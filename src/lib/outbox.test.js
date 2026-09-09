/**
 * What the sync queue is allowed to keep.
 *
 * The queue is state like any other: written to IndexedDB and broadcast to
 * every tab each time anything changes. So its size is not a tidiness question
 * — a queue big enough to fail the write takes the whole dataset down with it,
 * and a product image that never reached disk is gone for good. These pin the
 * two things that keep it small, and the one thing that must never be dropped.
 */

import { describe, expect, it } from 'vitest'
import { SYNCED_KEPT, pruneOutbox, slimPayload } from './store.jsx'

const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ'

const entry = (id, status = 'synced') => ({ id, type: 'order.create', status, payload: {} })

describe('what a queued payload carries', () => {
  it('leaves the product image behind', () => {
    const payload = slimPayload('product.save', { id: 'p1', name: 'Scarf', image: PHOTO })
    expect(payload.image).toBeNull()
    // Everything the handler needs to find the live record is still there.
    expect(payload).toMatchObject({ id: 'p1', name: 'Scarf' })
  })

  it('touches nothing else', () => {
    const order = { id: 'o1', total: 240 }
    expect(slimPayload('order.create', order)).toBe(order)
    // A product with no image is already slim; it should not be copied for
    // nothing on every save.
    const plain = { id: 'p1', image: null }
    expect(slimPayload('product.save', plain)).toBe(plain)
  })
})

describe('pruning the queue', () => {
  it('keeps every pending entry, however long the queue gets', () => {
    const queue = [
      ...Array.from({ length: SYNCED_KEPT + 50 }, (_, i) => entry(`s${i}`)),
      ...Array.from({ length: 30 }, (_, i) => entry(`p${i}`, 'pending')),
    ]
    const pruned = pruneOutbox(queue)
    // Unsent work is a sale that has not reached the server — never dropped.
    expect(pruned.filter((e) => e.status === 'pending')).toHaveLength(30)
    expect(pruned.filter((e) => e.status === 'synced')).toHaveLength(SYNCED_KEPT)
  })

  it('drops the oldest pushed entries first', () => {
    const queue = Array.from({ length: SYNCED_KEPT + 3 }, (_, i) => entry(`s${i}`))
    const kept = pruneOutbox(queue).map((e) => e.id)
    expect(kept).not.toContain('s0')
    expect(kept).toContain(`s${SYNCED_KEPT + 2}`)
  })

  it('leaves a queue that is already small alone', () => {
    const queue = [entry('a'), entry('b', 'pending')]
    expect(pruneOutbox(queue)).toBe(queue)
  })
})
