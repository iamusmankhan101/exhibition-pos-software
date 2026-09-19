/**
 * The receipt as a picture.
 *
 * A browser cannot put a file into WhatsApp Desktop — no share extension, and
 * `wa.me` carries text only. It *can* put an image on the clipboard, and every
 * chat app accepts a pasted image, so this is the one route that gets a real
 * receipt into a desktop conversation.
 *
 * Rendered on a canvas rather than through jsPDF: nothing here rasterises a PDF.
 * The page itself comes from `invoiceLayout.js`, the same layout the PDF draws,
 * so the picture in the chat and the PDF are one document.
 */

import { PAGE_W, drawInvoice, invoiceHeight, prepareLogo } from './invoiceLayout.js'

const PX_PER_MM = 5 // 1050 px wide: sharp in a chat bubble, small enough to paste
const PT = 25.4 / 72

const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif'
const SERIF = '"Times New Roman", Times, Georgia, serif'

/** Canvas backend for the shared invoice layout. */
function canvasPen(ctx) {
  const px = (mm) => mm * PX_PER_MM
  const rgb = (c) => `rgb(${c[0]}, ${c[1]}, ${c[2]})`
  const setFont = ({ serif, bold, size = 10 }) => {
    ctx.font = `${bold ? 700 : 400} ${px(size * PT)}px ${serif ? SERIF : SANS}`
  }
  const measure = (str, style = {}) => {
    setFont(style)
    const text = String(str)
    return ctx.measureText(text).width / PX_PER_MM + (style.spacing || 0) * Math.max(0, text.length - 1)
  }
  return {
    rect(x, y, w, h, color) {
      ctx.fillStyle = rgb(color)
      ctx.fillRect(px(x), px(y), px(w), px(h))
    },
    circle(cx, cy, r, color) {
      ctx.fillStyle = rgb(color)
      ctx.beginPath()
      ctx.arc(px(cx), px(cy), px(r), 0, Math.PI * 2)
      ctx.fill()
    },
    line(x1, y1, x2, y2, color, width) {
      ctx.strokeStyle = rgb(color)
      ctx.lineWidth = Math.max(1, px(width))
      ctx.beginPath()
      ctx.moveTo(px(x1), px(y1))
      ctx.lineTo(px(x2), px(y2))
      ctx.stroke()
    },
    text(str, x, y, style = {}) {
      const text = String(str ?? '')
      const spacing = style.spacing || 0
      let at = x
      if (style.align === 'right' || style.align === 'center') {
        const width = measure(text, style)
        at = style.align === 'right' ? x - width : x - width / 2
      }
      setFont(style)
      ctx.fillStyle = rgb(style.color || [24, 24, 24])
      ctx.textAlign = 'left'
      if (!spacing) {
        ctx.fillText(text, px(at), px(y))
        return
      }
      // Drawn a letter at a time: `ctx.letterSpacing` is not in every browser.
      let cursor = at
      for (const char of text) {
        ctx.fillText(char, px(cursor), px(y))
        cursor += ctx.measureText(char).width / PX_PER_MM + spacing
      }
    },
    measure,
    image(logo, x, y, w, h) {
      try {
        ctx.drawImage(logo.source, px(x), px(y), px(w), px(h))
      } catch {
        /* an undecodable logo is left out rather than failing the receipt */
      }
    },
  }
}

/** Renders the invoice to a PNG blob — the same page the PDF prints. */
export async function buildReceiptImage(data) {
  const logo = data.design?.showLogo !== false ? await prepareLogo(data.business?.logo) : null
  const height = invoiceHeight(data)

  const canvas = document.createElement('canvas')
  canvas.width = Math.round(PAGE_W * PX_PER_MM)
  canvas.height = Math.round(height * PX_PER_MM)
  const ctx = canvas.getContext('2d')
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  drawInvoice(data, canvasPen(ctx), logo)

  return new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png'))
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

/**
 * Fallback when the clipboard is unavailable: hand over the file instead.
 * Takes the blob that was already rendered rather than drawing it a second time.
 */
export function saveReceiptImage(blob, invoiceNo) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${invoiceNo}.png`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}
