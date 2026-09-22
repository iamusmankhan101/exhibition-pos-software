/**
 * The Tareez invoice, laid out once and drawn twice.
 *
 * The PDF (jsPDF) and the picture that goes into WhatsApp (canvas) must be the
 * same document, so the layout lives here and talks to a small "pen" that each
 * backend implements. Every coordinate is in millimetres on an A4 page and
 * every font size is in points, measured off the shop's own invoice template.
 *
 * Pen contract:
 *   rect(x, y, w, h, rgb)                  filled rectangle
 *   circle(cx, cy, r, rgb)                 filled circle
 *   line(x1, y1, x2, y2, rgb, width)       stroke, width in mm
 *   text(str, x, y, { size, serif, bold, align, color, spacing })
 *   measure(str, { size, serif, bold })    width in mm
 *   image(logo, x, y, w, h)                a logo from `prepareLogo`
 */

export const PAGE_W = 210
export const A4_H = 297

const INK = [24, 24, 24]
const MUTED = [110, 110, 110]
const RULE = [70, 70, 70]
const BEIGE = [241, 232, 224]
const BLACK = [8, 8, 8]
const RED = [190, 50, 50]

const LEFT = 18
const RIGHT = 192
const PRICE_X = 156.5
const TOTAL_X = 185.7
const TOTALS_LABEL_X = 136.5

const BAND_TOP = 106.4
const BAND_H = 11.8
const MIN_ROWS = 4

/** 6500 stays 6500; only real fractions carry decimals, as on the template. */
export function amount(value) {
  const number = Math.round(Number(value || 0) * 100) / 100
  return Number.isInteger(number) ? String(number) : number.toFixed(2)
}

function issuedDate(iso) {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

/** Row height shrinks once the four template rows are full. */
function rowMetrics(count) {
  const rows = Math.max(MIN_ROWS, count)
  const height = count > MIN_ROWS ? 11.5 : 17.4
  const firstRule = BAND_TOP + BAND_H + (count > MIN_ROWS ? height : 16.3)
  return { rows, height, firstRule, lastRule: firstRule + (rows - 1) * height }
}

/** Discount, promo and VAT lines — the template's "-" row when there are none. */
function adjustments(data) {
  const design = data.design || {}
  const lines = []
  if (data.discountAmount > 0) lines.push(['Discount', `-${amount(data.discountAmount)}`])
  if (data.promoAmount > 0) lines.push([`Promo ${data.promoCode || ''}`.trim(), `-${amount(data.promoAmount)}`])
  if (design.showTaxBreakdown !== false && data.tax > 0) {
    lines.push([`VAT ${data.taxRate}%${data.taxInclusive ? ' (incl.)' : ''}`, amount(data.tax)])
  }
  return lines
}

function totalsMetrics(data) {
  const { lastRule } = rowMetrics(data.items.length)
  const subtotal = lastRule + 27.5
  const adjust = Math.max(1, adjustments(data).length)
  const rule = subtotal + 17.5 + (adjust - 1) * 8 + 4.8
  const total = rule + 9.1
  const owing = data.balanceDue > 0 ? 2 : 0
  const last = total + owing * 8
  const bandTop = Math.max(267.7, last + 14)
  return { subtotal, rule, total, bandTop, pageHeight: bandTop + 18 + 11.3 }
}

/** Page height in mm: A4 until the items outgrow it, then as tall as needed. */
export function invoiceHeight(data) {
  return Math.max(A4_H, totalsMetrics(data).pageHeight)
}

function fit(pen, text, maxWidth, style) {
  let out = String(text || '')
  if (pen.measure(out, style) <= maxWidth) return out
  while (out.length > 1 && pen.measure(`${out}…`, style) > maxWidth) out = out.slice(0, -1)
  return `${out.trimEnd()}…`
}

function wrap(pen, text, maxWidth, style) {
  const words = String(text || '').split(/\s+/).filter(Boolean)
  const lines = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (line && pen.measure(next, style) > maxWidth) {
      lines.push(line)
      line = word
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines
}

export function drawInvoice(data, pen, logo) {
  const design = data.design || {}
  const business = data.business || {}
  const bank = data.bank || {}
  const code = data.currencyCode || String(data.currencySymbol || '').trim()

  /* ------------------------------------------------------------ header */

  pen.text('INVOICE', LEFT, 28.4, { size: 55, serif: true, spacing: 0.5 })

  pen.text(`Issued: ${issuedDate(data.createdAt)}`, 16.5, 37.5, { size: 10 })
  const reference = [data.invoiceNo ? `No. ${data.invoiceNo}` : '', data.status && data.status !== 'Completed' ? String(data.status).toUpperCase() : '']
    .filter(Boolean)
    .join('   ·   ')
  if (reference) {
    pen.text(reference, 16.5, 42, {
      size: 8,
      color: data.status && data.status !== 'Completed' ? RED : MUTED,
    })
  }

  pen.text('BILL TO:', 16.5, 48.4, { size: 10, bold: true })
  pen.text(String(data.customerName || 'Walk-in Customer').toUpperCase(), 16.5, 53.9, { size: 10.5 })

  pen.text('FROM:', 16.5, 60.2, { size: 10, bold: true })
  const from = [
    business.legalName || business.name,
    ...wrap(pen, business.address, 78, { size: 9 }).slice(0, 2),
    business.phone,
  ].filter(Boolean)
  let y = 60.2
  for (const line of from) {
    y += 4.65
    pen.text(line, 16.5, y, { size: 9 })
  }

  const bankLines = [
    bank.accountName,
    bank.bank,
    bank.accountNumber && `Account Number: ${bank.accountNumber}`,
    bank.iban && `IBAN: ${bank.iban}`,
  ].filter(Boolean)
  if (bankLines.length) {
    y += 8
    pen.text('ACCOUNT DETAILS:', 16.5, y, { size: 10, bold: true })
    y += 0.8
    for (const line of bankLines) {
      y += 4.7
      pen.text(line, 15, y, { size: 9 })
    }
  }

  // The logo sits in a black disc on a beige halo.
  pen.circle(156.8, 52.7, 40.5, BEIGE)
  pen.circle(156.8, 52.7, 28, BLACK)
  if (design.showLogo !== false && logo) {
    const scale = Math.min(41 / logo.width, 24 / logo.height)
    const w = logo.width * scale
    const h = logo.height * scale
    pen.image(logo, 156.8 - w / 2, 52.7 - h / 2, w, h)
  } else {
    pen.text(String(business.name || '').slice(0, 1).toUpperCase(), 156.8, 60, {
      size: 60,
      serif: true,
      align: 'center',
      color: [255, 255, 255],
    })
  }

  /* -------------------------------------------------------------- items */

  pen.rect(0, BAND_TOP, PAGE_W, BAND_H, BEIGE)
  const head = { size: 9.5, serif: true }
  pen.text('DESCRIPTION', 19.3, 113.4, head)
  pen.text('PRICE', PRICE_X, 113.4, { ...head, align: 'center' })
  pen.text('TOTAL', TOTAL_X, 113.4, { ...head, align: 'center' })

  const { rows, height, firstRule } = rowMetrics(data.items.length)
  const compact = data.items.length > MIN_ROWS
  for (let index = 0; index < rows; index += 1) {
    const rule = firstRule + index * height
    const item = data.items[index]
    if (item) {
      const quantity = Number(item.quantity) || 0
      const nameStyle = { size: compact ? 11 : 13 }
      // The quantity survives truncation; only the name gives way.
      const times = quantity > 1 ? ` × ${quantity}` : ''
      const room = PRICE_X - 14 - LEFT - (times ? pen.measure(times, nameStyle) : 0)
      const name = `${fit(pen, String(item.name || '').toUpperCase(), room, nameStyle)}${times}`
      const sub = [item.variant, item.listPrice > item.unitPrice ? `was ${amount(item.listPrice)}` : '']
        .filter(Boolean)
        .join('  ·  ')
      const base = sub ? rule - (compact ? 5.6 : 8.6) : rule - (compact ? 3.8 : 6.8)
      pen.text(name, LEFT, base, nameStyle)
      if (sub) pen.text(sub, LEFT, base + (compact ? 3.6 : 4.6), { size: 8, color: MUTED })
      pen.text(amount(item.unitPrice), PRICE_X, base, { ...nameStyle, align: 'center' })
      pen.text(amount(quantity * item.unitPrice), TOTAL_X, base, { ...nameStyle, align: 'center' })
    }
    pen.line(LEFT, rule, RIGHT, rule, RULE, 0.2)
  }

  /* ------------------------------------------------------------ totals */

  const metrics = totalsMetrics(data)
  pen.text('Subtotal', TOTALS_LABEL_X, metrics.subtotal, { size: 13 })
  pen.text(`${code} ${amount(data.subtotal)}`.trim(), RIGHT, metrics.subtotal, { size: 13, align: 'right' })

  const extra = adjustments(data)
  if (extra.length) {
    extra.forEach(([label, value], index) => {
      const at = metrics.subtotal + 17.5 + index * 8
      pen.text(label, TOTALS_LABEL_X, at, { size: 11 })
      pen.text(value, RIGHT, at, { size: 11, align: 'right' })
    })
  } else {
    pen.text('-', RIGHT, metrics.subtotal + 17.5, { size: 11, align: 'right' })
  }

  pen.line(119, metrics.rule, RIGHT + 0.5, metrics.rule, INK, 0.25)
  pen.text('TOTAL', 138.6, metrics.total, { size: 14, bold: true })
  pen.text(amount(data.total), RIGHT, metrics.total, { size: 14, bold: true, align: 'right' })

  if (data.balanceDue > 0) {
    pen.text('Paid', TOTALS_LABEL_X, metrics.total + 8, { size: 11 })
    pen.text(amount(data.amountPaid), RIGHT, metrics.total + 8, { size: 11, align: 'right' })
    pen.text('Balance due', TOTALS_LABEL_X, metrics.total + 16, { size: 11, bold: true, color: RED })
    pen.text(amount(data.balanceDue), RIGHT, metrics.total + 16, { size: 11, bold: true, color: RED, align: 'right' })
  }

  /* ------------------------------------------------------------ footer */

  pen.rect(0, metrics.bandTop, PAGE_W, 18, BEIGE)
  pen.text('Thank you!', 23.9, metrics.bandTop + 11.3, { size: 22, serif: true, spacing: 0.4 })
}

/**
 * Loads the logo and, when it is drawn on a transparent background, turns it
 * white so it reads on the black disc. An opaque logo (a photo, a JPEG) is left
 * as it is. Resolves to `null` when there is nothing usable.
 */
export function prepareLogo(src) {
  return new Promise((resolve) => {
    if (!src || typeof Image === 'undefined') return resolve(null)
    const image = new Image()
    image.onload = () => {
      const width = image.naturalWidth || image.width
      const height = image.naturalHeight || image.height
      try {
        // Upscaled so a small wordmark is not a smudge at 41 mm.
        const factor = Math.max(1, Math.ceil(1200 / width))
        const canvas = document.createElement('canvas')
        canvas.width = width * factor
        canvas.height = height * factor
        const ctx = canvas.getContext('2d')
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height)
        const px = pixels.data
        let transparent = 0
        for (let i = 3; i < px.length; i += 4) if (px[i] < 20) transparent += 1
        if (transparent > px.length / 4 / 10) {
          for (let i = 0; i < px.length; i += 4) {
            px[i] = 255
            px[i + 1] = 255
            px[i + 2] = 255
          }
          ctx.putImageData(pixels, 0, 0)
        }
        resolve({ source: canvas, dataUrl: canvas.toDataURL('image/png'), width, height })
      } catch {
        resolve({ source: image, dataUrl: src, width, height })
      }
    }
    image.onerror = () => resolve(null)
    image.src = src
    return undefined
  })
}
