/**
 * Offline sync queue.
 *
 * Every mutation is appended to an outbox with a stable `clientId`. While the
 * device is offline the queue simply grows; when connectivity returns the queue
 * is drained through an adapter.
 *
 * The default adapter is local-only (this build has no server), but it enforces
 * the same contract a real endpoint would: at-least-once delivery with
 * client-side idempotency keys, so replaying a queued sale can never create a
 * duplicate order.
 */

const listeners = new Set()

/**
 * Whether this device is holding work that never reached a server.
 *
 * The local adapter reports success without sending anything, so a change made
 * before the backend existed is marked `synced` and is never eligible to be
 * pushed again — the queue says it went, and the server has never heard of it.
 * Nothing else remembers that fact: pushed entries are pruned out of the outbox,
 * and it cannot live in the state either, because state syncs and "this till once
 * had nowhere to upload to" says nothing about any other till. So it is a
 * per-device marker, and `store.jsx` reads it to upload the backlog by itself
 * rather than waiting for somebody to find the button.
 */
const BACKFILL_KEY = 'tareez.needsBackfill'

/** Browsers without storage — private mode, or Node under test — get a no-op. */
const box = () => (typeof localStorage === 'undefined' ? null : localStorage)

export function markNeedsBackfill() {
  try {
    const storage = box()
    if (storage && storage.getItem(BACKFILL_KEY) !== '1') storage.setItem(BACKFILL_KEY, '1')
  } catch {
    /* nowhere to note it down; the manual push still works */
  }
}

export const needsBackfill = () => {
  try {
    return box()?.getItem(BACKFILL_KEY) === '1'
  } catch {
    return false
  }
}

export function clearNeedsBackfill() {
  try {
    box()?.removeItem(BACKFILL_KEY)
  } catch {
    /* nothing was set, or nowhere to unset it */
  }
}

export const localAdapter = {
  name: 'local',
  async push(entry) {
    // Simulated round-trip. A real adapter would POST `entry` to the API and
    // let the server reject anything whose clientId it has already stored.
    await new Promise((resolve) => setTimeout(resolve, 120))
    // Nothing left this device, so whatever it covers is owed an upload later.
    markNeedsBackfill()
    return { ok: true, clientId: entry.clientId, syncedAt: new Date().toISOString() }
  },
}

let adapter = localAdapter

export function setSyncAdapter(next) {
  adapter = next
}

export function onSyncEvent(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function emit(event) {
  listeners.forEach((listener) => listener(event))
}

let draining = false

/**
 * Drains pending outbox entries.
 *
 * `commit` is handed three lists: what synced, what failed and should be tried
 * again, and what the server refused outright.
 *
 * That third list is the point. This used to stop at the first failure of any
 * kind and retry the whole queue on the next tick, which is right for a dropped
 * connection and catastrophic for a row the database will never accept: the bad
 * entry sat at the head of the queue being re-sent every few seconds, every
 * sale behind it waited forever, and the screen said "pending" without ever
 * saying why. One unlucky record stopped the shop syncing.
 *
 * So a refusal the adapter marks `permanent` takes that entry out of the way
 * and the rest of the queue carries on. Nothing is deleted — a set-aside entry
 * keeps its payload and its reason, and can be put back in the queue once
 * whatever the server objected to is fixed.
 */
export async function drainOutbox(getOutbox, commit) {
  if (draining || !navigator.onLine) return
  const pending = getOutbox().filter((entry) => entry.status === 'pending')
  if (!pending.length) return

  draining = true
  emit({ type: 'sync:start', count: pending.length })
  const synced = []
  const failed = []
  const blocked = []

  try {
    for (const entry of pending) {
      try {
        const result = await adapter.push(entry)
        if (result.ok) synced.push({ id: entry.id, syncedAt: result.syncedAt })
        else failed.push({ id: entry.id, reason: '' })
      } catch (error) {
        const reason = error?.message || 'Unknown error'
        if (error?.permanent) {
          // This one and only this one. Step over it and keep going.
          blocked.push({ id: entry.id, reason })
          continue
        }
        // Offline, a 5xx, a lapsed token: everything in the queue is in the
        // same boat, so stop and try the lot again on the next tick.
        failed.push({ id: entry.id, reason })
        break
      }
    }
  } finally {
    draining = false
    if (synced.length || failed.length || blocked.length) commit(synced, failed, blocked)
    emit({ type: 'sync:done', synced: synced.length, failed: failed.length, blocked: blocked.length })
  }
}
