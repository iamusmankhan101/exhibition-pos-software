/**
 * Remembering what this device deleted.
 *
 * Sync has no tombstone table, so absence from the server means nothing to a
 * merge — it cannot tell a row somebody deleted from one this device made and
 * has not sent yet. The union therefore read a deleted sale as "a row the
 * server has that we are missing" and put it back, usually within seconds,
 * because the delete command was still sitting in the queue and the server
 * still had the row. This is the record that stops it.
 */

import { describe, expect, it } from 'vitest'
import { TOMBSTONES_KEPT, withTombstones } from './store.jsx'

const base = (over = {}) => ({
  orders: [],
  payments: [],
  returns: [],
  movements: [],
  products: [],
  customers: [],
  exhibitions: [],
  promoCodes: [],
  users: [],
  roles: [],
  auditLogs: [],
  tombstones: {},
  ...over,
})

describe('what a delete records', () => {
  it('names the row that went', () => {
    const before = base({ orders: [{ id: 'o1' }, { id: 'o2' }] })
    const after = base({ orders: [{ id: 'o2' }] })
    expect(Object.keys(withTombstones(before, after).tombstones)).toEqual(['o1'])
  })

  it('follows a cascade without being told about it', () => {
    // Removing an exhibition takes its sales, payments, movements and returns
    // with it. Passing ids in by hand would drift out of step with those rules
    // the first time one of them changed, so the record is a diff.
    const before = base({
      exhibitions: [{ id: 'ex1' }],
      orders: [{ id: 'o1' }],
      payments: [{ id: 'pay1' }],
      movements: [{ id: 'mv1' }],
      returns: [{ id: 'r1' }],
    })
    const after = base()
    const { tombstones } = withTombstones(before, after)
    expect(Object.keys(tombstones).sort()).toEqual(['ex1', 'mv1', 'o1', 'pay1', 'r1'])
  })

  it('ignores the audit log, which sheds rows on its own', () => {
    // Capped at 800, so entries fall off the end in normal use. Diffing it
    // would mint a tombstone every time the cap bit and blacklist good history.
    const before = base({ auditLogs: [{ id: 'log1' }, { id: 'log2' }] })
    const after = base({ auditLogs: [{ id: 'log2' }] })
    expect(withTombstones(before, after).tombstones).toEqual({})
  })

  it('records nothing when nothing was removed', () => {
    const before = base({ orders: [{ id: 'o1' }] })
    const after = base({ orders: [{ id: 'o1' }, { id: 'o2' }] })
    expect(withTombstones(before, after).tombstones).toEqual({})
  })

  it('keeps what was already remembered', () => {
    const before = base({ orders: [{ id: 'o2' }], tombstones: { o1: '2026-09-01T00:00:00Z' } })
    const after = base({ orders: [], tombstones: { o1: '2026-09-01T00:00:00Z' } })
    expect(Object.keys(withTombstones(before, after).tombstones).sort()).toEqual(['o1', 'o2'])
  })

  it('stays bounded, dropping the oldest first', () => {
    // It lives in the state blob like everything else, and a blob too big to
    // write loses far more than the list it was keeping.
    const tombstones = {}
    for (let i = 0; i < TOMBSTONES_KEPT + 20; i += 1) {
      tombstones[`old${i}`] = `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`
    }
    const before = base({ orders: [{ id: 'fresh' }], tombstones })
    const after = base({ orders: [], tombstones })

    const kept = withTombstones(before, after).tombstones
    expect(Object.keys(kept)).toHaveLength(TOMBSTONES_KEPT)
    expect(kept).toHaveProperty('fresh')
    expect(kept).not.toHaveProperty('old0')
  })
})
