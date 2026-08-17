/**
 * The acceptance run from the requirements brief: a full exhibition's trading
 * put through the real rules, then checked for the things that must never drift
 * — stock, takings, invoice numbers and the audit of what came back.
 *
 * The brief asks for 20–30 dummy sales covering discounts, multiple payment
 * methods, stock changes, receipt sharing, cancellation and refund, and a
 * weak-internet scenario. This drives all of that deterministically, so a
 * failure names the rule that broke rather than a flaky number.
 */

import { describe, expect, it } from 'vitest'
import {
  createOrder,
  deleteOrders,
  getStock,
  refundOrder,
  releasePromoUse,
  sellingPrice,
  settlePayment,
} from './domain.js'
import { decodeReceipt, encodeReceipt } from './receipt.js'
import {
  filterOrders,
  paymentBreakdown,
  productSales,
  returnsReport,
  returnsSummary,
  salesByCategory,
  salesSummary,
  staffPerformance,
} from './analytics.js'
import { MAIN_LOCATION, money } from './format.js'

/* ------------------------------------------------------------- fixtures */

const settings = {
  invoicePrefix: 'TRZ',
  currencySymbol: 'PKR ',
  taxEnabled: false,
  taxInclusive: false,
  taxRate: 0,
  allowOverselling: false,
  lowStockThreshold: 3,
  maxDiscountPercent: 30,
  business: { name: 'Tareez', tagline: 'Handmade', phone: '', email: '', address: '', vatNumber: '' },
  invoiceDesign: {},
  terms: 'No exchange without a receipt.',
  receiptFooter: 'Thank you.',
}

const CATALOGUE = [
  { id: 'v-scarf-blk', sku: 'TRZ-SCF-BLK-001', name: 'Black Silk Scarf', category: 'Scarves', price: 10500, exhibitionPrice: 9500, cost: 3200, opening: 12 },
  { id: 'v-scarf-ivy', sku: 'TRZ-SCF-IVY-002', name: 'Black Silk Scarf', category: 'Scarves', price: 10500, exhibitionPrice: 9500, cost: 3200, opening: 10 },
  { id: 'v-abaya-nvy', sku: 'TRZ-ABY-NVY-001', name: 'Linen Wrap Abaya', category: 'Abayas', price: 24000, exhibitionPrice: null, cost: 8600, opening: 8 },
  { id: 'v-clutch-gld', sku: 'TRZ-ACC-GLD-001', name: 'Beaded Clutch', category: 'Accessories', price: 8800, exhibitionPrice: 7900, cost: 2900, opening: 15 },
  { id: 'v-pins-prl', sku: 'TRZ-ACC-PRL-002', name: 'Hijab Magnet Pins', category: 'Accessories', price: 1200, exhibitionPrice: 1000, cost: 300, opening: 30 },
]

const EXHIBITION = 'ex-dha'
const STAFF = [
  { id: 'u-ahmed', name: 'Ahmed Khan' },
  { id: 'u-layla', name: 'Layla Hassan' },
]
const METHODS = ['Cash', 'Card', 'Bank Transfer', 'Online Payment']

function buildState() {
  const products = CATALOGUE.reduce((acc, entry) => {
    const existing = acc.find((product) => product.name === entry.name)
    const variant = {
      id: entry.id,
      sku: entry.sku,
      barcode: entry.id,
      size: 'One Size',
      color: entry.sku.slice(-6, -4),
      price: entry.price,
      exhibitionPrice: entry.exhibitionPrice,
      cost: entry.cost,
      minStock: 3,
    }
    if (existing) existing.variants.push(variant)
    else acc.push({ id: `p-${entry.id}`, name: entry.name, category: entry.category, variants: [variant] })
    return acc
  }, [])

  const inventory = {}
  for (const entry of CATALOGUE) {
    inventory[`${EXHIBITION}:${entry.id}`] = { quantity: entry.opening }
    inventory[`${MAIN_LOCATION}:${entry.id}`] = { quantity: 50 }
  }

  return {
    settings,
    products,
    exhibitions: [{ id: EXHIBITION, name: 'DHA Exhibition', status: 'Active' }],
    customers: Array.from({ length: 6 }, (_, i) => ({
      id: `cus${i}`,
      name: `Customer ${i}`,
      whatsapp: `+92300000000${i}`,
      email: `customer${i}@example.com`,
      totalOrders: 0,
      totalSpend: 0,
    })),
    users: STAFF,
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
      { id: 'pm2', code: 'PREVIEW20', type: 'percentage', value: 20, minSpend: 0, usageLimit: 3, usedCount: 0, active: true, exhibitionId: 'all' },
    ],
    inventory,
    counters: { invoice: 1 },
  }
}

/** Deterministic PRNG, so a failing run is reproducible. */
function rng(seed = 42) {
  let value = seed
  return () => {
    value = (value * 1103515245 + 12345) % 2147483648
    return value / 2147483648
  }
}

const variantOf = (state, variantId) =>
  state.products.flatMap((product) => product.variants).find((variant) => variant.id === variantId)

const productOf = (state, variantId) =>
  state.products.find((product) => product.variants.some((variant) => variant.id === variantId))

/** Builds a cart line the way the POS does, at the price this location charges. */
function cartLine(state, variantId, quantity, lineDiscount = 0) {
  const variant = variantOf(state, variantId)
  const product = productOf(state, variantId)
  return {
    productId: product.id,
    variantId,
    name: product.name,
    sku: variant.sku,
    category: product.category,
    size: variant.size,
    color: variant.color,
    quantity,
    listPrice: variant.price,
    unitPrice: sellingPrice(variant, EXHIBITION),
    lineDiscount,
  }
}

/* -------------------------------------------------------- the trading day */

/**
 * Runs the exhibition. Returns the final state plus a record of what was
 * deliberately done, so the assertions check against intent rather than
 * against a re-derivation of the same maths.
 */
function tradeAnExhibition() {
  const random = rng()
  let state = buildState()

  const intent = {
    sold: {},        // variantId -> units that left the stall
    returned: {},    // variantId -> units that came back
    invoices: [],
    cancelledIds: [],
    promoUses: 0,
  }

  const track = (bucket, variantId, quantity) => {
    bucket[variantId] = (bucket[variantId] || 0) + quantity
  }

  const orders = []

  for (let i = 0; i < 26; i += 1) {
    const staff = STAFF[i % STAFF.length]
    const walkIn = i % 5 === 0
    const customer = walkIn ? null : state.customers[i % state.customers.length]

    // One or two lines, always within what the stall still holds.
    const picks = []
    const first = CATALOGUE[i % CATALOGUE.length]
    picks.push(first.id)
    if (i % 3 === 0) picks.push(CATALOGUE[(i + 2) % CATALOGUE.length].id)

    const items = []
    for (const variantId of [...new Set(picks)]) {
      const available = getStock(state, EXHIBITION, variantId)
      if (available < 1) continue
      const quantity = Math.min(available, 1 + Math.floor(random() * 2))
      // Every fourth sale has money taken off the line itself.
      const lineDiscount = i % 4 === 0 ? 500 : 0
      items.push(cartLine(state, variantId, quantity, lineDiscount))
    }
    if (!items.length) continue

    const discount =
      i % 6 === 0
        ? { type: 'percentage', value: 10 }
        : i % 7 === 0
          ? { type: 'fixed', value: 1000 }
          : { type: 'percentage', value: 0 }

    // A promo on some sales, within its three-use limit.
    const promo =
      i === 3 || i === 9
        ? { code: 'PREVIEW20', type: 'percentage', value: 20 }
        : i === 15
          ? { code: 'STALL10', type: 'percentage', value: 10 }
          : null

    // Every payment shape the brief lists: single method, split, and part paid.
    const split = i % 8 === 3
    const partPayment = i % 11 === 5

    const result = createOrder(state, {
      clientId: `cli-${i}`,
      exhibitionId: EXHIBITION,
      customerId: customer?.id || null,
      customerName: customer?.name || 'Walk-in Customer',
      salespersonId: staff.id,
      salespersonName: staff.name,
      items,
      discount,
      promo,
      paymentMethod: METHODS[i % METHODS.length],
      paymentParts: null,
      deviceCode: i % 2 === 0 ? 'A1' : 'B2',
      createdAt: new Date(2026, 2, 1 + (i % 4), 10 + (i % 8), (i * 7) % 60).toISOString(),
    })

    let order = result.order
    let next = result.state

    // Re-run the ones that need a different payment shape, now that the total
    // is known — the POS does the same thing from the checkout screen.
    if (split || partPayment) {
      const rerun = createOrder(state, {
        clientId: `cli-${i}`,
        exhibitionId: EXHIBITION,
        customerId: customer?.id || null,
        customerName: customer?.name || 'Walk-in Customer',
        salespersonId: staff.id,
        salespersonName: staff.name,
        items,
        discount,
        promo,
        paymentMethod: METHODS[i % METHODS.length],
        paymentParts: split
          ? [
              { method: 'Cash', amount: money(order.total / 3) },
              { method: 'Card', amount: money(order.total - money(order.total / 3)) },
            ]
          : null,
        amountPaid: partPayment ? money(order.total / 2) : null,
        deviceCode: i % 2 === 0 ? 'A1' : 'B2',
        createdAt: order.createdAt,
      })
      order = rerun.order
      next = rerun.state
    }

    state = next
    orders.push(order)
    intent.invoices.push(order.invoiceNo)
    if (promo) intent.promoUses += 1
    for (const item of items) track(intent.sold, item.variantId, item.quantity)
  }

  return { state, orders, intent }
}

/* ----------------------------------------------------------------- tests */

describe('acceptance: a full exhibition', () => {
  const { state: traded, orders, intent } = tradeAnExhibition()

  it('takes the 20–30 sales the brief asks for', () => {
    expect(orders.length).toBeGreaterThanOrEqual(20)
    expect(orders.length).toBeLessThanOrEqual(30)
  })

  it('covers every payment shape', () => {
    expect(orders.some((order) => order.paymentMethod === 'Cash')).toBe(true)
    expect(orders.some((order) => order.paymentMethod === 'Card')).toBe(true)
    expect(orders.some((order) => order.paymentMethod === 'Bank Transfer')).toBe(true)
    expect(orders.some((order) => order.paymentParts?.length > 1)).toBe(true)
    expect(orders.some((order) => order.balanceDue > 0)).toBe(true)
  })

  it('covers discounts, line discounts and promo codes', () => {
    expect(orders.some((order) => order.discountAmount > 0)).toBe(true)
    expect(orders.some((order) => order.lineDiscounts > 0)).toBe(true)
    expect(orders.filter((order) => order.promoAmount > 0)).toHaveLength(intent.promoUses)
  })

  it('gives every sale its own invoice number', () => {
    expect(new Set(intent.invoices).size).toBe(intent.invoices.length)
  })

  it('deducts exactly what was sold, and only at the exhibition', () => {
    for (const entry of CATALOGUE) {
      const sold = intent.sold[entry.id] || 0
      expect(getStock(traded, EXHIBITION, entry.id)).toBe(entry.opening - sold)
      // The warehouse is untouched by stall trading.
      expect(getStock(traded, MAIN_LOCATION, entry.id)).toBe(50)
    }
  })

  it('never lets the stall go negative', () => {
    for (const entry of CATALOGUE) {
      expect(getStock(traded, EXHIBITION, entry.id)).toBeGreaterThanOrEqual(0)
    }
  })

  it('balances the payment ledger against what the orders say was received', () => {
    const captured = traded.payments
      .filter((payment) => payment.kind === 'payment')
      .reduce((sum, payment) => sum + payment.amount, 0)
    const receivedOnOrders = orders.reduce((sum, order) => sum + order.amountPaid, 0)
    expect(money(captured)).toBe(money(receivedOnOrders))
  })

  it('splits a sale across tills without inventing or losing money', () => {
    for (const order of orders.filter((entry) => entry.paymentParts?.length > 1)) {
      const parts = order.paymentParts.reduce((sum, part) => sum + part.amount, 0)
      expect(money(parts)).toBe(order.amountPaid)
      expect(order.amountPaid).toBeLessThanOrEqual(order.total)
    }
  })

  it('respects the promo code usage limit', () => {
    const preview = traded.promoCodes.find((entry) => entry.code === 'PREVIEW20')
    expect(preview.usedCount).toBeLessThanOrEqual(preview.usageLimit)
  })

  /* ------------------------------------------------- settle, return, cancel */

  describe('after settling, returning and cancelling', () => {
    let state = traded

    const pending = orders.find((order) => order.balanceDue > 0)
    const settled = settlePayment(state, {
      orderId: pending.id,
      method: 'Cash',
      amount: pending.balanceDue,
      userId: 'u-ahmed',
    })
    state = settled.state

    const returnable = orders.find((order) => order.items.length === 1 && order.balanceDue === 0)
    const refund = refundOrder(state, {
      orderId: returnable.id,
      lines: [{ variantId: returnable.items[0].variantId, quantity: 1 }],
      refundMethod: 'Cash',
      reason: 'Wrong colour',
      userId: 'u-layla',
      userName: 'Layla Hassan',
    })
    state = refund.state

    // A cancellation, reversed the way the store does it.
    const cancelled = orders.find(
      (order) => order.id !== returnable.id && order.id !== pending.id && order.balanceDue === 0,
    )
    state = {
      ...state,
      orders: state.orders.map((order) =>
        order.id === cancelled.id ? { ...order, status: 'Cancelled', note: 'Customer changed mind' } : order,
      ),
    }
    state = releasePromoUse(state, cancelled.promoCode)

    it('closes the balance on a part-paid sale', () => {
      const closed = state.orders.find((order) => order.id === pending.id)
      expect(closed.balanceDue).toBe(0)
      expect(closed.status).toBe('Completed')
    })

    it('never refunds more than the customer actually paid', () => {
      expect(refund.refundAmount).toBeLessThanOrEqual(returnable.amountPaid)
    })

    it('puts the returned unit back on the shelf', () => {
      const variantId = returnable.items[0].variantId
      const opening = CATALOGUE.find((entry) => entry.id === variantId).opening
      expect(getStock(state, EXHIBITION, variantId)).toBe(opening - (intent.sold[variantId] || 0) + 1)
    })

    it('records the return with its reason and who authorised it', () => {
      const ledger = returnsReport(state, { exhibitionId: EXHIBITION })
      expect(ledger).toHaveLength(1)
      expect(ledger[0]).toMatchObject({ reason: 'Wrong colour', userName: 'Layla Hassan' })
      expect(returnsSummary(ledger).units).toBe(1)
    })

    it('drops a cancelled sale out of the live figures', () => {
      const live = filterOrders(state, { exhibitionId: EXHIBITION })
      const summary = salesSummary(live)
      const cancelledTotal = cancelled.total
      const allTotals = orders.reduce((sum, order) => sum + order.total, 0)
      expect(summary.net).toBeLessThanOrEqual(money(allTotals - cancelledTotal))
      expect(summary.cancelled).toBe(1)
    })

    it('keeps the cancelled sale on the record rather than deleting it', () => {
      expect(state.orders.find((order) => order.id === cancelled.id)).toBeTruthy()
    })

    /* ------------------------------------------------------------ reports */

    it('reports sales by category that add up to the product report', () => {
      const filter = { exhibitionId: EXHIBITION }
      const byProduct = productSales(state, filter).reduce((sum, row) => sum + row.revenue, 0)
      const byCategory = salesByCategory(state, filter).reduce((sum, row) => sum + row.revenue, 0)
      expect(money(byCategory)).toBe(money(byProduct))
    })

    it('attributes split payments to each method rather than to a "Split" bucket', () => {
      const rows = staffPerformance(state, { exhibitionId: EXHIBITION })
      const buckets = rows.flatMap((row) => Object.keys(row.methods))
      expect(buckets).not.toContain('Split')
      expect(buckets).toContain('Cash')
    })

    it('breaks takings down by method for reconciliation', () => {
      const rows = paymentBreakdown(state, { exhibitionId: EXHIBITION })
      expect(rows.length).toBeGreaterThan(1)
      for (const row of rows) expect(METHODS).toContain(row.method)
    })

    /* ------------------------------------------------------------ receipt */

    it('shares a receipt that survives the round trip to the customer phone', () => {
      const order = orders.find((entry) => entry.promoAmount > 0 && entry.items.length >= 1)
      const customer = state.customers.find((entry) => entry.id === order.customerId)
      const encoded = encodeReceipt(order, settings, 'DHA Exhibition', customer)
      const decoded = decodeReceipt(encoded)

      expect(decoded.invoiceNo).toBe(order.invoiceNo)
      expect(decoded.total).toBe(order.total)
      expect(decoded.promoCode).toBe(order.promoCode)
      expect(decoded.promoAmount).toBe(order.promoAmount)
      expect(decoded.items).toHaveLength(order.items.length)
      expect(decoded.items[0].name).toBe(order.items[0].name)
      // The stall price was charged, so the receipt can show what it replaced.
      expect(decoded.items[0].listPrice).toBe(
        order.items[0].listPrice > order.items[0].unitPrice ? order.items[0].listPrice : 0,
      )
    })

    it('carries a split payment onto the receipt', () => {
      const order = orders.find((entry) => entry.paymentParts?.length > 1)
      const decoded = decodeReceipt(encodeReceipt(order, settings, 'DHA Exhibition', null))
      expect(decoded.paymentParts).toHaveLength(order.paymentParts.length)
      expect(money(decoded.paymentParts.reduce((sum, part) => sum + part.amount, 0))).toBe(order.amountPaid)
    })

    /* ------------------------------------------------------- weak internet */

    it('replays a queued offline sale without duplicating it', () => {
      const original = orders[0]
      const replay = createOrder(state, {
        clientId: 'cli-0',
        exhibitionId: EXHIBITION,
        customerName: original.customerName,
        salespersonId: original.salespersonId,
        salespersonName: original.salespersonName,
        items: original.items,
        discount: { type: original.discountType, value: original.discountValue },
        paymentMethod: original.paymentMethod,
      })
      expect(replay.duplicate).toBe(true)
      expect(replay.state.orders).toHaveLength(state.orders.length)
      const variantId = original.items[0].variantId
      expect(getStock(replay.state, EXHIBITION, variantId)).toBe(getStock(state, EXHIBITION, variantId))
    })

    it('restores stock and releases promo uses when a sale is deleted outright', () => {
      const target = orders.find((order) => order.promoAmount > 0 && order.status === 'Completed')
      const before = getStock(state, EXHIBITION, target.items[0].variantId)
      const promoBefore = state.promoCodes.find((entry) => entry.code === target.promoCode).usedCount

      const { state: after } = deleteOrders(state, { orderIds: [target.id] })

      expect(after.orders.find((order) => order.id === target.id)).toBeUndefined()
      expect(getStock(after, EXHIBITION, target.items[0].variantId)).toBe(before + target.items[0].quantity)
      expect(after.promoCodes.find((entry) => entry.code === target.promoCode).usedCount).toBe(promoBefore - 1)
    })
  })
})
