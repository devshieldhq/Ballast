// A local activity log — shield/unshield events with timestamps and tx
// hashes, kept in the browser's localStorage, scoped per wallet address.
//
// This is device-local, not synced across devices or browsers — it's not
// a substitute for the real record (which is always the chain itself,
// linked via the tx hashes stored here). It exists so the app can show a
// history without needing a backend of its own.

const MAX_EVENTS = 20

function storageKey(address) {
  return `ballast:activity:${address.toLowerCase()}`
}

export function getActivity(address) {
  try {
    const raw = localStorage.getItem(storageKey(address))
    return raw ? JSON.parse(raw) : []
  } catch {
    return [] // Corrupt or inaccessible storage — fail to empty, not to a crash.
  }
}

export function addActivityEvent(address, event) {
  try {
    const events = getActivity(address)
    events.unshift(event) // newest first
    const trimmed = events.slice(0, MAX_EVENTS)
    localStorage.setItem(storageKey(address), JSON.stringify(trimmed))
  } catch {
    // localStorage can fail (private browsing, quota, disabled) — the app
    // still works without a history, so this is not a fatal error.
  }
}
