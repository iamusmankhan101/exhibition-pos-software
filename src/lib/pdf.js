/**
 * PDF invoice generation.
 *
 * jsPDF is imported lazily so the ~120 kB library never touches the POS's first
 * paint — it loads only when someone actually asks for a PDF.
 */

import { PAGE_W, drawInvoice, invoiceHeight, prepareLogo } from './invoiceLayout.js'

/** jsPDF backend for the shared invoice layout. */
function pdfPen(doc) {
  const setFont = ({ serif, bold, size = 10 }) => {
    doc.setFont(serif ? 'times' : 'helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(size)
  }
  return {
    rect(x, y, w, h, rgb) {
      doc.setFillColor(...rgb)
      doc.rect(x, y, w, h, 'F')
    },
    circle(cx, cy, r, rgb) {
      doc.setFillColor(...rgb)
      doc.circle(cx, cy, r, 'F')
    },
    line(x1, y1, x2, y2, rgb, width) {
      doc.setDrawColor(...rgb)
      doc.setLineWidth(width)
      doc.line(x1, y1, x2, y2)
    },
    text(str, x, y, style = {}) {
      setFont(style)
      doc.setTextColor(...(style.color || [24, 24, 24]))
      const spacing = style.spacing || 0
      let at = x
      // jsPDF leaves letter spacing out of its own alignment maths.
      if (style.align === 'right' || style.align === 'center') {
        const width = this.measure(str, style)
        at = style.align === 'right' ? x - width : x - width / 2
      }
      doc.text(String(str), at, y, spacing ? { charSpace: spacing } : undefined)
    },
    measure(str, style = {}) {
      setFont(style)
      const text = String(str)
      return doc.getTextWidth(text) + (style.spacing || 0) * Math.max(0, text.length - 1)
    },
    image(logo, x, y, w, h) {
      try {
        doc.addImage(logo.dataUrl, 'PNG', x, y, w, h)
      } catch {
        /* a broken logo should never stop the invoice printing */
      }
    },
  }
}

/**
 * Builds the invoice and returns a Blob.
 * `data` is the same shape the Receipt page renders from.
 */
export async function buildInvoicePdf(data) {
  const [{ jsPDF }, logo] = await Promise.all([
    import('jspdf'),
    data.design?.showLogo !== false ? prepareLogo(data.business?.logo) : null,
  ])
  const doc = new jsPDF({ unit: 'mm', format: [PAGE_W, invoiceHeight(data)] })
  drawInvoice(data, pdfPen(doc), logo)
  return doc.output('blob')
}

/** Saves the PDF to the device. */
export async function downloadInvoicePdf(data) {
  const blob = await buildInvoicePdf(data)
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${data.invoiceNo}.pdf`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/**
 * Hands the PDF to the OS share sheet, which is what actually lets a phone
 * attach it to an email or WhatsApp message. Falls back to a download.
 */
export async function shareInvoicePdf(data, message) {
  const blob = await buildInvoicePdf(data)
  const file = new File([blob], `${data.invoiceNo}.pdf`, { type: 'application/pdf' })

  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: data.invoiceNo, text: message })
      return 'shared'
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled'
    }
  }

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${data.invoiceNo}.pdf`
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
  return 'downloaded'
}
