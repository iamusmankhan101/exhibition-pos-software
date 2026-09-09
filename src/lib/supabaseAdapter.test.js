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

/** Rows the stub hands back to a read, keyed by table. Empty unless a test fills it. */
const tables = {}

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
        const rows = tables[table] || []
        // Awaitable for `select('*')` and chainable for `select().eq()`, so the
        // one stub serves both the pull and the orphan-variant lookup.
        return {
          eq: () => Promise.resolve({ data: rows, error: null }),
          then: (resolve) => resolve({ data: rows, error: null }),
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
  for (const key of Object.keys(tables)) delete tables[key]
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

  it('mirrors the whole settings blob into the single settings row', async () => {
    const state = baseState()
    state.settings = { ...settings, currencySymbol: 'Rs ', categories: ['Scarves', 'Abayas'] }

    const adapter = createSupabaseAdapter({ getState: () => state })
    await adapter.push({
      id: 'o9',
      type: 'settings.save',
      clientId: 'set-1',
      payload: {},
      createdAt: '2026-03-01T10:00:00.000Z',
    })

    const [row] = rowsFor('settings')
    expect(row.id).toBe('settings')
    // Read out of state, not out of the payload — which is deliberately empty.
    expect(row.data.categories).toEqual(['Scarves', 'Abayas'])
    expect(row.data.currencySymbol).toBe('Rs ')
  })

  it('sends a role by id and moves its staff before deleting it', async () => {
    const state = baseState()
    state.roles = [{ id: 'floor', name: 'Floor lead', permissions: ['pos'], maxDiscountPercent: 12 }]
    state.users = [{ id: 'usr_1', name: 'Layla', email: 'l@t.com', role: 'salesperson', active: true }]

    const adapter = createSupabaseAdapter({ getState: () => state })
    await adapter.push({
      id: 'o10',
      type: 'role.save',
      clientId: 'floor',
      payload: { id: 'floor' },
      createdAt: '2026-03-01T10:00:00.000Z',
    })
    expect(rowsFor('roles')[0]).toMatchObject({
      id: 'floor',
      name: 'Floor lead',
      permissions: ['pos'],
      max_discount_percent: 12,
    })

    writes.length = 0
    await adapter.push({
      id: 'o11',
      type: 'role.delete',
      clientId: 'floor',
      payload: { roleId: 'floor', reassignTo: 'salesperson' },
      createdAt: '2026-03-01T10:00:00.000Z',
    })

    // `staff.role` is a foreign key, so the reassignment has to land first.
    expect(rowsFor('staff')[0]).toMatchObject({ id: 'usr_1', role: 'salesperson' })
    expect(deletes).toContainEqual({ table: 'roles', column: 'id', values: ['floor'] })
  })

  it('reports failure rather than throwing when state is not loaded yet', async () => {
    const adapter = createSupabaseAdapter({ getState: () => null })
    const result = await adapter.push({ id: 'o6', type: 'order.create', clientId: 'y', payload: {}, createdAt: '' })
    expect(result.ok).toBe(false)
  })
})

/*
 * Product images are the one field that is large, is not recoverable from
 * anywhere else, and is stored inline in the row rather than behind a URL. A
 * mapping slip that dropped the column, or wrote null over a good server-side
 * copy, would lose the photograph permanently and silently — nothing else in
 * the app would look wrong. So the round trip is pinned in both directions.
 */
describe('product images reach the database and come back', () => {
  const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ'

  const pushSave = (state, payload) =>
    createSupabaseAdapter({ getState: () => state }).push({
      id: 'obx1',
      type: 'product.save',
      clientId: 'p1',
      payload,
      deviceId: 'dev1',
      createdAt: '2026-03-01T10:00:00.000Z',
    })

  it('writes the image into the row it saves', async () => {
    const state = baseState()
    state.products[0].image = PHOTO
    const result = await pushSave(state, { id: 'p1' })

    expect(result.ok).toBe(true)
    expect(rowsFor('products')[0].image_url).toBe(PHOTO)
  })

  it('reads it from live state, not from the outbox payload', async () => {
    const state = baseState()
    state.products[0].image = PHOTO
    // The queued payload carries no image — the store strips it so the outbox
    // does not hold a second copy of every photograph.
    await pushSave(state, { id: 'p1', image: null })

    expect(rowsFor('products')[0].image_url).toBe(PHOTO)
  })

  it('leaves the column alone when the product is gone from local state', async () => {
    // Deleted locally before the queue drained: the payload standing in for it
    // has no image, so writing the column would blank a good server-side one.
    await pushSave(baseState(), { id: 'gone', name: 'Ghost', variants: [] })

    const [row] = rowsFor('products')
    expect(row.id).toBe('gone')
    expect(row).not.toHaveProperty('image_url')
  })

  it('comes back on a fresh device that pulls the catalogue down', async () => {
    const { pullEverything } = await import('./supabaseAdapter.js')
    tables.products = [
      { id: 'p1', name: 'Scarf', category: 'Scarves', collection: '', description: '', status: 'Active', image_url: PHOTO },
    ]
    tables.variants = [
      { id: 'v1', product_id: 'p1', sku: 'SKU1', barcode: '2001234567895', size: 'M', color: 'Black', price: 100, exhibition_price: null, cost: 20, min_stock: 1 },
    ]

    const pulled = await pullEverything()
    expect(pulled.products[0].image).toBe(PHOTO)
  })

  it('clears the column when the image really was removed', async () => {
    const state = baseState()
    state.products[0].image = null
    await pushSave(state, { id: 'p1' })

    // Present and null, not absent — "Remove image" has to reach the server.
    expect(rowsFor('products')[0]).toHaveProperty('image_url', null)
  })
})

/* -------------------------------------------------------------- backfill */

/**
 * The backfill is the recovery path for data that predates the backend, so
 * these tests are about the two ways it could quietly make things worse:
 * writing rows in an order the foreign keys reject, and overwriting a live
 * staff login with a local record that never had one.
 */
describe('pushEverything', () => {
  const PHOTO = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQ'

  const fullState = () => {
    const state = baseState()
    state.roles = [{ id: 'admin', name: 'Admin', permissions: ['*'], maxDiscountPercent: 100 }]
    state.users = [
      { id: 'u1', authId: 'auth-uuid-1', name: 'Ali', email: 'ali@tareez.com', role: 'admin', active: true },
      { id: 'u2', name: 'Sara', email: 'sara@tareez.com', role: 'admin', active: true },
    ]
    state.movements = [
      { id: 'm1', variantId: 'v1', locationId: 'ex1', type: 'in', quantity: 10, balanceAfter: 10, createdAt: '2026-03-01T10:00:00.000Z' },
    ]
    state.devices = [
      { id: 'dev1', code: 'AB12', label: 'Till', firstSeenAt: '2026-03-01T09:00:00.000Z', lastSeenAt: '2026-03-01T10:00:00.000Z' },
    ]
    state.orders = [
      {
        id: 'o1',
        clientId: 'cli-1',
        invoiceNo: 'TRZ-0001',
        exhibitionId: 'ex1',
        customerId: 'cus1',
        items: [{ variantId: 'v1', quantity: 1 }],
        total: 80,
        createdAt: '2026-03-01T10:05:00.000Z',
      },
    ]
    state.payments = [
      { id: 'pay1', orderId: 'o1', method: 'Cash', amount: 80, createdAt: '2026-03-01T10:05:00.000Z' },
    ]
    return state
  }

  it('writes every table in an order the foreign keys accept', async () => {
    const { pushEverything } = await import('./supabaseAdapter.js')
    await pushEverything(fullState())

    const order = writes.map((write) => write.table)
    const at = (table) => order.indexOf(table)

    // staff.role -> roles.id
    expect(at('roles')).toBeLessThan(at('staff'))
    // variants.product_id -> products.id
    expect(at('products')).toBeLessThan(at('variants'))
    // inventory.variant_id and stock_movements.variant_id -> variants.id
    expect(at('variants')).toBeLessThan(at('inventory'))
    expect(at('variants')).toBeLessThan(at('stock_movements'))
    // orders.customer_id -> customers.id
    expect(at('customers')).toBeLessThan(at('orders'))
  })

  it('never nulls a live auth_id from a record that has no login on it', async () => {
    const { pushEverything } = await import('./supabaseAdapter.js')
    await pushEverything(fullState())

    const staff = rowsFor('staff')
    // Ali was pulled with his login, so the link is written back.
    expect(staff.find((row) => row.id === 'u1').auth_id).toBe('auth-uuid-1')
    // Sara's record reached this device through a pull, which drops auth_id.
    // Writing it as null would lock her out of every RLS policy in the project.
    expect(staff.find((row) => row.id === 'u2')).not.toHaveProperty('auth_id')
  })

  it('upserts inventory on its composite key, not on a primary key it has not got', async () => {
    const { pushEverything } = await import('./supabaseAdapter.js')
    await pushEverything(fullState())

    const write = writes.find((entry) => entry.table === 'inventory')
    expect(write.options).toEqual({ onConflict: 'location_id,variant_id' })
  })

  it('sends products in small batches, because each row can carry an image', async () => {
    const { pushEverything } = await import('./supabaseAdapter.js')
    const state = fullState()
    state.products = Array.from({ length: 45 }, (_, i) => ({
      id: `p${i}`,
      name: `Product ${i}`,
      image: PHOTO,
      variants: [],
    }))

    await pushEverything(state)

    const batches = writes.filter((write) => write.table === 'products')
    expect(batches.length).toBe(3)
    expect(Math.max(...batches.map((batch) => batch.rows.length))).toBeLessThanOrEqual(20)
    expect(rowsFor('products')).toHaveLength(45)
  })

  it('reports what it sent, so the till can say more than "done"', async () => {
    const { pushEverything } = await import('./supabaseAdapter.js')
    const summary = await pushEverything(fullState())

    expect(summary.tables.products).toBe(1)
    expect(summary.tables.staff).toBe(2)
    expect(summary.tables.inventory).toBe(1)
    expect(summary.total).toBe(
      Object.values(summary.tables).reduce((sum, count) => sum + count, 0),
    )
  })

  it('skips a table with nothing in it rather than sending an empty write', async () => {
    const { pushEverything } = await import('./supabaseAdapter.js')
    const state = fullState()
    state.orders = []

    await pushEverything(state)
    expect(writes.some((write) => write.table === 'orders')).toBe(false)
  })
})
