// Wraps Nimiq Pay's injected provider access.
// Per https://nimiq.dev/mini-apps the SDK's init() helper waits until the
// provider is actually ready before you touch it.
import { init } from '@nimiq/mini-app-sdk'

let nimiqApi = null

export async function connectWallet() {
  // Nimiq-native handle (accounts, consensus, block number, NIM payments)
  nimiqApi = await init()

  // Standard EVM handle, injected by Nimiq Pay into the WebView.
  // This is what we use for the swap + Aave calls on Base.
  if (!window.ethereum) {
    throw new Error('No EVM provider found — are we running inside Nimiq Pay?')
  }
  const [address] = await window.ethereum.request({ method: 'eth_requestAccounts' })

  return { address, nimiqApi }
}

export function getNimiqApi() {
  if (!nimiqApi) throw new Error('Wallet not connected yet')
  return nimiqApi
}
