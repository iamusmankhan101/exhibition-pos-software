/**
 * Pure domain logic. Every function takes the current state and returns a new
 * state, so the React store, the seeder and (later) a server-side worker can all
 * share exactly the same rules.
 */

import { MAIN_LOCATION, money, nowIso, pad, uid, variantLabel } from './format.js'

export const PAYMENT_METHODS = ['Cash', 'Card', 'Bank Transfer', 'Online Payment', 'Other']
export const ORDER_STATUSES = ['Completed', 'Pending', 'Refunded', 'Partially Refunded', 'Cancelled']

export const MOVEMENT_TYPES = {
  TRANSFER_IN: 'Transfer In',
  TRANSFER_OUT: 'Transfer Out',
  SALE: 'Sale',
  RETURN: 'Return',
  ADJUSTMENT: 'Adjustment',
  INTAKE: 'Intake',
}

/* ------------------------------------------------------------------ stock */

export function inventoryKey(locationId, variantId) {
  return `${locationId}:${variantId}`
}

/**
 * Human label for a stock location. Selling without an exhibition is a normal
 * mode — stock simply comes from the main warehouse — so `MAIN` reads as a
 * direct sale rather than as a missing value.
 */
export function locationName(state, locationId) {
  if (!locationId || locationId === MAIN_LOCATION) return 'Direct sales'
  return state.exhibitions.find((entry) => entry.id === locationId)?.name || 'Deleted exhibition'
}

export const isExhibition = (locationId) => Boolean(locationId) && locationId !== MAIN_LOCATION

export function getStock(state, locationId, variantId) {
  return state.inventory[inventoryKey(locationId, variantId)]?.quantity ?? 0
}

/**
 * Writes a stock delta and records the movement that caused it.
 * Returns a new state — never mutates the argument.
 */
export function applyStockChange(state, { locationId, variantId, delta, type, reference, userId, note }) {
  const key = inventoryKey(locationId, variantId)
  const current = state.inventory[key]?.quantity ?? 0
  const inventory = {
    ...state.inventory,
    [key]: {
      locationId,
      variantId,
      quantity: money(current + delta),
      updatedAt: nowIso(),
    },
  }
  const movement = {
    id: uid('mv'),
    variantId,
    locationId,
    type,
    quantity: delta,
    balanceAfter: money(current + delta),
    reference: reference || '',
    userId: userId || '',
    note: note || '',
    createdAt: nowIso(),
  }
  return { ...state, inventory, movements: [movement, ...state.movements] }
}

export function transferStock(state, { variantId, fromLocation, toLocation, quantity, userId }) {
  const available = getStock(state, fromLocation, variantId)
  if (quantity <= 0) throw new Error('Transfer quantity must be greater than zero.')
  if (quantity > available) throw new Error('Not enough stock in the source location.')

  let next = applyStockChange(state, {
    locationId: fromLocation,
    variantId,
    delta: -quantity,
    type: MOVEMENT_TYPES.TRANSFER_OUT,
    reference: toLocation,
    userId,
  })
  next = applyStockChange(next, {
    locationId: toLocation,
    variantId,
    delta: quantity,
    type: MOVEMENT_TYPES.TRANSFER_IN,
    reference: fromLocation,
    userId,
  })
  return next
}

/* ------------------------------------------------------------ product help */

export function allVariants(state) {
  return state.products.flatMap((product) =>
    product.variants.map((variant) => ({ product, variant })),
  )
}

export function findVariant(state, variantId) {
  for (const product of state.products) {
    const variant = product.variants.find((item) => item.id === variantId)
    if (variant) return { product, variant }
  }
  return null
}

export function findByCode(state, code) {
  const needle = String(code || '').trim().toLowerCase()
  if (!needle) return null
  for (const product of state.products) {
    for (const variant of product.variants) {
      if (
        String(variant.barcode || '').toLowerCase() === needle ||
        String(variant.sku || '').toLowerCase() === needle ||
        variant.id.toLowerCase() === needle
      ) {
        return { product, variant }
      }
    }
  }
  return null
}

/** Category of a sold line, resolved from the catalogue for older orders. */
export function itemCategory(state, item) {
  if (item.category) return item.category
  return findVariant(state, item.variantId)?.product.category || 'Uncategorised'
}

/* ---------------------------------------------------------------- pricing */

/** True when a variant carries its own exhibition price. */
export function hasExhibitionPrice(variant) {
  return variant?.exhibitionPrice !== null && variant?.exhibitionPrice !== undefined && variant?.exhibitionPrice !== ''
}

/**
 * What a variant sells for at a given location.
 *
 * Stall pricing is routinely different from the studio list price, so a variant
 * may carry an `exhibitionPrice`. It applies only when selling at an exhibition;
 * a direct sale from the warehouse always uses the list price.
 */
export function sellingPrice(variant, locationId) {
  if (!variant) return 0
  if (isExhibition(locationId) && hasExhibitionPrice(variant)) return money(variant.exhibitionPrice)
  return money(variant.price)
}

/* ----------------------------------------------------------- promo codes */

export function findPromo(state, code) {
  const needle = String(code || '').trim().toUpperCase()
  if (!needle) return null
  return (state.promoCodes || []).find((entry) => String(entry.code).toUpperCase() === needle) || null
}

/**
 * Checks a promo code against the current cart. Promo codes are created by an
 * admin, so a valid one is already authorised — it deliberately does not count
 * towards the salesperson's own discount ceiling.
 *
 * `locationId` is where the sale is happening, which a code may be scoped to.
 */
export function validatePromo(state, code, subtotal, { locationId, today = nowIso().slice(0, 10) } = {}) {
  const promo = findPromo(state, code)
  if (!promo) return { ok: false, error: 'No promo code matches that.' }
  if (!promo.active) return { ok: false, error: `${promo.code} is no longer active.` }
  if (promo.startsAt && today < promo.startsAt) {
    return { ok: false, error: `${promo.code} is not valid until ${promo.startsAt}.` }
  }
  if (promo.expiresAt && today > promo.expiresAt) {
    return { ok: false, error: `${promo.code} expired on ${promo.expiresAt}.` }
  }
  if (promo.usageLimit > 0 && (promo.usedCount || 0) >= promo.usageLimit) {
    return { ok: false, error: `${promo.code} has reached its ${promo.usageLimit}-use limit.` }
  }
  if (promo.minSpend > 0 && subtotal < promo.minSpend) {
    return { ok: false, error: `${promo.code} needs a subtotal of at least ${promo.minSpend}.` }
  }
  // A code tied to one stand must not work at another, or at a direct sale.
  if (promo.exhibitionId && promo.exhibitionId !== 'all' && promo.exhibitionId !== locationId) {
    const where = state.exhibitions.find((entry) => entry.id === promo.exhibitionId)?.name
    return { ok: false, error: `${promo.code} only works at ${where || 'another exhibition'}.` }
  }
  return { ok: true, promo }
}

/* ----------------------------------------------------------------- totals */

/**
 * Cart maths. `discount` is `{ type: 'percentage' | 'fixed', value: number }`;
 * `promo` is an optional promo code record that stacks on top of it.
 */
export function computeTotals(items, discount, settings, promo = null) {
  const subtotal = money(
    items.reduce((sum, item) => sum + item.quantity * item.unitPrice - (item.lineDiscount || 0), 0),
  )

  let discountAmount = 0
  if (discount && discount.value > 0) {
    discountAmount =
      discount.type === 'percentage' ? money((subtotal * discount.value) / 100) : money(discount.value)
  }
  discountAmount = Math.min(discountAmount, subtotal)

  // The promo comes off what is still payable, so a code and a manual discount
  // can never combine to more than the order is worth.
  const afterManual = money(subtotal - discountAmount)
  let promoAmount = 0
  if (promo && promo.value > 0) {
    promoAmount =
      promo.type === 'percentage' ? money((afterManual * promo.value) / 100) : money(promo.value)
    promoAmount = Math.min(promoAmount, afterManual)
  }

  const lineDiscounts = money(items.reduce((sum, item) => sum + (item.lineDiscount || 0), 0))
  const net = money(subtotal - discountAmount - promoAmount)

  let tax = 0
  let total = net
  if (settings?.taxEnabled && settings.taxRate > 0) {
    const rate = settings.taxRate / 100
    if (settings.taxInclusive) {
      tax = money(net - net / (1 + rate))
      total = net
    } else {
      tax = money(net * rate)
      total = money(net + tax)
    }
  }

  return {
    subtotal,
    discountAmount,
    promoAmount,
    promoCode: promoAmount > 0 ? promo.code : '',
    lineDiscounts,
    totalDiscount: money(discountAmount + promoAmount + lineDiscounts),
    tax,
    total: money(total),
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
  }
}

export function discountPercentOf(subtotal, discountAmount) {
  if (!subtotal) return 0
  return money((discountAmount / subtotal) * 100)
}

/* --------------------------------------------------------------- invoices */

export function nextInvoiceNumber(state, deviceCode = 'A1') {
  const seq = (state.counters?.invoice ?? 1)
  const date = new Date()
  const stamp = `${String(date.getFullYear()).slice(2)}${pad(date.getMonth() + 1, 2)}${pad(date.getDate(), 2)}`
  return `${state.settings.invoicePrefix}-${stamp}-${deviceCode}${pad(seq, 3)}`
}

/* ------------------------------------------------------------- payments */

export const SPLIT_LABEL = 'Split'

/**
 * Allocates a requested split across methods up to what was actually taken.
 * The rows are filled in order, so an over-tendered final row is trimmed rather
 * than inflating the recorded takings.
 */
export function allocatePaymentParts(parts, cap) {
  const out = []
  let left = money(cap)
  for (const part of parts || []) {
    if (left <= 0) break
    const requested = money(part.amount)
    if (!part.method || requested <= 0) continue
    const amount = money(Math.min(requested, left))
    out.push({ method: part.method, amount, reference: part.reference || '' })
    left = money(left - amount)
  }
  return out
}

/** One label for a payment however it was made. */
export function paymentMethodLabel(parts, fallback = '') {
  if (!parts?.length) return fallback
  if (parts.length === 1) return parts[0].method
  return SPLIT_LABEL
}

/**
 * The payment breakdown of an order, in the shape reports and receipts want.
 * Orders written before split payments existed carry a single method, so they
 * are normalised to a one-row breakdown rather than special-cased everywhere.
 */
export function orderPaymentParts(order) {
  if (order.paymentParts?.length) return order.paymentParts
  const amount = money(order.amountPaid ?? order.total ?? 0)
  if (amount <= 0) return []
  return [{ method: order.paymentMethod, amount, reference: order.paymentReference || '' }]
}

export const isSplitPayment = (order) => (order.paymentParts?.length || 0) > 1

/* ------------------------------------------------------------------ sales */

/**
 * Creates an order, deducts exhibition stock, records the payment and updates
 * the customer aggregate. `clientId` makes the call idempotent so a queued
 * offline sale can be replayed on reconnect without duplicating.
 */
export function createOrder(state, payload) {
  const {
    clientId,
    exhibitionId,
    customerId,
    customerName,
    salespersonId,
    salespersonName,
    items,
    discount,
    promo = null,
    paymentMethod,
    paymentReference,
    // An ordered list of `{ method, amount, reference }`. When present it
    // replaces `paymentMethod`/`amountPaid` and records the exact breakdown.
    paymentParts = null,
    deviceCode = 'A1',
    createdAt = nowIso(),
    note = '',
    offlineCreated = false,
    // `null` means "paid in full"; a number records a part payment and leaves
    // the order Pending with a balance due.
    amountPaid = null,
    // Set by an authorised admin to sell past the recorded stock level.
    overrideOversell = false,
    overrideBy = null,
  } = payload

  const existing = state.orders.find((order) => order.clientId === clientId)
  if (existing) return { state, order: existing, duplicate: true }

  if (!items.length) throw new Error('Cannot complete a sale with an empty cart.')

  // Stock validation happens here so an offline replay cannot oversell silently.
  const oversold = []
  for (const item of items) {
    const available = getStock(state, exhibitionId, item.variantId)
    if (item.quantity > available) {
      oversold.push({ name: item.name, sku: item.sku, requested: item.quantity, available })
    }
  }
  if (oversold.length && !state.settings.allowOverselling && !overrideOversell) {
    const first = oversold[0]
    throw new Error(`${first.name} — only ${first.available} left in this exhibition.`)
  }

  const totals = computeTotals(items, discount, state.settings, promo)
  const invoiceNo = nextInvoiceNumber(state, deviceCode)

  // A split breakdown decides what was taken; otherwise fall back to the single
  // method plus the part-payment amount.
  const requested = (paymentParts || []).filter((part) => part.method && money(part.amount) > 0)
  const paid = requested.length
    ? money(Math.max(0, Math.min(requested.reduce((sum, part) => sum + money(part.amount), 0), totals.total)))
    : amountPaid === null
      ? totals.total
      : money(Math.max(0, Math.min(amountPaid, totals.total)))
  const balanceDue = money(totals.total - paid)

  const parts = requested.length
    ? allocatePaymentParts(requested, paid)
    : allocatePaymentParts([{ method: paymentMethod, amount: paid, reference: paymentReference || '' }], paid)

  const order = {
    id: uid('ord'),
    clientId,
    invoiceNo,
    exhibitionId,
    customerId: customerId || null,
    customerName: customerName || 'Walk-in Customer',
    salespersonId,
    salespersonName,
    items: items.map((item) => ({
      ...item,
      lineTotal: money(item.quantity * item.unitPrice - (item.lineDiscount || 0)),
      returnedQuantity: 0,
    })),
    subtotal: totals.subtotal,
    discountType: discount?.type || 'percentage',
    discountValue: discount?.value || 0,
    discountAmount: totals.discountAmount,
    lineDiscounts: totals.lineDiscounts,
    promoCode: totals.promoCode,
    promoAmount: totals.promoAmount,
    tax: totals.tax,
    total: totals.total,
    paymentMethod: paymentMethodLabel(parts, paymentMethod),
    paymentParts: parts,
    paymentReference: paymentReference || '',
    status: balanceDue > 0 ? 'Pending' : 'Completed',
    amountPaid: paid,
    balanceDue,
    note,
    offlineCreated,
    oversell:
      oversold.length && (overrideOversell || state.settings.allowOverselling)
        ? { by: overrideBy?.name || '', byId: overrideBy?.id || '', lines: oversold, at: createdAt }
        : null,
    refundedAmount: 0,
    createdAt,
  }

  let next = { ...state, orders: [order, ...state.orders] }
  next.counters = { ...next.counters, invoice: (next.counters?.invoice ?? 1) + 1 }

  for (const item of items) {
    next = applyStockChange(next, {
      locationId: exhibitionId,
      variantId: item.variantId,
      delta: -item.quantity,
      type: MOVEMENT_TYPES.SALE,
      reference: invoiceNo,
      userId: salespersonId,
    })
  }

  // Only money that actually changed hands becomes a payment row — one per
  // method, so a split sale reconciles correctly against each till.
  if (parts.length) {
    const rows = parts.map((part) => ({
      id: uid('pay'),
      orderId: order.id,
      invoiceNo,
      method: part.method,
      amount: part.amount,
      status: 'Captured',
      reference: part.reference || '',
      kind: 'payment',
      exhibitionId,
      createdAt,
    }))
    next = { ...next, payments: [...rows, ...next.payments] }
  }

  // A code that actually took money off is a use.
  if (totals.promoAmount > 0 && totals.promoCode) {
    next = {
      ...next,
      promoCodes: (next.promoCodes || []).map((entry) =>
        String(entry.code).toUpperCase() === String(totals.promoCode).toUpperCase()
          ? { ...entry, usedCount: (entry.usedCount || 0) + 1 }
          : entry,
      ),
    }
  }

  if (customerId) {
    next = {
      ...next,
      customers: next.customers.map((customer) =>
        customer.id === customerId
          ? {
              ...customer,
              totalOrders: (customer.totalOrders || 0) + 1,
              totalSpend: money((customer.totalSpend || 0) + paid),
              lastPurchaseAt: createdAt,
              exhibitionIds: Array.from(new Set([...(customer.exhibitionIds || []), exhibitionId])),
            }
          : customer,
      ),
    }
  }

  return { state: next, order, duplicate: false, oversold }
}

/**
 * Takes a further payment against an order that still has a balance due, and
 * flips it to Completed once nothing is outstanding.
 */
export function settlePayment(state, { orderId, method, amount, reference, userId }) {
  const order = state.orders.find((entry) => entry.id === orderId)
  if (!order) throw new Error('Order not found.')

  const outstanding = money(order.balanceDue || 0)
  if (outstanding <= 0) throw new Error('This order is already paid in full.')

  const received = money(Math.max(0, Math.min(amount, outstanding)))
  if (received <= 0) throw new Error('Enter an amount greater than zero.')

  const balanceDue = money(outstanding - received)

  let next = {
    ...state,
    orders: state.orders.map((entry) =>
      entry.id === orderId
        ? {
            ...entry,
            amountPaid: money((entry.amountPaid || 0) + received),
            balanceDue,
            status: balanceDue > 0 ? 'Pending' : 'Completed',
          }
        : entry,
    ),
    payments: [
      {
        id: uid('pay'),
        orderId: order.id,
        invoiceNo: order.invoiceNo,
        method,
        amount: received,
        status: 'Captured',
        reference: reference || 'Balance settlement',
        kind: 'payment',
        exhibitionId: order.exhibitionId,
        createdAt: nowIso(),
      },
      ...state.payments,
    ],
  }

  if (order.customerId) {
    next = {
      ...next,
      customers: next.customers.map((customer) =>
        customer.id === order.customerId
          ? { ...customer, totalSpend: money((customer.totalSpend || 0) + received) }
          : customer,
      ),
    }
  }

  return { state: next, received, balanceDue, userId }
}

/**
 * Returns selected lines of an order, restores exhibition stock and records a
 * refund payment row.
 */
export function refundOrder(state, { orderId, lines, refundMethod, reason, userId, userName }) {
  const order = state.orders.find((item) => item.id === orderId)
  if (!order) throw new Error('Order not found.')

  const returning = lines.filter((line) => line.quantity > 0)
  if (!returning.length) throw new Error('Select at least one item to return.')

  let refundAmount = 0
  const returnedLines = []
  const updatedItems = order.items.map((item) => {
    const line = returning.find((entry) => entry.variantId === item.variantId)
    if (!line) return item
    const remaining = item.quantity - (item.returnedQuantity || 0)
    if (line.quantity > remaining) throw new Error(`Cannot return more than ${remaining} of ${item.name}.`)
    // Refund the effective price actually paid for the line, discounts included.
    const effectiveUnit = money(item.lineTotal / item.quantity)
    refundAmount = money(refundAmount + effectiveUnit * line.quantity)
    returnedLines.push({
      variantId: item.variantId,
      name: item.name,
      sku: item.sku,
      category: item.category || '',
      quantity: line.quantity,
    })
    return { ...item, returnedQuantity: (item.returnedQuantity || 0) + line.quantity }
  })

  // Apply the same order-level discount ratio and tax treatment as the sale.
  // Promo codes discount the order just as a manual discount does, so both come
  // off the refund or a return would hand back more than was ever taken.
  const orderDiscount = money(order.discountAmount + (order.promoAmount || 0))
  const discountRatio = order.subtotal ? (order.subtotal - orderDiscount) / order.subtotal : 1
  refundAmount = money(refundAmount * discountRatio)
  if (state.settings.taxEnabled && !state.settings.taxInclusive) {
    refundAmount = money(refundAmount * (1 + state.settings.taxRate / 100))
  }

  // A return first cancels anything the customer still owes; only what they
  // actually handed over comes back as cash.
  const outstanding = money(order.balanceDue || 0)
  const balanceReduction = Math.min(outstanding, refundAmount)
  const cashRefund = money(refundAmount - balanceReduction)
  const balanceDue = money(outstanding - balanceReduction)

  const totalReturned = updatedItems.reduce((sum, item) => sum + (item.returnedQuantity || 0), 0)
  const totalSold = updatedItems.reduce((sum, item) => sum + item.quantity, 0)
  const status =
    totalReturned >= totalSold ? 'Refunded' : balanceDue > 0 ? 'Pending' : 'Partially Refunded'

  let next = {
    ...state,
    orders: state.orders.map((entry) =>
      entry.id === orderId
        ? {
            ...entry,
            items: updatedItems,
            status,
            balanceDue,
            refundedAmount: money((entry.refundedAmount || 0) + cashRefund),
          }
        : entry,
    ),
  }

  for (const line of returning) {
    next = applyStockChange(next, {
      locationId: order.exhibitionId,
      variantId: line.variantId,
      delta: line.quantity,
      type: MOVEMENT_TYPES.RETURN,
      reference: order.invoiceNo,
      userId,
      note: reason || '',
    })
  }

  if (cashRefund > 0) {
    const refund = {
      id: uid('ref'),
      orderId: order.id,
      invoiceNo: order.invoiceNo,
      method: refundMethod,
      amount: -cashRefund,
      status: 'Refunded',
      reference: reason || '',
      kind: 'refund',
      exhibitionId: order.exhibitionId,
      createdAt: nowIso(),
    }
    next = { ...next, payments: [refund, ...next.payments] }
  }

  if (order.customerId && cashRefund > 0) {
    next = {
      ...next,
      customers: next.customers.map((customer) =>
        customer.id === order.customerId
          ? { ...customer, totalSpend: money((customer.totalSpend || 0) - cashRefund) }
          : customer,
      ),
    }
  }

  // A first-class return record. Reconstructing this from payments and stock
  // movements loses the reason and who authorised it, which is exactly what the
  // returns report and the audit trail need.
  const record = {
    id: uid('ret'),
    kind: 'return',
    orderId: order.id,
    invoiceNo: order.invoiceNo,
    exhibitionId: order.exhibitionId,
    customerId: order.customerId || null,
    customerName: order.customerName,
    salespersonName: order.salespersonName,
    lines: returnedLines,
    quantity: returnedLines.reduce((sum, line) => sum + line.quantity, 0),
    refundAmount: cashRefund,
    balanceCleared: balanceReduction,
    method: cashRefund > 0 ? refundMethod : 'None',
    reason: reason || '',
    userId: userId || '',
    userName: userName || '',
    createdAt: nowIso(),
  }
  next = { ...next, returns: [record, ...(next.returns || [])] }

  return {
    state: next,
    refundAmount: cashRefund,
    balanceCleared: balanceReduction,
    record,
    userName,
  }
}

/* ---------------------------------------------------------------- deletes */

/** Writes a stock balance without logging a movement (used when erasing history). */
function setStockSilently(state, locationId, variantId, delta) {
  const key = inventoryKey(locationId, variantId)
  const current = state.inventory[key]?.quantity ?? 0
  return {
    ...state,
    inventory: {
      ...state.inventory,
      [key]: { locationId, variantId, quantity: money(current + delta), updatedAt: nowIso() },
    },
  }
}

/**
 * Permanently removes orders together with their payments and stock movements.
 *
 * Anything the customer kept is put back on the shelf, otherwise deleting a sale
 * would quietly lose that stock. Cancelled and fully returned orders have
 * already given their stock back, so they are not credited twice.
 */
export function deleteOrders(state, { orderIds, restoreStock = true }) {
  const ids = new Set(orderIds)
  const targets = state.orders.filter((order) => ids.has(order.id))
  if (!targets.length) return { state, deleted: 0, restored: 0 }

  let next = state
  let restored = 0
  const invoices = new Set(targets.map((order) => order.invoiceNo))

  for (const order of targets) {
    if (restoreStock && order.status !== 'Cancelled') {
      for (const item of order.items) {
        const outstanding = item.quantity - (item.returnedQuantity || 0)
        if (outstanding > 0) {
          next = setStockSilently(next, order.exhibitionId, item.variantId, outstanding)
          restored += outstanding
        }
      }
    }

    if (order.customerId) {
      const collected = money((order.amountPaid ?? order.total) - (order.refundedAmount || 0))
      next = {
        ...next,
        customers: next.customers.map((customer) =>
          customer.id === order.customerId
            ? {
                ...customer,
                totalOrders: Math.max(0, (customer.totalOrders || 0) - 1),
                totalSpend: money(Math.max(0, (customer.totalSpend || 0) - collected)),
              }
            : customer,
        ),
      }
    }
  }

  return {
    state: {
      ...next,
      orders: next.orders.filter((order) => !ids.has(order.id)),
      payments: next.payments.filter((payment) => !ids.has(payment.orderId)),
      returns: (next.returns || []).filter((entry) => !ids.has(entry.orderId)),
      movements: next.movements.filter((movement) => !invoices.has(movement.reference)),
    },
    deleted: targets.length,
    restored,
  }
}

/** Removes products along with their stock balances and movement history. */
export function deleteProducts(state, productIds) {
  const ids = new Set(productIds)
  const targets = state.products.filter((product) => ids.has(product.id))
  if (!targets.length) return { state, deleted: 0 }

  const variantIds = new Set(targets.flatMap((product) => product.variants.map((variant) => variant.id)))

  const inventory = Object.fromEntries(
    Object.entries(state.inventory).filter(([, row]) => !variantIds.has(row.variantId)),
  )

  return {
    state: {
      ...state,
      products: state.products.filter((product) => !ids.has(product.id)),
      inventory,
      movements: state.movements.filter((movement) => !variantIds.has(movement.variantId)),
    },
    deleted: targets.length,
  }
}

/** Deletes an exhibition; its stock can be returned to the warehouse first. */
export function deleteExhibition(state, { exhibitionId, returnStock = true, deleteSales = true }) {
  let next = state

  if (returnStock) {
    for (const product of state.products) {
      for (const variant of product.variants) {
        const remaining = getStock(next, exhibitionId, variant.id)
        if (remaining > 0) {
          next = setStockSilently(next, exhibitionId, variant.id, -remaining)
          next = setStockSilently(next, MAIN_LOCATION, variant.id, remaining)
        }
      }
    }
  }

  if (deleteSales) {
    const orderIds = next.orders.filter((order) => order.exhibitionId === exhibitionId).map((o) => o.id)
    // Stock has already been handled above, so do not credit it twice.
    next = deleteOrders(next, { orderIds, restoreStock: false }).state
  }

  const inventory = Object.fromEntries(
    Object.entries(next.inventory).filter(([, row]) => row.locationId !== exhibitionId),
  )

  return {
    ...next,
    inventory,
    exhibitions: next.exhibitions.filter((entry) => entry.id !== exhibitionId),
    movements: next.movements.filter((movement) => movement.locationId !== exhibitionId),
    returns: (next.returns || []).filter((entry) => entry.exhibitionId !== exhibitionId),
  }
}

/** Removes customers; their past orders keep the name that was on the sale. */
export function deleteCustomers(state, customerIds) {
  const ids = new Set(customerIds)
  return {
    ...state,
    customers: state.customers.filter((customer) => !ids.has(customer.id)),
    orders: state.orders.map((order) => (ids.has(order.customerId) ? { ...order, customerId: null } : order)),
  }
}

/* ------------------------------------------------------------- selections */

export function exhibitionStockRows(state, exhibitionId) {
  return allVariants(state)
    .map(({ product, variant }) => {
      const quantity = getStock(state, exhibitionId, variant.id)
      return {
        key: variant.id,
        product,
        variant,
        quantity,
        mainQuantity: getStock(state, MAIN_LOCATION, variant.id),
        price: sellingPrice(variant, exhibitionId),
        label: variantLabel(variant),
        lowStock: quantity > 0 && quantity <= (variant.minStock ?? state.settings.lowStockThreshold),
        outOfStock: quantity <= 0,
      }
    })
    .filter((row) => row.quantity !== 0 || row.mainQuantity !== 0)
}

export function ordersFor(state, exhibitionId) {
  if (!exhibitionId) return state.orders
  return state.orders.filter((order) => order.exhibitionId === exhibitionId)
}
