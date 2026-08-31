import { ethers } from 'ethers'
import { connectWallet } from './sdk/wallet.js'
import { getMarketSnapshot } from './lib/price.js'
import { buildSwapTx, sendSwap, TOKENS } from './lib/swap.js'
import { supply, withdraw, WITHDRAW_ALL } from './lib/aave.js'
import { getEthBalance, parseReceivedAmount } from './lib/erc20.js'

const el = {
  walletBadge: document.getElementById('wallet-badge'),
  price: document.getElementById('price-value'),
  change: document.getElementById('change-value'),
  volNote: document.getElementById('volatility-note'),
  positionEmpty: document.getElementById('position-empty'),
  positionActive: document.getElementById('position-active'),
  shieldedAmount: document.getElementById('shielded-amount'),
  apyValue: document.getElementById('apy-value'),
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
let state = {
  connected: false,
  address: null,
  apiKey: import.meta.env.VITE_ONEINCH_API_KEY,
  ethBalance: 0n,
  shielded: false,
  shieldedUsdtAmount: 0n // real on-chain amount, set only after a confirmed tx
}

function setStatus(text) {
  el.status.textContent = text || ''
}

function renderMarket(snapshot) {
  el.price.textContent = `$${snapshot.price.toLocaleString()}`
  el.change.textContent = `${snapshot.change24h > 0 ? '+' : ''}${snapshot.change24h.toFixed(2)}%`
  el.change.className = `change ${snapshot.change24h >= 0 ? 'up' : 'down'}`
  el.volNote.textContent = snapshot.isVolatile
    ? 'Volatility is elevated — consider shielding'
    : 'Market looks calm right now'
}

function renderPosition() {
  el.positionEmpty.classList.toggle('hidden', state.shielded)
  el.positionActive.classList.toggle('hidden', !state.shielded)
  if (state.shielded) {
    const display = ethers.formatUnits(state.shieldedUsdtAmount, 6)
    el.shieldedAmount.textContent = `$${Number(display).toFixed(2)}`
    el.apyValue.textContent = 'earning'
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
    const snapshot = await getMarketSnapshot()
    renderMarket(snapshot)
  } catch {
    el.volNote.textContent = 'Could not reach the price feed'
  }
}

async function refreshBalance() {
  if (!state.connected) return
  state.ethBalance = await getEthBalance(provider, state.address)
  renderAmountCard()
}

async function handleConnect() {
  setStatus('Connecting…')
  el.actionBtn.disabled = true
  try {
    const { address } = await connectWallet()
    provider = new ethers.BrowserProvider(window.ethereum)
    state.connected = true
    state.address = address
    el.walletBadge.textContent = `${address.slice(0, 6)}…${address.slice(-4)}`
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
  const amountWei = ethers.parseEther(inputEth.toString()).toString()

  try {
    setStatus('Building swap…')
    const tx = await buildSwapTx({
      fromToken: TOKENS.ETH,
      toToken: TOKENS.USDT,
      amountWei,
      fromAddress: state.address,
      apiKey: state.apiKey
    })

    setStatus('Confirm the swap in your wallet…')
    const swapTxHash = await sendSwap(tx)
    const swapReceipt = await provider.waitForTransaction(swapTxHash)

    // Read what actually landed in the wallet, not what the quote predicted —
    // slippage and routing mean the real figure can differ from the estimate.
    const usdtReceived = parseReceivedAmount(swapReceipt, TOKENS.USDT, state.address)

    setStatus('Confirm the Aave supply in your wallet…')
    await supply(TOKENS.USDT, usdtReceived)

    state.shielded = true
    state.shieldedUsdtAmount = usdtReceived
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
    const withdrawReceipt = await withdraw(TOKENS.USDT, WITHDRAW_ALL)
    const usdtWithdrawn = parseReceivedAmount(withdrawReceipt, TOKENS.USDT, state.address)

    setStatus('Building swap back to ETH…')
    const tx = await buildSwapTx({
      fromToken: TOKENS.USDT,
      toToken: TOKENS.ETH,
      amountWei: usdtWithdrawn.toString(),
      fromAddress: state.address,
      apiKey: state.apiKey
    })

    setStatus('Confirm the swap in your wallet…')
    const swapTxHash = await sendSwap(tx)
    await provider.waitForTransaction(swapTxHash)

    state.shielded = false
    state.shieldedUsdtAmount = 0n
    setStatus('Unshielded')
  } catch (err) {
    setStatus(err.message)
  }

  await refreshBalance()
  renderPosition()
  renderAmountCard()
  renderButton()
}

el.actionBtn.addEventListener('click', () => {
  if (!state.connected) return handleConnect()
  if (!state.shielded) return handleShield()
  return handleUnshield()
})

refreshMarket()
setInterval(refreshMarket, 30_000)
renderButton()
