// Records a shield event toward the public running total — hardened
// version. Unlike a naive counter, this does NOT trust anything the
// client reports. It takes only a transaction hash, independently reads
// that transaction from Base's own RPC, and only credits the total if
// the receipt contains a real Aave `Supply` event for the real USDC
// reserve. A client can't inflate the number by lying about an amount,
// because no client-supplied amount is ever used — the amount is read
// from the chain itself.
//
// What this does NOT protect against: someone running many small real
// supply transactions themselves to inflate the total. That's not
// spoofing though — it's real USDC, really supplied to Aave, really
// paying real gas each time. The number stays honest to what it claims
// to measure (verified on-chain volume), even if a determined person
// could still grind it up slowly at real cost to themselves.
//
// RPC note: uses Base's public https://mainnet.base.org endpoint, which
// Base's own docs label "rate limited, not for production." Fine for a
// competition-scale demo; if this ever needs to handle real traffic,
// swap in a paid provider (Alchemy/Infura/QuickNode all have free tiers
// well above the public endpoint's limits).
import { ethers } from 'ethers'
import { Redis } from '@upstash/redis'
import { AaveV3Base } from '@bgd-labs/aave-address-book'

// Vercel's Upstash Marketplace integration sets KV_REST_API_URL and
// KV_REST_API_TOKEN, not the plain UPSTASH_REDIS_REST_URL/TOKEN names
// @upstash/redis's Redis.fromEnv() looks for by default — so we build
// the client explicitly against the names Vercel actually provides.
const redis = new Redis({
  url: process.env.KV_REST_API_URL,
  token: process.env.KV_REST_API_TOKEN
})

const BASE_RPC = 'https://mainnet.base.org'
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const POOL_ADDRESS = AaveV3Base.POOL

const POOL_INTERFACE = new ethers.Interface([
  'event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)'
])

const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const txHash = req.body?.txHash
  if (typeof txHash !== 'string' || !TX_HASH_PATTERN.test(txHash)) {
    res.status(400).json({ error: 'Invalid transaction hash' })
    return
  }

  // Idempotent: a hash that's already been credited is never credited
  // again, whether from a retry, a resubmission, or an attempted replay.
  const alreadyCounted = await redis.sismember('ballast:counted_tx_hashes', txHash)
  if (alreadyCounted) {
    res.status(200).json({ ok: true, alreadyCounted: true })
    return
  }

  let receipt
  try {
    const provider = new ethers.JsonRpcProvider(BASE_RPC)
    receipt = await provider.getTransactionReceipt(txHash)
  } catch {
    res.status(502).json({ error: 'Could not reach Base RPC to verify this transaction' })
    return
  }

  if (!receipt || receipt.status !== 1) {
    res.status(422).json({ error: 'Transaction not found or not successful on Base' })
    return
  }

  // Find a genuine Supply event, emitted by Aave's real Pool contract,
  // for the real USDC reserve — not inferred, not assumed.
  let suppliedAmount = null
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== POOL_ADDRESS.toLowerCase()) continue
    let parsed
    try {
      parsed = POOL_INTERFACE.parseLog(log)
    } catch {
      continue // Not a Supply log on this contract — keep scanning.
    }
    if (parsed?.name === 'Supply' && parsed.args.reserve.toLowerCase() === USDC_ADDRESS.toLowerCase()) {
      suppliedAmount = parsed.args.amount
      break
    }
  }

  if (suppliedAmount === null) {
    res.status(422).json({ error: 'No matching Aave USDC supply event found in this transaction' })
    return
  }

  const amountUsd = Number(ethers.formatUnits(suppliedAmount, 6))

  await redis.sadd('ballast:counted_tx_hashes', txHash)
  await redis.incrbyfloat('ballast:total_shielded_usd', amountUsd)
  await redis.incr('ballast:total_shield_count')

  res.status(200).json({ ok: true, amountUsd })
}
