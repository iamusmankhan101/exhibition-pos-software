/**
 * The receipt as a picture.
 *
 * A browser cannot put a file into WhatsApp Desktop — no share extension, and
 * `wa.me` carries text only. It *can* put an image on the clipboard, and every
 * chat app accepts a pasted image, so this is the one route that gets a real
 * receipt into a desktop conversation.
 *
 * Rendered on a canvas rather than through jsPDF: nothing here rasterises a PDF,
 * and an image that previews inline in the chat is what a customer actually
 * wants to look at. The layout is a tall receipt slip rather than the A4 invoice
 * — it is read on a phone, in a message bubble.
 *
 * `data` is the same shape `buildInvoicePdf` takes, so both stay in step.
 */

import { formatDate } from './format.js'

const W = 700 // logical width; the canvas is rendered at 2× for a crisp paste
const SCALE = 2
const PAD = 36
const INK = '#14171c'
const MUTED = '#6f7784'
const FAINT = '#8c939e'
const LINE = '#e7e9ee'

const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'
const font = (size, weight = 400) => `${weight} ${size}px ${FONT}`

/** Data URLs only — no network fetch, so nothing here can hang on bad wifi. */
function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null)
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = src
    return undefined
  })
}

export async function buildReceiptImage(data, qrDataUrl) {
  const design = data.design || {}
  const accent = design.accent || '#021b8d'
  const money = (value) =>
    `${data.currencySymbol}${Number(value || 0).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`

  const [logo, qr] = await Promise.all([
    design.showLogo !== false ? loadImage(data.business.logo) : null,
    design.showQr !== false ? loadImage(qrDataUrl) : null,
  ])

  // Drawn tall and cropped to the ink at the end, which avoids a second
  // measuring pass over a layout that changes with every basket.
  const canvas = document.createElement('canvas')
  canvas.width = W * SCALE
  canvas.height = 4200 * SCALE
  const ctx = canvas.getContext('2d')
  ctx.scale(SCALE, SCALE)
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, 4200)

  const right = W - PAD
  let y = 0

  const write = (text, x, { size = 14, weight = 400, color = INK, align = 'left' } = {}) => {
    ctx.font = font(size, weight)
    ctx.fillStyle = color
    ctx.textAlign = align
    ctx.fillText(String(text ?? ''), x, y)
    ctx.textAlign = 'left'
  }

  /** Greedy wrap, returning the lines so the caller controls the spacing. */
  const wrap = (text, maxWidth, size, weight = 400) => {
    ctx.font = font(size, weight)
    const words = String(text || '').split(/\s+/).filter(Boolean)
    const lines = []
    let line = ''
    for (const word of words) {
      const next = line ? `${line} ${word}` : word
      if (ctx.measureText(next).width > maxWidth && line) {
        lines.push(line)
        line = word
      } else {
        line = next
      }
    }
    if (line) lines.push(line)
    return lines
  }

  const rule = (color = LINE) => {
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(PAD, y + 0.5)
    ctx.lineTo(right, y + 0.5)
    ctx.stroke()
  }

  /* ------------------------------------------------------------ header */

  ctx.fillStyle = accent
  ctx.fillRect(0, 0, W, 8)
  y = 8 + PAD

  if (logo) {
    // The wordmark is roughly 2:1; a square box would squash it.
    const scale = Math.min(150 / logo.width, 56 / logo.height)
    ctx.drawImage(logo, PAD, y, logo.width * scale, logo.height * scale)
    y += logo.height * scale + 22
  }

  y += 10
  write(data.business.name || '', PAD, { size: 26, weight: 700 })
  write('RECEIPT', right, { size: 15, weight: 700, color: accent, align: 'right' })
  y += 24

  const contact = [data.business.phone, data.business.email].filter(Boolean).join('  ·  ')
  if (contact) {
    write(contact, PAD, { size: 12.5, color: MUTED })
    y += 18
  }
  if (data.business.address) {
    for (const line of wrap(data.business.address, W - PAD * 2, 12.5)) {
      write(line, PAD, { size: 12.5, color: MUTED })
      y += 17
    }
  }

  y += 12
  rule()
  y += 26

  /* -------------------------------------------------------------- meta */

  const meta = [
    ['Invoice', data.invoiceNo],
    ['Date', formatDate(data.createdAt, true)],
    ['Billed to', data.customerName || 'Walk-in Customer'],
  ]
  if (design.showExhibition !== false && data.exhibitionName) meta.push(['Exhibition', data.exhibitionName])
  if (design.showSalesperson !== false && data.salespersonName) meta.push(['Served by', data.salespersonName])
  meta.push(['Payment', data.paymentMethod || ''])

  for (const [label, value] of meta) {
    write(label.toUpperCase(), PAD, { size: 10.5, weight: 600, color: FAINT })
    write(value, right, { size: 13.5, weight: 600, align: 'right' })
    y += 26
  }

  if (data.status && data.status !== 'Completed') {
    y += 2
    write(String(data.status).toUpperCase(), right, { size: 13, weight: 700, color: '#c8463c', align: 'right' })
    y += 24
  }

  y += 6
  rule()
  y += 26

  /* ------------------------------------------------------------- items */

  write('ITEM', PAD, { size: 10.5, weight: 600, color: FAINT })
  write('QTY', right - 150, { size: 10.5, weight: 600, color: FAINT, align: 'right' })
  write('TOTAL', right, { size: 10.5, weight: 600, color: FAINT, align: 'right' })
  y += 12
  rule()
  y += 26

  for (const item of data.items) {
    const nameLines = wrap(item.name, W - PAD * 2 - 190, 14.5, 600)
    const top = y
    for (const line of nameLines) {
      write(line, PAD, { size: 14.5, weight: 600 })
      y += 20
    }

    const discounted = item.listPrice > item.unitPrice
    const sub = [item.variant, `${money(item.unitPrice)} each`, discounted ? `was ${money(item.listPrice)}` : '']
      .filter(Boolean)
      .join('  ·  ')
    if (sub) {
      write(sub, PAD, { size: 12, color: MUTED })
      y += 19
    }

    // Quantity and line total sit against the item's first line.
    const back = y
    y = top
    write(String(item.quantity), right - 150, { size: 14.5, align: 'right' })
    write(money(item.quantity * item.unitPrice), right, { size: 14.5, weight: 700, align: 'right' })
    y = back

    y += 8
    rule('#f0f2f5')
    y += 20
  }

  /* ------------------------------------------------------------ totals */

  y += 4
  const totalLine = (label, value, { size = 14, weight = 400, color = MUTED, valueColor = INK } = {}) => {
    write(label, right - 200, { size, weight, color })
    write(value, right, { size, weight: 700, color: valueColor, align: 'right' })
    y += 26
  }

  totalLine('Subtotal', money(data.subtotal))
  if (data.discountAmount > 0) totalLine('Discount', `-${money(data.discountAmount)}`)
  if (data.promoAmount > 0) totalLine(`Promo ${data.promoCode || ''}`.trim(), `-${money(data.promoAmount)}`)
  if (design.showTaxBreakdown !== false && data.tax > 0) {
    totalLine(`VAT ${data.taxRate}%${data.taxInclusive ? ' (incl.)' : ''}`, money(data.tax))
  }

  y += 2
  ctx.strokeStyle = INK
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(right - 200, y + 0.5)
  ctx.lineTo(right, y + 0.5)
  ctx.stroke()
  y += 30

  write('TOTAL', right - 200, { size: 17, weight: 700 })
  write(money(data.total), right, { size: 20, weight: 700, color: accent, align: 'right' })
  y += 30

  for (const part of data.paymentParts || []) totalLine(part.method, money(part.amount), { size: 13 })

  if (data.balanceDue > 0) {
    totalLine('Paid', money(data.amountPaid), { size: 13 })
    totalLine('Balance due', money(data.balanceDue), { size: 15, weight: 700, color: '#c8463c', valueColor: '#c8463c' })
  }

  /* ------------------------------------------------------------ footer */

  y += 14
  rule()
  y += 28

  if (qr) {
    ctx.drawImage(qr, PAD, y - 12, 96, 96)
    const textX = PAD + 116
    let footY = y + 12
    const savedY = y
    y = footY
    write('Scan to open this receipt', textX, { size: 12.5, weight: 600, color: MUTED })
    y += 20
    if (data.footer) {
      for (const line of wrap(data.footer, right - textX, 12)) {
        write(line, textX, { size: 12, color: FAINT })
        y += 17
      }
    }
    footY = Math.max(y, savedY + 96)
    y = footY + 14
  } else if (data.footer) {
    for (const line of wrap(data.footer, W - PAD * 2, 12.5)) {
      write(line, PAD, { size: 12.5, color: MUTED })
      y += 18
    }
    y += 10
  }

  if (design.showTerms !== false && data.terms) {
    for (const line of wrap(data.terms, W - PAD * 2, 11.5)) {
      write(line, PAD, { size: 11.5, color: FAINT })
      y += 16
    }
  }

  y += PAD

  /* -------------------------------------------------------------- crop */

  const height = Math.ceil(y)
  const out = document.createElement('canvas')
  out.width = W * SCALE
  out.height = height * SCALE
  const octx = out.getContext('2d')
  octx.fillStyle = '#ffffff'
  octx.fillRect(0, 0, out.width, out.height)
  octx.drawImage(canvas, 0, 0)
  // A closing band, so the slip reads as finished rather than cut off.
  octx.fillStyle = accent
  octx.fillRect(0, out.height - 8 * SCALE, out.width, 8 * SCALE)

  return new Promise((resolve) => out.toBlob((blob) => resolve(blob), 'image/png'))
}

/**
 * Puts the receipt on the clipboard.
 *
 * `ClipboardItem` is handed the *promise*, not the finished blob: Safari drops
 * the user gesture if anything is awaited before `write` is called, and without
 * the gesture the write is refused.
 */
export function copyReceiptImage(blobPromise) {
  if (typeof ClipboardItem === 'undefined' || !navigator.clipboard?.write) {
    return Promise.resolve(false)
  }
  return navigator.clipboard
    .write([new ClipboardItem({ 'image/png': blobPromise })])
    .then(() => true)
    .catch(() => false)
}

/** Fallback when the clipboard is unavailable: hand over the file instead. */
export async function downloadReceiptImage(data, qrDataUrl) {
  const blob = await buildReceiptImage(data, qrDataUrl)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${data.invoiceNo}.png`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
