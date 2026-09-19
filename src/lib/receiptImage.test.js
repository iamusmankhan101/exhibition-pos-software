/**
 * The receipt renderer draws blind — there is no DOM in CI and no eye on the
 * result — so these tests stub a 2D context and assert on what was drawn: that
 * the whole sequence completes, that the canvas is cropped to the content, and
 * that the numbers a customer would query actually appear on the slip.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const drawn = { text: [], images: 0, height: 0 }

function stubContext() {
  return {
    scale: vi.fn(),
    fillRect: vi.fn(),
    fillText: (text) => drawn.text.push(String(text)),
    measureText: (text) => ({ width: String(text).length * 7 }),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    drawImage: () => {
      drawn.images += 1
    },
  }
}

beforeEach(() => {
  drawn.text = []
  drawn.images = 0
  drawn.height = 0

  globalThis.document = {
    createElement: (tag) => {
      if (tag !== 'canvas') throw new Error(`unexpected element: ${tag}`)
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => stubContext(),
        toBlob: (cb) => {
          drawn.height = canvas.height
          cb({ type: 'image/png', size: 1024 })
        },
      }
      return canvas
    },
  }

  globalThis.navigator = globalThis.navigator || {}

  // A data URL never actually decodes here, so the load is resolved by hand.
  globalThis.Image = class {
    set src(value) {
      this._src = value
      queueMicrotask(() => (value ? this.onload?.() : this.onerror?.()))
    }

    get src() {
      return this._src
    }

    width = 200
    height = 100
  }
})

afterEach(() => {
  delete globalThis.document
  delete globalThis.Image
})

const { buildReceiptImage, copyReceiptImage } = await import('./receiptImage.js')

const data = {
  business: { name: 'Tareez Tech', phone: '+92 300 1234567', address: '18 Marylebone Lane', logo: 'data:image/png;base64,AAA' },
  currencySymbol: 'Rs ',
  design: { accent: '#021b8d' },
  invoiceNo: 'TRZ-260907-WQ005',
  createdAt: '2026-09-07T12:09:00.000Z',
  exhibitionName: 'DHA Exhibition',
  salespersonName: 'Ahmed',
  customerName: 'Usman',
  items: [
    { name: 'Embroidered Scarf', variant: 'Black / One Size', quantity: 2, unitPrice: 2000, listPrice: 2500 },
    { name: 'Silk Abaya', variant: 'Navy / M', quantity: 1, unitPrice: 1500, listPrice: 0 },
  ],
  subtotal: 5500,
  discountAmount: 0,
  promoAmount: 0,
  tax: 0,
  taxRate: 0,
  total: 5500,
  amountPaid: 5500,
  balanceDue: 0,
  status: 'Completed',
  paymentMethod: 'Cash',
  paymentParts: [],
  terms: 'Items may be returned within 14 days with this receipt.',
  footer: 'Thank you for visiting our stall.',
}

describe('buildReceiptImage', () => {
  // Letter-spaced headings are drawn a character at a time, so read the page
  // back with every fragment joined as well as one per line.
  const everything = () => `${drawn.text.join('\n')}\n${drawn.text.join('')}`

  it('draws the invoice and returns a PNG blob', async () => {
    const blob = await buildReceiptImage(data)
    expect(blob.type).toBe('image/png')
  })

  it('carries every figure a customer would check', async () => {
    await buildReceiptImage({ ...data, currencyCode: 'PKR' })
    const text = everything()

    expect(text).toContain('INVOICE')
    expect(text).toContain('TRZ-260907-WQ005')
    expect(text).toContain('USMAN')
    expect(text).toContain('EMBROIDERED SCARF × 2')
    expect(text).toContain('SILK ABAYA')
    expect(text).toContain('TOTAL')
    // Unit price, line total for 2 × 2000, subtotal with the code, and the total.
    expect(drawn.text).toContain('2000')
    expect(drawn.text).toContain('4000')
    expect(drawn.text).toContain('PKR 5500')
    expect(drawn.text).toContain('5500')
    expect(text).toContain('was 2500')
    expect(text).toContain('Thank you!')
  })

  it('prints the bank details and the from block', async () => {
    await buildReceiptImage({
      ...data,
      business: { ...data.business, legalName: 'Tareez Fashion' },
      bank: { accountName: 'A M SHEIKH', bank: 'Meezan Bank', accountNumber: '0283', iban: 'PK75MEZN' },
    })
    const text = everything()
    expect(text).toContain('Tareez Fashion')
    expect(text).toContain('ACCOUNT DETAILS:')
    expect(text).toContain('Account Number: 0283')
    expect(text).toContain('IBAN: PK75MEZN')
  })

  it('stays A4 for a short sale and grows for a long one', async () => {
    await buildReceiptImage(data)
    const short = drawn.height

    drawn.text = []
    await buildReceiptImage({ ...data, items: Array.from({ length: 14 }, () => data.items[0]) })

    expect(short).toBe(297 * 5)
    expect(drawn.height).toBeGreaterThan(short)
  })

  it('renders without a logo rather than failing', async () => {
    const blob = await buildReceiptImage({ ...data, business: { ...data.business, logo: null } })
    expect(blob.type).toBe('image/png')
    expect(drawn.images).toBe(0)
  })

  it('places the logo when there is one', async () => {
    await buildReceiptImage(data)
    expect(drawn.images).toBeGreaterThanOrEqual(1)
  })

  it('shows a balance still owed', async () => {
    await buildReceiptImage({ ...data, amountPaid: 3000, balanceDue: 2500, status: 'Partially Paid' })
    const text = everything()
    expect(text).toContain('Balance due')
    expect(drawn.text).toContain('2500')
    expect(text).toContain('PARTIALLY PAID')
  })
})

describe('copyReceiptImage', () => {
  it('hands the clipboard the pending promise, not an awaited blob', async () => {
    let received = null
    globalThis.ClipboardItem = class {
      constructor(items) {
        received = items['image/png']
      }
    }
    globalThis.navigator.clipboard = { write: vi.fn().mockResolvedValue(undefined) }

    const pending = Promise.resolve({ type: 'image/png' })
    await expect(copyReceiptImage(pending)).resolves.toBe(true)
    // Safari drops the user gesture if the blob is awaited first, so what goes
    // into ClipboardItem must still be the promise itself.
    expect(received).toBe(pending)

    delete globalThis.ClipboardItem
  })

  it('reports false when the clipboard refuses instead of throwing', async () => {
    globalThis.ClipboardItem = class {}
    globalThis.navigator.clipboard = { write: vi.fn().mockRejectedValue(new Error('denied')) }

    await expect(copyReceiptImage(Promise.resolve({}))).resolves.toBe(false)
    delete globalThis.ClipboardItem
  })
})
