/** The starting dataset for a fresh install: settings and roles, nothing else. */

import { DEFAULT_ROLES } from './permissions.js'
/**
 * The Tareez wordmark.
 *
 * This arrives as a data URL, not a file path — `assetsInlineLimit` in
 * `vite.config.js` pins that, and the comment there explains why the rest of
 * the app cannot work with anything else.
 */
import TAREEZ_LOGO from '../assets/tareez-logo.png'

export { TAREEZ_LOGO }

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
    logo: TAREEZ_LOGO,
  },
  // A fresh install starts with the logo already in place, so the one-time
  // backfill in `migrate` has nothing left to do.
  logoSeeded: true,
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
    accent: '#021b8d',
    showLogo: true,
    showQr: true,
    showTaxBreakdown: true,
    showSalesperson: true,
    showExhibition: true,
    showCustomerContact: true,
    showTerms: true,
    paperSize: 'a4',
  },
  // Printed under "Account details" on the invoice. Empty lines are left off.
  bankDetails: { accountName: '', bank: '', accountNumber: '', iban: '' },
  paymentMethods: ['Cash', 'Card', 'Bank Transfer', 'Online Payment'],
  // Product categories the business has defined. Empty on a fresh install —
  // the catalogue names its own, nothing is invented here.
  categories: [],
  // Stitching services sold alongside the cloth: `{ id, name, price }`.
  // Added to a sale from the till, never stocked.
  stitching: [],
  /* -------------------------------------------------------- Tareez Tech */
  // The marketing arm: a second invoice identity, its own numbered series, and
  // its own list of services. Invoiced from the till like any other sale, but
  // nothing here is stocked and nothing here is charged to Tareez Fashion Ltd.
  // Contact details are deliberately blank — they are the company's to fill in,
  // and inventing a VAT number or an address would put it on a real invoice.
  techBusiness: {
    name: 'Tareez Tech',
    legalName: 'Tareez Tech',
    tagline: 'Marketing & Digital Services',
    phone: '',
    email: '',
    website: '',
    address: '',
    vatNumber: '',
    logo: '',
  },
  // `invoicePrefix` above belongs to the fashion side; a marketing invoice has
  // its own series so the two businesses never share a number line.
  techInvoicePrefix: 'TT',
  // Services the till can invoice: `{ id, name, price, note }`. Seeded at zero —
  // a price list is the business's to set, and the till lets any job be quoted
  // over the top of it anyway.
  techServices: [
    { id: 'tsc_web', name: 'Website development', price: 0, note: '' },
    { id: 'tsc_social', name: 'Social media management', price: 0, note: 'Monthly retainer' },
    { id: 'tsc_video', name: 'Video editing', price: 0, note: '' },
    { id: 'tsc_ads', name: 'Performance marketing (Meta Ads)', price: 0, note: 'Monthly management fee' },
  ],
  // Days from the issue date before a Tareez Tech invoice is late. The till
  // offers this as the default due date and the cashier can move it.
  techDueDays: 14,
  // The stall's consent line talks about collections and exhibitions, which is
  // not what a marketing client is opting into.
  techMarketingConsentText:
    'I would like Tareez Tech to contact me about campaigns, offers and events.',
  terms:
    'Items may be returned within 14 days with this receipt. Sale items and custom pieces are final. Thank you for supporting Tareez.',
  marketingConsentText:
    'I would like to hear from Tareez about new collections, exhibition invitations and offers.',
  receiptFooter: 'Thank you for visiting our stall — we hope to see you again.',
  signup: {
    enabled: true,
    defaultRole: 'salesperson',
    requireApproval: true,
  },
}

/**
 * A brand-new dataset: settings and roles only.
 *
 * Nothing is invented on the user's behalf — no accounts, no catalogue, no
 * sales history. The first thing the app can do with this is the first-run
 * signup, and everything after that is data somebody actually entered.
 */
export async function buildSeedState() {
  return {
    version: 2,
    settings: DEFAULT_SETTINGS,
    roles: DEFAULT_ROLES.map((role) => ({ ...role })),
    users: [],
    products: [],
    exhibitions: [],
    customers: [],
    promoCodes: [],
    orders: [],
    payments: [],
    returns: [],
    // Filled in by whichever devices actually sign in.
    devices: [],
    inventory: {},
    movements: [],
    auditLogs: [],
    notifications: [],
    // Ids this device has deleted, so a pull cannot put them back.
    tombstones: {},
    counters: { invoice: 1, techInvoice: 1 },
    outbox: [],
    seededAt: new Date().toISOString(),
  }
}

/**
 * The accounts the old demo dataset shipped with.
 *
 * Kept only so `migrate` can recognise a browser still holding that dataset and
 * clear it. Nothing creates these any more — see the boot path in `store.jsx`.
 */
export const DEMO_ACCOUNT_EMAILS = [
  'ali@tareez.com',
  'sarah@tareez.com',
  'ahmed@tareez.com',
  'layla@tareez.com',
]

/**
 * The names those accounts carried.
 *
 * Matched as well as the emails because an admin could have edited a demo
 * account's address on the old build — the dataset is still the demo one, and
 * an email-only check would leave it in place.
 */
export const DEMO_ACCOUNT_NAMES = [
  'ali rahman',
  'sarah bennett',
  'ahmed khan',
  'layla hassan',
]

/** True if `state` came from the demo seed rather than from anyone's real use. */
export function isDemoDataset(state) {
  return (state?.users || []).some(
    (user) =>
      DEMO_ACCOUNT_EMAILS.includes(String(user?.email || '').toLowerCase()) ||
      DEMO_ACCOUNT_NAMES.includes(String(user?.name || '').trim().toLowerCase()),
  )
}
