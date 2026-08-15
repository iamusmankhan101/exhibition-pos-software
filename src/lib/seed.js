/** Demo dataset so the system is usable the moment it is opened. */

import { MAIN_LOCATION, money, uid } from './format.js'
import { MOVEMENT_TYPES, applyStockChange, createOrder, getStock, transferStock } from './domain.js'

export const DEFAULT_SETTINGS = {
  business: {
    name: 'Tareez',
    legalName: 'Tareez Fashion Ltd',
    tagline: 'Handcrafted modest fashion',
    phone: '+44 20 7946 0112',
    email: 'hello@tareez.com',
    website: 'tareez.com',
    address: '18 Marylebone Lane, London W1U 2NF',
    vatNumber: 'GB 341 8827 55',
    logo: null,
  },
  currency: 'GBP',
  currencySymbol: '£',
  taxEnabled: true,
  taxRate: 20,
  taxInclusive: true,
  invoicePrefix: 'TRZ',
  lowStockThreshold: 3,
  allowOverselling: false,
  requireCustomerOnSale: false,
  maxDiscountPercent: 15,
  largeDiscountAlertPercent: 25,
  receiptChannels: { whatsapp: true, sms: true, email: true, qr: true },
  invoiceDesign: {
    accent: '#0d9e59',
    showLogo: true,
    showQr: true,
    showTaxBreakdown: true,
    showSalesperson: true,
    showExhibition: true,
    showCustomerContact: true,
    showTerms: true,
    paperSize: 'a4',
  },
  paymentMethods: ['Cash', 'Card', 'Bank Transfer', 'Online Payment'],
  terms:
    'Items may be returned within 14 days with this receipt. Sale items and custom pieces are final. Thank you for supporting Tareez.',
  marketingConsentText:
    'I would like to hear from Tareez about new collections, exhibition invitations and offers.',
  receiptFooter: 'Thank you for visiting our stall — we hope to see you again.',
}

const CATEGORIES = ['Scarves', 'Abayas', 'Dresses', 'Kaftans', 'Accessories']

let barcodeSeed = 5060421000000

function barcode() {
  barcodeSeed += 137
  return String(barcodeSeed)
}

function makeProduct(name, category, collection, price, cost, variants) {
  const base = name
    .split(/\s+/)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
    .slice(0, 3)
  return {
    id: uid('prd'),
    name,
    category,
    collection,
    description: `${collection} collection · ${category.toLowerCase()}`,
    status: 'Active',
    image: null,
    createdAt: new Date().toISOString(),
    variants: variants.map((variant, index) => ({
      id: uid('var'),
      sku: `T${base}-${(variant.color || 'STD').slice(0, 3).toUpperCase()}-${String(index + 1).padStart(3, '0')}`,
      barcode: barcode(),
      size: variant.size || 'One Size',
      color: variant.color || 'Natural',
      price: money(variant.price ?? price),
      cost: money(variant.cost ?? cost),
      minStock: 3,
    })),
  }
}

const PRODUCT_BLUEPRINT = [
  ['Black Silk Scarf', 'Scarves', 'Heritage', 68, 22, [{ color: 'Black' }, { color: 'Ivory' }, { color: 'Sand' }]],
  ['Embroidered Pashmina', 'Scarves', 'Heritage', 95, 34, [{ color: 'Deep Teal' }, { color: 'Rose' }]],
  ['Gold Thread Shawl', 'Scarves', 'Bridal', 145, 52, [{ color: 'Champagne' }, { color: 'Midnight' }]],
  ['Chiffon Hijab', 'Scarves', 'Everyday', 24, 7, [{ color: 'Dusty Pink' }, { color: 'Olive' }, { color: 'Charcoal' }, { color: 'Cream' }]],
  [
    'Linen Wrap Abaya',
    'Abayas',
    'Summer Nights',
    210,
    78,
    [
      { color: 'Stone', size: 'S' },
      { color: 'Stone', size: 'M' },
      { color: 'Stone', size: 'L' },
      { color: 'Black', size: 'M' },
      { color: 'Black', size: 'L' },
    ],
  ],
  [
    'Pearl Cuff Abaya',
    'Abayas',
    'Bridal',
    340,
    124,
    [
      { color: 'Ivory', size: 'S' },
      { color: 'Ivory', size: 'M' },
      { color: 'Ivory', size: 'L' },
    ],
  ],
  [
    'Tiered Maxi Dress',
    'Dresses',
    'Summer Nights',
    185,
    64,
    [
      { color: 'Terracotta', size: 'S' },
      { color: 'Terracotta', size: 'M' },
      { color: 'Sage', size: 'M' },
      { color: 'Sage', size: 'L' },
    ],
  ],
  [
    'Satin Slip Dress',
    'Dresses',
    'Summer Nights',
    155,
    54,
    [
      { color: 'Emerald', size: 'S' },
      { color: 'Emerald', size: 'M' },
      { color: 'Bronze', size: 'M' },
    ],
  ],
  [
    'Hand-Beaded Kaftan',
    'Kaftans',
    'Heritage',
    265,
    96,
    [
      { color: 'Indigo', size: 'One Size' },
      { color: 'Saffron', size: 'One Size' },
    ],
  ],
  [
    'Cotton Lounge Kaftan',
    'Kaftans',
    'Everyday',
    120,
    41,
    [
      { color: 'White', size: 'M' },
      { color: 'White', size: 'L' },
      { color: 'Sky', size: 'M' },
    ],
  ],
  ['Beaded Clutch', 'Accessories', 'Bridal', 88, 29, [{ color: 'Gold' }, { color: 'Silver' }]],
  ['Leather Belt', 'Accessories', 'Everyday', 45, 14, [{ color: 'Tan', size: 'S/M' }, { color: 'Black', size: 'M/L' }]],
  ['Silk Scrunchie Set', 'Accessories', 'Everyday', 18, 5, [{ color: 'Mixed' }]],
  ['Hijab Magnet Pins', 'Accessories', 'Everyday', 12, 3, [{ color: 'Rose Gold' }, { color: 'Pearl' }]],
]

const FIRST_NAMES = [
  'Amina', 'Layla', 'Zara', 'Fatima', 'Noor', 'Hana', 'Yasmin', 'Sofia', 'Maryam', 'Aisha',
  'Emma', 'Charlotte', 'Priya', 'Leila', 'Rania', 'Sara', 'Dina', 'Nadia', 'Iman', 'Salma',
]
const LAST_NAMES = [
  'Hassan', 'Khan', 'Ahmed', 'Patel', 'Bennett', 'Iqbal', 'Rahman', 'Osman', 'Choudhury',
  'Farah', 'Malik', 'Shah', 'Ali', 'Yusuf', 'Karim',
]

function randomFrom(list) {
  return list[Math.floor(Math.random() * list.length)]
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function makeCustomer(index) {
  const name = `${FIRST_NAMES[index % FIRST_NAMES.length]} ${randomFrom(LAST_NAMES)}`
  const digits = `7${randomInt(100000000, 999999999)}`
  return {
    id: uid('cus'),
    name,
    phone: `+44 ${digits.slice(0, 4)} ${digits.slice(4)}`,
    whatsapp: `+44 ${digits.slice(0, 4)} ${digits.slice(4)}`,
    email: `${name.split(' ')[0].toLowerCase()}.${randomInt(10, 99)}@example.com`,
    marketingConsent: Math.random() > 0.35,
    consentAt: new Date().toISOString(),
    notes: '',
    totalOrders: 0,
    totalSpend: 0,
    lastPurchaseAt: null,
    exhibitionIds: [],
    createdAt: new Date().toISOString(),
  }
}

export function buildSeedState() {
  const now = new Date()
  const iso = (offsetDays, hour = 12, minute = 0) => {
    const date = new Date(now)
    date.setDate(date.getDate() + offsetDays)
    date.setHours(hour, minute, 0, 0)
    return date.toISOString()
  }

  const users = [
    {
      id: uid('usr'),
      name: 'Ali Rahman',
      email: 'ali@tareez.com',
      phone: '+44 7700 900110',
      role: 'admin',
      pin: '1111',
      active: true,
      maxDiscountPercent: 100,
      createdAt: iso(-90),
    },
    {
      id: uid('usr'),
      name: 'Sarah Bennett',
      email: 'sarah@tareez.com',
      phone: '+44 7700 900221',
      role: 'manager',
      pin: '2222',
      active: true,
      maxDiscountPercent: 30,
      createdAt: iso(-80),
    },
    {
      id: uid('usr'),
      name: 'Ahmed Khan',
      email: 'ahmed@tareez.com',
      phone: '+44 7700 900332',
      role: 'salesperson',
      pin: '3333',
      active: true,
      maxDiscountPercent: 15,
      createdAt: iso(-60),
    },
    {
      id: uid('usr'),
      name: 'Layla Hassan',
      email: 'layla@tareez.com',
      phone: '+44 7700 900443',
      role: 'salesperson',
      pin: '4444',
      active: true,
      maxDiscountPercent: 10,
      createdAt: iso(-30),
    },
  ]

  const products = PRODUCT_BLUEPRINT.map((entry) => makeProduct(...entry))

  const exhibitions = [
    {
      id: uid('exh'),
      name: 'London Fashion Exhibition',
      location: 'Olympia London, Hammersmith Rd',
      startDate: iso(-6, 9),
      endDate: iso(2, 18),
      status: 'Active',
      staffIds: [users[1].id, users[2].id, users[3].id],
      notes: 'Stand B14 — main hall.',
      closedAt: null,
      closingReport: null,
      createdAt: iso(-20),
    },
    {
      id: uid('exh'),
      name: 'Dubai Modest Fashion Week',
      location: 'Dubai World Trade Centre',
      startDate: iso(24, 10),
      endDate: iso(28, 20),
      status: 'Upcoming',
      staffIds: [users[2].id],
      notes: '',
      closedAt: null,
      closingReport: null,
      createdAt: iso(-6),
    },
    {
      id: uid('exh'),
      name: 'Manchester Craft Market',
      location: 'Manchester Central',
      startDate: iso(-40, 9),
      endDate: iso(-37, 18),
      status: 'Completed',
      staffIds: [users[3].id],
      notes: 'Closed and reconciled.',
      closedAt: iso(-37, 19),
      closingReport: null,
      createdAt: iso(-52),
    },
  ]

  const customers = Array.from({ length: 18 }, (_, index) => makeCustomer(index))

  let state = {
    version: 1,
    settings: DEFAULT_SETTINGS,
    users,
    products,
    exhibitions,
    customers,
    orders: [],
    payments: [],
    inventory: {},
    movements: [],
    auditLogs: [],
    notifications: [],
    counters: { invoice: 1 },
    outbox: [],
    seededAt: new Date().toISOString(),
  }

  // Warehouse intake.
  for (const product of products) {
    for (const variant of product.variants) {
      state = applyStockChange(state, {
        locationId: MAIN_LOCATION,
        variantId: variant.id,
        delta: randomInt(28, 60),
        type: MOVEMENT_TYPES.INTAKE,
        reference: 'Opening stock',
        userId: users[0].id,
      })
    }
  }

  // Allocate stock to the active and completed exhibitions.
  for (const product of products) {
    for (const variant of product.variants) {
      state = transferStock(state, {
        variantId: variant.id,
        fromLocation: MAIN_LOCATION,
        toLocation: exhibitions[0].id,
        quantity: randomInt(10, 20),
        userId: users[0].id,
      })
      state = transferStock(state, {
        variantId: variant.id,
        fromLocation: MAIN_LOCATION,
        toLocation: exhibitions[2].id,
        quantity: randomInt(2, 5),
        userId: users[0].id,
      })
    }
  }

  // Spread across the full run of the exhibition so the trend chart is meaningful.
  state = generateDemoSales(state, exhibitions[0], users.slice(1), customers, { count: 92, days: 7 })
  state = generateDemoSales(state, exhibitions[2], [users[3]], customers, {
    count: 22,
    days: 3,
    dayOffset: -40,
  })

  return state
}

function generateDemoSales(state, exhibition, staff, customers, { count, days, dayOffset = 0 }) {
  const methods = ['Cash', 'Card', 'Card', 'Card', 'Bank Transfer', 'Online Payment']
  let next = state

  for (let i = 0; i < count; i += 1) {
    const sellable = next.products
      .flatMap((product) => product.variants.map((variant) => ({ product, variant })))
      .filter((entry) => getStock(next, exhibition.id, entry.variant.id) > 1)
    if (!sellable.length) break

    const lineCount = randomInt(1, 3)
    const picked = []
    for (let line = 0; line < lineCount; line += 1) {
      const entry = randomFrom(sellable)
      if (picked.some((item) => item.variantId === entry.variant.id)) continue
      const available = getStock(next, exhibition.id, entry.variant.id)
      const quantity = Math.min(randomInt(1, 2), available)
      if (quantity < 1) continue
      picked.push({
        productId: entry.product.id,
        variantId: entry.variant.id,
        name: entry.product.name,
        sku: entry.variant.sku,
        size: entry.variant.size,
        color: entry.variant.color,
        image: entry.product.image,
        quantity,
        unitPrice: entry.variant.price,
        lineDiscount: 0,
      })
    }
    if (!picked.length) continue

    const walkIn = Math.random() < 0.3
    const customer = walkIn ? null : randomFrom(customers)
    const staffMember = randomFrom(staff)
    const discountRoll = Math.random()
    const discount =
      discountRoll > 0.75
        ? { type: 'percentage', value: randomFrom([5, 10, 10, 15]) }
        : { type: 'percentage', value: 0 }

    const dayBack = dayOffset - randomInt(0, days - 1)
    const created = new Date()
    created.setDate(created.getDate() + dayBack)
    created.setHours(randomInt(10, 18), randomInt(0, 59), randomInt(0, 59), 0)

    try {
      const result = createOrder(next, {
        clientId: uid('cli'),
        exhibitionId: exhibition.id,
        customerId: customer?.id || null,
        customerName: customer?.name || 'Walk-in Customer',
        salespersonId: staffMember.id,
        salespersonName: staffMember.name,
        items: picked,
        discount,
        paymentMethod: randomFrom(methods),
        deviceCode: randomFrom(['A1', 'B2']),
        createdAt: created.toISOString(),
      })
      next = result.state
    } catch {
      // Skip a sale that would oversell; the demo data does not need to be exact.
    }
  }

  // Sort chronologically (newest first) so the sales list looks natural.
  next = { ...next, orders: [...next.orders].sort((a, b) => b.createdAt.localeCompare(a.createdAt)) }
  return next
}
