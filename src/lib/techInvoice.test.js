/**
 * Tareez Tech — the marketing business that shares this till.
 *
 * The risk of two businesses in one app is that they bleed into each other: a
 * service invoice eating a hole in the stall's invoice numbers, a marketing line
 * moving a dress out of stock, a client's bill printed under the fashion label.
 * These are the rules that keep them apart.
 */

import { describe, expect, it } from 'vitest'
import { buildInvoiceData } from './invoiceData.js'
import { createOrder, dueDateFor, invoiceBusiness, isTechOrder, TECH_PROFILE } from './domain.js'
import { decodeReceipt, encodeReceipt } from './receipt.js'

const settings = {
  currency: 'PKR',
  currencySymbol: 'Rs ',
  invoicePrefix: 'TRZ',
  taxEnabled: false,
  taxInclusive: false,
  taxRate: 0,
  allowOverselling: false,
  lowStockThreshold: 3,
  maxDiscountPercent: 30,
  terms: 'All sales final.',
  receiptFooter: 'Thank you.',
  business: { name: 'Tareez', legalName: 'Tareez Styles', logo: 'data:stall' },
  techBusiness: { name: 'Tareez Tech', legalName: 'Tareez Tech (Pvt)', logo: 'data:tech', vatNumber: 'GST-99' },
  techInvoicePrefix: 'TT',
  techDueDays: 14,
  techServices: [{ id: 'tsc_web', name: 'Website development', price: 45000, note: '' }],
  invoiceDesign: {},
  paymentMethods: ['Cash'],
}

/** A line exactly as the till builds one when a service is priced per job. */
const serviceLine = (over = {}) => ({
  productId: null,
  variantId: 'svc_tsc_web:45000',
  name: 'Website development',
  sku: '',
  category: 'Tareez Tech',
  size: '',
  color: '',
  image: '',
  service: 'tech',
  quantity: 1,
  listPrice: 45000,
  unitPrice: 45000,
  lineDiscount: 0,
  ...over,
})

const stockLine = (over = {}) => ({
  productId: 'p1',
  variantId: 'v1',
  name: 'Black Silk Scarf',
  sku: 'SKU1',
  category: 'Scarves',
  quantity: 1,
  listPrice: 100,
  unitPrice: 80,
  lineDiscount: 0,
  ...over,
})

function baseState(overrides = {}) {
  return {
    settings,
    products: [{ id: 'p1', name: 'Black Silk Scarf', category: 'Scarves', variants: [{ id: 'v1', price: 100 }] }],
    exhibitions: [{ id: 'ex1', name: 'DHA Exhibition' }],
    customers: [{ id: 'cus1', name: 'Brew & Bean Ltd', whatsapp: '+92 300 111 2222', email: 'accounts@brewbean.co' }],
    users: [],
    orders: [],
    payments: [],
    returns: [],
    movements: [],
    auditLogs: [],
    notifications: [],
    outbox: [],
    devices: [],
    promoCodes: [],
    inventory: { 'ex1:v1': { quantity: 10 } },
    counters: { invoice: 1, techInvoice: 1 },
    ...overrides,
  }
}

const sellTech = (state, payload = {}) =>
  createOrder(state, {
    clientId: `cli-${Math.random()}`,
    exhibitionId: 'ex1',
    customerId: 'cus1',
    customerName: 'Brew & Bean Ltd',
    salespersonId: 'u1',
    salespersonName: 'Ahmed',
    items: [serviceLine()],
    discount: { type: 'percentage', value: 0 },
    paymentMethod: 'Bank',
    profile: TECH_PROFILE,
    clientContact: 'Amina (marketing@brewbean.co)',
    issuedAt: '2026-11-03T12:00:00.000Z',
    dueDate: '2026-11-17T12:00:00.000Z',
    ...payload,
  })

const sellStall = (state, payload = {}) =>
  createOrder(state, {
    clientId: `cli-${Math.random()}`,
    exhibitionId: 'ex1',
    customerName: 'Walk-in',
    salespersonId: 'u1',
    salespersonName: 'Ahmed',
    items: [stockLine()],
    discount: { type: 'percentage', value: 0 },
    paymentMethod: 'Cash',
    ...payload,
  })

describe('invoice numbers', () => {
  it('numbers a service invoice on its own prefix and counter', () => {
    const { order, state } = sellTech(baseState())
    expect(order.invoiceNo.startsWith('TT-')).toBe(true)
    expect(state.counters.techInvoice).toBe(2)
    expect(state.counters.invoice).toBe(1)
  })

  it('leaves the stall sequence untouched', () => {
    const afterTech = sellTech(baseState()).state
    const { order } = sellStall(afterTech)
    expect(order.invoiceNo.startsWith('TRZ-')).toBe(true)
    expect(order.invoiceNo).toContain('A1001')
  })

  it('falls back to the stall prefix when no tech prefix is configured', () => {
    const state = baseState()
    state.settings = { ...settings, techInvoicePrefix: '' }
    expect(sellTech(state).order.invoiceNo.startsWith('TRZ-')).toBe(true)
  })
})

describe('what a tech invoice carries', () => {
  it('stamps the profile, the client contact and the due date', () => {
    const { order } = sellTech(baseState())
    expect(isTechOrder(order)).toBe(true)
    expect(order.clientContact).toBe('Amina (marketing@brewbean.co)')
    expect(order.dueDate).toBe('2026-11-17T12:00:00.000Z')
    expect(order.issuedAt).toBe('2026-11-03T12:00:00.000Z')
  })

  it('keeps a stall sale free of all of it', () => {
    const { order } = sellStall(baseState())
    expect(isTechOrder(order)).toBe(false)
    expect(order.profile).toBeUndefined()
    expect(order.dueDate).toBeUndefined()
    expect(order.clientContact).toBeUndefined()
  })

  it('tells the two businesses apart by whose name goes on the paper', () => {
    const state = baseState()
    expect(invoiceBusiness(state.settings, sellTech(state).order).name).toBe('Tareez Tech')
    expect(invoiceBusiness(state.settings, sellStall(state).order).name).toBe('Tareez')
  })

  it('never invents a due date when the term is not set', () => {
    expect(dueDateFor('2026-11-03T12:00:00.000Z', 0)).toBe('')
    expect(dueDateFor('2026-11-03T12:00:00.000Z', -3)).toBe('')
    expect(dueDateFor('not a date', 14)).toBe('')
    expect(dueDateFor('2026-11-03T12:00:00.000Z', 14)).toBe('2026-11-17T12:00:00.000Z')
  })
})

describe('stock', () => {
  it('takes nothing out of the exhibition for a service line', () => {
    const state = baseState()
    const { state: next } = sellTech(state)
    expect(next.inventory['ex1:v1'].quantity).toBe(10)
    expect(next.movements).toHaveLength(0)
  })

  it('still refuses an oversold dress when a service shares the cart', () => {
    const state = baseState()
    state.inventory = { 'ex1:v1': { quantity: 1 } }
    expect(() => sellTech(state, { items: [serviceLine(), stockLine({ quantity: 5 })] })).toThrow(
      /only 1 left/,
    )
  })
})

describe('the invoice a client receives', () => {
  it('is drawn under the marketing business, with the term and the VAT', () => {
    const state = baseState()
    const { order } = sellTech(state)
    const data = buildInvoiceData(order, state, { exhibitionName: 'DHA Exhibition' })
    expect(data.business.name).toBe('Tareez Tech')
    expect(data.showVat).toBe(true)
    expect(data.showTagline).toBe(true)
    expect(data.dueDate).toBe('2026-11-17T12:00:00.000Z')
    expect(data.clientContact).toBe('Amina (marketing@brewbean.co)')
    expect(data.createdAt).toBe('2026-11-03T12:00:00.000Z')
    // The stall's returns policy is not a campaign invoice's terms.
    expect(data.terms).toBe('')
  })

  it('leaves the stall invoice exactly as it always was', () => {
    const state = baseState()
    const { order } = sellStall(state)
    const data = buildInvoiceData(order, state, { exhibitionName: 'DHA Exhibition' })
    expect(data.business.name).toBe('Tareez')
    expect(data.showVat).toBe(false)
    expect(data.dueDate).toBe('')
    expect(data.terms).toBe('All sales final.')
    expect(data.createdAt).toBe(order.createdAt)
  })

  it('sends the tech identity through the receipt link', () => {
    const state = baseState()
    const { order } = sellTech(state)
    const decoded = decodeReceipt(encodeReceipt(order, state.settings, 'DHA Exhibition', state.customers[0]))
    expect(decoded.business.name).toBe('Tareez Tech')
    expect(decoded.business.vatNumber).toBe('GST-99')
    expect(decoded.tech).toBe(true)
    expect(decoded.dueDate).toBe('2026-11-17T12:00:00.000Z')
    expect(decoded.clientContact).toBe('Amina (marketing@brewbean.co)')
  })

  it('sends a stall receipt without it', () => {
    const state = baseState()
    const { order } = sellStall(state)
    const decoded = decodeReceipt(encodeReceipt(order, state.settings, 'DHA Exhibition', null))
    expect(decoded.business.name).toBe('Tareez')
    expect(decoded.tech).toBeFalsy()
    expect(decoded.dueDate).toBe('')
  })
})
