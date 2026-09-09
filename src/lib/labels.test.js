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
import {
  CUSTOM_PAGE,
  CUSTOM_RANGE,
  LABEL_LAYOUTS,
  MIN_MODULE_WIDTH,
  MODULE_WIDTH,
  THERMAL_RANGE,
  bestColumns,
  buildLabels,
  customLayout,
  labelSheetHtml,
  paginate,
  sheetSummary,
  symbolWidth,
  thermalLayout,
} from './labels.js'

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

describe('a custom number per sheet', () => {
  /*
   * A derived size is rounded, so the grid cannot land on the page exactly the
   * way the hand-measured 12-up layout does. What matters is the direction: it
   * must never exceed the page — a grid wider or taller than its fixed-size
   * sheet spills onto an extra blank page — and it must not waste more than the
   * rounding, which is a hundredth of a millimetre per row or column.
   */
  const fits = (layout) => {
    const { page, columns, rows, label } = layout
    const across = page.marginX * 2 + columns * label.width
    const down = page.marginY * 2 + rows * label.height
    expect(across).toBeLessThanOrEqual(page.width)
    expect(down).toBeLessThanOrEqual(page.height)
    expect(across).toBeGreaterThan(page.width - columns * 0.01 - 1e-9)
    expect(down).toBeGreaterThan(page.height - rows * 0.01 - 1e-9)
  }

  it('honours the count exactly rather than rounding to a tidy grid', () => {
    for (const count of [1, 2, 6, 7, 11, 12, 13, 24, 40]) {
      expect(customLayout({ perSheet: count }).perSheet).toBe(count)
    }
  })

  it('fills the printable page at every count', () => {
    for (const count of [1, 4, 7, 12, 20, 33]) fits(customLayout({ perSheet: count }))
  })

  it('leaves spare cells when the count does not divide by the columns', () => {
    // Seven at three across is three rows of three: seven labels, two gaps.
    const layout = customLayout({ perSheet: 7, columns: 3 })
    expect(layout.rows).toBe(3)
    expect(layout.cells).toBe(9)
    expect(layout.perSheet).toBe(7)
    expect(layout.hint).toContain('2 cells left empty')
  })

  it('keeps the spare cells on the page so labels stay in their measured spots', () => {
    const layout = customLayout({ perSheet: 7, columns: 3 })
    const pages = paginate(Array.from({ length: 7 }, () => ({})), layout.perSheet, layout.cells)
    expect(pages).toHaveLength(1)
    expect(pages[0]).toHaveLength(9)
    expect(pages[0].slice(7)).toEqual([null, null])
  })

  it('reproduces the standard 12-up grid when asked for twelve', () => {
    expect(bestColumns(12)).toBe(3)
    expect(customLayout({ perSheet: 12 }).rows).toBe(4)
  })

  it('takes a column override', () => {
    expect(customLayout({ perSheet: 12, columns: 4 })).toMatchObject({ columns: 4, rows: 3 })
  })

  it('clamps a count outside the offered range', () => {
    expect(customLayout({ perSheet: 0 }).perSheet).toBe(CUSTOM_RANGE.min)
    expect(customLayout({ perSheet: 5000 }).perSheet).toBe(CUSTOM_RANGE.max)
    expect(customLayout({ perSheet: 'nonsense' }).perSheet).toBe(CUSTOM_RANGE.min)
  })
})

describe('barcode scale', () => {
  it('never magnifies past nominal, however much room there is', () => {
    expect(customLayout({ perSheet: 1 }).barcode.moduleWidth).toBe(MODULE_WIDTH)
    expect(LABEL_LAYOUTS.a4_12.barcode.moduleWidth).toBe(MODULE_WIDTH)
  })

  it('keeps the symbol inside the label it has to print on', () => {
    for (const count of [1, 4, 9, 12, 20, 40]) {
      const layout = customLayout({ perSheet: count })
      const usable = layout.label.width - layout.label.padding * 2
      expect(symbolWidth(layout.barcode.moduleWidth)).toBeLessThanOrEqual(usable + 1e-6)
    }
  })

  it('flags a sheet too dense for a readable barcode instead of shrinking it silently', () => {
    const roomy = customLayout({ perSheet: 12 })
    expect(roomy.barcode.scannable).toBe(true)
    expect(roomy.barcode.moduleWidth).toBeGreaterThanOrEqual(MIN_MODULE_WIDTH)

    // Ten across leaves under 20mm per label — nowhere near an EAN-13.
    const cramped = customLayout({ perSheet: 40, columns: 10 })
    expect(cramped.barcode.scannable).toBe(false)
  })

  it('agrees with the printable width the page actually offers', () => {
    const usableWidth = CUSTOM_PAGE.width - CUSTOM_PAGE.marginX * 2
    const layout = customLayout({ perSheet: 4, columns: 4 })
    expect(layout.label.width).toBeCloseTo(usableWidth / 4, 5)
  })
})

describe('the printed document at a custom size', () => {
  const render = (perSheet, columns) =>
    labelSheetHtml(
      buildLabels([{ id: 'p', name: 'Scarf', variants: [variant('a')] }], 1),
      {
        layout: customLayout({ perSheet, columns }),
        currencySymbol: '£',
        renderBarcode: (code, options) => `<svg data-module="${options.moduleWidth}"></svg>`,
      },
    )

  it('hands the barcode scale from the layout to the renderer', () => {
    const layout = customLayout({ perSheet: 24 })
    expect(render(24)).toContain(`data-module="${layout.barcode.moduleWidth}"`)
  })

  it('lays out the grid the layout describes', () => {
    const html = render(7, 3)
    expect(html).toContain('grid-template-columns: repeat(3,')
    expect(html).toContain('grid-template-rows: repeat(3,')
    // Nine cells for seven labels: two blanks hold the tail positions.
    expect(html.match(/class="label blank"/g)).toHaveLength(8)
  })
})

describe('choosing the columns', () => {
  it('keeps the bars at full size in preference to a prettier grid', () => {
    for (const count of [4, 8, 12, 16, 20, 24, 30, 40, 60]) {
      const layout = customLayout({ perSheet: count })
      expect(layout.barcode.moduleWidth).toBe(MODULE_WIDTH)
      expect(layout.barcode.scannable).toBe(true)
    }
  })

  it('prefers a grid that uses every cell', () => {
    // 24 tiles exactly as 4 x 6; a squarer 5 x 5 would waste a label and
    // narrow the rest.
    expect(customLayout({ perSheet: 24 })).toMatchObject({ columns: 4, rows: 6, cells: 24 })
  })

  it('wastes at most a row when the count does not tile', () => {
    for (const count of [7, 11, 13, 17, 23, 29]) {
      const layout = customLayout({ perSheet: count })
      expect(layout.cells - count).toBeLessThan(layout.columns)
    }
  })
})

describe('a label too short for everything on it', () => {
  it('keeps all four lines at a comfortable size', () => {
    expect(LABEL_LAYOUTS.a4_12.lines).toEqual({ name: true, color: true, sku: true, price: true })
    expect(customLayout({ perSheet: 24 }).lines).toEqual({ name: true, color: true, sku: true, price: true })
  })

  it('drops the recoverable lines first and the barcode never', () => {
    const dense = customLayout({ perSheet: 48 })
    expect(dense.lines.color).toBe(false)
    expect(dense.lines.sku).toBe(false)
    // Whatever else goes, the bars are still drawn at full width.
    expect(dense.barcode.moduleWidth).toBe(MODULE_WIDTH)
  })

  it('leaves the dropped lines out of the printed markup', () => {
    const layout = customLayout({ perSheet: 48 })
    const html = labelSheetHtml(
      buildLabels([{ id: 'p', name: 'Silk Scarf', variants: [variant('a')] }], 1),
      { layout, currencySymbol: '£', renderBarcode: () => '<svg></svg>' },
    )
    expect(html).not.toContain('Silk Scarf')
    expect(html).not.toContain('SKU-a')
    expect(html).toContain('<svg></svg>')
  })

  it('drops nothing on a flowing layout, which has no height to overflow', () => {
    expect(LABEL_LAYOUTS.compact.lines).toEqual({ name: true, color: true, sku: true, price: true })
  })

  it('fits the content it keeps inside the label', () => {
    for (const count of [12, 24, 40, 48, 60]) {
      const layout = customLayout({ perSheet: count })
      const room = layout.label.height - layout.label.padding * 2
      const text = Object.entries(layout.lines)
        .filter(([, on]) => on)
        .reduce((sum, [line]) => sum + layout.type[line] * 1.25 * 0.3528 + 0.6, 0)
      expect(layout.barcode.height + 4.4 + text).toBeLessThanOrEqual(room + 1e-6)
    }
  })
})

describe('what a label says about the variant', () => {
  const render = (over) =>
    labelSheetHtml(buildLabels([{ id: 'p', name: 'Silk Scarf', variants: [variant('a', over)] }], 1), {
      layout: LABEL_LAYOUTS.a4_12,
      currencySymbol: '£',
      renderBarcode: () => '<svg></svg>',
    })

  it('prints the colour but never the size', () => {
    const html = render({ color: 'Emerald', size: 'XL' })
    expect(html).toContain('Emerald')
    expect(html).not.toContain('XL')
  })

  it('leaves the line out entirely when there is no colour', () => {
    const html = render({ color: '', size: 'XL' })
    expect(html).not.toContain('class="color"')
    expect(html).not.toContain('XL')
  })

  it('still tells two sizes apart by their SKU and barcode', () => {
    const product = {
      id: 'p',
      name: 'Silk Scarf',
      variants: [
        variant('a', { color: 'Emerald', size: 'S', sku: 'TSS-EME-001', barcode: '2001234567895' }),
        variant('b', { color: 'Emerald', size: 'L', sku: 'TSS-EME-002', barcode: '2009876543210' }),
      ],
    }
    const html = labelSheetHtml(buildLabels([product], 1), {
      layout: LABEL_LAYOUTS.a4_12,
      currencySymbol: '£',
      renderBarcode: (code) => `<svg data-code="${code}"></svg>`,
    })
    expect(html).toContain('TSS-EME-001')
    expect(html).toContain('TSS-EME-002')
    expect(html).toContain('data-code="2001234567895"')
    expect(html).toContain('data-code="2009876543210"')
  })
})

/*
 * A roll printer is the one case where the paper is not A4 and there is no grid
 * to tile, so what is checked here is that neither of those leaks in: the page
 * must be the label's own size, and one label must never share a page with
 * another. Both failures are invisible on screen and only show up as a ruined
 * roll.
 */
describe('a thermal roll', () => {
  const label = (over = {}) => ({ id: 'p', name: 'Silk Scarf', variants: [variant('a', over)] })
  const render = (roll, count = 1) =>
    labelSheetHtml(
      buildLabels([label()], count),
      {
        layout: thermalLayout(roll),
        currencySymbol: '£',
        guides: true,
        renderBarcode: (code, options) => `<svg data-module="${options.moduleWidth}"></svg>`,
      },
    )

  it('makes the page the label, not a sheet the label sits on', () => {
    const html = render({ width: 40, height: 30 })
    expect(html).toContain('@page { size: 40mm 30mm; margin: 0; }')
    expect(html).not.toContain('size: A4')
  })

  it('prints one label per page, however many are queued', () => {
    const html = render({ width: 50, height: 30 }, 5)
    expect(html.match(/class="sheet"/g)).toHaveLength(5)
    // Every page is full, so no blank ever pads a roll.
    expect(html).not.toContain('class="label blank"')
  })

  it('leaves the page no margin of its own to add', () => {
    const layout = thermalLayout({ width: 40, height: 30 })
    expect(layout.page).toMatchObject({ width: 40, height: 30, marginX: 0, marginY: 0 })
    expect(layout.perSheet).toBe(1)
    expect(layout.columns * layout.rows).toBe(1)
  })

  it('draws no cut guide, because the die-cut edge already is one', () => {
    // Asked for explicitly, and still refused: the roll has no cut to guide.
    expect(render({ width: 40, height: 30 })).not.toContain('dashed')
  })

  it('gives the margin back to the bars when the label is small', () => {
    const small = thermalLayout({ width: 40, height: 30 })
    // A 40mm label cannot carry the symbol at nominal, so it takes what it can:
    // less padding than the sheet layouts use, and more magnification for it.
    expect(small.label.padding).toBeLessThan(4)
    expect(small.barcode.scannable).toBe(true)
    expect(symbolWidth(small.barcode.moduleWidth)).toBeLessThanOrEqual(
      small.label.width - small.label.padding * 2 + 1e-6,
    )
  })

  it('spends nothing on magnification once the symbol fits at nominal', () => {
    const roomy = thermalLayout({ width: 60, height: 40 })
    expect(roomy.barcode.moduleWidth).toBe(MODULE_WIDTH)
    expect(roomy.label.padding).toBe(3.8)
  })

  it('says when a roll is too narrow for an EAN-13 rather than shrinking it', () => {
    const narrow = thermalLayout({ width: 25, height: 25 })
    expect(narrow.barcode.scannable).toBe(false)
    expect(narrow.barcode.moduleWidth).toBeLessThan(MIN_MODULE_WIDTH)
  })

  it('is scannable at every width with room for the symbol and its padding', () => {
    for (let width = THERMAL_RANGE.minWidth; width <= THERMAL_RANGE.maxWidth; width += 2.5) {
      const layout = thermalLayout({ width, height: 30 })
      const room = width - layout.label.padding * 2
      expect(layout.barcode.scannable).toBe(room >= symbolWidth(MIN_MODULE_WIDTH) - 1e-9)
    }
  })

  it('clamps a size the printer could not take', () => {
    expect(thermalLayout({ width: 0, height: 0 }).label).toMatchObject({
      width: THERMAL_RANGE.minWidth,
      height: THERMAL_RANGE.minHeight,
    })
    expect(thermalLayout({ width: 9000, height: 9000 }).label).toMatchObject({
      width: THERMAL_RANGE.maxWidth,
      height: THERMAL_RANGE.maxHeight,
    })
    expect(thermalLayout({ width: 'nonsense', height: 'nonsense' }).label).toMatchObject({ width: 50.8, height: 50.8 })
    expect(thermalLayout().label).toMatchObject({ width: 50.8, height: 50.8 })
  })

  it('defaults to a 2 x 2in label, carried at nominal with nothing dropped', () => {
    const layout = thermalLayout()
    // 2in is 50.8mm, not 50 — the stock is imperial and the drift would be
    // half a millimetre per label against the printer's gap sensor.
    expect(layout.label).toMatchObject({ width: 50.8, height: 50.8 })
    expect(layout.barcode.moduleWidth).toBe(MODULE_WIDTH)
    expect(layout.lines).toEqual({ name: true, color: true, sku: true, price: true })
  })

  it('drops text rather than the barcode when the roll is short', () => {
    const short = thermalLayout({ width: 50, height: 20 })
    expect(short.lines.color).toBe(false)
    expect(short.barcode.scannable).toBe(true)
  })

  it('hands the roll scale to the renderer, not the caller\'s guess', () => {
    const layout = thermalLayout({ width: 40, height: 30 })
    expect(render({ width: 40, height: 30 })).toContain(`data-module="${layout.barcode.moduleWidth}"`)
  })

  it('leaves the sheet layouts on A4', () => {
    const html = labelSheetHtml(buildLabels([label()], 1), {
      layout: LABEL_LAYOUTS.a4_12,
      currencySymbol: '£',
      renderBarcode: () => '<svg></svg>',
    })
    expect(html).toContain('@page { size: A4; margin: 0; }')
  })
})
