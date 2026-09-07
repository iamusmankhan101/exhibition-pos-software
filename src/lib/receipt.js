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
    // The list price is only carried when the stall charged something else, so
    // a receipt with no special pricing costs no extra fragment bytes.
    it: order.items.map((item) => {
      const row = [item.name, `${item.color || ''}${item.size ? ` / ${item.size}` : ''}`, item.quantity, item.unitPrice]
      if (item.listPrice > item.unitPrice) row.push(item.listPrice)
      return row
    }),
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
      items: (data.it || []).map(([name, variant, quantity, unitPrice, listPrice]) => ({
        name,
        variant,
        quantity,
        unitPrice,
        listPrice: listPrice || 0,
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

/**
 * The covering note. `url` is optional: when the receipt travels as an attached
 * PDF there is nothing to link to, and the encoded link is long enough to swamp
 * the message on its own.
 */
export function receiptMessage(order, settings, url) {
  const symbol = settings.currencySymbol
  const total = `${symbol}${Number(order.total).toFixed(2)}`
  return [
    `Thank you for shopping with ${settings.business.name}!`,
    '',
    `Invoice: ${order.invoiceNo}`,
    `Date: ${formatDate(order.createdAt, true)}`,
    `Total: ${total} (${order.paymentMethod})`,
    ...(url ? ['', `View your receipt: ${url}`] : []),
  ].join('\n')
}

/** Whether this browser can push a file into the OS share sheet at all. */
export function canShareFiles() {
  if (typeof navigator === 'undefined' || !navigator.canShare) return false
  try {
    return navigator.canShare({
      files: [new File(['x'], 'probe.pdf', { type: 'application/pdf' })],
    })
  } catch {
    return false
  }
}

/**
 * Whether the share sheet on this device can actually reach WhatsApp.
 *
 * Sharing a file and sharing it *to WhatsApp* are different questions, and only
 * the second one matters here. macOS Safari answers the first happily — the
 * sheet opens with AirDrop, Mail and Messages — but WhatsApp Desktop registers
 * no macOS share extension, so it never appears in that list and the receipt
 * goes nowhere. Only a phone or tablet share sheet carries WhatsApp, so
 * everything else takes the download-and-attach route instead.
 */
export function canShareToWhatsApp() {
  if (!canShareFiles()) return false
  if (navigator.userAgentData?.mobile) return true
  const ua = navigator.userAgent || ''
  // iPadOS Safari claims to be a Mac; the touch points give it away.
  const iPad = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1
  return /Android|iPhone|iPad|iPod/i.test(ua) || iPad
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

/**
 * Opens the customer's chat.
 *
 * The `whatsapp://` scheme hands straight to the installed app — the desktop
 * client or the phone one — and leaves the till exactly where it is. `wa.me`
 * would instead open a browser tab that only asks whether to open the app, so
 * the tab is pure overhead and it strands the salesperson away from the POS.
 *
 * Pass `web: true` for the link version, which is the one to use when the app
 * may not be installed at all.
 */
export function sendWhatsApp(number, text, { web = false } = {}) {
  const to = digitsOnly(number)
  if (!to) return false
  const body = encodeURIComponent(text)
  if (web) {
    window.open(`https://wa.me/${to}?text=${body}`, '_blank', 'noopener')
  } else {
    // Not `window.open`: a custom scheme in a new tab leaves a blank one behind.
    window.location.href = `whatsapp://send?phone=${to}&text=${body}`
  }
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
