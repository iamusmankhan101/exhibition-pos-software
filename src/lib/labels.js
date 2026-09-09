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
 * An EAN-13 is 95 modules of bars plus a quiet zone either side, and `quiet`
 * here matches the default in `ean13Svg` — the pale margin is part of the
 * symbol, not padding around it, and a scanner that cannot see it does not read
 * the code.
 */
const MODULES = 95
const QUIET = 11
const SYMBOL_MODULES = MODULES + QUIET * 2

/**
 * Nominal module width, and the smallest one still worth printing.
 *
 * GS1 specifies EAN-13 at a nominal size and permits magnification down to 80%
 * of it; below that the printed bar edges stop being crisp enough for a cheap
 * laser gun to resolve. 0.33mm is the nominal this app has always printed at, so
 * 0.264 is that 80% floor. A layout that cannot give the symbol 0.264 is not a
 * layout that can carry a barcode, and the UI says so rather than quietly
 * shrinking it.
 */
export const MODULE_WIDTH = 0.33
export const MIN_MODULE_WIDTH = 0.264

/** How wide the printed symbol is at a given module width, in millimetres. */
export function symbolWidth(moduleWidth) {
  return SYMBOL_MODULES * moduleWidth
}

/** Typography at the reference label size, in points. */
const BASE_TYPE = { name: 9, color: 8, sku: 7.5, price: 11 }
const REFERENCE_WIDTH = 63.5

const round = (value, places = 2) => Number(value.toFixed(places))

/**
 * Rounds a millimetre measurement down, never up.
 *
 * A derived label size has to be rounded somewhere, and rounding up is the
 * dangerous direction: three columns of 64.67mm is 194.01mm of grid inside
 * 194mm of page, and a grid a hundredth of a millimetre too wide for its
 * fixed-size sheet can spill into an extra blank page on every sheet printed.
 * Rounding down leaves the remainder in the margin, where it is invisible.
 */
const floorTo = (value, places = 2) => {
  const factor = 10 ** places
  return Math.floor(value * factor) / factor
}

/**
 * The barcode scale and the text sizes a label of this size can carry.
 *
 * The bars are the one thing that is fitted rather than fixed, and only
 * downwards, only as far as the 80% floor — everything else on the label is
 * decoration that can be made smaller, but a symbol too wide for its label would
 * print off the edge and scan as nothing at all. `scannable` is false when even
 * the floor does not fit, which is the signal the UI turns into a warning.
 */
const MM_PER_PT = 0.3528
const lineHeight = (points) => points * 1.25 * MM_PER_PT

/** The digit row `ean13Svg` draws under the bars, and the gap between lines. */
const DIGIT_ROW = 4.4
const LINE_GAP = 0.6

/**
 * What gets dropped first when a label is too short for everything.
 *
 * The barcode is never in this list: it is the entire reason the label exists,
 * and a label whose bars are clipped by an overflowing product name is worse
 * than one with no name at all. Of the text, the price and the name are what a
 * customer and a salesperson read off the shelf, so the colour and the SKU —
 * both recoverable by scanning — go first.
 */
const DROP_ORDER = ['color', 'sku', 'name', 'price']

/**
 * The barcode scale, text sizes, and which lines actually fit on this label.
 *
 * The bars are the one thing that is fitted rather than fixed, and only
 * downwards, only as far as the 80% floor — everything else on the label is
 * decoration that can be made smaller or dropped, but a symbol too wide for its
 * label would print off the edge and scan as nothing at all. `scannable` is
 * false when even the floor does not fit, which is the signal the UI turns into
 * a warning.
 */
function metricsFor(label) {
  const available = label.width - label.padding * 2
  const moduleWidth = Math.min(MODULE_WIDTH, available / SYMBOL_MODULES)
  const scale = Math.max(0.72, Math.min(1, label.width / REFERENCE_WIDTH))
  // The symbol plus its digit line, with the rest of the label left for text.
  const barHeight = label.height ? Math.max(8, Math.min(16, label.height * 0.26)) : 16

  const type = {
    name: round(BASE_TYPE.name * scale, 1),
    color: round(BASE_TYPE.color * scale, 1),
    sku: round(BASE_TYPE.sku * scale, 1),
    price: round(BASE_TYPE.price * scale, 1),
  }

  /*
   * A flowing layout has no fixed height to overflow, so nothing is dropped
   * there. A gridded one does: its cells are a fixed size, and content taller
   * than the cell is clipped rather than pushed onto another page.
   */
  const lines = { name: true, color: true, sku: true, price: true }
  if (label.height) {
    const room = label.height - label.padding * 2
    const used = () =>
      barHeight +
      DIGIT_ROW +
      DROP_ORDER.filter((line) => lines[line]).reduce((sum, line) => sum + lineHeight(type[line]) + LINE_GAP, 0)
    for (const line of DROP_ORDER) {
      if (used() <= room) break
      lines[line] = false
    }
  }

  return {
    barcode: {
      moduleWidth: round(moduleWidth, 3),
      height: round(barHeight, 1),
      scannable: moduleWidth >= MIN_MODULE_WIDTH,
    },
    type,
    lines,
  }
}

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
    page: { size: 'A4', width: 210, height: 297, marginX: 9.75, marginY: 4.5 },
    columns: 3,
    rows: 4,
    label: { width: 63.5, height: 72, padding: 4 },
    perSheet: 12,
    ...metricsFor({ width: 63.5, height: 72, padding: 4 }),
  },
  compact: {
    id: 'compact',
    name: 'Compact (fill the page)',
    hint: 'Small 48mm labels flowed across the page — most labels per sheet, cut by hand.',
    page: null,
    label: { width: 48, height: null, padding: 3 },
    perSheet: 0,
    ...metricsFor({ width: 48, height: null, padding: 3 }),
  },
}

export const DEFAULT_LAYOUT = 'a4_12'
export const CUSTOM_LAYOUT = 'custom'

/**
 * The page a custom sheet is cut from.
 *
 * Unlike the die-cut layouts this one is printed on plain paper and cut by
 * hand, so the margins are the printer's — almost nothing can print to the edge
 * of A4, and a grid that assumed it could would lose its outermost column.
 */
export const CUSTOM_PAGE = { size: 'A4', width: 210, height: 297, marginX: 8, marginY: 8 }

/** How many labels per sheet the custom layout will accept. */
export const CUSTOM_RANGE = { min: 1, max: 60 }

/** Padding scales with the label, so a small one is not mostly margin. */
const paddingFor = (width) => round(Math.max(1.5, Math.min(4, width / 16)), 1)

/** The measurements a given column count produces, before it is judged. */
function geometryFor(perSheet, columns, page) {
  const rows = Math.ceil(perSheet / columns)
  const width = floorTo((page.width - page.marginX * 2) / columns)
  const height = floorTo((page.height - page.marginY * 2) / rows)
  const padding = paddingFor(width)
  return {
    columns,
    rows,
    label: { width, height, padding },
    cells: columns * rows,
    spare: columns * rows - perSheet,
    moduleWidth: Math.min(MODULE_WIDTH, (width - padding * 2) / SYMBOL_MODULES),
  }
}

/** The proportions of the standard 12-up label, used as the shape to aim for. */
const TARGET_ASPECT = Math.log(63.5 / 72)

/**
 * How bad a column count is, lower being better.
 *
 * The obvious heuristic — labels shaped like the page — is wrong here, and
 * wrong in a way that costs money: it prefers tall narrow labels, and a narrow
 * label is one the barcode has to shrink to fit. So the dominant term is how
 * much the symbol has to give up, which is the one thing on the label that
 * cannot be made smaller without becoming unscannable. Wasted cells come next,
 * because they are wasted paper on every sheet of a long run, and the shape of
 * the label only breaks ties.
 */
function scoreColumns(geometry, perSheet) {
  const squeeze = (MODULE_WIDTH - geometry.moduleWidth) / MODULE_WIDTH
  const waste = geometry.spare / perSheet
  const shape = Math.abs(Math.log(geometry.label.width / geometry.label.height) - TARGET_ASPECT)
  return squeeze * 3 + waste * 1.5 + shape * 0.35
}

/**
 * The column count to use when the operator has not picked one.
 *
 * Every factorisation tiles the sheet, so this is a judgement rather than a
 * constraint — but the judgement is made on printability, not looks. See
 * `scoreColumns` for what it weighs.
 */
export function bestColumns(perSheet, page = CUSTOM_PAGE) {
  let best = 1
  let bestScore = Infinity
  for (let columns = 1; columns <= perSheet; columns += 1) {
    const score = scoreColumns(geometryFor(perSheet, columns, page), perSheet)
    if (score < bestScore - 1e-9) {
      bestScore = score
      best = columns
    }
  }
  return best
}

/**
 * A layout for an arbitrary number of labels per sheet.
 *
 * The count is honoured exactly: the grid is sized to hold it, and where the
 * count does not divide evenly by the columns the spare cells at the end are
 * left empty on every page rather than the count being rounded to something
 * that tiles neatly. Somebody who asked for seven per sheet gets seven.
 */
export function customLayout({ perSheet, columns = 0, page = CUSTOM_PAGE }) {
  const count = Math.max(CUSTOM_RANGE.min, Math.min(CUSTOM_RANGE.max, Math.floor(Number(perSheet) || 1)))
  const asked = Math.floor(Number(columns) || 0)
  const cols = Math.max(1, Math.min(count, asked || bestColumns(count, page)))
  const geometry = geometryFor(count, cols, page)
  const { label, rows, spare } = geometry
  return {
    id: CUSTOM_LAYOUT,
    name: 'Custom',
    hint:
      `${cols} across x ${rows} down · ${label.width} x ${label.height}mm labels` +
      (spare > 0 ? ` · ${spare} cell${spare === 1 ? '' : 's'} left empty to keep the count at ${count}` : ''),
    page,
    columns: cols,
    rows,
    label,
    perSheet: count,
    // The grid has cells the count does not fill; the printed page must still
    // reserve them so every label lands in the position it was measured for.
    cells: geometry.cells,
    ...metricsFor(label),
  }
}

/**
 * A single label on a thermal roll.
 *
 * A roll printer is a different machine from a sheet printer, not a smaller
 * one. There is no page to tile and no die-cut grid to line up against: the
 * label *is* the page, the printer advances one at a time, and the driver's
 * paper size has to be the sticker's own size or the gap sensor tears the run
 * apart. So `@page` is sized in millimetres to the label and the grid is 1 x 1
 * — every other layout here divides a sheet, and this one refuses to.
 *
 * The stock is die-cut too, so no cut guides are drawn: a printed border on a
 * label whose edge is already the cut is just a line slightly off the edge.
 */
export const THERMAL_LAYOUT = 'thermal'

/**
 * The roll this shop prints on, in millimetres.
 *
 * Label stock is sold in inches and measured here in millimetres, so the number
 * is written out rather than rounded: a 2 x 2in label is 50.8mm exactly, and
 * 50mm would be half a millimetre of drift per label against the gap sensor.
 */
export const DEFAULT_THERMAL = { width: 50.8, height: 50.8 }

/** What a roll printer will accept — beyond this it is sheet stock, not a roll. */
export const THERMAL_RANGE = { minWidth: 20, maxWidth: 120, minHeight: 10, maxHeight: 200 }

/**
 * The margin on a roll label, which is worth less than the bars are.
 *
 * On a 63.5mm sheet label the padding costs nothing — the symbol fits at
 * nominal with room to spare. On a 40mm roll it is the difference between a
 * symbol at nominal and one at 91% of it, so the padding is given back to the
 * barcode down to a floor, and only as far as nominal needs. Below the floor
 * the print head's own edge tolerance starts eating the quiet zone, which
 * costs more than the magnification gains.
 */
const THERMAL_MIN_PADDING = 1.5

function thermalPadding(width) {
  const preferred = paddingFor(width)
  const spare = (width - symbolWidth(MODULE_WIDTH)) / 2
  if (spare >= preferred) return preferred
  return Math.max(THERMAL_MIN_PADDING, floorTo(spare, 1))
}

const clamp = (value, min, max, fallback) => {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return round(Math.min(max, Math.max(min, number)), 2)
}

/**
 * A layout that prints one label per page at the roll's exact size.
 *
 * The size is the operator's to state because it is a physical fact about the
 * roll loaded in the printer, not something this app can derive or should
 * guess. What it can do is say when the number they typed cannot carry an
 * EAN-13 — see `barcode.scannable`, which the UI turns into a warning rather
 * than printing bars no scanner will read.
 */
export function thermalLayout({ width = DEFAULT_THERMAL.width, height = DEFAULT_THERMAL.height } = {}) {
  const w = clamp(width, THERMAL_RANGE.minWidth, THERMAL_RANGE.maxWidth, DEFAULT_THERMAL.width)
  const h = clamp(height, THERMAL_RANGE.minHeight, THERMAL_RANGE.maxHeight, DEFAULT_THERMAL.height)
  const label = { width: w, height: h, padding: thermalPadding(w) }
  return {
    id: THERMAL_LAYOUT,
    name: 'Thermal roll (one at a time)',
    hint: `${w} x ${h}mm labels, one per print — set the printer's paper size to match, and turn scaling off.`,
    // The label is the page: no margins, because a roll has none to give.
    page: { size: `${w}mm ${h}mm`, width: w, height: h, marginX: 0, marginY: 0 },
    columns: 1,
    rows: 1,
    label,
    perSheet: 1,
    cells: 1,
    // The die-cut edge is the cut line; a printed one would only sit beside it.
    cuts: false,
    ...metricsFor(label),
  }
}

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
export function paginate(labels, perSheet, cells = perSheet) {
  if (!perSheet) return [labels]
  const pad = Math.max(perSheet, cells || 0)
  const pages = []
  for (let index = 0; index < labels.length; index += perSheet) {
    const page = labels.slice(index, index + perSheet)
    while (page.length < pad) page.push(null)
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
function labelHtml(entry, { currencySymbol, renderBarcode, barcode, lines }) {
  if (!entry) return '<div class="label blank"></div>'
  const { productName, variant } = entry
  // The scale comes from the layout, never from the caller: a label printed at
  // whatever size the calling screen felt like is the failure this file exists
  // to prevent.
  const bars = renderBarcode(variant.barcode, barcode)
  const show = lines || { name: true, color: true, sku: true, price: true }
  return `
    <div class="label">
      ${show.name ? `<strong>${escapeHtml(productName)}</strong>` : ''}
      ${show.color && variant.color ? `<span class="color">${escapeHtml(variant.color)}</span>` : ''}
      ${show.sku ? `<span class="sku">${escapeHtml(variant.sku)}</span>` : ''}
      <div class="bars">${bars || `<span class="code">${escapeHtml(variant.barcode)}</span>`}</div>
      ${show.price ? `<span class="price">${escapeHtml(currencySymbol)}${Number(variant.price).toFixed(2)}</span>` : ''}
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
    @page { size: ${page.size || 'A4'}; margin: 0; }
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
  const cell = { currencySymbol, renderBarcode, barcode: layout.barcode, lines: layout.lines }
  const pages = paginate(labels, layout.perSheet, layout.cells || layout.perSheet)
  const body = layout.perSheet
    ? pages
        .map((page) => `<div class="sheet">${page.map((entry) => labelHtml(entry, cell)).join('')}</div>`)
        .join('')
    : labels.map((entry) => labelHtml(entry, cell)).join('')

  const cuts = guides && layout.cuts !== false
  const layoutCss = layout.perSheet ? sheetCss(layout, cuts) : compactCss(layout, cuts)
  const type = layout.type || { name: 9, color: 8, sku: 7.5, price: 11 }

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
    .label strong { font-size: ${type.name}pt; line-height: 1.15; }
    .color { font-size: ${type.color}pt; }
    .sku { font-family: monospace; font-size: ${type.sku}pt; color: #555; }
    .price { font-weight: 700; font-size: ${type.price}pt; margin-top: 1mm; }
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
