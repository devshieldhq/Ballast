// Local activity log, per wallet address. Device-local only, not synced
// across browsers — the real record is always the chain itself via the
// stored tx hashes.

const MAX_EVENTS = 20

function storageKey(address) {
  return `ballast:activity:${address.toLowerCase()}`
}

export function getActivity(address) {
  try {
    const raw = localStorage.getItem(storageKey(address))
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function addActivityEvent(address, event) {
  try {
    const events = getActivity(address)
    events.unshift(event)
    const trimmed = events.slice(0, MAX_EVENTS)
    localStorage.setItem(storageKey(address), JSON.stringify(trimmed))
  } catch {
    // localStorage can be unavailable (private browsing, quota, disabled).
  }
}
