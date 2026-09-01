// Swaps directly against Uniswap V3 on Base — no third-party aggregator,
// no API key. Addresses below are verified against official sources as of
// this writing (Uniswap's own deployments docs, Circle's USDC docs, and
// the OP Stack's standard WETH predeploy). Re-verify before relying on
// this with meaningful amounts — contract addresses don't change often,
// but "don't change often" isn't "never," and this is the one class of
// mistake that can't be undone.
import { ethers } from 'ethers'
import { ensureApproval } from './erc20.js'

const CHAIN_ID = 8453 // Base mainnet

export const TOKENS = {
  // OP Stack chains (Base, Optimism, etc.) all predeploy WETH9 at this
  // same address. Verify: basescan.org/address/0x4200...0006
  WETH: '0x4200000000000000000000000000000000000006',
  // Native USDC on Base, issued directly by Circle.
  // Verify: developers.circle.com/stablecoins/usdc-contract-addresses
  USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
}

// Verify: docs.uniswap.org/contracts/v3/reference/deployments/base-deployments
const SWAP_ROUTER_02 = '0x2626664c2603336E57B271c5C0b26F421741e481'
const QUOTER_V2 = '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a'

// The most liquid USDC/WETH pool on Base is currently the 0.05% tier.
// Confirm this still holds real liquidity at info.uniswap.org before
// relying on it — pool liquidity shifts over time, unlike contract addresses.
const POOL_FEE = 500

const ROUTER_ABI = [
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)',
  'function multicall(bytes[] calldata data) external payable returns (bytes[] memory results)',
  'function unwrapWETH9(uint256 amountMinimum, address recipient) external payable',
  'function refundETH() external payable'
]

const QUOTER_ABI = [
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)'
]

// A router-recognized sentinel meaning "send output to the router itself,"
// used when a second step (like unwrapping WETH to ETH) needs to happen
// in the same multicall before funds reach the user.
const ADDRESS_THIS = '0x00000000000000000000000000000000000002'

// Reads a real on-chain quote via Uniswap's Quoter contract. This is a
// state-changing-shaped call used in a read-only way (staticCall) — it
// doesn't actually execute a swap or cost gas, it simulates one.
async function getQuote(provider, { tokenIn, tokenOut, amountIn }) {
  const quoter = new ethers.Contract(QUOTER_V2, QUOTER_ABI, provider)
  const result = await quoter.quoteExactInputSingle.staticCall({
    tokenIn,
    tokenOut,
    amountIn,
    fee: POOL_FEE,
    sqrtPriceLimitX96: 0
  })
  return result.amountOut
}

function minOutWithSlippage(quotedAmountOut, slippagePct) {
  const bps = BigInt(Math.round(slippagePct * 100)) // e.g. 1% -> 100 bps
  return (quotedAmountOut * (10_000n - bps)) / 10_000n
}

// ETH -> USDC. Sends native ETH as msg.value; the router wraps it to WETH
// internally when tokenIn is WETH9, so no separate wrap step is needed.
export async function swapEthToUsdc(signer, amountWei, { slippagePct = 1 } = {}) {
  const provider = signer.provider
  const userAddress = await signer.getAddress()

  const quoted = await getQuote(provider, {
    tokenIn: TOKENS.WETH,
    tokenOut: TOKENS.USDC,
    amountIn: amountWei
  })
  const amountOutMinimum = minOutWithSlippage(quoted, slippagePct)

  const router = new ethers.Contract(SWAP_ROUTER_02, ROUTER_ABI, signer)
  const tx = await router.exactInputSingle(
    {
      tokenIn: TOKENS.WETH,
      tokenOut: TOKENS.USDC,
      fee: POOL_FEE,
      recipient: userAddress,
      amountIn: amountWei,
      amountOutMinimum,
      sqrtPriceLimitX96: 0
    },
    { value: amountWei }
  )
  return tx.wait()
}

// USDC -> ETH. Needs an approval first (USDC is an ERC-20, unlike native
// ETH), and needs a two-call multicall: swap into WETH held by the router
// itself, then unwrap that WETH into native ETH sent to the user.
export async function swapUsdcToEth(signer, amountUsdc, { slippagePct = 1 } = {}) {
  const provider = signer.provider
  const userAddress = await signer.getAddress()

  await ensureApproval(SWAP_ROUTER_02, TOKENS.USDC, amountUsdc, signer)

  const quoted = await getQuote(provider, {
    tokenIn: TOKENS.USDC,
    tokenOut: TOKENS.WETH,
    amountIn: amountUsdc
  })
  const amountOutMinimum = minOutWithSlippage(quoted, slippagePct)

  const router = new ethers.Contract(SWAP_ROUTER_02, ROUTER_ABI, signer)
  const routerInterface = new ethers.Interface(ROUTER_ABI)

  const swapCalldata = routerInterface.encodeFunctionData('exactInputSingle', [{
    tokenIn: TOKENS.USDC,
    tokenOut: TOKENS.WETH,
    fee: POOL_FEE,
    recipient: ADDRESS_THIS,
    amountIn: amountUsdc,
    amountOutMinimum,
    sqrtPriceLimitX96: 0
  }])
  const unwrapCalldata = routerInterface.encodeFunctionData('unwrapWETH9', [
    amountOutMinimum,
    userAddress
  ])

  const tx = await router.multicall([swapCalldata, unwrapCalldata])
  return tx.wait()
}
