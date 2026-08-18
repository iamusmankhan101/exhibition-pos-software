/**
 * Supabase transport for the offline outbox.
 *
 * The outbox holds *commands* ("this sale happened", "this stock moved"), but a
 * command's payload is only what the caller passed in — the rows it actually
 * produced (payments, stock movements, the new inventory balance) live in the
 * state the domain function returned. So the adapter is given a reader for the
 * current local state and mirrors the real rows, not just the payload.
 *
 * Everything is an upsert keyed by the id the device minted offline, which makes
 * a replayed queue harmless: applying the same command twice writes the same
 * rows twice and lands in the same place.
 *
 * Phase 1 treats the device as authoritative and Supabase as the durable copy —
 * good for backup, reporting and the live owner dashboard. Making the server
 * authoritative for stock and invoice numbers is phase 2, and is what multiple
 * tills selling at once will need.
 */

import { getSupabase, isConfigured } from './supabase.js'
import { MAIN_LOCATION } from './format.js'

// Resolved once on the first sync and reused. The handlers below read it rather
// than taking it as an argument, which keeps each one about rows, not plumbing.
let sb = null

/* ------------------------------------------------------------- mapping */

const orderRow = (order) => ({
  id: order.id,
  client_id: order.clientId,
  invoice_no: order.invoiceNo,
  exhibition_id: order.exhibitionId === MAIN_LOCATION ? null : order.exhibitionId,
  customer_id: order.customerId || null,
  customer_name: order.customerName || '',
  salesperson_id: order.salespersonId || '',
  salesperson_name: order.salespersonName || '',
  items: order.items || [],
  subtotal: order.subtotal || 0,
  discount_type: order.discountType || 'percentage',
  discount_value: order.discountValue || 0,
  discount_amount: order.discountAmount || 0,
  line_discounts: order.lineDiscounts || 0,
  promo_code: order.promoCode || '',
  promo_amount: order.promoAmount || 0,
  tax: order.tax || 0,
  total: order.total || 0,
  payment_method: order.paymentMethod || '',
  payment_parts: order.paymentParts || [],
  payment_reference: order.paymentReference || '',
  status: order.status || 'Completed',
  amount_paid: order.amountPaid || 0,
  balance_due: order.balanceDue || 0,
  note: order.note || '',
  offline_created: Boolean(order.offlineCreated),
  oversell: order.oversell || null,
  refunded_amount: order.refundedAmount || 0,
  created_at: order.createdAt,
})

const paymentRow = (payment) => ({
  id: payment.id,
  order_id: payment.orderId,
  invoice_no: payment.invoiceNo || '',
  method: payment.method,
  amount: payment.amount,
  status: payment.status || 'Captured',
  reference: payment.reference || '',
  kind: payment.kind || 'payment',
  exhibition_id: payment.exhibitionId === MAIN_LOCATION ? null : payment.exhibitionId,
  created_at: payment.createdAt,
})

const returnRow = (entry) => ({
  id: entry.id,
  kind: entry.kind || 'return',
  order_id: entry.orderId,
  invoice_no: entry.invoiceNo || '',
  exhibition_id: entry.exhibitionId === MAIN_LOCATION ? null : entry.exhibitionId,
  customer_id: entry.customerId || null,
  customer_name: entry.customerName || '',
  salesperson_name: entry.salespersonName || '',
  lines: entry.lines || [],
  quantity: entry.quantity || 0,
  refund_amount: entry.refundAmount || 0,
  balance_cleared: entry.balanceCleared || 0,
  method: entry.method || '',
  reason: entry.reason || '',
  user_id: entry.userId || '',
  user_name: entry.userName || '',
  created_at: entry.createdAt,
})

const movementRow = (movement) => ({
  id: movement.id,
  variant_id: movement.variantId,
  location_id: movement.locationId,
  type: movement.type,
  quantity: movement.quantity,
  balance_after: movement.balanceAfter,
  reference: movement.reference || '',
  user_id: movement.userId || '',
  note: movement.note || '',
  created_at: movement.createdAt,
})

const inventoryRow = (cell) => ({
  location_id: cell.locationId,
  variant_id: cell.variantId,
  quantity: cell.quantity,
  updated_at: cell.updatedAt,
})

const productRow = (product) => ({
  id: product.id,
  name: product.name,
  category: product.category || '',
  collection: product.collection || '',
  description: product.description || '',
  status: product.status || 'Active',
  // Phase 1 keeps the data URL the picker produced. Phase 2 uploads to Storage
  // and stores the public URL here instead.
  image_url: product.image || null,
})

const variantRow = (variant, productId) => ({
  id: variant.id,
  product_id: productId,
  sku: variant.sku,
  barcode: String(variant.barcode || ''),
  size: variant.size || '',
  color: variant.color || '',
  price: variant.price || 0,
  exhibition_price: variant.exhibitionPrice ?? null,
  cost: variant.cost || 0,
  min_stock: variant.minStock || 0,
})

const customerRow = (customer) => ({
  id: customer.id,
  name: customer.name,
  whatsapp: customer.whatsapp || '',
  phone: customer.phone || '',
  email: customer.email || '',
  marketing_consent: Boolean(customer.marketingConsent),
  consent_at: customer.consentAt || null,
  total_orders: customer.totalOrders || 0,
  total_spend: customer.totalSpend || 0,
  last_purchase_at: customer.lastPurchaseAt || null,
  exhibition_ids: customer.exhibitionIds || [],
})

const exhibitionRow = (exhibition) => ({
  id: exhibition.id,
  name: exhibition.name,
  location: exhibition.location || '',
  start_date: exhibition.startDate || null,
  end_date: exhibition.endDate || null,
  status: exhibition.status || 'Upcoming',
  staff_ids: exhibition.staffIds || [],
  notes: exhibition.notes || '',
  closed_at: exhibition.closedAt || null,
  closing_report: exhibition.closingReport || null,
})

const promoRow = (promo) => ({
  id: promo.id,
  code: promo.code,
  description: promo.description || '',
  type: promo.type || 'percentage',
  value: promo.value || 0,
  min_spend: promo.minSpend || 0,
  usage_limit: promo.usageLimit || 0,
  used_count: promo.usedCount || 0,
  starts_at: promo.startsAt || null,
  expires_at: promo.expiresAt || null,
  exhibition_id: promo.exhibitionId || 'all',
  active: promo.active !== false,
  created_at: promo.createdAt,
})

/** Only the hash of a PIN ever leaves the device that set it. */
const staffRow = (account) => ({
  id: account.id,
  auth_id: account.authId || null,
  name: account.name,
  email: account.email,
  role: account.role,
  pin_hash: account.pinHash || null,
  pin_salt: account.pinSalt || null,
  active: Boolean(account.active),
  max_discount_percent: account.maxDiscountPercent ?? null,
})

const auditRow = (log) => ({
  id: log.id,
  user_id: log.userId || '',
  user_name: log.userName || '',
  action: log.action,
  entity: log.entity || '',
  entity_id: log.entityId || '',
  detail: log.detail || '',
  device_id: log.deviceId || '',
  created_at: log.createdAt,
})

/* ------------------------------------------------------------- helpers */

/** Throws on a real error so `drainOutbox` retries; ignores an empty write. */
async function upsert(table, rows, onConflict) {
  const list = (Array.isArray(rows) ? rows : [rows]).filter(Boolean)
  if (!list.length) return
  const { error } = await sb.from(table).upsert(list, onConflict ? { onConflict } : undefined)
  if (error) throw new Error(`${table}: ${error.message}`)
}

async function remove(table, column, values) {
  const list = (Array.isArray(values) ? values : [values]).filter(Boolean)
  if (!list.length) return
  const { error } = await sb.from(table).delete().in(column, list)
  if (error) throw new Error(`${table}: ${error.message}`)
}

const inventoryCells = (state, variantIds) => {
  const wanted = new Set(variantIds)
  return Object.values(state.inventory || {}).filter((cell) => wanted.has(cell.variantId))
}

const movementsFor = (state, reference) =>
  (state.movements || []).filter((movement) => movement.reference === reference)

const variantIdsOf = (order) => (order.items || []).map((item) => item.variantId)

/* ------------------------------------------------------------ commands */

/**
 * What each queued command means in terms of rows. Every handler reads the
 * *result* out of local state rather than trusting the payload alone, because
 * a sale writes payments, movements and inventory that the payload never held.
 */
const handlers = {
  async 'order.create'(entry, state) {
    const order = state.orders.find((row) => row.clientId === entry.clientId) || entry.payload
    await upsert('orders', orderRow(order))
    await upsert('payments', (state.payments || []).filter((p) => p.orderId === order.id).map(paymentRow))
    await upsert('stock_movements', movementsFor(state, order.invoiceNo).map(movementRow))
    await upsert('inventory', inventoryCells(state, variantIdsOf(order)).map(inventoryRow), 'location_id,variant_id')
    if (order.customerId) {
      const customer = state.customers.find((row) => row.id === order.customerId)
      if (customer) await upsert('customers', customerRow(customer))
    }
    if (order.promoCode) {
      const promo = (state.promoCodes || []).find(
        (row) => String(row.code).toUpperCase() === String(order.promoCode).toUpperCase(),
      )
      if (promo) await upsert('promo_codes', promoRow(promo))
    }
  },

  async 'order.settle'(entry, state) {
    const order = state.orders.find((row) => row.id === entry.payload.orderId)
    if (!order) return
    await upsert('orders', orderRow(order))
    await upsert('payments', (state.payments || []).filter((p) => p.orderId === order.id).map(paymentRow))
    if (order.customerId) {
      const customer = state.customers.find((row) => row.id === order.customerId)
      if (customer) await upsert('customers', customerRow(customer))
    }
  },

  async 'order.refund'(entry, state) {
    const order = state.orders.find((row) => row.id === entry.payload.orderId)
    if (!order) return
    await upsert('orders', orderRow(order))
    await upsert('payments', (state.payments || []).filter((p) => p.orderId === order.id).map(paymentRow))
    await upsert('returns', (state.returns || []).filter((r) => r.orderId === order.id).map(returnRow))
    await upsert('stock_movements', movementsFor(state, order.invoiceNo).map(movementRow))
    await upsert('inventory', inventoryCells(state, variantIdsOf(order)).map(inventoryRow), 'location_id,variant_id')
  },

  async 'order.delete'(entry, state) {
    // Payments and returns cascade from the order row.
    await remove('orders', 'id', entry.payload.orderIds)
    // Stock may have been restored, so mirror every cell that could have moved.
    await upsert('inventory', Object.values(state.inventory || {}).map(inventoryRow), 'location_id,variant_id')
  },

  async 'stock.transfer'(entry, state) {
    const { variantId } = entry.payload
    await upsert('inventory', inventoryCells(state, [variantId]).map(inventoryRow), 'location_id,variant_id')
    await upsert(
      'stock_movements',
      (state.movements || []).filter((m) => m.variantId === variantId).slice(0, 4).map(movementRow),
    )
  },

  async 'stock.adjust'(entry, state) {
    const { variantId } = entry.payload
    await upsert('inventory', inventoryCells(state, [variantId]).map(inventoryRow), 'location_id,variant_id')
    await upsert(
      'stock_movements',
      (state.movements || []).filter((m) => m.variantId === variantId).slice(0, 2).map(movementRow),
    )
  },

  async 'product.save'(entry, state) {
    const product = state.products.find((row) => row.id === entry.payload.id) || entry.payload
    await upsert('products', productRow(product))
    await upsert('variants', product.variants.map((variant) => variantRow(variant, product.id)))
    // A variant removed in the editor has to go from the server too.
    const { data } = await sb.from('variants').select('id').eq('product_id', product.id)
    const keep = new Set(product.variants.map((variant) => variant.id))
    const orphans = (data || []).map((row) => row.id).filter((id) => !keep.has(id))
    await remove('variants', 'id', orphans)
  },

  async 'product.delete'(entry) {
    await remove('products', 'id', entry.payload.productIds)
  },

  async 'customer.save'(entry, state) {
    const customer = state.customers.find((row) => row.id === entry.payload.id) || entry.payload
    await upsert('customers', customerRow(customer))
  },

  async 'customer.delete'(entry) {
    await remove('customers', 'id', entry.payload.customerIds)
  },

  async 'exhibition.save'(entry, state) {
    const exhibition = state.exhibitions.find((row) => row.id === entry.payload.id) || entry.payload
    await upsert('exhibitions', exhibitionRow(exhibition))
  },

  async 'exhibition.close'(entry, state) {
    const exhibition = state.exhibitions.find((row) => row.id === entry.clientId)
    if (exhibition) await upsert('exhibitions', exhibitionRow(exhibition))
    // Closing returns unsold stock to the warehouse, so every cell may have moved.
    await upsert('inventory', Object.values(state.inventory || {}).map(inventoryRow), 'location_id,variant_id')
  },

  async 'exhibition.delete'(entry, state) {
    if (entry.payload.deleteSales) {
      const { error } = await sb.from('orders').delete().eq('exhibition_id', entry.payload.exhibitionId)
      if (error) throw new Error(`orders: ${error.message}`)
    }
    await remove('exhibitions', 'id', entry.payload.exhibitionId)
    await upsert('inventory', Object.values(state.inventory || {}).map(inventoryRow), 'location_id,variant_id')
  },

  async 'promo.save'(entry, state) {
    const promo = (state.promoCodes || []).find((row) => row.id === entry.payload.id) || entry.payload
    await upsert('promo_codes', promoRow(promo))
  },

  async 'promo.delete'(entry) {
    await remove('promo_codes', 'id', entry.payload.promoId)
  },

  async 'user.signup'(entry, state) {
    const account = state.users.find((row) => row.id === entry.payload.id)
    if (!account) return
    await upsert('staff', staffRow(account))
  },

  async 'user.save'(entry, state) {
    const account = state.users.find((row) => row.id === entry.payload.id) || entry.payload
    await upsert('staff', staffRow(account))
  },

  async 'user.delete'(entry) {
    // The auth.users login is left alone: removing someone from the staff list
    // stops them reaching anything, and deleting an auth account needs the
    // service role, which the browser must never hold.
    await remove('staff', 'id', entry.payload.userId)
  },
}

/* -------------------------------------------------------------- adapter */

/**
 * Builds the adapter. `getState` reads the current local state, which is where
 * the rows a command produced actually live.
 */
export function createSupabaseAdapter({ getState }) {
  return {
    name: 'supabase',

    async push(entry) {
      if (!isConfigured) return { ok: false }
      const state = getState()
      if (!state) return { ok: false }
      sb = sb || (await getSupabase())
      if (!sb) return { ok: false }

      const handler = handlers[entry.type]
      // An unknown command must not wedge the queue behind it forever.
      if (!handler) {
        return { ok: true, clientId: entry.clientId, syncedAt: new Date().toISOString() }
      }

      await handler(entry, state)

      // The audit trail written alongside this command. PRD §19 wants who did
      // what and when to survive off the device.
      const logs = (state.auditLogs || []).filter((log) => log.createdAt >= entry.createdAt)
      await upsert('audit_logs', logs.slice(0, 20).map(auditRow))

      // Append-only ledger of what has been applied. Unique on client_id, so a
      // replay is recorded once; a conflict here means it already landed.
      const { error } = await sb.from('sync_commands').upsert(
        {
          id: entry.id,
          client_id: entry.clientId,
          type: entry.type,
          payload: entry.payload ?? {},
          device_id: entry.deviceId || '',
          created_at: entry.createdAt,
        },
        { onConflict: 'client_id' },
      )
      if (error) throw new Error(`sync_commands: ${error.message}`)

      return { ok: true, clientId: entry.clientId, syncedAt: new Date().toISOString() }
    },
  }
}

/* ------------------------------------------------------------ bootstrap */

/**
 * Pulls the whole dataset down into the local state shape.
 *
 * Used when a fresh device signs in and has nothing yet. It deliberately does
 * not merge — merging a device that already holds unsynced sales is the phase 2
 * problem, and quietly guessing here would be how a sale goes missing.
 */
export async function pullEverything() {
  if (!isConfigured) throw new Error('Supabase is not configured.')
  sb = sb || (await getSupabase())

  const tables = [
    'settings', 'roles', 'staff', 'products', 'variants', 'exhibitions',
    'customers', 'promo_codes', 'orders', 'payments', 'returns',
    'inventory', 'stock_movements', 'devices', 'audit_logs',
  ]

  const loaded = {}
  for (const table of tables) {
    const { data, error } = await sb.from(table).select('*')
    if (error) throw new Error(`${table}: ${error.message}`)
    loaded[table] = data || []
  }

  const inventory = {}
  for (const cell of loaded.inventory) {
    inventory[`${cell.location_id}:${cell.variant_id}`] = {
      locationId: cell.location_id,
      variantId: cell.variant_id,
      quantity: Number(cell.quantity),
      updatedAt: cell.updated_at,
    }
  }

  const variantsByProduct = loaded.variants.reduce((acc, row) => {
    ;(acc[row.product_id] ||= []).push({
      id: row.id,
      sku: row.sku,
      barcode: row.barcode,
      size: row.size,
      color: row.color,
      price: Number(row.price),
      exhibitionPrice: row.exhibition_price === null ? null : Number(row.exhibition_price),
      cost: Number(row.cost),
      minStock: row.min_stock,
    })
    return acc
  }, {})

  return {
    settings: loaded.settings[0]?.data,
    roles: loaded.roles.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      system: row.system,
      permissions: row.permissions,
      maxDiscountPercent: Number(row.max_discount_percent),
    })),
    users: loaded.staff.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      role: row.role,
      active: row.active,
      maxDiscountPercent: row.max_discount_percent,
    })),
    products: loaded.products.map((row) => ({
      id: row.id,
      name: row.name,
      category: row.category,
      collection: row.collection,
      description: row.description,
      status: row.status,
      image: row.image_url,
      variants: variantsByProduct[row.id] || [],
    })),
    exhibitions: loaded.exhibitions.map((row) => ({
      id: row.id,
      name: row.name,
      location: row.location,
      startDate: row.start_date,
      endDate: row.end_date,
      status: row.status,
      staffIds: row.staff_ids,
      notes: row.notes,
      closedAt: row.closed_at,
      closingReport: row.closing_report,
    })),
    customers: loaded.customers.map((row) => ({
      id: row.id,
      name: row.name,
      whatsapp: row.whatsapp,
      phone: row.phone,
      email: row.email,
      marketingConsent: row.marketing_consent,
      consentAt: row.consent_at,
      totalOrders: row.total_orders,
      totalSpend: Number(row.total_spend),
      lastPurchaseAt: row.last_purchase_at,
      exhibitionIds: row.exhibition_ids,
    })),
    promoCodes: loaded.promo_codes.map((row) => ({
      id: row.id,
      code: row.code,
      description: row.description,
      type: row.type,
      value: Number(row.value),
      minSpend: Number(row.min_spend),
      usageLimit: row.usage_limit,
      usedCount: row.used_count,
      startsAt: row.starts_at || '',
      expiresAt: row.expires_at || '',
      exhibitionId: row.exhibition_id,
      active: row.active,
      createdAt: row.created_at,
    })),
    orders: loaded.orders.map((row) => ({
      id: row.id,
      clientId: row.client_id,
      invoiceNo: row.invoice_no,
      exhibitionId: row.exhibition_id || MAIN_LOCATION,
      customerId: row.customer_id,
      customerName: row.customer_name,
      salespersonId: row.salesperson_id,
      salespersonName: row.salesperson_name,
      items: row.items,
      subtotal: Number(row.subtotal),
      discountType: row.discount_type,
      discountValue: Number(row.discount_value),
      discountAmount: Number(row.discount_amount),
      lineDiscounts: Number(row.line_discounts),
      promoCode: row.promo_code,
      promoAmount: Number(row.promo_amount),
      tax: Number(row.tax),
      total: Number(row.total),
      paymentMethod: row.payment_method,
      paymentParts: row.payment_parts,
      paymentReference: row.payment_reference,
      status: row.status,
      amountPaid: Number(row.amount_paid),
      balanceDue: Number(row.balance_due),
      note: row.note,
      offlineCreated: row.offline_created,
      oversell: row.oversell,
      refundedAmount: Number(row.refunded_amount),
      createdAt: row.created_at,
    })),
    payments: loaded.payments.map((row) => ({
      id: row.id,
      orderId: row.order_id,
      invoiceNo: row.invoice_no,
      method: row.method,
      amount: Number(row.amount),
      status: row.status,
      reference: row.reference,
      kind: row.kind,
      exhibitionId: row.exhibition_id || MAIN_LOCATION,
      createdAt: row.created_at,
    })),
    returns: loaded.returns.map((row) => ({
      id: row.id,
      kind: row.kind,
      orderId: row.order_id,
      invoiceNo: row.invoice_no,
      exhibitionId: row.exhibition_id || MAIN_LOCATION,
      customerId: row.customer_id,
      customerName: row.customer_name,
      salespersonName: row.salesperson_name,
      lines: row.lines,
      quantity: row.quantity,
      refundAmount: Number(row.refund_amount),
      balanceCleared: Number(row.balance_cleared),
      method: row.method,
      reason: row.reason,
      userId: row.user_id,
      userName: row.user_name,
      createdAt: row.created_at,
    })),
    inventory,
    movements: loaded.stock_movements.map((row) => ({
      id: row.id,
      variantId: row.variant_id,
      locationId: row.location_id,
      type: row.type,
      quantity: Number(row.quantity),
      balanceAfter: row.balance_after === null ? null : Number(row.balance_after),
      reference: row.reference,
      userId: row.user_id,
      note: row.note,
      createdAt: row.created_at,
    })),
    devices: loaded.devices.map((row) => ({
      id: row.id,
      code: row.code,
      label: row.label,
      firstSeenAt: row.first_seen_at,
      lastSeenAt: row.last_seen_at,
      lastUserId: row.last_user_id,
      lastUserName: row.last_user_name,
      revokedAt: row.revoked_at,
      userAgent: row.user_agent,
    })),
    auditLogs: loaded.audit_logs.map((row) => ({
      id: row.id,
      userId: row.user_id,
      userName: row.user_name,
      action: row.action,
      entity: row.entity,
      entityId: row.entity_id,
      detail: row.detail,
      deviceId: row.device_id,
      createdAt: row.created_at,
    })),
  }
}
