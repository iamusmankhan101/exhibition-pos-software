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

/**
 * A product as a row.
 *
 * `image` carries the data URL the picker produced, and it is written here as
 * the column's own value rather than a link to a bucket — the till has to draw
 * a thumbnail with no network, so the picture lives in the record. Phase 2
 * uploads to Storage and stores the public URL here instead.
 *
 * `withImage` is false only when the product could not be read back from local
 * state and the outbox payload stood in for it. Those payloads carry no image
 * (see `slimPayload` in the store), so writing the column from one would
 * replace a good server-side image with null — which is the difference between
 * an image saved permanently and one that survives until the next sync.
 */
const productRow = (product, { withImage = true } = {}) => ({
  id: product.id,
  name: product.name,
  category: product.category || '',
  collection: product.collection || '',
  description: product.description || '',
  status: product.status || 'Active',
  ...(withImage ? { image_url: product.image || null } : {}),
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

/**
 * Only the hash of a PIN ever leaves the device that set it.
 *
 * `auth_id` is the link between a staff record and the login that owns it, and
 * it is what every RLS policy checks through `is_active_staff()`. A device that
 * has only ever seen this person through a pull holds no `authId` for them —
 * the pull maps the row for display and drops it — so writing the column from
 * such a record would replace a live link with null and lock that person out of
 * the project entirely. The column is therefore omitted rather than nulled
 * whenever the local record cannot supply one.
 */
const staffRow = (account) => ({
  id: account.id,
  ...(account.authId ? { auth_id: account.authId } : {}),
  name: account.name,
  email: account.email,
  role: account.role,
  pin_hash: account.pinHash || null,
  pin_salt: account.pinSalt || null,
  active: Boolean(account.active),
  max_discount_percent: account.maxDiscountPercent ?? null,
})

const roleRow = (role) => ({
  id: role.id,
  name: role.name,
  description: role.description || '',
  system: Boolean(role.system),
  permissions: role.permissions || [],
  max_discount_percent: role.maxDiscountPercent ?? 0,
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

/**
 * Is this the backend saying "I do not know who you are"?
 *
 * Worth telling apart from every other failure, because it is the only one
 * retrying cannot fix. PostgREST answers an unreadable or expired token with
 * 401 and `PGRST301` — a different thing from the 403 (`42501`) row-level
 * security gives a caller it *did* authenticate and then refused. Retrying the
 * first is how a till spends an afternoon pushing the same sale every four
 * seconds; only a fresh sign-in ends it.
 *
 * Checked here rather than trusted from `getSession`, which validates a stored
 * token's expiry locally and nothing else. A project whose JWT secret has been
 * rotated hands back a session that looks perfectly good and is refused by
 * every request, and the wire is the only place that shows.
 */
export const isAuthError = (error) =>
  error?.code === 'PGRST301' || /jwt|no suitable key/i.test(error?.message || '')

/**
 * Preserves the PostgREST code, which the message alone throws away, and says
 * whether this entry could ever succeed by being sent again.
 *
 * The distinction decides whether one bad row stops the shop syncing. A dropped
 * connection or a lapsed token affects every entry equally, so the queue should
 * stop and try the lot again shortly. A row the database *understood and
 * refused* — a foreign key with nothing behind it, a column the deployed schema
 * does not have — will be refused identically forever, and the entries queued
 * behind it are usually fine. Postgres and PostgREST both answer with a code;
 * a network failure has none. That is the test.
 */
function fail(table, error) {
  const wrapped = new Error(`${table}: ${error.message}`)
  wrapped.code = error.code
  wrapped.permanent = Boolean(error.code) && !isAuthError(error)
  return wrapped
}

/** Throws on a real error so `drainOutbox` retries; ignores an empty write. */
async function upsert(table, rows, onConflict) {
  const list = (Array.isArray(rows) ? rows : [rows]).filter(Boolean)
  if (!list.length) return
  const { error } = await sb.from(table).upsert(list, onConflict ? { onConflict } : undefined)
  if (error) throw fail(table, error)
}

async function remove(table, column, values) {
  const list = (Array.isArray(values) ? values : [values]).filter(Boolean)
  if (!list.length) return
  const { error } = await sb.from(table).delete().in(column, list)
  if (error) throw fail(table, error)
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
    const live = state.products.find((row) => row.id === entry.payload.id)
    const product = live || entry.payload
    await upsert('products', productRow(product, { withImage: Boolean(live) }))
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

  /**
   * Settings are one shared row, so the last device to save wins — the same
   * device-authoritative rule the rest of phase 1 follows. The payload carries
   * nothing; the row is mirrored out of local state.
   */
  async 'settings.save'(entry, state) {
    await upsert('settings', {
      id: 'settings',
      data: state.settings,
      updated_at: new Date().toISOString(),
    })
  },

  async 'role.save'(entry, state) {
    const role = (state.roles || []).find((row) => row.id === entry.payload.id)
    if (role) await upsert('roles', roleRow(role))
  },

  async 'role.delete'(entry, state) {
    // Staff move to the replacement role first: `staff.role` is a foreign key,
    // so deleting the row out from under them would be rejected.
    const moved = (state.users || []).filter((row) => row.role === entry.payload.reassignTo)
    await upsert('staff', moved.map(staffRow))
    await remove('roles', 'id', entry.payload.roleId)
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
 * Builds the adapter.
 *
 * `getState` reads the current local state, which is where the rows a command
 * produced actually live. `onAuthError` is called when the backend rejects the
 * token rather than the write — the one failure the queue must stop retrying
 * and hand back to a person.
 */
export function createSupabaseAdapter({ getState, onAuthError = () => {} }) {
  return {
    name: 'supabase',

    async push(entry) {
      try {
        return await send(entry, getState())
      } catch (error) {
        if (isAuthError(error)) onAuthError(error)
        throw error
      }
    },
  }

  async function send(entry, state) {
    if (!isConfigured) return { ok: false }
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
    //
    // Deliberately not allowed to fail the command. The sale is the thing that
    // must reach the server; an audit row is a record *about* it. Letting this
    // throw means one rejected log entry stops the queue draining and every
    // later sale waits behind it — which is exactly what a missing UPDATE
    // policy on this table used to cause.
    const logs = (state.auditLogs || []).filter((log) => log.createdAt >= entry.createdAt)
    try {
      await upsert('audit_logs', logs.slice(0, 20).map(auditRow))
    } catch (error) {
      console.warn('[sync] audit log not written:', error.message)
    }

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
    if (error) throw fail('sync_commands', error)

    return { ok: true, clientId: entry.clientId, syncedAt: new Date().toISOString() }
  }
}

/* ------------------------------------------------------------ bootstrap */

/**
 * Every product column except the picture. See `haveImagesFor` below.
 */
const PRODUCT_COLUMNS = 'id, name, category, collection, description, status'

/** Append-only tables, where `historyLimit` means "the most recent N". */
const HISTORY_TABLES = new Set(['orders', 'payments', 'returns', 'stock_movements', 'audit_logs'])

/**
 * Rows per request on a read.
 *
 * PostgREST caps a response — a thousand by default — and says so only by
 * handing back a short list, which reads exactly like a small table. That is
 * not a detail the pull can shrug off: a truncated `variants` read would leave
 * every product past the cap looking like it has no sizes at all, and the merge
 * would then write that emptiness over a device that had them. So every read
 * here is paged to the end.
 */
const READ_PAGE = 1000

/** Ids per `in (...)` lookup. Kept well under the cap so the URL stays sane. */
const IMAGE_LOOKUP_CHUNK = 100

/**
 * Said once, not every twenty seconds for the life of the show.
 *
 * Deletions only propagate between devices once `supabase/schema.sql` has been
 * re-run, so this is the message that explains why deleting a sale on one till
 * leaves it on another.
 */
let warnedMissingDeletions = false
function warnMissingDeletions(error) {
  if (warnedMissingDeletions) return
  warnedMissingDeletions = true
  console.warn(
    '[sync] the `deletions` table is missing, so deletes will not reach other devices. ' +
      'Re-run supabase/schema.sql on the project to fix it. Original error:',
    error?.message,
  )
}

/**
 * Reads a table to the end, a page at a time.
 *
 * `limit` stops it early — the most recent N rows — for the append-only tables
 * a refresh only wants a recent window of.
 */
async function readAll(table, columns, limit) {
  const rows = []
  for (;;) {
    const size = limit ? Math.min(READ_PAGE, limit - rows.length) : READ_PAGE
    if (size <= 0) break
    let request = sb.from(table).select(columns)
    if (limit) request = request.order('created_at', { ascending: false })
    const { data, error } = await request.range(rows.length, rows.length + size - 1)
    if (error) throw fail(table, error)
    rows.push(...(data || []))
    // A short page is the end of the table; a full one might not be.
    if (!data || data.length < size) break
  }
  return rows
}

/**
 * Pulls the whole dataset down into the local state shape.
 *
 * Used when a fresh device signs in and has nothing yet, and again on every
 * refresh once `mergeCloud` gave the app a safe way to fold a pull into a
 * device that already holds data.
 *
 * `haveImagesFor` is the set of product ids whose picture the caller already
 * has. A product image is a base64 data URL living in the row, so a refresh on
 * a timer that re-fetched them would drag megabytes down a stall's uplink every
 * tick, forever. Those rows come back without the column at all — absent, not
 * null — and the merge keeps the copy already on the device. Pass nothing and
 * the pull is complete, which is what first sign-in wants.
 */
export async function pullEverything({ haveImagesFor = null, historyLimit = null } = {}) {
  if (!isConfigured) throw new Error('Supabase is not configured.')
  sb = sb || (await getSupabase())

  const tables = [
    'settings', 'roles', 'staff', 'products', 'variants', 'exhibitions',
    'customers', 'promo_codes', 'orders', 'payments', 'returns',
    'inventory', 'stock_movements', 'devices', 'audit_logs', 'deletions',
  ]

  const loaded = {}
  for (const table of tables) {
    const columns = table === 'products' && haveImagesFor ? PRODUCT_COLUMNS : '*'
    // A refresh wants what has happened lately, not the whole history of the
    // show over and over. Safe to cut short: the merge unions by id and keeps
    // every row already on the device, so a shorter window can only mean a
    // device backfills less of somebody else's past — never that it loses its
    // own. A first sign-in passes no limit and takes the lot.
    const limit = historyLimit && HISTORY_TABLES.has(table) ? historyLimit : null
    // `deletions` arrived after the first deployments, so a project whose
    // schema has not been re-run does not have it. That must not take the whole
    // pull down with it — losing every other table because gravestones are
    // missing would turn a feature that is not there yet into an outage.
    if (table === 'deletions') {
      loaded[table] = await readAll(table, columns, limit).catch((error) => {
        warnMissingDeletions(error)
        return []
      })
      continue
    }
    loaded[table] = await readAll(table, columns, limit)
  }

  // Second pass for the pictures the device is actually missing — a product
  // added on another till still arrives with its image on the very next tick.
  if (haveImagesFor) {
    const missing = loaded.products.filter((row) => !haveImagesFor.has(row.id)).map((row) => row.id)
    const images = new Map()
    for (const batch of chunked(missing, IMAGE_LOOKUP_CHUNK)) {
      const { data, error } = await sb.from('products').select('id, image_url').in('id', batch)
      if (error) throw fail('products', error)
      for (const row of data || []) images.set(row.id, row.image_url)
    }
    if (images.size) {
      loaded.products = loaded.products.map((row) =>
        images.has(row.id) ? { ...row, image_url: images.get(row.id) } : row,
      )
    }
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
      // Left out entirely when the pull skipped the column, so that the merge
      // keeps the picture this device already holds. `null` would wipe it.
      ...('image_url' in row ? { image: row.image_url } : {}),
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
    // What other tills have deleted. Explicit, unlike absence, so the merge is
    // allowed to act on it.
    deletions: Object.fromEntries((loaded.deletions || []).map((row) => [row.id, row.deleted_at])),
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

/**
 * Records deletions this device has made.
 *
 * Separate from the command queue on purpose. A command says "delete these
 * orders" and is consumed once; this is the standing fact that they are gone,
 * which every other device needs to read long afterwards — including one that
 * was switched off at the time and has the rows still sitting in its own copy.
 *
 * Upserted by id, so re-sending the same gravestone is free.
 */
export async function pushDeletions(rows) {
  if (!isConfigured || !rows.length) return 0
  sb = sb || (await getSupabase())
  if (!sb) return 0

  for (const batch of chunked(rows, PUSH_CHUNK)) {
    const { error } = await sb.from('deletions').upsert(batch, { onConflict: 'id' })
    if (error) throw fail('deletions', error)
  }
  return rows.length
}

/* ------------------------------------------------------------- backfill */

const deviceRow = (device) => ({
  id: device.id,
  code: device.code,
  label: device.label || '',
  first_seen_at: device.firstSeenAt,
  last_seen_at: device.lastSeenAt,
  last_user_id: device.lastUserId || null,
  last_user_name: device.lastUserName || '',
  revoked_at: device.revokedAt || null,
  user_agent: device.userAgent || '',
})

/**
 * How many rows go up in one request.
 *
 * Products are their own case because the image lives in the row as a base64
 * data URL — a hundred of those in one request is tens of megabytes, which the
 * API rejects outright and a stall's uplink would not carry anyway. The rest
 * are small enough that the round trip, not the payload, is the cost.
 */
const PUSH_CHUNK = 400
const PRODUCT_CHUNK = 20

const chunked = (rows, size) => {
  const out = []
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size))
  return out
}

/**
 * Mirrors the whole of local state up to Supabase.
 *
 * This exists because sync only ever carried *new* mutations. A device that
 * built its catalogue before the backend was configured queued those changes
 * against the local adapter, which reports success without sending anything —
 * so they were marked synced and were never eligible to be pushed again. The
 * data is perfectly safe in IndexedDB and completely absent from the server,
 * and no amount of ordinary use will ever close that gap: nothing re-sends a
 * record that the queue believes it already sent.
 *
 * Every write is the same upsert the incremental path uses, so running this
 * twice writes the same rows twice and lands in the same place. It is additive
 * by design — nothing is deleted, so a row that exists only on the server (a
 * sale another till took) survives a backfill from this one.
 *
 * Ordered to respect the foreign keys: roles before the staff that reference
 * them, products before variants, variants before the inventory and movements
 * that hang off them, customers before the orders that name them.
 */
export async function pushEverything(state, onProgress = () => {}) {
  if (!isConfigured) throw new Error('Supabase is not configured.')
  if (!state) throw new Error('There is no local data to push.')
  sb = sb || (await getSupabase())
  if (!sb) throw new Error('Could not reach Supabase.')

  const products = state.products || []

  const plan = [
    ['roles', (state.roles || []).map(roleRow)],
    ['staff', (state.users || []).map(staffRow)],
    [
      'settings',
      state.settings
        ? [{ id: 'settings', data: state.settings, updated_at: new Date().toISOString() }]
        : [],
    ],
    ['exhibitions', (state.exhibitions || []).map(exhibitionRow)],
    ['products', products.map((product) => productRow(product)), PRODUCT_CHUNK],
    [
      'variants',
      products.flatMap((product) =>
        (product.variants || []).map((variant) => variantRow(variant, product.id)),
      ),
    ],
    ['customers', (state.customers || []).map(customerRow)],
    ['promo_codes', (state.promoCodes || []).map(promoRow)],
    ['orders', (state.orders || []).map(orderRow)],
    ['payments', (state.payments || []).map(paymentRow)],
    ['returns', (state.returns || []).map(returnRow)],
    ['inventory', Object.values(state.inventory || {}).map(inventoryRow), PUSH_CHUNK, 'location_id,variant_id'],
    ['stock_movements', (state.movements || []).map(movementRow)],
    ['devices', (state.devices || []).map(deviceRow)],
    ['audit_logs', (state.auditLogs || []).map(auditRow)],
  ]

  const total = plan.reduce((sum, [, rows]) => sum + rows.length, 0)
  const pushed = {}
  let done = 0

  for (const [table, rows, size = PUSH_CHUNK, onConflict] of plan) {
    pushed[table] = rows.length
    for (const batch of chunked(rows, size)) {
      await upsert(table, batch, onConflict)
      done += batch.length
      onProgress({ table, done, total })
    }
    // A table with nothing in it still moves the report along, so the caller
    // can show progress that reaches the end rather than stalling on empties.
    onProgress({ table, done, total })
  }

  return { total, tables: pushed }
}
