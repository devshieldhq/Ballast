// Wraps wallet access for both real Nimiq Pay and plain-browser testing.
//
// Nimiq Pay injects window.ethereum the same way MetaMask does, so the
// entire EVM side of this app (balance, swap, Aave) works identically in
// either environment. The Nimiq-specific SDK (init()) only matters for
// Nimiq-native features — NIM payments, consensus state — which this app
// doesn't currently use beyond connect. So: try it if it's there, don't
// block on it if it's not. This lets the whole shield/unshield flow be
// built and tested against MetaMask in a normal browser before ever
// touching an actual phone.
import { init } from '@nimiq/mini-app-sdk'

let nimiqApi = null

export async function connectWallet() {
  if (!window.ethereum) {
    throw new Error(
      'No wallet provider found. Install MetaMask for browser testing, ' +
      'or open this inside Nimiq Pay.'
    )
  }

  // Best-effort: only succeeds inside the real Nimiq Pay WebView.
  try {
    nimiqApi = await init()
  } catch {
    nimiqApi = null // Expected in a plain browser — not a real failure.
  }

  const [address] = await window.ethereum.request({ method: 'eth_requestAccounts' })

  return { address, nimiqApi, isNimiqPay: nimiqApi !== null }
}

export function getNimiqApi() {
  if (!nimiqApi) throw new Error('Not running inside Nimiq Pay, or wallet not connected yet')
  return nimiqApi
}
