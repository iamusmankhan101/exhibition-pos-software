/**
 * Receipt building and delivery.
 *
 * A receipt link carries a compact, self-contained payload in the URL fragment
 * so a customer who scans the QR code or opens the WhatsApp link sees the real
 * receipt on their own phone without this build needing a server. Oversized
 * orders fall back to an id-only link that resolves against local data.
 */

import QRCode from 'qrcode'
import { formatDate } from './format.js'

const MAX_FRAGMENT = 1800

function toBase64Url(text) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte)
  })
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text) {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded + '==='.slice((padded.length + 3) % 4))
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/** Minimal wire format — short keys keep the QR code scannable. */
export function encodeReceipt(order, settings, exhibitionName, customer) {
  const design = settings.invoiceDesign || {}
  const payload = {
    v: 1,
    b: settings.business.name,
    bt: settings.business.tagline,
    bp: settings.business.phone,
    be: settings.business.email,
    ba: settings.business.address,
    bv: settings.business.vatNumber,
    cur: settings.currencySymbol,
    inv: order.invoiceNo,
    dt: order.createdAt,
    ex: exhibitionName,
    sp: order.salespersonName,
    cu: order.customerName,
    cc: design.showCustomerContact === false ? '' : [customer?.whatsapp || customer?.phone, customer?.email].filter(Boolean).join(' · '),
    it: order.items.map((item) => [item.name, `${item.color || ''}${item.size ? ` / ${item.size}` : ''}`, item.quantity, item.unitPrice]),
    sub: order.subtotal,
    dis: order.discountAmount,
    // Promo and split-payment fields are omitted when they do not apply — the
    // whole payload has to fit in a URL fragment.
    ...(order.promoAmount > 0 ? { pc: order.promoCode, pa: order.promoAmount } : {}),
    ...(order.paymentParts?.length > 1
      ? { pp: order.paymentParts.map((part) => [part.method, part.amount]) }
      : {}),
    tax: order.tax,
    ti: settings.taxInclusive,
    tr: settings.taxRate,
    tot: order.total,
    ap: order.amountPaid,
    bd: order.balanceDue,
    st: order.status,
    pm: order.paymentMethod,
    tc: settings.terms,
    ft: settings.receiptFooter,
    dz: design,
  }
  return toBase64Url(JSON.stringify(payload))
}

export function decodeReceipt(encoded) {
  try {
    const data = JSON.parse(fromBase64Url(encoded))
    if (data?.v !== 1) return null
    return {
      business: {
        name: data.b,
        tagline: data.bt,
        phone: data.bp,
        email: data.be,
        address: data.ba,
        vatNumber: data.bv,
      },
      currencySymbol: data.cur,
      invoiceNo: data.inv,
      createdAt: data.dt,
      exhibitionName: data.ex,
      salespersonName: data.sp,
      customerName: data.cu,
      customerContact: data.cc || '',
      items: (data.it || []).map(([name, variant, quantity, unitPrice]) => ({
        name,
        variant,
        quantity,
        unitPrice,
      })),
      subtotal: data.sub,
      discountAmount: data.dis,
      promoCode: data.pc || '',
      promoAmount: data.pa || 0,
      paymentParts: (data.pp || []).map(([method, amount]) => ({ method, amount })),
      tax: data.tax,
      taxInclusive: data.ti,
      taxRate: data.tr,
      total: data.tot,
      amountPaid: data.ap,
      balanceDue: data.bd,
      status: data.st,
      paymentMethod: data.pm,
      terms: data.tc,
      footer: data.ft,
      design: data.dz || {},
    }
  } catch {
    return null
  }
}

export function receiptUrl(order, settings, exhibitionName, customer) {
  const base = window.location.origin
  const encoded = encodeReceipt(order, settings, exhibitionName, customer)
  if (encoded.length <= MAX_FRAGMENT) return `${base}/r/${order.id}#d=${encoded}`
  return `${base}/r/${order.id}`
}

export function receiptMessage(order, settings, url) {
  const symbol = settings.currencySymbol
  const total = `${symbol}${Number(order.total).toFixed(2)}`
  return [
    `Thank you for shopping with ${settings.business.name}!`,
    '',
    `Invoice: ${order.invoiceNo}`,
    `Date: ${formatDate(order.createdAt, true)}`,
    `Total: ${total} (${order.paymentMethod})`,
    '',
    `View your receipt: ${url}`,
  ].join('\n')
}

export async function receiptQr(url) {
  return QRCode.toDataURL(url, {
    errorCorrectionLevel: 'L',
    margin: 1,
    width: 320,
    color: { dark: '#16181dff', light: '#ffffffff' },
  })
}

const digitsOnly = (value) => String(value || '').replace(/[^\d]/g, '')

export function sendWhatsApp(number, text) {
  const to = digitsOnly(number)
  if (!to) return false
  window.open(`https://wa.me/${to}?text=${encodeURIComponent(text)}`, '_blank', 'noopener')
  return true
}

export function sendSms(number, text) {
  const to = String(number || '').replace(/\s/g, '')
  if (!to) return false
  // iOS wants `&body=`, Android accepts `?body=`; this form works on both.
  window.location.href = `sms:${to}${/iPhone|iPad|Mac/.test(navigator.userAgent) ? '&' : '?'}body=${encodeURIComponent(text)}`
  return true
}

export function sendEmail(email, subject, body) {
  if (!email) return false
  window.location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
  return true
}

/** Native share sheet where available (iOS/Android), else clipboard. */
export async function shareOrCopy(title, text, url) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url })
      return 'shared'
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled'
    }
  }
  try {
    await navigator.clipboard.writeText(url)
    return 'copied'
  } catch {
    return 'failed'
  }
}
