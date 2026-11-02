/**
 * Whether a change that "synced" without leaving the device is remembered.
 *
 * A till that built its catalogue before the backend existed ends up with a
 * queue that says everything went and a server that has never heard of any of
 * it. Nothing in the outbox can tell that apart later — pushed entries are
 * pruned — so the one-time upload in `store.jsx` needs a fact that outlives the
 * queue. These tests pin down the one thing that would make the automatic pass
 * worse than the button it replaces: firing on a device that has nothing to
 * send, or not firing on one that does.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  clearNeedsBackfill,
  drainOutbox,
  localAdapter,
  needsBackfill,
  setSyncAdapter,
} from './sync.js'

const entry = (id) => ({ id, clientId: id, type: 'product.save', status: 'pending', payload: {} })

/** `localStorage` and `navigator` are browser globals; these tests run in Node. */
function stubBrowser({ onLine = true } = {}) {
  const stored = new Map()
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (key) => (stored.has(key) ? stored.get(key) : null),
      setItem: (key, value) => stored.set(key, String(value)),
      removeItem: (key) => stored.delete(key),
    },
    configurable: true,
    writable: true,
  })
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine },
    configurable: true,
    writable: true,
  })
}

/** Drains `ids` through whichever adapter the module currently holds. */
async function drain(ids) {
  const result = { synced: [], failed: [], blocked: [] }
  await drainOutbox(
    () => ids.map(entry),
    (synced, failed, blocked) => Object.assign(result, { synced, failed, blocked }),
  )
  return result
}

beforeEach(() => {
  stubBrowser()
  clearNeedsBackfill()
})

describe('a device with nowhere to send', () => {
  it('remembers that its work never left', async () => {
    setSyncAdapter(localAdapter)
    const result = await drain(['a'])

    // Reported synced, and nothing was uploaded — the exact state that used to
    // mean the backlog waited for somebody to find the button.
    expect(result.synced).toHaveLength(1)
    expect(needsBackfill()).toBe(true)
  })

  it('forgets once the backlog has been uploaded', async () => {
    setSyncAdapter(localAdapter)
    await drain(['a'])
    expect(needsBackfill()).toBe(true)

    clearNeedsBackfill()
    expect(needsBackfill()).toBe(false)
  })
})

describe('a device that really is syncing', () => {
  it('is never told it owes an upload', async () => {
    // A real adapter is the one the backfill must leave alone: everything this
    // device makes is already going up through the queue, row by row.
    setSyncAdapter({
      name: 'supabase',
      async push(item) {
        return { ok: true, clientId: item.clientId, syncedAt: '2026-11-03T09:00:00Z' }
      },
    })
    const result = await drain(['a', 'b'])

    expect(result.synced).toHaveLength(2)
    expect(needsBackfill()).toBe(false)
  })
})

describe('a browser that will not hold storage', () => {
  it('carries on with nothing noted down', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem() {
          throw new Error('SecurityError')
        },
        setItem() {
          throw new Error('SecurityError')
        },
        removeItem() {
          throw new Error('SecurityError')
        },
      },
      configurable: true,
      writable: true,
    })

    setSyncAdapter(localAdapter)
    // A refused write must not lose the sale that was being queued.
    await expect(drain(['a']).then((r) => r.synced)).resolves.toHaveLength(1)
    expect(needsBackfill()).toBe(false)
  })
})
