/**
 * PDF invoice generation.
 *
 * jsPDF is imported lazily so the ~120 kB library never touches the POS's first
 * paint — it loads only when someone actually asks for a PDF.
 */

import { formatDate } from './format.js'

const SIZES = { a4: [210, 297], a5: [148, 210] }

function hexToRgb(hex) {
  const clean = String(hex || '#021b8d').replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  return [
    parseInt(full.slice(0, 2), 16) || 0,
    parseInt(full.slice(2, 4), 16) || 0,
    parseInt(full.slice(4, 6), 16) || 0,
  ]
}

/**
 * Builds the invoice and returns a Blob.
 * `data` is the same shape the Receipt page renders from.
 */
export async function buildInvoicePdf(data, qrDataUrl) {
  const { jsPDF } = await import('jspdf')

  const design = data.design || {}
  const size = SIZES[design.paperSize] || SIZES.a4
  const [pageW, pageH] = size
  const doc = new jsPDF({ unit: 'mm', format: size })

  const accent = hexToRgb(design.accent)
  const margin = 16
  const right = pageW - margin
  const currency = (value) =>
    `${data.currencySymbol}${Number(value || 0).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`

  let y = margin

  /* ------------------------------------------------------------ header */

  doc.setFillColor(...accent)
  doc.rect(0, 0, pageW, 4, 'F')

  if (design.showLogo !== false && data.business.logo) {
    try {
      doc.addImage(data.business.logo, 'JPEG', margin, y, 18, 18)
    } catch {
      /* a broken data URL should never stop the invoice printing */
    }
  }

  const textLeft = design.showLogo !== false && data.business.logo ? margin + 23 : margin

  doc.setTextColor(20, 23, 28)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(17)
  doc.text(data.business.name || '', textLeft, y + 7)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(110, 118, 130)
  const contact = [data.business.phone, data.business.email, data.business.website]
    .filter(Boolean)
    .join('  ·  ')
  if (contact) doc.text(contact, textLeft, y + 12.5)
  if (data.business.address) doc.text(data.business.address, textLeft, y + 16.5)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(...accent)
  doc.text('INVOICE', right, y + 7, { align: 'right' })
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(110, 118, 130)
  doc.text(data.invoiceNo, right, y + 13, { align: 'right' })
  doc.text(formatDate(data.createdAt, true), right, y + 18, { align: 'right' })

  y += 26

  if (data.status && data.status !== 'Completed') {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(200, 70, 60)
    doc.text(data.status.toUpperCase(), right, y, { align: 'right' })
    doc.setTextColor(20, 23, 28)
    y += 5
  }

  doc.setDrawColor(230, 233, 238)
  doc.line(margin, y, right, y)
  y += 8

  /* --------------------------------------------------------- meta block */

  const metaLeft = []
  const metaRight = []
  metaLeft.push(['Billed to', data.customerName || 'Walk-in Customer'])
  if (design.showCustomerContact !== false && data.customerContact) {
    metaLeft.push(['Contact', data.customerContact])
  }
  if (design.showExhibition !== false && data.exhibitionName) {
    metaRight.push(['Exhibition', data.exhibitionName])
  }
  if (design.showSalesperson !== false && data.salespersonName) {
    metaRight.push(['Served by', data.salespersonName])
  }
  metaRight.push(['Payment', data.paymentMethod || ''])

  const metaTop = y
  const drawMeta = (rows, x, align) => {
    let cursor = metaTop
    for (const [key, value] of rows) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(140, 147, 158)
      doc.text(key.toUpperCase(), x, cursor, { align })
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(9.5)
      doc.setTextColor(20, 23, 28)
      doc.text(String(value), x, cursor + 4.6, { align })
      cursor += 11
    }
    return cursor
  }
  const leftEnd = drawMeta(metaLeft, margin, 'left')
  const rightEnd = drawMeta(metaRight, right, 'right')
  y = Math.max(leftEnd, rightEnd) + 3

  /* -------------------------------------------------------------- items */

  const colQty = right - 62
  const colPrice = right - 40
  const colTotal = right

  doc.setFillColor(246, 247, 249)
  doc.rect(margin, y, right - margin, 8, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(110, 118, 130)
  doc.text('DESCRIPTION', margin + 3, y + 5.4)
  doc.text('QTY', colQty, y + 5.4, { align: 'right' })
  doc.text('PRICE', colPrice, y + 5.4, { align: 'right' })
  doc.text('TOTAL', colTotal - 3, y + 5.4, { align: 'right' })
  y += 12

  doc.setTextColor(20, 23, 28)
  for (const item of data.items) {
    if (y > pageH - 60) {
      doc.addPage()
      y = margin
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9.5)
    const name = doc.splitTextToSize(item.name, colQty - margin - 8)[0]
    doc.text(name, margin + 3, y)

    // The stall price is what was charged, so the list price goes underneath as
    // the "original price" the invoice is expected to show.
    const discounted = item.listPrice > item.unitPrice
    const subLine = [item.variant, discounted ? `was ${currency(item.listPrice)}` : '']
      .filter(Boolean)
      .join('  ·  ')

    if (subLine) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(8)
      doc.setTextColor(140, 147, 158)
      doc.text(subLine, margin + 3, y + 4)
      doc.setTextColor(20, 23, 28)
    }

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.text(String(item.quantity), colQty, y, { align: 'right' })
    doc.text(currency(item.unitPrice), colPrice, y, { align: 'right' })
    doc.setFont('helvetica', 'bold')
    doc.text(currency(item.quantity * item.unitPrice), colTotal - 3, y, { align: 'right' })

    y += subLine ? 10 : 7
    doc.setDrawColor(240, 242, 245)
    doc.line(margin, y - 2.5, right, y - 2.5)
  }

  /* ------------------------------------------------------------ totals */

  y += 4
  const totalsX = right - 62
  const line = (label, value, bold = false, color = [20, 23, 28]) => {
    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(bold ? 10 : 9.5)
    doc.setTextColor(...(bold ? color : [110, 118, 130]))
    doc.text(label, totalsX, y)
    doc.setTextColor(...color)
    doc.setFont('helvetica', 'bold')
    doc.text(value, colTotal - 3, y, { align: 'right' })
    y += 6
  }

  line('Subtotal', currency(data.subtotal))
  if (data.discountAmount > 0) line('Discount', `-${currency(data.discountAmount)}`)
  if (data.promoAmount > 0) line(`Promo ${data.promoCode || ''}`.trim(), `-${currency(data.promoAmount)}`)
  if (design.showTaxBreakdown !== false && data.tax > 0) {
    line(`VAT ${data.taxRate}%${data.taxInclusive ? ' (incl.)' : ''}`, currency(data.tax))
  }

  y += 1
  doc.setDrawColor(20, 23, 28)
  doc.setLineWidth(0.4)
  doc.line(totalsX, y - 3, right, y - 3)
  doc.setLineWidth(0.2)
  y += 2
  line('TOTAL', currency(data.total), true)

  // A split sale itemises each method, so the invoice reconciles against both.
  for (const part of data.paymentParts || []) {
    line(part.method, currency(part.amount))
  }

  if (data.amountPaid !== undefined && data.balanceDue > 0) {
    line('Paid', currency(data.amountPaid))
    line('Balance due', currency(data.balanceDue), true, [200, 70, 60])
  }

  /* ------------------------------------------------------------ footer */

  let footY = pageH - 40
  if (design.showQr !== false && qrDataUrl) {
    try {
      doc.addImage(qrDataUrl, 'PNG', margin, footY - 6, 24, 24)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.setTextColor(140, 147, 158)
      doc.text('Scan to open', margin, footY + 22)
    } catch {
      /* ignore an unreadable QR image */
    }
  }

  const footTextX = design.showQr !== false && qrDataUrl ? margin + 30 : margin
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(140, 147, 158)
  if (data.business.vatNumber) {
    doc.text(`VAT No. ${data.business.vatNumber}`, footTextX, footY)
    footY += 4
  }
  if (design.showTerms !== false && data.terms) {
    doc.text(doc.splitTextToSize(data.terms, right - footTextX), footTextX, footY)
  }

  doc.setFillColor(...accent)
  doc.rect(0, pageH - 4, pageW, 4, 'F')

  return doc.output('blob')
}

/** Saves the PDF to the device. */
export async function downloadInvoicePdf(data, qrDataUrl) {
  const blob = await buildInvoicePdf(data, qrDataUrl)
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
export async function shareInvoicePdf(data, qrDataUrl, message) {
  const blob = await buildInvoicePdf(data, qrDataUrl)
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
