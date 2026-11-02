/**
 * The one place an invoice is assembled.
 *
 * The receipt screen and the sale-complete screen each built their own copy of
 * this object, and the two renderers — the picture for WhatsApp and the PDF —
 * both draw from whatever they are handed. Duplicated, that meant a field added
 * for one of them is quietly missing from the other: the customer gets a
 * receipt with no due date while the copy on file has one.
 *
 * Everything here is read off the order, not off today's settings, wherever the
 * order can carry it itself. An invoice is a record of what was said to a
 * customer at the time, so changing a logo or a policy next month must not
 * rewrite what an old one looked like.
 */

import { invoiceBusiness, isTechOrder } from './domain.js'
import { money } from './format.js'

export function buildInvoiceData(order, state, { exhibitionName = '', customer = null } = {}) {
  const settings = state.settings
  const tech = isTechOrder(order)
  return {
    // Whichever business sold it is the one whose name and logo are on the paper.
    business: invoiceBusiness(settings, order),
    currencySymbol: settings.currencySymbol,
    currencyCode: settings.currency,
    bank: settings.bankDetails,
    design: settings.invoiceDesign || {},
    invoiceNo: order.invoiceNo,
    // A service invoice is often raised after the work, so it carries its own
    // issue date; the stall never does and falls back to the sale time.
    createdAt: order.issuedAt || order.createdAt,
    dueDate: order.dueDate || '',
    clientContact: order.clientContact || '',
    // Both of these are opt-in per invoice, so the stall's layout — which has
    // never shown either — is untouched.
    showVat: tech,
    showTagline: tech,
    exhibitionName,
    salespersonName: order.salespersonName,
    customerName: order.customerName,
    customerContact: [customer?.whatsapp || customer?.phone, customer?.email].filter(Boolean).join(' · '),
    items: order.items.map((item) => ({
      name: item.name,
      variant: [item.color, item.size].filter(Boolean).join(' / '),
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      listPrice: item.listPrice || 0,
    })),
    subtotal: order.subtotal,
    discountAmount: money(order.discountAmount + (order.lineDiscounts || 0)),
    promoCode: order.promoCode || '',
    promoAmount: order.promoAmount || 0,
    paymentParts: order.paymentParts?.length > 1 ? order.paymentParts : [],
    tax: order.tax,
    taxInclusive: settings.taxInclusive,
    taxRate: settings.taxRate,
    total: order.total,
    amountPaid: order.amountPaid,
    balanceDue: order.balanceDue,
    paymentMethod: order.paymentMethod,
    // The stall's returns policy is not a marketing invoice's terms, so a tech
    // invoice goes without rather than being told to return an ad campaign.
    terms: tech ? '' : settings.terms,
    footer: settings.receiptFooter,
    status: order.status,
  }
}
