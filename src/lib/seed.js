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
  paymentMethods: ['Cash', 'Card', 'Bank Transfer', 'Online Payment'],
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
    counters: { invoice: 1 },
    outbox: [],
    seededAt: new Date().toISOString(),
  }
}
