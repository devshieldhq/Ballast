// Run this once, locally, to prove the verification logic in api/track.js
// actually works against a real transaction — not just that it compiles.
//
// Usage:
//   node verify-track-logic.mjs
//
// It finds a real, recent Aave USDC Supply event on Base and runs it
// through the exact same parsing logic api/track.js uses, so you can see
// the real amount get extracted correctly before trusting this with
// anything live.
import { ethers } from 'ethers'
import { AaveV3Base } from '@bgd-labs/aave-address-book'

const provider = new ethers.JsonRpcProvider('https://mainnet.base.org')
const POOL_ADDRESS = AaveV3Base.POOL
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'

const POOL_INTERFACE = new ethers.Interface([
  'event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)'
])

const latest = await provider.getBlockNumber()
console.log('Pool address:', POOL_ADDRESS)
console.log('Latest block:', latest)

const logs = await provider.getLogs({
  address: POOL_ADDRESS,
  topics: [ethers.id('Supply(address,address,address,uint256,uint16)')],
  fromBlock: latest - 20000,
  toBlock: latest
})

console.log(`Found ${logs.length} Supply events in the last ~20,000 blocks\n`)
if (logs.length === 0) {
  console.log('No recent Supply events found — try a wider block range.')
  process.exit(0)
}

const sampleTxHash = logs[logs.length - 1].transactionHash
console.log('Testing against real tx:', sampleTxHash)
console.log('View it yourself: https://basescan.org/tx/' + sampleTxHash + '\n')

// This is the exact logic from api/track.js, run against a real receipt.
const receipt = await provider.getTransactionReceipt(sampleTxHash)
let suppliedAmount = null
for (const log of receipt.logs) {
  if (log.address.toLowerCase() !== POOL_ADDRESS.toLowerCase()) continue
  try {
    const parsed = POOL_INTERFACE.parseLog(log)
    if (parsed?.name === 'Supply' && parsed.args.reserve.toLowerCase() === USDC_ADDRESS.toLowerCase()) {
      suppliedAmount = parsed.args.amount
      break
    }
  } catch {}
}

if (suppliedAmount === null) {
  console.log('❌ This particular tx was a Supply of a different asset, not USDC. Try another block range.')
} else {
  console.log(`✅ Parsed successfully — verified USDC supply amount: $${ethers.formatUnits(suppliedAmount, 6)}`)
}
