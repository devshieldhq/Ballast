const COINGECKO_URL =
  'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true'

export const VOLATILITY_THRESHOLD_PCT = 5
export const HIGH_VOLATILITY_PCT = 8

let socket = null
let socketTimer = null
let listeners = new Set()
let lastSnapshot = null
let prices = []
let connected = false

function classify(change24h, shortTermVolatility) {
  const score = Math.max(Math.abs(change24h), shortTermVolatility)
  if (score >= HIGH_VOLATILITY_PCT) return 'critical'
  if (score >= VOLATILITY_THRESHOLD_PCT) return 'high'
  if (score >= 2) return 'watch'
  return 'calm'
}

function makeSnapshot(price, change24h, source = 'live') {
  const now = Date.now()
  prices.push({ price, time: now })
  prices = prices.filter(p => now - p.time <= 60 * 60 * 1000)

  const oneMinuteAgo = prices.find(p => now - p.time >= 60_000)
  const shortTermVolatility = oneMinuteAgo
    ? Math.abs(((price - oneMinuteAgo.price) / oneMinuteAgo.price) * 100)
    : 0
  const riskLevel = classify(change24h, shortTermVolatility)

  return {
    price,
    change24h: Number(change24h) || 0,
    shortTermVolatility,
    riskLevel,
    isVolatile: riskLevel === 'high' || riskLevel === 'critical',
    source,
    updatedAt: now,
    live: connected
  }
}

function emit(snapshot) {
  lastSnapshot = snapshot
  listeners.forEach(fn => fn(snapshot))
}

function connectLiveFeed() {
  if (typeof WebSocket === 'undefined') return false
  try {
    socket = new WebSocket('wss://stream.binance.com:9443/ws/ethusdt@trade')
    socket.onopen = () => {
      connected = true
      if (lastSnapshot) emit({ ...lastSnapshot, live: true })
    }
    socket.onmessage = event => {
      const data = JSON.parse(event.data)
      const price = Number(data.p)
      if (!Number.isFinite(price)) return
      const change24h = lastSnapshot?.change24h ?? 0
      emit(makeSnapshot(price, change24h, 'Binance WebSocket'))
    }
    socket.onerror = () => { connected = false }
    socket.onclose = () => {
      connected = false
      clearTimeout(socketTimer)
      socketTimer = setTimeout(connectLiveFeed, 3000)
    }
    return true
  } catch {
    connected = false
    return false
  }
}

async function refreshReferenceData() {
  const res = await fetch(COINGECKO_URL, { cache: 'no-store' })
  if (!res.ok) throw new Error('Price feed unavailable')
  const data = await res.json()
  const price = Number(data.ethereum.usd)
  const change24h = Number(data.ethereum.usd_24h_change)
  const livePrice = lastSnapshot?.price || price
  emit(makeSnapshot(livePrice, change24h, 'CoinGecko'))
}

export function getMarketHistory() { return prices.slice() }

export function subscribeMarket(listener) {
  listeners.add(listener)
  if (lastSnapshot) listener(lastSnapshot)
  return () => listeners.delete(listener)
}

export async function getMarketSnapshot() {
  if (!lastSnapshot) await refreshReferenceData()
  return lastSnapshot
}

export async function startMarketMonitor() {
  await refreshReferenceData()
  connectLiveFeed()
  // 24h change is refreshed separately because the trade stream only carries price.
  setInterval(() => refreshReferenceData().catch(() => {}), 30_000)
  return lastSnapshot
}
