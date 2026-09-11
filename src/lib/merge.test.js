/**
 * Folding another device's work into this one.
 *
 * Sync used to be push-only, so these are the rules that decide what a pull is
 * allowed to do to a till that is already carrying a day's trading. The line
 * they all defend is the same one: nothing this device has not sent yet may be
 * lost to something the server said.
 */

import { describe, expect, it } from 'vitest'
import { hasPendingWork, mergeCloud } from './merge.js'

const local = (over = {}) => ({
  settings: { currencySymbol: '£' },
  products: [],
  customers: [],
  exhibitions: [],
  promoCodes: [],
  devices: [],
  orders: [],
  payments: [],
  returns: [],
  movements: [],
  auditLogs: [],
  inventory: {},
  outbox: [],
  ...over,
})

const pending = [{ id: 'obx1', status: 'pending' }]

describe('history', () => {
  it('brings another till’s sales across', () => {
    const theirs = { id: 'o2', total: 40, createdAt: '2026-09-10T10:00:00Z' }
    const mine = { id: 'o1', total: 10, createdAt: '2026-09-10T09:00:00Z' }
    const { state, changed } = mergeCloud(local({ orders: [mine] }), { orders: [mine, theirs] })

    expect(changed).toBe(true)
    expect(state.orders.map((order) => order.id)).toEqual(['o2', 'o1'])
  })

  it('keeps a sale the server has never heard of', () => {
    // The one that matters: an order still sitting in the queue must survive a
    // pull that does not mention it.
    const unsent = { id: 'o9', total: 99, createdAt: '2026-09-10T11:00:00Z' }
    const { state } = mergeCloud(local({ orders: [unsent], outbox: pending }), { orders: [] })

    expect(state.orders).toEqual([unsent])
  })

  it('does not revert a local edit while the queue still holds it', () => {
    // A refund recorded here and not yet pushed: the server's copy of the order
    // is stale, and taking it would put the money back on the books.
    const refunded = { id: 'o1', refundedAmount: 25, createdAt: '2026-09-10T09:00:00Z' }
    const stale = { id: 'o1', refundedAmount: 0, createdAt: '2026-09-10T09:00:00Z' }
    const { state } = mergeCloud(local({ orders: [refunded], outbox: pending }), { orders: [stale] })

    expect(state.orders[0].refundedAmount).toBe(25)
  })

  it('takes the server’s copy once the queue is empty', () => {
    // Same order, refunded on the other till this time.
    const mine = { id: 'o1', refundedAmount: 0, createdAt: '2026-09-10T09:00:00Z' }
    const theirs = { id: 'o1', refundedAmount: 25, createdAt: '2026-09-10T09:00:00Z' }
    const { state } = mergeCloud(local({ orders: [mine] }), { orders: [theirs] })

    expect(state.orders[0].refundedAmount).toBe(25)
  })

  it('keeps every collection newest first', () => {
    const rows = [
      { id: 'a', createdAt: '2026-09-01T00:00:00Z' },
      { id: 'c', createdAt: '2026-09-03T00:00:00Z' },
      { id: 'b', createdAt: '2026-09-02T00:00:00Z' },
    ]
    const { state } = mergeCloud(local(), { movements: rows })
    expect(state.movements.map((row) => row.id)).toEqual(['c', 'b', 'a'])
  })
})

describe('the catalogue', () => {
  it('takes a product edited on another device', () => {
    const { state } = mergeCloud(
      local({ products: [{ id: 'p1', name: 'Old', variants: [] }] }),
      { products: [{ id: 'p1', name: 'New', variants: [] }] },
    )
    expect(state.products[0].name).toBe('New')
  })

  it('keeps the picture the pull chose not to fetch', () => {
    // The refresh omits `image` for products it already has, because the column
    // is a base64 data URL. An absent key must leave the local one standing —
    // a null would blank the thumbnail on every till in the building.
    const held = { id: 'p1', name: 'Scarf', image: 'data:image/jpeg;base64,xx', variants: [] }
    const { state } = mergeCloud(local({ products: [held] }), {
      products: [{ id: 'p1', name: 'Scarf', variants: [] }],
    })
    expect(state.products[0].image).toBe('data:image/jpeg;base64,xx')
  })

  it('leaves the catalogue alone while the queue has work in it', () => {
    const mine = { id: 'p1', name: 'Renamed here', variants: [] }
    const { state } = mergeCloud(
      local({ products: [mine], outbox: pending }),
      { products: [{ id: 'p1', name: 'Stale', variants: [] }] },
    )
    expect(state.products).toEqual([mine])
  })

  it('leaves the products list where the user last saw it', () => {
    // Pulled rows carry no `createdAt`, so sorting on one would drop every
    // product the server knows about to the bottom of the screen.
    const mine = [
      { id: 'p1', name: 'Scarf', variants: [] },
      { id: 'p2', name: 'Bag', variants: [] },
    ]
    const { state } = mergeCloud(local({ products: mine }), {
      products: [
        { id: 'p2', name: 'Bag', variants: [] },
        { id: 'p3', name: 'Belt', variants: [] },
        { id: 'p1', name: 'Scarf', variants: [] },
      ],
    })
    expect(state.products.map((product) => product.id)).toEqual(['p1', 'p2', 'p3'])
  })

  it('keeps a product the server has never heard of', () => {
    // No tombstones, so absence is never read as a deletion — a device whose
    // catalogue predates the backend would otherwise wipe itself clean.
    const { state } = mergeCloud(local({ products: [{ id: 'p1', name: 'Scarf', variants: [] }] }), {
      products: [],
    })
    expect(state.products).toHaveLength(1)
  })

  it('merges settings rather than replacing them', () => {
    const { state } = mergeCloud(local({ settings: { currencySymbol: '£', vatNumber: '123' } }), {
      settings: { currencySymbol: 'AED' },
    })
    expect(state.settings).toEqual({ currencySymbol: 'AED', vatNumber: '123' })
  })

  it('leaves the local defaults alone when the server has no settings row', () => {
    const start = local()
    const { state, changed } = mergeCloud(start, { settings: undefined })
    expect(changed).toBe(false)
    expect(state.settings).toEqual({ currencySymbol: '£' })
  })
})

describe('something this device deleted', () => {
  const order = { id: 'o1', total: 40, createdAt: '2026-09-10T09:00:00Z' }

  it('stays deleted, even though the server still has it', () => {
    // The delete is almost always still in the queue when the next pull lands,
    // so the server does still have the row. Without the tombstone the union
    // read that as "a sale we are missing" and put it straight back, seconds
    // after somebody deleted it.
    const { state } = mergeCloud(local({ orders: [], tombstones: { o1: '2026-09-10T09:05:00Z' } }), {
      orders: [order],
    })
    expect(state.orders).toEqual([])
  })

  it('stays deleted while the queue still holds the command', () => {
    const { state } = mergeCloud(
      local({ orders: [], outbox: pending, tombstones: { o1: '2026-09-10T09:05:00Z' } }),
      { orders: [order] },
    )
    expect(state.orders).toEqual([])
  })

  it('applies to the catalogue too', () => {
    const { state } = mergeCloud(local({ products: [], tombstones: { p1: '2026-09-10T09:05:00Z' } }), {
      products: [{ id: 'p1', name: 'Scarf', variants: [] }],
    })
    expect(state.products).toEqual([])
  })

  it('does not bury anything else', () => {
    const theirs = { id: 'o2', total: 10, createdAt: '2026-09-10T10:00:00Z' }
    const { state } = mergeCloud(local({ orders: [], tombstones: { o1: '2026-09-10T09:05:00Z' } }), {
      orders: [order, theirs],
    })
    expect(state.orders).toEqual([theirs])
  })

  it('is remembered even after the server has forgotten the row', () => {
    // This used to drop the tombstone the moment a pull came back without the
    // row, on the reasoning that the delete had landed and there was nothing
    // left to guard. There was: the *other* till still had the sale and pushed
    // it straight back up, and with the tombstone gone the next pull welcomed
    // it in as something new. The sale returned within the minute, every time.
    const { state } = mergeCloud(local({ orders: [], tombstones: { o1: '2026-09-10T09:05:00Z' } }), {
      orders: [],
    })
    expect(state.tombstones).toEqual({ o1: '2026-09-10T09:05:00Z' })
  })
})

describe('something another till deleted', () => {
  const order = { id: 'o1', total: 40, createdAt: '2026-09-10T09:00:00Z' }

  it('is taken off this device too', () => {
    // The gravestone is explicit, unlike absence, so it is the one thing a pull
    // may remove a local row for. Without it a delete only ever held on the
    // device that made it.
    const { state } = mergeCloud(local({ orders: [order] }), {
      orders: [order],
      deletions: { o1: '2026-09-10T09:05:00Z' },
    })
    expect(state.orders).toEqual([])
  })

  it('applies to the catalogue as well', () => {
    const product = { id: 'p1', name: 'Scarf', variants: [] }
    const { state } = mergeCloud(local({ products: [product] }), {
      products: [product],
      deletions: { p1: '2026-09-10T09:05:00Z' },
    })
    expect(state.products).toEqual([])
  })

  it('reaches a device that was switched off at the time', () => {
    // The row is still on this till and no longer on the server. Absence alone
    // would not be enough to act on; the gravestone is.
    const { state } = mergeCloud(local({ orders: [order] }), {
      orders: [],
      deletions: { o1: '2026-09-10T09:05:00Z' },
    })
    expect(state.orders).toEqual([])
  })

  it('leaves everything it does not name alone', () => {
    const mine = { id: 'o2', total: 10, createdAt: '2026-09-10T11:00:00Z' }
    const { state } = mergeCloud(local({ orders: [order, mine] }), {
      orders: [],
      deletions: { o1: '2026-09-10T09:05:00Z' },
    })
    expect(state.orders).toEqual([mine])
  })
})

describe('stock balances', () => {
  const cell = (quantity, updatedAt) => ({ locationId: 'ex1', variantId: 'v1', quantity, updatedAt })

  it('takes the newer count', () => {
    const { state } = mergeCloud(local({ inventory: { 'ex1:v1': cell(5, '2026-09-10T09:00:00Z') } }), {
      inventory: { 'ex1:v1': cell(3, '2026-09-10T10:00:00Z') },
    })
    expect(state.inventory['ex1:v1'].quantity).toBe(3)
  })

  it('keeps this device’s count when the server’s is older', () => {
    // Which is always the case for a sale that has not been pushed: it stamped
    // the cell a moment ago.
    const { state } = mergeCloud(local({ inventory: { 'ex1:v1': cell(4, '2026-09-10T11:00:00Z') } }), {
      inventory: { 'ex1:v1': cell(6, '2026-09-10T10:00:00Z') },
    })
    expect(state.inventory['ex1:v1'].quantity).toBe(4)
  })

  it('picks up a shelf this device has never stocked', () => {
    const { state } = mergeCloud(local(), { inventory: { 'ex1:v1': cell(7, '2026-09-10T10:00:00Z') } })
    expect(state.inventory['ex1:v1'].quantity).toBe(7)
  })
})

describe('leaving the device alone', () => {
  it('reports no change and hands back the very same object', () => {
    // The refresh runs on a timer forever, so an idle pull must not cost a
    // write of the whole state blob — product images and all — to IndexedDB.
    const start = local({ orders: [{ id: 'o1', createdAt: '2026-09-10T09:00:00Z' }] })
    const { state, changed } = mergeCloud(start, { orders: [{ id: 'o1', createdAt: '2026-09-10T09:00:00Z' }] })

    expect(changed).toBe(false)
    expect(state).toBe(start)
  })

  it('never touches what belongs to this device alone', () => {
    const start = local({
      outbox: pending,
      notifications: [{ id: 'n1' }],
      counters: { invoice: 42 },
      users: [{ id: 'u1', pinHash: 'secret' }],
    })
    const { state } = mergeCloud(start, {
      orders: [{ id: 'o1', createdAt: '2026-09-10T09:00:00Z' }],
      users: [{ id: 'u1' }],
      roles: [{ id: 'admin' }],
    })

    expect(state.outbox).toEqual(pending)
    expect(state.notifications).toEqual([{ id: 'n1' }])
    expect(state.counters).toEqual({ invoice: 42 })
    // Staff carry the PIN hashes and the pulled row has none, so the list is
    // `refreshIdentity`'s to replace, never the merge's.
    expect(state.users).toEqual([{ id: 'u1', pinHash: 'secret' }])
  })
})

describe('unsent work', () => {
  it('sees a pending entry and ignores a synced one', () => {
    expect(hasPendingWork({ outbox: pending })).toBe(true)
    expect(hasPendingWork({ outbox: [{ id: 'x', status: 'synced' }] })).toBe(false)
    expect(hasPendingWork({})).toBe(false)
  })
})
