/** Reporting maths shared by the dashboard, the reports page and closing. */

import { MAIN_LOCATION, money } from './format.js'
import { MOVEMENT_TYPES, getStock } from './domain.js'

export function withinRange(iso, from, to) {
  if (!iso) return false
  const day = iso.slice(0, 10)
  if (from && day < from) return false
  if (to && day > to) return false
  return true
}

export function filterOrders(state, { exhibitionId, from, to, salespersonId } = {}) {
  return state.orders.filter((order) => {
    if (exhibitionId && order.exhibitionId !== exhibitionId) return false
    if (salespersonId && order.salespersonId !== salespersonId) return false
    if (!withinRange(order.createdAt, from, to)) return false
    return true
  })
}

/** Orders that count towards revenue (cancelled sales do not). */
const isLive = (order) => order.status !== 'Cancelled'

export function salesSummary(orders) {
  const live = orders.filter(isLive)
  const gross = money(live.reduce((sum, order) => sum + order.subtotal, 0))
  const discounts = money(
    live.reduce((sum, order) => sum + order.discountAmount + (order.lineDiscounts || 0), 0),
  )
  const tax = money(live.reduce((sum, order) => sum + order.tax, 0))
  const refunds = money(live.reduce((sum, order) => sum + (order.refundedAmount || 0), 0))
  const net = money(live.reduce((sum, order) => sum + order.total, 0) - refunds)
  const itemsSold = live.reduce(
    (sum, order) => sum + order.items.reduce((n, item) => n + item.quantity - (item.returnedQuantity || 0), 0),
    0,
  )
  const count = live.length

  return {
    gross,
    discounts,
    tax,
    refunds,
    net,
    itemsSold,
    count,
    averageOrder: count ? money(net / count) : 0,
    cancelled: orders.length - live.length,
  }
}

export function paymentBreakdown(state, { exhibitionId, from, to } = {}) {
  const rows = new Map()
  for (const payment of state.payments) {
    if (exhibitionId && payment.exhibitionId !== exhibitionId) continue
    if (!withinRange(payment.createdAt, from, to)) continue
    const current = rows.get(payment.method) || { method: payment.method, amount: 0, count: 0, refunded: 0 }
    current.amount = money(current.amount + payment.amount)
    if (payment.kind === 'refund') current.refunded = money(current.refunded + Math.abs(payment.amount))
    else current.count += 1
    rows.set(payment.method, current)
  }
  return [...rows.values()].sort((a, b) => b.amount - a.amount)
}

export function staffPerformance(state, filter = {}) {
  const orders = filterOrders(state, filter).filter(isLive)
  const rows = new Map()

  for (const order of orders) {
    const current = rows.get(order.salespersonId) || {
      id: order.salespersonId,
      name: order.salespersonName,
      sales: 0,
      transactions: 0,
      items: 0,
      discounts: 0,
      methods: {},
    }
    current.sales = money(current.sales + order.total - (order.refundedAmount || 0))
    current.transactions += 1
    current.items += order.items.reduce((sum, item) => sum + item.quantity, 0)
    current.discounts = money(current.discounts + order.discountAmount + (order.lineDiscounts || 0))
    current.methods[order.paymentMethod] = money((current.methods[order.paymentMethod] || 0) + order.total)
    rows.set(order.salespersonId, current)
  }

  return [...rows.values()]
    .map((row) => ({
      ...row,
      averageOrder: row.transactions ? money(row.sales / row.transactions) : 0,
    }))
    .sort((a, b) => b.sales - a.sales)
}

export function topProducts(state, filter = {}, limit = 8) {
  const orders = filterOrders(state, filter).filter(isLive)
  const rows = new Map()

  for (const order of orders) {
    for (const item of order.items) {
      const netQty = item.quantity - (item.returnedQuantity || 0)
      const current = rows.get(item.variantId) || {
        variantId: item.variantId,
        name: item.name,
        sku: item.sku,
        variant: [item.color, item.size].filter(Boolean).join(' · '),
        quantity: 0,
        revenue: 0,
      }
      current.quantity += netQty
      current.revenue = money(current.revenue + netQty * item.unitPrice)
      rows.set(item.variantId, current)
    }
  }

  return [...rows.values()].sort((a, b) => b.revenue - a.revenue).slice(0, limit)
}

export function salesByDay(state, filter = {}) {
  const orders = filterOrders(state, filter).filter(isLive)
  const rows = new Map()
  for (const order of orders) {
    const day = order.createdAt.slice(0, 10)
    const current = rows.get(day) || { day, total: 0, count: 0 }
    current.total = money(current.total + order.total)
    current.count += 1
    rows.set(day, current)
  }
  return [...rows.values()].sort((a, b) => a.day.localeCompare(b.day))
}

export function salesByHour(state, filter = {}) {
  const orders = filterOrders(state, filter).filter(isLive)
  const buckets = Array.from({ length: 24 }, (_, hour) => ({ hour, total: 0, count: 0 }))
  for (const order of orders) {
    const hour = new Date(order.createdAt).getHours()
    buckets[hour].total = money(buckets[hour].total + order.total)
    buckets[hour].count += 1
  }
  return buckets
}

/**
 * Per-variant inventory movement for an exhibition:
 * opening → sold → returned → closing.
 */
export function inventoryReport(state, exhibitionId) {
  const rows = []

  for (const product of state.products) {
    for (const variant of product.variants) {
      const movements = state.movements.filter(
        (movement) => movement.variantId === variant.id && movement.locationId === exhibitionId,
      )
      if (!movements.length) continue

      const sold = movements
        .filter((movement) => movement.type === MOVEMENT_TYPES.SALE)
        .reduce((sum, movement) => sum + Math.abs(movement.quantity), 0)
      const returned = movements
        .filter((movement) => movement.type === MOVEMENT_TYPES.RETURN)
        .reduce((sum, movement) => sum + movement.quantity, 0)
      const allocated = movements
        .filter((movement) => movement.type === MOVEMENT_TYPES.TRANSFER_IN)
        .reduce((sum, movement) => sum + movement.quantity, 0)
      const returnedToWarehouse = movements
        .filter((movement) => movement.type === MOVEMENT_TYPES.TRANSFER_OUT)
        .reduce((sum, movement) => sum + Math.abs(movement.quantity), 0)
      const adjustments = movements
        .filter((movement) => movement.type === MOVEMENT_TYPES.ADJUSTMENT)
        .reduce((sum, movement) => sum + movement.quantity, 0)

      const closing = getStock(state, exhibitionId, variant.id)

      rows.push({
        key: variant.id,
        product,
        variant,
        opening: allocated + adjustments,
        allocated,
        sold,
        returned,
        returnedToWarehouse,
        adjustments,
        closing,
        revenue: money(sold * variant.price),
        cost: money(sold * variant.cost),
      })
    }
  }

  return rows.sort((a, b) => b.sold - a.sold)
}

export function lowStockRows(state, exhibitionId) {
  const rows = []
  for (const product of state.products) {
    for (const variant of product.variants) {
      const quantity = getStock(state, exhibitionId, variant.id)
      const threshold = variant.minStock ?? state.settings.lowStockThreshold
      const ever = state.movements.some(
        (movement) => movement.variantId === variant.id && movement.locationId === exhibitionId,
      )
      if (!ever) continue
      if (quantity <= threshold) {
        rows.push({
          key: variant.id,
          product,
          variant,
          quantity,
          threshold,
          mainStock: getStock(state, MAIN_LOCATION, variant.id),
        })
      }
    }
  }
  return rows.sort((a, b) => a.quantity - b.quantity)
}

export function customerSummary(state, { exhibitionId, from, to } = {}) {
  const orders = filterOrders(state, { exhibitionId, from, to }).filter(isLive)
  const buyerIds = new Set(orders.map((order) => order.customerId).filter(Boolean))
  const walkIns = orders.filter((order) => !order.customerId).length

  let newCustomers = 0
  let returning = 0
  for (const id of buyerIds) {
    const customer = state.customers.find((entry) => entry.id === id)
    if (!customer) continue
    const priorOrders = state.orders.filter(
      (order) =>
        order.customerId === id &&
        order.status !== 'Cancelled' &&
        (!from || order.createdAt.slice(0, 10) < from),
    )
    if (priorOrders.length) returning += 1
    else newCustomers += 1
  }

  const consented = state.customers.filter((entry) => entry.marketingConsent).length

  return {
    identified: buyerIds.size,
    walkIns,
    newCustomers,
    returning,
    totalCustomers: state.customers.length,
    marketingConsented: consented,
    consentRate: state.customers.length ? Math.round((consented / state.customers.length) * 100) : 0,
  }
}

/** Everything the exhibition closing report needs, frozen at close time. */
export function buildClosingReport(state, exhibition) {
  const filter = { exhibitionId: exhibition.id }
  const orders = filterOrders(state, filter)
  const summary = salesSummary(orders)
  const inventory = inventoryReport(state, exhibition.id)

  return {
    exhibitionId: exhibition.id,
    exhibitionName: exhibition.name,
    location: exhibition.location,
    startDate: exhibition.startDate,
    endDate: exhibition.endDate,
    generatedAt: new Date().toISOString(),
    grossSales: summary.gross,
    discounts: summary.discounts,
    refunds: summary.refunds,
    tax: summary.tax,
    netSales: summary.net,
    orders: summary.count,
    itemsSold: summary.itemsSold,
    averageOrder: summary.averageOrder,
    payments: paymentBreakdown(state, filter),
    staff: staffPerformance(state, filter),
    customers: customerSummary(state, filter),
    inventory: inventory.map((row) => ({
      sku: row.variant.sku,
      name: row.product.name,
      variant: [row.variant.color, row.variant.size].filter(Boolean).join(' · '),
      opening: row.opening,
      sold: row.sold,
      returned: row.returned,
      closing: row.closing,
      revenue: row.revenue,
    })),
    topProducts: topProducts(state, filter, 10),
  }
}
