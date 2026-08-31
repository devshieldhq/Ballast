// Swap the volatile asset into USDT via 1inch's aggregator on Base.
//
// IMPORTANT: 1inch's API has required an API key (from https://portal.1inch.dev)
// for a while now, and endpoint paths/versions shift. Verify the current path
// and auth scheme against https://portal.1inch.dev/documentation before
// relying on this — don't trust this file's URL as gospel, it's a starting
// shape, not a confirmed-working endpoint as of whenever you're reading this.

const CHAIN_ID = 8453 // Base mainnet
const ONEINCH_BASE = `https://api.1inch.dev/swap/v6.0/${CHAIN_ID}`

// Base mainnet token addresses — double check these on basescan.org before
// using real funds. Native ETH uses 1inch's convention address.
export const TOKENS = {
  ETH: '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
  USDT: '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2'
}

export async function getSwapQuote({ fromToken, toToken, amountWei, apiKey }) {
  const url = `${ONEINCH_BASE}/quote?src=${fromToken}&dst=${toToken}&amount=${amountWei}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } })
  if (!res.ok) throw new Error(`Quote failed: ${res.status}`)
  return res.json()
}

// Returns an unsigned tx object ready to hand to window.ethereum.
export async function buildSwapTx({ fromToken, toToken, amountWei, fromAddress, apiKey, slippagePct = 1 }) {
  const url = `${ONEINCH_BASE}/swap?src=${fromToken}&dst=${toToken}&amount=${amountWei}` +
    `&from=${fromAddress}&slippage=${slippagePct}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } })
  if (!res.ok) throw new Error(`Swap build failed: ${res.status}`)
  const { tx } = await res.json()
  return tx // { from, to, data, value, gas, gasPrice }
}

export async function sendSwap(tx) {
  // window.ethereum is the EVM provider Nimiq Pay injects — the native
  // approval dialog appears here, mediated by the host app.
  return window.ethereum.request({
    method: 'eth_sendTransaction',
    params: [tx]
  })
}
