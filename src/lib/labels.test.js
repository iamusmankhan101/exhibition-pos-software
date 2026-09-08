/**
 * Label sheets.
 *
 * The geometry is the point of these: a grid that does not line up with the
 * die-cut sheet in the tray ruins every sticker on every page, and that is not
 * something a preview reliably shows. So the layout is checked against the
 * paper it claims to fit, and the pagination against what a CSS grid does with
 * a short final row.
 */

import { describe, expect, it } from 'vitest'
import { LABEL_LAYOUTS, buildLabels, labelSheetHtml, paginate, sheetSummary } from './labels.js'

const variant = (id, over = {}) => ({
  id,
  sku: `SKU-${id}`,
  barcode: '2001234567895',
  size: 'M',
  color: 'Black',
  price: 40,
  ...over,
})

const product = (name, variants) => ({ id: `prd_${name}`, name, variants })

describe('the 12-up A4 layout', () => {
  const layout = LABEL_LAYOUTS.a4_12

  it('fills the page exactly across and down', () => {
    const { page, columns, rows, label } = layout
    expect(page.marginX * 2 + columns * label.width).toBeCloseTo(page.width, 5)
    expect(page.marginY * 2 + rows * label.height).toBeCloseTo(page.height, 5)
  })

  it('is twelve labels', () => {
    expect(layout.columns * layout.rows).toBe(layout.perSheet)
    expect(layout.perSheet).toBe(12)
  })
})

describe('building the run', () => {
  it('gives every variant its own label, not the product', () => {
    const labels = buildLabels([product('Dress', [variant('a'), variant('b')])], 1)
    expect(labels.map((entry) => entry.variant.id)).toEqual(['a', 'b'])
  })

  it('repeats copies per variant so sizes keep their own barcodes', () => {
    const labels = buildLabels([product('Dress', [variant('a'), variant('b')])], 3)
    expect(labels).toHaveLength(6)
    expect(labels.filter((entry) => entry.variant.id === 'a')).toHaveLength(3)
  })

  it('treats a missing or silly copy count as one', () => {
    const one = [product('Dress', [variant('a')])]
    expect(buildLabels(one, 0)).toHaveLength(1)
    expect(buildLabels(one, -4)).toHaveLength(1)
    expect(buildLabels(one)).toHaveLength(1)
  })
})

describe('pagination', () => {
  const labels = (count) => Array.from({ length: count }, (_, index) => ({ productName: 'x', variant: variant(index) }))

  it('pads the last sheet so the grid keeps its positions', () => {
    const pages = paginate(labels(13), 12)
    expect(pages).toHaveLength(2)
    expect(pages[0]).toHaveLength(12)
    expect(pages[1]).toHaveLength(12)
    // Eleven blanks, so the thirteenth label stays in the top-left cell.
    expect(pages[1].filter((entry) => entry === null)).toHaveLength(11)
    expect(pages[1][0]).not.toBeNull()
  })

  it('leaves a flowing layout as a single run', () => {
    expect(paginate(labels(30), 0)).toEqual([labels(30)])
  })

  it('counts sheets and the stickers left over', () => {
    expect(sheetSummary(12, LABEL_LAYOUTS.a4_12)).toMatchObject({ sheets: 1, blanks: 0 })
    expect(sheetSummary(13, LABEL_LAYOUTS.a4_12)).toMatchObject({ sheets: 2, blanks: 11 })
    expect(sheetSummary(0, LABEL_LAYOUTS.a4_12)).toMatchObject({ sheets: 0, blanks: 0 })
  })
})

describe('the printed document', () => {
  const render = (count, layout) =>
    labelSheetHtml(buildLabels([product('Silk Scarf', Array.from({ length: count }, (_, i) => variant(i)))], 1), {
      layout,
      currencySymbol: '£',
      renderBarcode: () => '<svg class="bars-svg"></svg>',
    })

  it('hands the whole page over so the grid sits on the sheet origin', () => {
    expect(render(1, LABEL_LAYOUTS.a4_12)).toContain('@page { size: A4; margin: 0; }')
  })

  it('breaks a page per sheet and not after the last one', () => {
    const html = render(13, LABEL_LAYOUTS.a4_12)
    expect(html.match(/class="sheet"/g)).toHaveLength(2)
    expect(html).toContain('.sheet:last-child { break-after: auto;')
  })

  it('forces the bars black without blackening the quiet zone', () => {
    const html = render(1, LABEL_LAYOUTS.a4_12)
    expect(html).toContain('.ean13-bars rect { fill: #000 !important; }')
    expect(html).toContain('.ean13-bg { fill: #fff !important; }')
  })

  it('falls back to the digits when a code cannot be encoded', () => {
    const html = labelSheetHtml(buildLabels([product('Scarf', [variant('a', { barcode: 'nonsense' })])], 1), {
      layout: LABEL_LAYOUTS.a4_12,
      currencySymbol: '£',
      renderBarcode: () => '',
    })
    expect(html).toContain('<span class="code">nonsense</span>')
  })

  it('escapes a product name rather than letting it close a tag', () => {
    const html = labelSheetHtml(buildLabels([product('Scarf <b>x</b>', [variant('a')])], 1), {
      layout: LABEL_LAYOUTS.a4_12,
      currencySymbol: '£',
      renderBarcode: () => '',
    })
    expect(html).toContain('Scarf &lt;b&gt;x&lt;/b&gt;')
    expect(html).not.toContain('<b>x</b>')
  })

  it('omits the grid entirely for the flowing layout', () => {
    const html = render(20, LABEL_LAYOUTS.compact)
    expect(html).not.toContain('class="sheet"')
    // No fixed grid at all — the labels flow, so nothing pins them to cells.
    expect(html).not.toContain('grid-template-columns')
    expect(html).toContain('@page { size: A4; margin: 8mm; }')
  })
})
