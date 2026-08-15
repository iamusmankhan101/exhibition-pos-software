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

/* ----------------------------------------------------------------- totals */

/**
 * Cart maths. `discount` is `{ type: 'percentage' | 'fixed', value: number }`.
 */
export function computeTotals(items, discount, settings) {
  const subtotal = money(
    items.reduce((sum, item) => sum + item.quantity * item.unitPrice - (item.lineDiscount || 0), 0),
  )

  let discountAmount = 0
  if (discount && discount.value > 0) {
    discountAmount =
      discount.type === 'percentage' ? money((subtotal * discount.value) / 100) : money(discount.value)
  }
  discountAmount = Math.min(discountAmount, subtotal)

  const lineDiscounts = money(items.reduce((sum, item) => sum + (item.lineDiscount || 0), 0))
  const net = money(subtotal - discountAmount)

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
    lineDiscounts,
    totalDiscount: money(discountAmount + lineDiscounts),
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
    paymentMethod,
    paymentReference,
    deviceCode = 'A1',
    createdAt = nowIso(),
    note = '',
    offlineCreated = false,
  } = payload

  const existing = state.orders.find((order) => order.clientId === clientId)
  if (existing) return { state, order: existing, duplicate: true }

  if (!items.length) throw new Error('Cannot complete a sale with an empty cart.')

  // Stock validation happens here so an offline replay cannot oversell silently.
  if (!state.settings.allowOverselling) {
    for (const item of items) {
      const available = getStock(state, exhibitionId, item.variantId)
      if (item.quantity > available) {
        throw new Error(`${item.name} — only ${available} left in this exhibition.`)
      }
    }
  }

  const totals = computeTotals(items, discount, state.settings)
  const invoiceNo = nextInvoiceNumber(state, deviceCode)

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
    tax: totals.tax,
    total: totals.total,
    paymentMethod,
    paymentReference: paymentReference || '',
    status: 'Completed',
    note,
    offlineCreated,
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

  const payment = {
    id: uid('pay'),
    orderId: order.id,
    invoiceNo,
    method: paymentMethod,
    amount: totals.total,
    status: 'Captured',
    reference: paymentReference || '',
    kind: 'payment',
    exhibitionId,
    createdAt,
  }
  next = { ...next, payments: [payment, ...next.payments] }

  if (customerId) {
    next = {
      ...next,
      customers: next.customers.map((customer) =>
        customer.id === customerId
          ? {
              ...customer,
              totalOrders: (customer.totalOrders || 0) + 1,
              totalSpend: money((customer.totalSpend || 0) + totals.total),
              lastPurchaseAt: createdAt,
              exhibitionIds: Array.from(new Set([...(customer.exhibitionIds || []), exhibitionId])),
            }
          : customer,
      ),
    }
  }

  return { state: next, order, duplicate: false }
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
  const updatedItems = order.items.map((item) => {
    const line = returning.find((entry) => entry.variantId === item.variantId)
    if (!line) return item
    const remaining = item.quantity - (item.returnedQuantity || 0)
    if (line.quantity > remaining) throw new Error(`Cannot return more than ${remaining} of ${item.name}.`)
    // Refund the effective price actually paid for the line, discounts included.
    const effectiveUnit = money(item.lineTotal / item.quantity)
    refundAmount = money(refundAmount + effectiveUnit * line.quantity)
    return { ...item, returnedQuantity: (item.returnedQuantity || 0) + line.quantity }
  })

  // Apply the same order-level discount ratio and tax treatment as the sale.
  const discountRatio = order.subtotal ? (order.subtotal - order.discountAmount) / order.subtotal : 1
  refundAmount = money(refundAmount * discountRatio)
  if (state.settings.taxEnabled && !state.settings.taxInclusive) {
    refundAmount = money(refundAmount * (1 + state.settings.taxRate / 100))
  }

  const totalReturned = updatedItems.reduce((sum, item) => sum + (item.returnedQuantity || 0), 0)
  const totalSold = updatedItems.reduce((sum, item) => sum + item.quantity, 0)
  const status = totalReturned >= totalSold ? 'Refunded' : 'Partially Refunded'

  let next = {
    ...state,
    orders: state.orders.map((entry) =>
      entry.id === orderId
        ? {
            ...entry,
            items: updatedItems,
            status,
            refundedAmount: money((entry.refundedAmount || 0) + refundAmount),
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

  const refund = {
    id: uid('ref'),
    orderId: order.id,
    invoiceNo: order.invoiceNo,
    method: refundMethod,
    amount: -refundAmount,
    status: 'Refunded',
    reference: reason || '',
    kind: 'refund',
    exhibitionId: order.exhibitionId,
    createdAt: nowIso(),
  }
  next = { ...next, payments: [refund, ...next.payments] }

  if (order.customerId) {
    next = {
      ...next,
      customers: next.customers.map((customer) =>
        customer.id === order.customerId
          ? { ...customer, totalSpend: money((customer.totalSpend || 0) - refundAmount) }
          : customer,
      ),
    }
  }

  return { state: next, refundAmount, userName }
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
