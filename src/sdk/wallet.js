// Wraps wallet access for both Nimiq Pay and plain-browser testing.
// Nimiq Pay injects window.ethereum the same as MetaMask, so the EVM side
// works identically either way. Nimiq's own init() only matters for
// NIM-native features this app doesn't use yet, so it's best-effort.
import { init } from '@nimiq/mini-app-sdk'

let nimiqApi = null

export async function connectWallet() {
  if (!window.ethereum) {
    throw new Error(
      'No wallet provider found. Install MetaMask for browser testing, ' +
      'or open this inside Nimiq Pay.'
    )
  }

  try {
    nimiqApi = await init()
  } catch {
    nimiqApi = null // Expected outside Nimiq Pay — not a real failure.
  }

  const [address] = await window.ethereum.request({ method: 'eth_requestAccounts' })

  return { address, nimiqApi, isNimiqPay: nimiqApi !== null }
}

export function getNimiqApi() {
  if (!nimiqApi) throw new Error('Not running inside Nimiq Pay, or wallet not connected yet')
  return nimiqApi
}
