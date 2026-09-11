/**
 * What one bad record is allowed to do to everything behind it.
 *
 * The queue used to stop at the first failure of any kind and retry the whole
 * thing on the next tick. That is right for a dropped connection and ruinous
 * for a row the database will never accept: the bad entry sat at the head being
 * re-sent every few seconds, every sale behind it waited forever, and the
 * screen said "pending" without ever saying why.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { drainOutbox, setSyncAdapter } from './sync.js'

const entry = (id) => ({ id, clientId: id, type: 'order.create', status: 'pending', payload: {} })

/** A failure the database understood and refused — a code, and never retryable. */
const refusal = (message, code = '23503') => {
  const error = new Error(message)
  error.code = code
  error.permanent = true
  return error
}

/** Offline, a 5xx, a lapsed token: no code, and everything is in the same boat. */
const outage = (message) => new Error(message)

let pushed = []

/**
 * `navigator` is a browser global and `drainOutbox` reads it directly, because
 * that is what it has at runtime. These tests run in Node, so it is defined
 * here rather than weakening the module with a fallback it would never take.
 */
const setOnline = (value) => {
  Object.defineProperty(globalThis, 'navigator', {
    value: { onLine: value },
    configurable: true,
    writable: true,
  })
}

beforeEach(() => {
  pushed = []
  setOnline(true)
})

/** Runs a drain over `ids`, failing whichever the `fails` map names. */
async function drain(ids, fails = {}) {
  setSyncAdapter({
    name: 'stub',
    async push(item) {
      pushed.push(item.id)
      if (fails[item.id]) throw fails[item.id]
      return { ok: true, clientId: item.clientId, syncedAt: '2026-09-11T10:00:00Z' }
    },
  })
  const result = { synced: [], failed: [], blocked: [] }
  await drainOutbox(
    () => ids.map(entry),
    (synced, failed, blocked) => Object.assign(result, { synced, failed, blocked }),
  )
  return result
}

describe('a record the server refuses', () => {
  it('steps over it and keeps going', async () => {
    const result = await drain(['a', 'b', 'c'], {
      a: refusal('orders: violates foreign key constraint'),
    })

    expect(pushed).toEqual(['a', 'b', 'c'])
    expect(result.blocked).toEqual([{ id: 'a', reason: 'orders: violates foreign key constraint' }])
    expect(result.synced.map((item) => item.id)).toEqual(['b', 'c'])
  })

  it('keeps the reason, because it is the only thing that makes it fixable', async () => {
    const result = await drain(['a'], { a: refusal('products: column "collection" does not exist', 'PGRST204') })
    expect(result.blocked[0].reason).toMatch(/column "collection" does not exist/)
  })
})

describe('an outage', () => {
  it('stops the drain, so the whole queue is tried again together', async () => {
    const result = await drain(['a', 'b', 'c'], { a: outage('Failed to fetch') })

    // Nothing after it was attempted — there is no point while the wire is down.
    expect(pushed).toEqual(['a'])
    expect(result.failed).toEqual([{ id: 'a', reason: 'Failed to fetch' }])
    expect(result.blocked).toEqual([])
    expect(result.synced).toEqual([])
  })

  it('still lets everything before it through', async () => {
    const result = await drain(['a', 'b', 'c'], { b: outage('Failed to fetch') })

    expect(result.synced.map((item) => item.id)).toEqual(['a'])
    expect(result.failed.map((item) => item.id)).toEqual(['b'])
    // 'c' was never tried, so it stays pending and is picked up next tick.
    expect(pushed).toEqual(['a', 'b'])
  })
})

describe('a clean queue', () => {
  it('marks everything synced', async () => {
    const result = await drain(['a', 'b'])
    expect(result.synced).toHaveLength(2)
    expect(result.failed).toEqual([])
    expect(result.blocked).toEqual([])
  })

  it('does nothing at all while offline', async () => {
    setOnline(false)
    const result = await drain(['a'])
    expect(pushed).toEqual([])
    expect(result.synced).toEqual([])
  })
})
