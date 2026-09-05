// Verifies a real Aave Supply event on-chain before crediting the public
// total. Only takes a tx hash — the amount is read from the chain, never
// trusted from the client, so it can't be spoofed by lying about a number.
//
// Not protected against: someone running many small real supply txs to
// grind the total up. That's real volume at real cost though, not fake data.
//
// Uses Base's public RPC (mainnet.base.org), which Base's docs mark
// "rate limited, not for production." Fine at this scale; swap in a paid
// provider (Alchemy/Infura/QuickNode) if traffic grows.
import { ethers } from 'ethers'
import { Redis } from '@upstash/redis'
import { AaveV3Base } from '@bgd-labs/aave-address-book'

// Vercel's Upstash Marketplace integration uses KV_REST_API_URL /
// KV_REST_API_TOKEN, not the UPSTASH_REDIS_REST_* names Redis.fromEnv()
// defaults to.
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

  let suppliedAmount = null
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== POOL_ADDRESS.toLowerCase()) continue
    let parsed
    try {
      parsed = POOL_INTERFACE.parseLog(log)
    } catch {
      continue
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
