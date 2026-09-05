import { ethers } from 'ethers'
import { connectWallet } from './sdk/wallet.js'
import { startMarketMonitor, subscribeMarket, getMarketHistory } from './lib/price.js'
import { swapEthToUsdc, swapUsdcToEth, TOKENS, SWAP_ROUTER_02 } from './lib/swap.js'
import { supply, withdraw, WITHDRAW_ALL, getUsdcSupplyApy, getShieldedUsdcBalance, POOL_ADDRESS } from './lib/aave.js'
import { getEthBalance, getTokenBalance, parseReceivedAmount } from './lib/erc20.js'
import { getActivity, addActivityEvent } from './lib/activity.js'

const el = {
  statsLine: document.getElementById('stats-line'),
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
  shareLink: document.getElementById('share-link'),
  linkRouter: document.getElementById('link-router'),
  linkPool: document.getElementById('link-pool'),
  positionSince: document.getElementById('position-since'),
  activityCard: document.getElementById('activity-card'),
  activityList: document.getElementById('activity-list'),
  amountCard: document.getElementById('amount-card'),
  amountInput: document.getElementById('amount-input'),
  balanceNote: document.getElementById('balance-note'),
  assetButtons: document.querySelectorAll('.asset-btn'),
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
  usdcWalletBalance: 0n, // USDC sitting in the wallet, separate from what's shielded in Aave
  shieldAsset: 'ETH', // which asset the user is shielding FROM
  unshieldAsset: 'ETH', // which asset the user wants back when unshielding
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
    const display = Number(ethers.formatUnits(state.shieldedUsdcAmount, 6)).toFixed(2)
    el.shieldedAmount.textContent = `$${display}`
    el.apyValue.textContent = 'earning'
    el.explorerLink.href = `https://basescan.org/address/${state.address}`
    el.positionSince.textContent = state.shieldedAt
      ? `Shielded ${new Date(state.shieldedAt).toLocaleString()}`
      : ''

    const shareText = `Just shielded $${display} from volatility using Ballast — ` +
      `a Nimiq Pay Mini App that auto-parks crypto into USDC and Aave yield when markets get rough.`
    const shareUrl = window.location.origin
    el.shareLink.href = `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(shareUrl)}`
  }
}

function renderActivity() {
  if (!state.address) return
  const events = getActivity(state.address)
  el.activityCard.classList.toggle('hidden', events.length === 0)
  if (events.length === 0) return

  el.activityList.innerHTML = events.map(ev => {
    const label = ev.type === 'shield' ? 'Shielded' : 'Unshielded'
    const when = new Date(ev.timestamp).toLocaleString()
    const link = ev.txHash
      ? `<a href="https://basescan.org/tx/${ev.txHash}" target="_blank" rel="noopener">View ↗</a>`
      : ''
    return `<li class="activity-item">
      <div><strong>${label}</strong> $${ev.amount}</div>
      <div class="muted">${when} ${link}</div>
    </li>`
  }).join('')
}

function renderAmountCard() {
  const show = state.connected && !state.shielded
  el.amountCard.classList.toggle('hidden', !show)
  if (!show) return

  if (state.shieldAsset === 'ETH') {
    const balanceEth = ethers.formatEther(state.ethBalance)
    const spendable = Math.max(0, Number(balanceEth) - GAS_BUFFER_ETH)
    el.balanceNote.textContent = `Balance: ${Number(balanceEth).toFixed(4)} ETH ` +
      `(up to ${spendable.toFixed(4)} shieldable, ${GAS_BUFFER_ETH} reserved for gas)`
  } else {
    const balanceUsdc = ethers.formatUnits(state.usdcWalletBalance, 6)
    const ethForGas = ethers.formatEther(state.ethBalance)
    el.balanceNote.textContent = `Balance: $${Number(balanceUsdc).toFixed(2)} USDC ` +
      `(still needs a small amount of ETH for gas — you have ${Number(ethForGas).toFixed(4)})`
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
  state.usdcWalletBalance = await getTokenBalance(provider, TOKENS.USDC, state.address).catch(() => 0n)
  const shieldedBalance = await getShieldedUsdcBalance(provider, state.address).catch(() => 0n)
  state.shieldedUsdcAmount = shieldedBalance
  state.shielded = shieldedBalance > 0n
  const apy = await getUsdcSupplyApy(provider).catch(() => null)
  if (apy != null) el.apyValue.textContent = `${apy.toFixed(2)}% APY`
  renderPosition()
  renderActivity()
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
  const inputAmount = Number(el.amountInput.value)
  if (!inputAmount || inputAmount <= 0) {
    setStatus('Enter an amount to shield')
    return
  }

  el.actionBtn.disabled = true

  try {
    let usdcReceived
    let supplyReceipt

    if (state.shieldAsset === 'ETH') {
      const maxSpendable = Number(ethers.formatEther(state.ethBalance)) - GAS_BUFFER_ETH
      if (inputAmount > maxSpendable) {
        setStatus(`That's more than your spendable balance (${maxSpendable.toFixed(4)} ETH)`)
        el.actionBtn.disabled = false
        return
      }
      const amountWei = ethers.parseEther(inputAmount.toString())

      setStatus('Confirm the swap in your wallet…')
      const swapReceipt = await swapEthToUsdc(signer, amountWei)

      // Read what actually landed in the wallet, not what the quote predicted —
      // even with slippage protection, the exact figure can differ slightly.
      usdcReceived = parseReceivedAmount(swapReceipt, TOKENS.USDC, state.address)

      setStatus('Confirm the Aave supply in your wallet…')
      supplyReceipt = await supply(TOKENS.USDC, usdcReceived, signer)
    } else {
      // USDC selected — no swap needed at all, supply it directly.
      const maxUsdc = Number(ethers.formatUnits(state.usdcWalletBalance, 6))
      if (inputAmount > maxUsdc) {
        setStatus(`That's more than your USDC balance ($${maxUsdc.toFixed(2)})`)
        el.actionBtn.disabled = false
        return
      }
      if (state.ethBalance === 0n) {
        setStatus('You still need a small amount of ETH to pay for gas')
        el.actionBtn.disabled = false
        return
      }
      usdcReceived = ethers.parseUnits(inputAmount.toFixed(6), 6)

      setStatus('Confirm the Aave supply in your wallet…')
      supplyReceipt = await supply(TOKENS.USDC, usdcReceived, signer)
    }

    state.shielded = true
    state.shieldedUsdcAmount = usdcReceived
    state.shieldedAt = Date.now()
    addActivityEvent(state.address, {
      type: 'shield',
      amount: Number(ethers.formatUnits(usdcReceived, 6)).toFixed(2),
      timestamp: state.shieldedAt,
      txHash: supplyReceipt.hash
    })
    reportShieldToPublicStats(supplyReceipt.hash)
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

    let finalTxHash = withdrawReceipt.hash
    if (state.unshieldAsset === 'ETH') {
      setStatus('Confirm the swap back to ETH…')
      const swapBackReceipt = await swapUsdcToEth(signer, usdcWithdrawn)
      finalTxHash = swapBackReceipt.hash
    }
    // If unshieldAsset is USDC, the withdrawn USDC just stays in the
    // wallet — no swap needed.

    state.shielded = false
    state.shieldedUsdcAmount = 0n
    state.shieldedAt = null
    addActivityEvent(state.address, {
      type: 'unshield',
      amount: Number(ethers.formatUnits(usdcWithdrawn, 6)).toFixed(2),
      timestamp: Date.now(),
      txHash: finalTxHash
    })
    setStatus('Unshielded')
  } catch (err) {
    setStatus(err.message)
  }

  await refreshBalance()
  renderPosition()
  renderAmountCard()
  renderButton()
}

el.assetButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const { role, asset } = btn.dataset
    if (role === 'shield') {
      state.shieldAsset = asset
    } else {
      state.unshieldAsset = asset
    }
    document.querySelectorAll(`.asset-btn[data-role="${role}"]`).forEach(b => {
      b.classList.toggle('active', b.dataset.asset === asset)
    })
    renderAmountCard()
  })
})

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
loadPublicStats()
el.linkRouter.href = `https://basescan.org/address/${SWAP_ROUTER_02}`
el.linkPool.href = `https://basescan.org/address/${POOL_ADDRESS}`

// Best-effort — the /api endpoints need Upstash Redis configured in
// Vercel to actually work. Until then, this quietly does nothing rather
// than showing a broken or fake stat.
async function loadPublicStats() {
  try {
    const res = await fetch('/api/stats')
    if (!res.ok) return
    const { totalShieldedUsd, totalShieldCount } = await res.json()
    if (!totalShieldCount) return
    el.statsLine.innerHTML =
      `<strong>$${totalShieldedUsd.toLocaleString(undefined, { maximumFractionDigits: 0 })}</strong> ` +
      `shielded so far across ${totalShieldCount} session${totalShieldCount === 1 ? '' : 's'}`
    el.statsLine.classList.remove('hidden')
  } catch {
    // No backend configured yet, or offline — stat stays hidden.
  }
}

// Sends only the transaction hash — the server verifies the real amount
// on-chain itself rather than trusting anything reported here.
async function reportShieldToPublicStats(txHash) {
  try {
    await fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ txHash })
    })
  } catch {
    // Non-critical — the shield itself already succeeded on-chain.
  }
}
