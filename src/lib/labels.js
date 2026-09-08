/**
 * Printable barcode labels for the catalogue.
 *
 * Two things make label printing different from every other print in this app.
 *
 * The first is that a barcode is not a picture: it is a measurement. Bars must
 * reach the paper at the exact width they were authored at, so nothing here is
 * ever sized as a percentage or fitted to its box — a barcode scaled to suit a
 * label is a barcode a scanner refuses, and the failure shows up at the till in
 * front of a customer rather than here.
 *
 * The second is that label stock is die-cut before it is printed on. The sheet
 * layout is not a design choice, it is a physical fact about the sheet already
 * loaded in the tray: twelve 63.5 x 72mm labels, three across and four down, on
 * A4. If the printed grid and the cut grid disagree by a millimetre, every label
 * on every page is wrong. That is why the page is laid out in millimetres from
 * a fixed origin with `@page { margin: 0 }`, rather than flowing.
 */

/**
 * The sheet geometries on offer.
 *
 * `a4_12` matches the common 12-up A4 label sheet. The margins are what is left
 * of the page once the labels are placed, so the three numbers per axis always
 * add back up to the paper: 9.75 + 3x63.5 + 9.75 = 210mm across, 4.5 + 4x72 +
 * 4.5 = 297mm down.
 */
export const LABEL_LAYOUTS = {
  a4_12: {
    id: 'a4_12',
    name: '12 per sheet (A4)',
    hint: '3 x 4 grid of 63.5 x 72mm labels — standard 12-up A4 label stock.',
    page: { width: 210, height: 297, marginX: 9.75, marginY: 4.5 },
    columns: 3,
    rows: 4,
    label: { width: 63.5, height: 72, padding: 4 },
    perSheet: 12,
  },
  compact: {
    id: 'compact',
    name: 'Compact (fill the page)',
    hint: 'Small 48mm labels flowed across the page — most labels per sheet, cut by hand.',
    page: null,
    label: { width: 48, height: null, padding: 3 },
    perSheet: 0,
  },
}

export const DEFAULT_LAYOUT = 'a4_12'

const escapeHtml = (value) =>
  String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char])

/**
 * Every label to be printed, in order, one entry per physical sticker.
 *
 * `copies` is per variant rather than per product: a rail of one dress in four
 * sizes needs four different barcodes, and printing four copies of the same one
 * would put the same number on every size.
 */
export function buildLabels(products, copies = 1) {
  const count = Math.max(1, Math.floor(Number(copies) || 1))
  const labels = []
  for (const product of products || []) {
    for (const variant of product.variants || []) {
      for (let index = 0; index < count; index += 1) {
        labels.push({ productName: product.name, variant })
      }
    }
  }
  return labels
}

/**
 * Labels split into pages, the last one padded out with blanks.
 *
 * The padding is not cosmetic: a CSS grid with a short final row would pull the
 * remaining labels up into positions the die-cut sheet does not have, so the
 * blanks are what keeps the last page's stickers on their backing.
 */
export function paginate(labels, perSheet) {
  if (!perSheet) return [labels]
  const pages = []
  for (let index = 0; index < labels.length; index += perSheet) {
    const page = labels.slice(index, index + perSheet)
    while (page.length < perSheet) page.push(null)
    pages.push(page)
  }
  return pages
}

/** How many sheets a batch needs, and how many stickers are left over unused. */
export function sheetSummary(labelCount, layout) {
  const perSheet = layout?.perSheet || 0
  if (!perSheet) return { sheets: labelCount > 0 ? 1 : 0, blanks: 0, perSheet: 0 }
  const sheets = Math.ceil(labelCount / perSheet)
  return { sheets, blanks: sheets * perSheet - labelCount, perSheet }
}

/**
 * One label's markup. `renderBarcode` is passed in rather than imported so this
 * module stays about geometry, and so a label whose code cannot be encoded
 * falls back to the digits instead of printing an empty box.
 */
function labelHtml(entry, { currencySymbol, renderBarcode }) {
  if (!entry) return '<div class="label blank"></div>'
  const { productName, variant } = entry
  const bars = renderBarcode(variant.barcode)
  const variantLine = [variant.color, variant.size].filter(Boolean).join(' / ')
  return `
    <div class="label">
      <strong>${escapeHtml(productName)}</strong>
      ${variantLine ? `<span class="variant">${escapeHtml(variantLine)}</span>` : ''}
      <span class="sku">${escapeHtml(variant.sku)}</span>
      <div class="bars">${bars || `<span class="code">${escapeHtml(variant.barcode)}</span>`}</div>
      <span class="price">${escapeHtml(currencySymbol)}${Number(variant.price).toFixed(2)}</span>
    </div>`
}

/**
 * The stylesheet for a sheet layout.
 *
 * `@page { margin: 0 }` hands the whole physical page over, which is the only
 * way the label grid can be positioned against the sheet's own origin rather
 * than against whatever margin the browser felt like applying.
 */
function sheetCss(layout, guides) {
  const { page, label, columns, rows } = layout
  const guideRule = guides ? 'border: 1px dashed #c8ccd4; border-radius: 2mm;' : 'border: 1px solid transparent;'
  return `
    @page { size: A4; margin: 0; }
    html, body { margin: 0; padding: 0; }
    body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; }
    .sheet {
      width: ${page.width}mm; height: ${page.height}mm; box-sizing: border-box;
      padding: ${page.marginY}mm ${page.marginX}mm;
      display: grid;
      grid-template-columns: repeat(${columns}, ${label.width}mm);
      grid-template-rows: repeat(${rows}, ${label.height}mm);
      break-after: page; page-break-after: always;
    }
    .sheet:last-child { break-after: auto; page-break-after: auto; }
    .label {
      width: ${label.width}mm; height: ${label.height}mm; box-sizing: border-box;
      padding: ${label.padding}mm;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      text-align: center; gap: 0.6mm; overflow: hidden;
      ${guideRule}
    }
    .label.blank { border-color: transparent; }`
}

/** The stylesheet for the flowing compact layout, which has no fixed grid. */
function compactCss(layout, guides) {
  const { label } = layout
  return `
    @page { size: A4; margin: 8mm; }
    html, body { margin: 0; padding: 0; }
    body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; display: flex; flex-wrap: wrap; gap: 5mm; }
    .label {
      width: ${label.width}mm; padding: ${label.padding}mm; box-sizing: border-box;
      display: flex; flex-direction: column; align-items: center; text-align: center; gap: 0.6mm;
      break-inside: avoid; page-break-inside: avoid;
      ${guides ? 'border: 1px dashed #c8ccd4; border-radius: 2mm;' : ''}
    }`
}

/**
 * The complete printable document.
 *
 * Built as a whole HTML string and handed to a new window rather than rendered
 * into this one: the print stylesheet here sets page margins to zero for the
 * whole document, which would wreck every other print in the app if it were
 * ever allowed to load beside it.
 */
export function labelSheetHtml(labels, { layout, currencySymbol = '', guides = true, renderBarcode, title = 'Labels' }) {
  const pages = paginate(labels, layout.perSheet)
  const body = layout.perSheet
    ? pages
        .map((page) => `<div class="sheet">${page.map((entry) => labelHtml(entry, { currencySymbol, renderBarcode })).join('')}</div>`)
        .join('')
    : labels.map((entry) => labelHtml(entry, { currencySymbol, renderBarcode })).join('')

  const layoutCss = layout.perSheet ? sheetCss(layout, guides) : compactCss(layout, guides)

  /*
   * Bars must reach the paper as solid black: a printer's "save ink" pass
   * renders them grey and a scanner reads nothing, so print-color-adjust asks
   * for the colours exactly as authored.
   *
   * The two fills are named separately on purpose. Forcing every rect black
   * also blackens the quiet-zone background the barcode draws behind itself,
   * which buries the bars and prints a solid block.
   */
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>
    ${layoutCss}
    .label strong { font-size: 9pt; line-height: 1.15; }
    .variant { font-size: 8pt; }
    .sku { font-family: monospace; font-size: 7.5pt; color: #555; }
    .price { font-weight: 700; font-size: 11pt; margin-top: 1mm; }
    .bars { margin-top: 1.5mm; }
    .bars svg { display: block; }
    .code { font-family: monospace; font-size: 9pt; }
    @media print {
      .bars svg { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .bars svg .ean13-bars rect { fill: #000 !important; }
      .bars svg .ean13-bg { fill: #fff !important; }
    }
  </style></head><body>${body}</body></html>`
}
