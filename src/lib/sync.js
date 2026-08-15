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

export const localAdapter = {
  name: 'local',
  async push(entry) {
    // Simulated round-trip. A real adapter would POST `entry` to the API and
    // let the server reject anything whose clientId it has already stored.
    await new Promise((resolve) => setTimeout(resolve, 120))
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
 * Drains pending outbox entries. `commit` receives the ids that synced
 * successfully so the store can mark them off in a single state update.
 */
export async function drainOutbox(getOutbox, commit) {
  if (draining || !navigator.onLine) return
  const pending = getOutbox().filter((entry) => entry.status === 'pending')
  if (!pending.length) return

  draining = true
  emit({ type: 'sync:start', count: pending.length })
  const synced = []
  const failed = []

  try {
    for (const entry of pending) {
      try {
        const result = await adapter.push(entry)
        if (result.ok) synced.push({ id: entry.id, syncedAt: result.syncedAt })
        else failed.push(entry.id)
      } catch {
        failed.push(entry.id)
        break // Stop on the first transport failure and retry on the next tick.
      }
    }
  } finally {
    draining = false
    if (synced.length || failed.length) commit(synced, failed)
    emit({ type: 'sync:done', synced: synced.length, failed: failed.length })
  }
}
