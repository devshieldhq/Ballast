import { ethers } from 'ethers'
import { connectWallet } from './sdk/wallet.js'
import { startMarketMonitor, subscribeMarket, getMarketHistory } from './lib/price.js'
import { swapEthToUsdc, swapUsdcToEth, TOKENS } from './lib/swap.js'
import { supply, withdraw, WITHDRAW_ALL, getUsdcSupplyApy, getShieldedUsdcBalance } from './lib/aave.js'
import { getEthBalance, parseReceivedAmount } from './lib/erc20.js'

const el = {
  landing: document.getElementById('landing'),
  openAppBtn: document.getElementById('open-app-btn'),
  appShell: document.getElementById('app-shell'),
  walletBadge: document.getElementById('wallet-badge'),
  price: document.getElementById('price-value'),
  change: document.getElementById('change-value'),
  volNote: document.getElementById('volatility-note'),
  liveBadge: document.getElementById('live-badge'),
  riskLevel: document.getElementById('risk-level'),
  shortVol: document.getElementById('short-vol'),
  updated: document.getElementById('updated-at'),
  chart: document.getElementById('market-chart'),
  positionEmpty: document.getElementById('position-empty'),
  positionActive: document.getElementById('position-active'),
  shieldedAmount: document.getElementById('shielded-amount'),
  apyValue: document.getElementById('apy-value'),
  explorerLink: document.getElementById('position-explorer-link'),
  positionSince: document.getElementById('position-since'),
  amountCard: document.getElementById('amount-card'),
  amountInput: document.getElementById('amount-input'),
  balanceNote: document.getElementById('balance-note'),
  actionBtn: document.getElementById('action-btn'),
  status: document.getElementById('status-line')
}

// Reserve some ETH for gas so "shield everything" doesn't leave the wallet
// unable to pay for its own transactions. Adjust for actual Base gas costs.
const GAS_BUFFER_ETH = 0.003

let provider = null
let signer = null
let state = {
  connected: false,
  address: null,
  ethBalance: 0n,
  shielded: false,
  shieldedUsdcAmount: 0n, // real on-chain amount, set only after a confirmed tx
  shieldedAt: null // only known within this session; not persisted
}

function setStatus(text) {
  el.status.textContent = text || ''
}

function renderMarket(snapshot) {
  el.price.textContent = `$${snapshot.price.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  el.change.textContent = `${snapshot.change24h > 0 ? '+' : ''}${snapshot.change24h.toFixed(2)}%`
  el.change.className = `change ${snapshot.change24h >= 0 ? 'up' : 'down'}`

  const labels = { calm: 'CALM', watch: 'WATCH', high: 'HIGH RISK', critical: 'CRITICAL' }
  el.riskLevel.textContent = labels[snapshot.riskLevel] || 'WATCH'
  el.riskLevel.className = `risk ${snapshot.riskLevel}`
  el.shortVol.textContent = `${snapshot.shortTermVolatility.toFixed(2)}% / 1m`
  el.liveBadge.textContent = snapshot.live ? '● LIVE' : '○ RECONNECTING'
  el.liveBadge.className = snapshot.live ? 'live-badge live' : 'live-badge'
  el.updated.textContent = `Updated ${new Date(snapshot.updatedAt).toLocaleTimeString()}`
  renderChart()
  el.volNote.textContent = snapshot.isVolatile
    ? 'Volatility is elevated — consider shielding'
    : 'Market looks calm right now'
}

function renderChart() {
  const points = getMarketHistory()
  if (!el.chart || points.length < 2) return
  const values = points.map(p => p.price)
  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const width = 440
  const height = 90
  const padTop = 18
  const padBottom = 8
  const plotHeight = height - padTop - padBottom

  const coords = points.map((p, i) => {
    const x = (i / Math.max(points.length - 1, 1)) * width
    const y = padTop + (1 - (p.price - min) / range) * plotHeight
    return [x, y]
  })
  const linePoints = coords.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const areaPoints = `0,${height} ${linePoints} ${width},${height}`
  const fmt = v => `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`

  el.chart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img">
      <polygon points="${areaPoints}" fill="currentColor" opacity="0.12" />
      <line x1="0" y1="${padTop}" x2="${width}" y2="${padTop}" stroke="currentColor" stroke-width="1" opacity="0.15" vector-effect="non-scaling-stroke" />
      <line x1="0" y1="${height - padBottom}" x2="${width}" y2="${height - padBottom}" stroke="currentColor" stroke-width="1" opacity="0.15" vector-effect="non-scaling-stroke" />
      <polyline points="${linePoints}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" />
    </svg>
    <span class="chart-label chart-label-high">${fmt(max)}</span>
    <span class="chart-label chart-label-low">${fmt(min)}</span>
  `
}

function renderPosition() {
  el.positionEmpty.classList.toggle('hidden', state.shielded)
  el.positionActive.classList.toggle('hidden', !state.shielded)
  if (state.shielded) {
    const display = ethers.formatUnits(state.shieldedUsdcAmount, 6)
    el.shieldedAmount.textContent = `$${Number(display).toFixed(2)}`
    el.apyValue.textContent = 'earning'
    el.explorerLink.href = `https://basescan.org/address/${state.address}`
    el.positionSince.textContent = state.shieldedAt
      ? `Shielded ${new Date(state.shieldedAt).toLocaleString()}`
      : ''
  }
}

function renderAmountCard() {
  const show = state.connected && !state.shielded
  el.amountCard.classList.toggle('hidden', !show)
  if (show) {
    const balanceEth = ethers.formatEther(state.ethBalance)
    const spendable = Math.max(0, Number(balanceEth) - GAS_BUFFER_ETH)
    el.balanceNote.textContent = `Balance: ${Number(balanceEth).toFixed(4)} ETH ` +
      `(up to ${spendable.toFixed(4)} shieldable, ${GAS_BUFFER_ETH} reserved for gas)`
  }
}

function renderButton() {
  if (!state.connected) {
    el.actionBtn.textContent = 'Connect wallet'
  } else if (!state.shielded) {
    el.actionBtn.textContent = 'Shield my funds'
  } else {
    el.actionBtn.textContent = 'Unshield'
  }
  el.actionBtn.disabled = false
}

async function refreshMarket() {
  try {
    await startMarketMonitor()
  } catch {
    el.volNote.textContent = 'Could not reach the price feed'
  }
}

async function refreshBalance() {
  if (!state.connected) return
  state.ethBalance = await getEthBalance(provider, state.address)
  const shieldedBalance = await getShieldedUsdcBalance(provider, state.address).catch(() => 0n)
  state.shieldedUsdcAmount = shieldedBalance
  state.shielded = shieldedBalance > 0n
  const apy = await getUsdcSupplyApy(provider).catch(() => null)
  if (apy != null) el.apyValue.textContent = `${apy.toFixed(2)}% APY`
  renderPosition()
  renderAmountCard()
}

async function handleConnect() {
  setStatus('Connecting…')
  el.actionBtn.disabled = true
  try {
    const { address, isNimiqPay } = await connectWallet()
    provider = new ethers.BrowserProvider(window.ethereum)
    signer = await provider.getSigner()
    state.connected = true
    state.address = address
    const modeTag = isNimiqPay ? '' : ' (browser test mode)'
    el.walletBadge.textContent = `${address.slice(0, 6)}…${address.slice(-4)}${modeTag}`
    el.walletBadge.classList.add('connected')
    await refreshBalance()
    setStatus('')
  } catch (err) {
    setStatus(err.message)
  }
  renderButton()
}

async function handleShield() {
  const inputEth = Number(el.amountInput.value)
  if (!inputEth || inputEth <= 0) {
    setStatus('Enter an amount to shield')
    return
  }
  const maxSpendable = Number(ethers.formatEther(state.ethBalance)) - GAS_BUFFER_ETH
  if (inputEth > maxSpendable) {
    setStatus(`That's more than your spendable balance (${maxSpendable.toFixed(4)} ETH)`)
    return
  }

  el.actionBtn.disabled = true
  const amountWei = ethers.parseEther(inputEth.toString())

  try {
    setStatus('Confirm the swap in your wallet…')
    const swapReceipt = await swapEthToUsdc(signer, amountWei)

    // Read what actually landed in the wallet, not what the quote predicted —
    // even with slippage protection, the exact figure can differ slightly.
    const usdcReceived = parseReceivedAmount(swapReceipt, TOKENS.USDC, state.address)

    setStatus('Confirm the Aave supply in your wallet…')
    await supply(TOKENS.USDC, usdcReceived, signer)

    state.shielded = true
    state.shieldedUsdcAmount = usdcReceived
    state.shieldedAt = Date.now()
    setStatus('Shielded')
  } catch (err) {
    setStatus(err.message)
  }

  await refreshBalance()
  renderPosition()
  renderAmountCard()
  renderButton()
}

async function handleUnshield() {
  el.actionBtn.disabled = true
  try {
    setStatus('Confirm the Aave withdrawal in your wallet…')
    // Withdraw everything (principal + any accrued interest) rather than
    // re-supplying a remembered figure that could drift from the truth.
    const withdrawReceipt = await withdraw(TOKENS.USDC, WITHDRAW_ALL, signer)
    const usdcWithdrawn = parseReceivedAmount(withdrawReceipt, TOKENS.USDC, state.address)

    setStatus('Confirm the swap back to ETH…')
    await swapUsdcToEth(signer, usdcWithdrawn)

    state.shielded = false
    state.shieldedUsdcAmount = 0n
    state.shieldedAt = null
    setStatus('Unshielded')
  } catch (err) {
    setStatus(err.message)
  }

  await refreshBalance()
  renderPosition()
  renderAmountCard()
  renderButton()
}

el.openAppBtn.addEventListener('click', () => {
  el.landing.classList.add('hidden')
  el.appShell.classList.remove('hidden')
})

el.actionBtn.addEventListener('click', () => {
  if (!state.connected) return handleConnect()
  if (!state.shielded) return handleShield()
  return handleUnshield()
})

subscribeMarket(renderMarket)
refreshMarket()
renderButton()
