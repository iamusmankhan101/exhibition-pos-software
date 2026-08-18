/**
 * The adapter turns a queued command into rows. These tests run it against a
 * recording stub rather than a real project, so they check the mapping and the
 * derived writes — which is where an adapter actually goes wrong — without
 * needing credentials or a network.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Records every table write so a test can assert on what was sent. */
const writes = []
const deletes = []

const stubClient = {
  from(table) {
    return {
      upsert(rows, options) {
        writes.push({ table, rows: Array.isArray(rows) ? rows : [rows], options })
        return Promise.resolve({ error: null })
      },
      delete() {
        return {
          in(column, values) {
            deletes.push({ table, column, values })
            return Promise.resolve({ error: null })
          },
          eq(column, value) {
            deletes.push({ table, column, values: [value] })
            return Promise.resolve({ error: null })
          },
        }
      },
      select() {
        return {
          eq: () => Promise.resolve({ data: [], error: null }),
        }
      },
    }
  },
}

vi.mock('./supabase.js', () => ({
  isConfigured: true,
  getSupabase: () => Promise.resolve(stubClient),
  connectionStatus: () => ({ connected: true, detail: 'stub' }),
}))

const { createSupabaseAdapter } = await import('./supabaseAdapter.js')
const { createOrder } = await import('./domain.js')

/* ------------------------------------------------------------ fixtures */

const settings = {
  invoicePrefix: 'TRZ',
  taxEnabled: false,
  taxInclusive: false,
  taxRate: 0,
  allowOverselling: false,
  lowStockThreshold: 3,
}

const variant = { id: 'v1', sku: 'SKU1', price: 100, exhibitionPrice: 80, cost: 20, minStock: 1 }

function baseState() {
  return {
    settings,
    products: [{ id: 'p1', name: 'Scarf', category: 'Scarves', variants: [variant] }],
    exhibitions: [{ id: 'ex1', name: 'DHA Exhibition' }],
    customers: [{ id: 'cus1', name: 'Amina', totalOrders: 0, totalSpend: 0 }],
    users: [],
    orders: [],
    payments: [],
    returns: [],
    movements: [],
    auditLogs: [],
    notifications: [],
    outbox: [],
    devices: [],
    promoCodes: [
      { id: 'pm1', code: 'STALL10', type: 'percentage', value: 10, minSpend: 0, usageLimit: 0, usedCount: 0, active: true, exhibitionId: 'all' },
    ],
    inventory: { 'ex1:v1': { locationId: 'ex1', variantId: 'v1', quantity: 10, updatedAt: '2026-03-01T10:00:00.000Z' } },
    counters: { invoice: 1 },
  }
}

const rowsFor = (table) => writes.filter((write) => write.table === table).flatMap((write) => write.rows)

beforeEach(() => {
  writes.length = 0
  deletes.length = 0
})

/* --------------------------------------------------------------- tests */

describe('supabase adapter', () => {
  it('mirrors a sale and everything it produced, not just the payload', async () => {
    const { state, order } = createOrder(baseState(), {
      clientId: 'cli-1',
      exhibitionId: 'ex1',
      customerId: 'cus1',
      customerName: 'Amina',
      salespersonId: 'u1',
      salespersonName: 'Ahmed',
      items: [{ variantId: 'v1', name: 'Scarf', sku: 'SKU1', quantity: 2, unitPrice: 80, lineDiscount: 0 }],
      discount: { type: 'percentage', value: 0 },
      promo: { code: 'STALL10', type: 'percentage', value: 10 },
      paymentParts: [
        { method: 'Cash', amount: 100 },
        { method: 'Card', amount: 44 },
      ],
    })

    const adapter = createSupabaseAdapter({ getState: () => state })
    const result = await adapter.push({
      id: 'obx1',
      type: 'order.create',
      clientId: 'cli-1',
      payload: order,
      deviceId: 'dev1',
      createdAt: order.createdAt,
    })

    expect(result.ok).toBe(true)

    // The order itself, mapped to snake_case with the offline key intact.
    const [orderRow] = rowsFor('orders')
    expect(orderRow.client_id).toBe('cli-1')
    expect(orderRow.invoice_no).toBe(order.invoiceNo)
    expect(orderRow.total).toBe(order.total)
    expect(orderRow.promo_code).toBe('STALL10')

    // One payment row per method — the whole point of splitting them.
    expect(rowsFor('payments').map((row) => row.method).sort()).toEqual(['Card', 'Cash'])

    // Derived rows the payload never carried.
    expect(rowsFor('stock_movements')).toHaveLength(1)
    expect(rowsFor('inventory')[0]).toMatchObject({ location_id: 'ex1', variant_id: 'v1', quantity: 8 })

    // The customer's running totals and the promo's use count both moved.
    expect(rowsFor('customers')[0]).toMatchObject({ id: 'cus1', total_orders: 1 })
    expect(rowsFor('promo_codes')[0]).toMatchObject({ code: 'STALL10', used_count: 1 })

    // And the command is logged for replay safety.
    expect(rowsFor('sync_commands')[0]).toMatchObject({ client_id: 'cli-1', type: 'order.create' })
  })

  it('upserts inventory on its composite key rather than duplicating cells', async () => {
    const { state, order } = createOrder(baseState(), {
      clientId: 'cli-2',
      exhibitionId: 'ex1',
      customerName: 'Walk-in',
      salespersonId: 'u1',
      salespersonName: 'Ahmed',
      items: [{ variantId: 'v1', name: 'Scarf', sku: 'SKU1', quantity: 1, unitPrice: 80, lineDiscount: 0 }],
      discount: { type: 'percentage', value: 0 },
      paymentMethod: 'Cash',
    })

    const adapter = createSupabaseAdapter({ getState: () => state })
    await adapter.push({ id: 'o2', type: 'order.create', clientId: 'cli-2', payload: order, createdAt: order.createdAt })

    const inventoryWrite = writes.find((write) => write.table === 'inventory')
    expect(inventoryWrite.options).toEqual({ onConflict: 'location_id,variant_id' })
  })

  it('maps a direct warehouse sale to a null exhibition rather than the string MAIN', async () => {
    const state = baseState()
    state.inventory = { 'MAIN:v1': { locationId: 'MAIN', variantId: 'v1', quantity: 5, updatedAt: '2026-03-01' } }
    const { state: after, order } = createOrder(state, {
      clientId: 'cli-3',
      exhibitionId: 'MAIN',
      customerName: 'Walk-in',
      salespersonId: 'u1',
      salespersonName: 'Ahmed',
      items: [{ variantId: 'v1', name: 'Scarf', sku: 'SKU1', quantity: 1, unitPrice: 100, lineDiscount: 0 }],
      discount: { type: 'percentage', value: 0 },
      paymentMethod: 'Cash',
    })

    const adapter = createSupabaseAdapter({ getState: () => after })
    await adapter.push({ id: 'o3', type: 'order.create', clientId: 'cli-3', payload: order, createdAt: order.createdAt })

    expect(rowsFor('orders')[0].exhibition_id).toBeNull()
    expect(rowsFor('payments')[0].exhibition_id).toBeNull()
  })

  it('deletes by id when a sale is removed outright', async () => {
    const adapter = createSupabaseAdapter({ getState: () => baseState() })
    await adapter.push({
      id: 'o4',
      type: 'order.delete',
      clientId: 'del-1',
      payload: { orderIds: ['ord_a', 'ord_b'], restoreStock: true },
      createdAt: '2026-03-01T10:00:00.000Z',
    })

    expect(deletes).toContainEqual({ table: 'orders', column: 'id', values: ['ord_a', 'ord_b'] })
  })

  it('acknowledges an unknown command instead of wedging the queue behind it', async () => {
    const adapter = createSupabaseAdapter({ getState: () => baseState() })
    const result = await adapter.push({
      id: 'o5',
      type: 'something.new',
      clientId: 'x-1',
      payload: {},
      createdAt: '2026-03-01T10:00:00.000Z',
    })

    expect(result.ok).toBe(true)
    expect(writes).toHaveLength(0)
  })

  it('syncs a staff member added in the app, hash only', async () => {
    const state = baseState()
    state.users = [
      {
        id: 'usr_1',
        authId: 'auth-uuid',
        name: 'Layla',
        email: 'layla@tareez.com',
        role: 'salesperson',
        active: true,
        maxDiscountPercent: 10,
        pinHash: 'deadbeef',
        pinSalt: 'cafe',
      },
    ]

    const adapter = createSupabaseAdapter({ getState: () => state })
    await adapter.push({
      id: 'o7',
      type: 'user.save',
      clientId: 'usr_1',
      payload: { id: 'usr_1' },
      createdAt: '2026-03-01T10:00:00.000Z',
    })

    const [row] = rowsFor('staff')
    expect(row).toMatchObject({
      id: 'usr_1',
      auth_id: 'auth-uuid',
      email: 'layla@tareez.com',
      role: 'salesperson',
      active: true,
      pin_hash: 'deadbeef',
      pin_salt: 'cafe',
    })
    // The plaintext PIN must never appear in what is sent.
    expect(JSON.stringify(row)).not.toContain('1234')
    expect(row.pin).toBeUndefined()
  })

  it('removes a staff member from the list without touching their login', async () => {
    const adapter = createSupabaseAdapter({ getState: () => baseState() })
    await adapter.push({
      id: 'o8',
      type: 'user.delete',
      clientId: 'del-u',
      payload: { userId: 'usr_1' },
      createdAt: '2026-03-01T10:00:00.000Z',
    })

    expect(deletes).toContainEqual({ table: 'staff', column: 'id', values: ['usr_1'] })
    // auth.users is service-role territory and must not be reachable from here.
    expect(deletes.some((entry) => entry.table.includes('auth'))).toBe(false)
  })

  it('reports failure rather than throwing when state is not loaded yet', async () => {
    const adapter = createSupabaseAdapter({ getState: () => null })
    const result = await adapter.push({ id: 'o6', type: 'order.create', clientId: 'y', payload: {}, createdAt: '' })
    expect(result.ok).toBe(false)
  })
})
