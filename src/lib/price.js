// Public, keyless price feed. Swap the coingecko id if you shield a
// different asset than ETH.
const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true'

// Tune this: 5% is a reasonable "meaningfully volatile" threshold for a
// same-day move. Not a model, just a trigger point you can adjust.
export const VOLATILITY_THRESHOLD_PCT = 5

export async function getMarketSnapshot() {
  const res = await fetch(COINGECKO_URL)
  if (!res.ok) throw new Error('Price feed unavailable')
  const data = await res.json()
  const price = data.ethereum.usd
  const change24h = data.ethereum.usd_24h_change

  return {
    price,
    change24h,
    isVolatile: Math.abs(change24h) >= VOLATILITY_THRESHOLD_PCT
  }
}
