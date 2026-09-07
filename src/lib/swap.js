// Swaps directly against Uniswap V3 on Base — no aggregator, no API key.
// Addresses verified against official sources (Uniswap's deployments
// docs, Circle's USDC docs, the OP Stack WETH predeploy, Coinbase's and
// Lido's own token pages). Re-check before relying on this for
// meaningful amounts.
import { ethers } from 'ethers'
import { ensureApproval } from './erc20.js'

const CHAIN_ID = 8453 // Base mainnet

export const TOKENS = {
  // OP Stack chains (Base, Optimism, etc.) all predeploy WETH9 here.
  // Verify: basescan.org/address/0x4200...0006
  WETH: '0x4200000000000000000000000000000000000006',
  // Native USDC on Base, issued directly by Circle.
  // Verify: developers.circle.com/stablecoins/usdc-contract-addresses
  USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  // Coinbase Wrapped Staked ETH. Verify: coinbase.com/cbeth
  CBETH: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',
  // Lido Wrapped stETH, official Base deployment. Verify: docs.lido.fi/deployed-contracts
  WSTETH: '0xc1CBa3fCea344f92D9239c08C0568f6F2F0ee452',
  // Coinbase Wrapped BTC. Verify: coinbase.com/cbbtc
  CBBTC: '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf'
}

// Decimals per token — needed to parse/format amounts correctly.
// cbETH and wstETH follow the standard 18 decimals used by ETH-denominated
// tokens; cbBTC uses 8, confirmed on its Basescan token page.
export const DECIMALS = {
  ETH: 18,
  USDC: 6,
  CBETH: 18,
  WSTETH: 18,
  CBBTC: 8
}

// Verify: docs.uniswap.org/contracts/v3/reference/deployments/base-deployments
export const SWAP_ROUTER_02 = '0x2626664c2603336E57B271c5C0b26F421741e481'
const QUOTER_V2 = '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a'

// The ETH/USDC pair's most liquid pool on Base is the 0.05% tier as of
// writing. Confirm at info.uniswap.org before relying on it.
const ETH_USDC_POOL_FEE = 500

// For the newer pairs (cbETH, wstETH, cbBTC against USDC), pool liquidity
// per fee tier isn't something that can be verified from this codebase
// with confidence — it shifts, and differs per pair. Rather than guess a
// single tier and risk a failed or badly-priced swap, every quote tries
// each common tier and uses whichever actually returns a real, valid
// price. This is slower (up to 3 calls instead of 1) but doesn't rely on
// an assumption that could be wrong.
const CANDIDATE_FEE_TIERS = [500, 3000, 10000]

const ROUTER_ABI = [
  'function exactInputSingle((address tokenIn, address tokenOut, uint24 fee, address recipient, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96) params) external payable returns (uint256 amountOut)',
  'function multicall(bytes[] calldata data) external payable returns (bytes[] memory results)',
  'function unwrapWETH9(uint256 amountMinimum, address recipient) external payable',
  'function refundETH() external payable'
]

const QUOTER_ABI = [
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)'
]

// A router sentinel meaning "send output to the router itself" — used
// when a second step (unwrapping WETH) needs to happen in the same
// multicall before funds reach the user.
const ADDRESS_THIS = '0x00000000000000000000000000000000000002'

// Simulates a swap via Uniswap's Quoter contract (staticCall — no gas,
// no state change) against one specific fee tier.
async function getQuoteAtFee(provider, { tokenIn, tokenOut, amountIn, fee }) {
  const quoter = new ethers.Contract(QUOTER_V2, QUOTER_ABI, provider)
  const result = await quoter.quoteExactInputSingle.staticCall({
    tokenIn,
    tokenOut,
    amountIn,
    fee,
    sqrtPriceLimitX96: 0
  })
  return result.amountOut
}

// Tries each candidate fee tier and returns the best real quote found.
// Throws a clear error if no pool exists at any of them, rather than
// letting a cryptic revert surface from deeper in the call stack.
async function getBestQuote(provider, { tokenIn, tokenOut, amountIn }) {
  const attempts = await Promise.allSettled(
    CANDIDATE_FEE_TIERS.map(fee =>
      getQuoteAtFee(provider, { tokenIn, tokenOut, amountIn, fee }).then(amountOut => ({ fee, amountOut }))
    )
  )
  const successes = attempts
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value)

  if (successes.length === 0) {
    throw new Error('No Uniswap pool with liquidity found for this pair on Base')
  }
  return successes.reduce((best, cur) => (cur.amountOut > best.amountOut ? cur : best))
}

function minOutWithSlippage(quotedAmountOut, slippagePct) {
  const bps = BigInt(Math.round(slippagePct * 100)) // e.g. 1% -> 100 bps
  return (quotedAmountOut * (10_000n - bps)) / 10_000n
}

// ETH -> USDC. Router auto-wraps ETH sent as msg.value when tokenIn is WETH9.
export async function swapEthToUsdc(signer, amountWei, { slippagePct = 1 } = {}) {
  const provider = signer.provider
  const userAddress = await signer.getAddress()

  const quoted = await getQuoteAtFee(provider, {
    tokenIn: TOKENS.WETH,
    tokenOut: TOKENS.USDC,
    amountIn: amountWei,
    fee: ETH_USDC_POOL_FEE
  })
  const amountOutMinimum = minOutWithSlippage(quoted, slippagePct)

  const router = new ethers.Contract(SWAP_ROUTER_02, ROUTER_ABI, signer)
  const tx = await router.exactInputSingle(
    {
      tokenIn: TOKENS.WETH,
      tokenOut: TOKENS.USDC,
      fee: ETH_USDC_POOL_FEE,
      recipient: userAddress,
      amountIn: amountWei,
      amountOutMinimum,
      sqrtPriceLimitX96: 0
    },
    { value: amountWei }
  )
  return tx.wait()
}

// USDC -> ETH. Needs approval first, then a multicall: swap into WETH
// held by the router, then unwrap to native ETH for the user.
export async function swapUsdcToEth(signer, amountUsdc, { slippagePct = 1 } = {}) {
  const provider = signer.provider
  const userAddress = await signer.getAddress()

  await ensureApproval(SWAP_ROUTER_02, TOKENS.USDC, amountUsdc, signer)

  const quoted = await getQuoteAtFee(provider, {
    tokenIn: TOKENS.USDC,
    tokenOut: TOKENS.WETH,
    amountIn: amountUsdc,
    fee: ETH_USDC_POOL_FEE
  })
  const amountOutMinimum = minOutWithSlippage(quoted, slippagePct)

  const router = new ethers.Contract(SWAP_ROUTER_02, ROUTER_ABI, signer)
  const routerInterface = new ethers.Interface(ROUTER_ABI)

  const swapCalldata = routerInterface.encodeFunctionData('exactInputSingle', [{
    tokenIn: TOKENS.USDC,
    tokenOut: TOKENS.WETH,
    fee: ETH_USDC_POOL_FEE,
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

// Generic ERC20 -> USDC swap, used for cbETH, wstETH, cbBTC (anything
// that isn't native ETH or USDC itself). Single-hop only — if a pair has
// no direct pool against USDC at any of the candidate fee tiers, this
// throws clearly rather than silently routing through an intermediate
// hop. That's a real, disclosed limitation: a token with only a WETH pool
// and no direct USDC pool won't work here yet.
export async function swapTokenToUsdc(signer, tokenAddress, amountIn, { slippagePct = 1 } = {}) {
  const provider = signer.provider
  const userAddress = await signer.getAddress()

  await ensureApproval(SWAP_ROUTER_02, tokenAddress, amountIn, signer)

  const { fee, amountOut: quoted } = await getBestQuote(provider, {
    tokenIn: tokenAddress,
    tokenOut: TOKENS.USDC,
    amountIn
  })
  const amountOutMinimum = minOutWithSlippage(quoted, slippagePct)

  const router = new ethers.Contract(SWAP_ROUTER_02, ROUTER_ABI, signer)
  const tx = await router.exactInputSingle({
    tokenIn: tokenAddress,
    tokenOut: TOKENS.USDC,
    fee,
    recipient: userAddress,
    amountIn,
    amountOutMinimum,
    sqrtPriceLimitX96: 0
  })
  return tx.wait()
}
