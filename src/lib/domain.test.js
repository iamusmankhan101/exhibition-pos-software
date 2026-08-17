/**
 * Rules that decide what a customer is charged and what stock is left.
 *
 * These run against `domain.js` directly — no browser, no React — which is the
 * whole reason the rules live in pure `state → state` functions.
 */

import { describe, expect, it } from 'vitest'
import {
  allocatePaymentParts,
  computeTotals,
  createOrder,
  deleteOrders,
  getStock,
  hasExhibitionPrice,
  orderPaymentParts,
  refundOrder,
  releasePromoUse,
  sellingPrice,
  settlePayment,
  validatePromo,
} from './domain.js'
import { MAIN_LOCATION } from './format.js'

const settings = {
  invoicePrefix: 'TRZ',
  taxEnabled: false,
  taxInclusive: false,
  taxRate: 0,
  allowOverselling: false,
  lowStockThreshold: 3,
  maxDiscountPercent: 30,
}

const variant = { id: 'v1', sku: 'SKU1', price: 100, exhibitionPrice: 80, cost: 20, minStock: 1 }
const plainVariant = { id: 'v2', sku: 'SKU2', price: 50, exhibitionPrice: null, cost: 10, minStock: 1 }

const product = {
  id: 'p1',
  name: 'Black Silk Scarf',
  category: 'Scarves',
  variants: [variant, plainVariant],
}

/** A minimal but complete state, so tests read as scenarios rather than setup. */
function baseState(overrides = {}) {
  return {
    settings,
    products: [product],
    exhibitions: [
      { id: 'ex1', name: 'DHA Exhibition' },
      { id: 'ex2', name: 'Karachi Show' },
    ],
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
      { id: 'pm2', code: 'EX2ONLY', type: 'fixed', value: 20, minSpend: 0, usageLimit: 0, usedCount: 0, active: true, exhibitionId: 'ex2' },
      { id: 'pm3', code: 'ONESHOT', type: 'percentage', value: 50, minSpend: 0, usageLimit: 1, usedCount: 0, active: true, exhibitionId: 'all' },
      { id: 'pm4', code: 'BIGSPEND', type: 'fixed', value: 25, minSpend: 200, usageLimit: 0, usedCount: 0, active: true, exhibitionId: 'all' },
      { id: 'pm5', code: 'RETIRED', type: 'percentage', value: 10, minSpend: 0, usageLimit: 0, usedCount: 4, active: false, exhibitionId: 'all' },
    ],
    inventory: { 'ex1:v1': { quantity: 10 }, 'ex1:v2': { quantity: 5 }, [`${MAIN_LOCATION}:v1`]: { quantity: 20 } },
    counters: { invoice: 1 },
    ...overrides,
  }
}

const line = (over = {}) => ({
  variantId: 'v1',
  name: 'Black Silk Scarf',
  sku: 'SKU1',
  category: 'Scarves',
  quantity: 2,
  unitPrice: 80,
  listPrice: 100,
  lineDiscount: 0,
  ...over,
})

/** Completes a sale and hands back both the new state and the order. */
function sell(state, payload = {}) {
  return createOrder(state, {
    clientId: `cli-${Math.random()}`,
    exhibitionId: 'ex1',
    customerId: 'cus1',
    customerName: 'Amina',
    salespersonId: 'u1',
    salespersonName: 'Ahmed',
    items: [line()],
    discount: { type: 'percentage', value: 0 },
    paymentMethod: 'Cash',
    ...payload,
  })
}

/* ------------------------------------------------------------- pricing */

describe('exhibition pricing', () => {
  it('charges the stall price at an exhibition', () => {
    expect(sellingPrice(variant, 'ex1')).toBe(80)
  })

  it('charges the list price selling direct from the warehouse', () => {
    expect(sellingPrice(variant, MAIN_LOCATION)).toBe(100)
  })

  it('falls back to the list price when no stall price is set', () => {
    expect(hasExhibitionPrice(plainVariant)).toBe(false)
    expect(sellingPrice(plainVariant, 'ex1')).toBe(50)
  })

  it('treats a zero stall price as a real price, not as unset', () => {
    expect(hasExhibitionPrice({ ...variant, exhibitionPrice: 0 })).toBe(true)
  })
})

/* -------------------------------------------------------------- totals */

describe('cart maths', () => {
  it('applies a percentage discount to the subtotal', () => {
    const totals = computeTotals([line()], { type: 'percentage', value: 10 }, settings)
    expect(totals.subtotal).toBe(160)
    expect(totals.discountAmount).toBe(16)
    expect(totals.total).toBe(144)
  })

  it('never discounts more than the order is worth', () => {
    const totals = computeTotals([line()], { type: 'fixed', value: 999 }, settings)
    expect(totals.discountAmount).toBe(160)
    expect(totals.total).toBe(0)
  })

  it('takes a promo off what is still payable, after the manual discount', () => {
    const promo = { code: 'STALL10', type: 'percentage', value: 10 }
    const totals = computeTotals([line()], { type: 'percentage', value: 10 }, settings, promo)
    // 160 − 16 = 144, then 10% of 144.
    expect(totals.promoAmount).toBe(14.4)
    expect(totals.total).toBe(129.6)
    expect(totals.totalDiscount).toBe(30.4)
  })

  it('cannot combine a discount and a promo into more than the order', () => {
    const promo = { code: 'STALL10', type: 'fixed', value: 999 }
    const totals = computeTotals([line()], { type: 'fixed', value: 100 }, settings, promo)
    expect(totals.total).toBe(0)
    expect(totals.promoAmount).toBe(60)
  })

  it('counts per-item discounts in the total given away', () => {
    const totals = computeTotals([line({ lineDiscount: 20 })], { type: 'percentage', value: 0 }, settings)
    expect(totals.subtotal).toBe(140)
    expect(totals.lineDiscounts).toBe(20)
  })

  it('adds exclusive VAT on top of the net', () => {
    const taxed = { ...settings, taxEnabled: true, taxRate: 20, taxInclusive: false }
    const totals = computeTotals([line()], { type: 'percentage', value: 0 }, taxed)
    expect(totals.tax).toBe(32)
    expect(totals.total).toBe(192)
  })

  it('extracts inclusive VAT without changing what is charged', () => {
    const taxed = { ...settings, taxEnabled: true, taxRate: 20, taxInclusive: true }
    const totals = computeTotals([line()], { type: 'percentage', value: 0 }, taxed)
    expect(totals.total).toBe(160)
    expect(totals.tax).toBeCloseTo(26.67, 2)
  })
})

/* ---------------------------------------------------------- promo codes */

describe('promo codes', () => {
  const state = baseState()

  it('accepts a live code', () => {
    expect(validatePromo(state, 'STALL10', 160, { locationId: 'ex1' }).ok).toBe(true)
  })

  it('is case-insensitive and ignores surrounding space', () => {
    expect(validatePromo(state, '  stall10 ', 160, { locationId: 'ex1' }).ok).toBe(true)
  })

  it('rejects a code scoped to a different exhibition', () => {
    const result = validatePromo(state, 'EX2ONLY', 160, { locationId: 'ex1' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('Karachi Show')
  })

  it('accepts that same code at its own exhibition', () => {
    expect(validatePromo(state, 'EX2ONLY', 160, { locationId: 'ex2' }).ok).toBe(true)
  })

  it('rejects an inactive code', () => {
    expect(validatePromo(state, 'RETIRED', 160, { locationId: 'ex1' }).ok).toBe(false)
  })

  it('rejects a code below its minimum spend', () => {
    expect(validatePromo(state, 'BIGSPEND', 100, { locationId: 'ex1' }).ok).toBe(false)
    expect(validatePromo(state, 'BIGSPEND', 200, { locationId: 'ex1' }).ok).toBe(true)
  })

  it('rejects a code that has run out of uses', () => {
    const used = baseState()
    used.promoCodes = used.promoCodes.map((p) => (p.code === 'ONESHOT' ? { ...p, usedCount: 1 } : p))
    expect(validatePromo(used, 'ONESHOT', 160, { locationId: 'ex1' }).ok).toBe(false)
  })

  it('honours a date window', () => {
    const dated = baseState()
    dated.promoCodes = [
      { ...dated.promoCodes[0], startsAt: '2026-01-01', expiresAt: '2026-01-31' },
    ]
    expect(validatePromo(dated, 'STALL10', 160, { locationId: 'ex1', today: '2025-12-31' }).ok).toBe(false)
    expect(validatePromo(dated, 'STALL10', 160, { locationId: 'ex1', today: '2026-01-15' }).ok).toBe(true)
    expect(validatePromo(dated, 'STALL10', 160, { locationId: 'ex1', today: '2026-02-01' }).ok).toBe(false)
  })

  it('counts a use only when the code actually took money off', () => {
    const { state: after } = sell(baseState(), { promo: { code: 'STALL10', type: 'percentage', value: 10 } })
    expect(after.promoCodes.find((p) => p.code === 'STALL10').usedCount).toBe(1)
  })

  it('gives a use back rather than letting it drop below zero', () => {
    const released = releasePromoUse(releasePromoUse(baseState(), 'STALL10'), 'STALL10')
    expect(released.promoCodes.find((p) => p.code === 'STALL10').usedCount).toBe(0)
  })
})

/* -------------------------------------------------------------- payments */

describe('split payments', () => {
  it('records one payment row per method', () => {
    const { state: after, order } = sell(baseState(), {
      paymentParts: [
        { method: 'Cash', amount: 60 },
        { method: 'Card', amount: 100 },
      ],
    })
    expect(order.paymentMethod).toBe('Split')
    expect(after.payments.map((p) => [p.method, p.amount])).toEqual([
      ['Cash', 60],
      ['Card', 100],
    ])
    expect(order.balanceDue).toBe(0)
  })

  it('trims an over-tendered row instead of inflating the takings', () => {
    const parts = allocatePaymentParts(
      [
        { method: 'Cash', amount: 100 },
        { method: 'Card', amount: 100 },
      ],
      160,
    )
    expect(parts).toEqual([
      { method: 'Cash', amount: 100, reference: '' },
      { method: 'Card', amount: 60, reference: '' },
    ])
  })

  it('leaves a balance due when the split does not cover the order', () => {
    const { order } = sell(baseState(), { paymentParts: [{ method: 'Cash', amount: 100 }] })
    expect(order.amountPaid).toBe(100)
    expect(order.balanceDue).toBe(60)
    expect(order.status).toBe('Pending')
  })

  it('normalises an order written before split payments existed', () => {
    expect(orderPaymentParts({ paymentMethod: 'Card', amountPaid: 50, total: 50 })).toEqual([
      { method: 'Card', amount: 50, reference: '' },
    ])
  })

  it('settles an outstanding balance and closes the order', () => {
    const { state: after, order } = sell(baseState(), { amountPaid: 60 })
    expect(order.status).toBe('Pending')
    const { state: settled } = settlePayment(after, {
      orderId: order.id,
      method: 'Card',
      amount: 100,
      userId: 'u1',
    })
    const closed = settled.orders.find((entry) => entry.id === order.id)
    expect(closed.balanceDue).toBe(0)
    expect(closed.status).toBe('Completed')
  })
})

/* ----------------------------------------------------------------- stock */

describe('stock', () => {
  it('deducts what was sold from the selling location only', () => {
    const { state: after } = sell(baseState())
    expect(getStock(after, 'ex1', 'v1')).toBe(8)
    expect(getStock(after, MAIN_LOCATION, 'v1')).toBe(20)
  })

  it('refuses to oversell', () => {
    expect(() => sell(baseState(), { items: [line({ quantity: 99 })] })).toThrow(/only 10 left/i)
  })

  it('sells past the count when an override is authorised, and records who', () => {
    const { order } = sell(baseState(), {
      items: [line({ quantity: 99 })],
      overrideOversell: true,
      overrideBy: { id: 'u9', name: 'Sarah' },
    })
    expect(order.oversell.by).toBe('Sarah')
    expect(order.oversell.lines[0]).toMatchObject({ requested: 99, available: 10 })
  })

  it('does not flag an oversell on a sale that was within stock', () => {
    const { order } = sell(baseState(), { overrideOversell: true, overrideBy: { id: 'u9', name: 'Sarah' } })
    expect(order.oversell).toBeNull()
  })
})

/* ---------------------------------------------------- returns and refunds */

describe('returns and refunds', () => {
  it('refunds what was paid for the line, not the ticket price', () => {
    const { state: after, order } = sell(baseState(), { discount: { type: 'percentage', value: 10 } })
    const { refundAmount } = refundOrder(after, {
      orderId: order.id,
      lines: [{ variantId: 'v1', quantity: 1 }],
      refundMethod: 'Cash',
      reason: 'Changed mind',
      userId: 'u1',
      userName: 'Ahmed',
    })
    // 80 charged, less the 10% the customer never paid.
    expect(refundAmount).toBe(72)
  })

  it('takes the promo off the refund too', () => {
    const { state: after, order } = sell(baseState(), {
      discount: { type: 'percentage', value: 10 },
      promo: { code: 'STALL10', type: 'percentage', value: 10 },
    })
    const { refundAmount } = refundOrder(after, {
      orderId: order.id,
      lines: [{ variantId: 'v1', quantity: 1 }],
      refundMethod: 'Cash',
      reason: 'Changed mind',
      userId: 'u1',
      userName: 'Ahmed',
    })
    // Paid 129.60 for two, so one comes back at 64.80 — never more than was taken.
    expect(refundAmount).toBe(64.8)
  })

  it('puts returned stock back', () => {
    const { state: after, order } = sell(baseState())
    const { state: refunded } = refundOrder(after, {
      orderId: order.id,
      lines: [{ variantId: 'v1', quantity: 1 }],
      refundMethod: 'Cash',
      reason: 'Faulty',
      userId: 'u1',
      userName: 'Ahmed',
    })
    expect(getStock(refunded, 'ex1', 'v1')).toBe(9)
  })

  it('logs the return with its reason and who authorised it', () => {
    const { state: after, order } = sell(baseState())
    const { state: refunded } = refundOrder(after, {
      orderId: order.id,
      lines: [{ variantId: 'v1', quantity: 1 }],
      refundMethod: 'Cash',
      reason: 'Faulty stitching',
      userId: 'u1',
      userName: 'Ahmed',
    })
    expect(refunded.returns).toHaveLength(1)
    expect(refunded.returns[0]).toMatchObject({
      kind: 'return',
      reason: 'Faulty stitching',
      userName: 'Ahmed',
      quantity: 1,
    })
  })

  it('clears an unpaid balance before handing back any cash', () => {
    const { state: after, order } = sell(baseState(), { amountPaid: 20 })
    const { refundAmount, balanceCleared } = refundOrder(after, {
      orderId: order.id,
      lines: [{ variantId: 'v1', quantity: 2 }],
      refundMethod: 'Cash',
      reason: 'Returned everything',
      userId: 'u1',
      userName: 'Ahmed',
    })
    // Only £20 ever changed hands, so only £20 can come back.
    expect(balanceCleared).toBe(140)
    expect(refundAmount).toBe(20)
  })

  it('refuses a return of more than was bought', () => {
    const { state: after, order } = sell(baseState())
    expect(() =>
      refundOrder(after, {
        orderId: order.id,
        lines: [{ variantId: 'v1', quantity: 5 }],
        refundMethod: 'Cash',
        reason: 'too many',
        userId: 'u1',
        userName: 'Ahmed',
      }),
    ).toThrow()
  })
})

/* ------------------------------------------------------------- deletion */

describe('deleting a sale', () => {
  it('restores stock and releases the promo use', () => {
    const { state: after, order } = sell(baseState(), {
      promo: { code: 'ONESHOT', type: 'percentage', value: 50 },
    })
    expect(after.promoCodes.find((p) => p.code === 'ONESHOT').usedCount).toBe(1)

    const { state: deleted } = deleteOrders(after, { orderIds: [order.id] })
    expect(deleted.orders).toHaveLength(0)
    expect(getStock(deleted, 'ex1', 'v1')).toBe(10)
    // The one-use code is available again, since the sale never stood.
    expect(deleted.promoCodes.find((p) => p.code === 'ONESHOT').usedCount).toBe(0)
  })

  it('takes the payments and returns of that order with it', () => {
    const { state: after, order } = sell(baseState())
    const { state: refunded } = refundOrder(after, {
      orderId: order.id,
      lines: [{ variantId: 'v1', quantity: 1 }],
      refundMethod: 'Cash',
      reason: 'Faulty',
      userId: 'u1',
      userName: 'Ahmed',
    })
    const { state: deleted } = deleteOrders(refunded, { orderIds: [order.id] })
    expect(deleted.payments).toHaveLength(0)
    expect(deleted.returns).toHaveLength(0)
  })
})

/* ------------------------------------------------------------- offline */

describe('offline replay', () => {
  it('cannot create the same sale twice from a replayed queue', () => {
    const first = createOrder(baseState(), {
      clientId: 'offline-1',
      exhibitionId: 'ex1',
      customerName: 'Walk-in',
      salespersonId: 'u1',
      salespersonName: 'Ahmed',
      items: [line()],
      discount: { type: 'percentage', value: 0 },
      paymentMethod: 'Cash',
    })
    const replay = createOrder(first.state, {
      clientId: 'offline-1',
      exhibitionId: 'ex1',
      customerName: 'Walk-in',
      salespersonId: 'u1',
      salespersonName: 'Ahmed',
      items: [line()],
      discount: { type: 'percentage', value: 0 },
      paymentMethod: 'Cash',
    })
    expect(replay.duplicate).toBe(true)
    expect(replay.state.orders).toHaveLength(1)
    // Critically, the replay must not deduct the stock a second time.
    expect(getStock(replay.state, 'ex1', 'v1')).toBe(8)
  })

  it('embeds the device code in the invoice number so two tills cannot collide', () => {
    const state = baseState()
    const a = createOrder(state, {
      clientId: 'a',
      exhibitionId: 'ex1',
      customerName: 'Walk-in',
      salespersonId: 'u1',
      salespersonName: 'Ahmed',
      items: [line()],
      discount: { type: 'percentage', value: 0 },
      paymentMethod: 'Cash',
      deviceCode: 'A1',
    })
    const b = createOrder(state, {
      clientId: 'b',
      exhibitionId: 'ex1',
      customerName: 'Walk-in',
      salespersonId: 'u1',
      salespersonName: 'Ahmed',
      items: [line()],
      discount: { type: 'percentage', value: 0 },
      paymentMethod: 'Cash',
      deviceCode: 'B2',
    })
    expect(a.order.invoiceNo).toContain('A1')
    expect(b.order.invoiceNo).toContain('B2')
    expect(a.order.invoiceNo).not.toBe(b.order.invoiceNo)
  })
})
