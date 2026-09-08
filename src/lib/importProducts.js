/**
 * Building a catalogue out of a folder of product photographs.
 *
 * Entering a stall's stock one product at a time through the editor is fine for
 * a correction and hopeless for a first load: fifty dresses is fifty modals,
 * each with a name to type, a SKU to invent and a barcode to remember to
 * generate. What the business actually has to hand is a folder of photos and a
 * price per photo, so that is what this takes — one row per image, everything
 * else derived and then editable before anything is written.
 *
 * The derivations are deliberately dumb and visible: a name guessed from a file
 * name is a starting point the importer can see and correct in the grid, which
 * is safer than a clever guess that is silently wrong on the shelf label. What
 * is *not* left to the importer is the part a human gets wrong — SKU and
 * barcode uniqueness, checked here against the whole catalogue and the rest of
 * the batch, because a duplicate barcode rings up the wrong dress at the till.
 */

import { MAIN_LOCATION, uid } from './format.js'
import { generateBarcode, isValidEan13, usedBarcodes } from './barcode.js'

/** Camera and phone file names that carry no product information at all. */
const NOISE = /^(img|image|photo|dsc|dscn|pxl|screenshot|whatsapp image|final|copy of)\b[\s_-]*/i

/**
 * A product name guessed from a file name.
 *
 * `black-silk-scarf_02.jpg` becomes "Black Silk Scarf". The trailing counter
 * goes because it numbers the shot, not the garment, and a name ending in "2"
 * would be printed onto the label. An unrecoverable name — `IMG_4471.jpg` —
 * comes back empty rather than as "4471": a blank cell reads as "you need to
 * fill this in", which is exactly the state it is in.
 */
export function nameFromFilename(filename) {
  const base = String(filename || '')
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const withoutNoise = base.replace(NOISE, '').trim()
  // A trailing shot number ("scarf 2", "scarf 02") but never a size or a count
  // that is the whole name.
  const cleaned = withoutNoise.replace(/\s+\d{1,3}$/, '').trim() || withoutNoise
  if (!cleaned || /^\d+$/.test(cleaned)) return ''
  return cleaned
    .split(' ')
    .map((word) => (word.length > 2 && word === word.toUpperCase() ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ')
}

/** The letters a SKU is built from: initials of the name, or PRD if there are none. */
function skuBase(name) {
  const initials = String(name || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join('')
    .replace(/[^a-z0-9]/gi, '')
    .toUpperCase()
    .slice(0, 3)
  return initials || 'PRD'
}

/**
 * A SKU in the same shape the editor's "Auto SKU" produces — `TBSS-BLA-001` —
 * counting up past anything already taken rather than colliding with it.
 */
export function skuFor(name, color, taken = new Set()) {
  const stem = `T${skuBase(name)}-${(String(color || '').replace(/[^a-z0-9]/gi, '') || 'STD').slice(0, 3).toUpperCase()}`
  for (let index = 1; index < 1000; index += 1) {
    const candidate = `${stem}-${String(index).padStart(3, '0')}`
    if (!taken.has(candidate.toLowerCase())) return candidate
  }
  return `${stem}-${uid('x').slice(-4).toUpperCase()}`
}

/** Every SKU the catalogue already uses, lowercased for comparison. */
export function usedSkus(products = []) {
  const taken = new Set()
  for (const product of products) {
    for (const variant of product.variants || []) taken.add(String(variant.sku || '').trim().toLowerCase())
  }
  taken.delete('')
  return taken
}

/**
 * One editable row per picked image.
 *
 * SKUs and barcodes are allocated here, at pick time, rather than at import:
 * the importer can see them in the grid and print labels from them, and two
 * rows in the same batch cannot be handed the same number because each
 * allocation is added to `taken` before the next runs.
 */
export function buildRows(files, existingProducts = []) {
  const skus = usedSkus(existingProducts)
  const codes = usedBarcodes(existingProducts)
  return files.map(({ fileName, image }) => {
    const name = nameFromFilename(fileName)
    const sku = skuFor(name, '', skus)
    skus.add(sku.toLowerCase())
    const barcode = generateBarcode(codes)
    codes.add(barcode)
    return {
      id: uid('row'),
      fileName,
      image,
      name,
      category: '',
      collection: '',
      size: 'One Size',
      color: '',
      price: '',
      cost: '',
      stock: '',
      sku,
      barcode,
    }
  })
}

/**
 * What is wrong with the batch, keyed by row id, plus a batch-wide list.
 *
 * The same rules the single-product editor enforces, applied across every row
 * at once — an import that saved twenty products and then refused the
 * twenty-first would leave the catalogue half-written with no obvious way back.
 */
export function validateRows(rows, existingProducts = []) {
  const byRow = {}
  const fail = (row, message) => {
    if (!byRow[row.id]) byRow[row.id] = message
  }

  const outsideSkus = usedSkus(existingProducts)
  const outsideCodes = usedBarcodes(existingProducts)
  const seenSkus = new Map()
  const seenCodes = new Map()

  for (const row of rows) {
    const name = String(row.name || '').trim()
    const sku = String(row.sku || '').trim()
    const barcode = String(row.barcode || '').trim()
    const price = Number(row.price)
    const cost = Number(row.cost || 0)
    const stock = String(row.stock ?? '').trim() === '' ? 0 : Number(row.stock)

    if (!name) fail(row, 'Needs a name')
    if (!sku) fail(row, 'Needs a SKU')
    if (!(price > 0)) fail(row, 'Needs a price above zero')
    if (!Number.isFinite(cost) || cost < 0) fail(row, 'Cost must be zero or more')
    if (!Number.isFinite(stock) || stock < 0) fail(row, 'Stock must be zero or more')
    if (!isValidEan13(barcode)) fail(row, 'Barcode is not a valid EAN-13')

    const skuKey = sku.toLowerCase()
    if (skuKey) {
      if (outsideSkus.has(skuKey)) fail(row, `SKU ${sku} is already in the catalogue`)
      else if (seenSkus.has(skuKey)) fail(row, `SKU ${sku} is used twice in this batch`)
      else seenSkus.set(skuKey, row.id)
    }
    if (barcode) {
      if (outsideCodes.has(barcode)) fail(row, `Barcode ${barcode} is already in the catalogue`)
      else if (seenCodes.has(barcode)) fail(row, `Barcode ${barcode} is used twice in this batch`)
      else seenCodes.set(barcode, row.id)
    }
  }

  return { byRow, ok: Object.keys(byRow).length === 0 }
}

/**
 * The rows as products and warehouse stock counts.
 *
 * One variant per row: a photograph is of one thing, and a dress that comes in
 * four sizes is four rows or a trip to the editor afterwards. Stock lands at
 * `MAIN_LOCATION` because that is the warehouse — allocating it to a stall is a
 * transfer somebody makes deliberately, not something an import should assume.
 */
export function rowsToProducts(rows) {
  const products = []
  const stockEntries = []
  for (const row of rows) {
    const variantId = uid('var')
    const quantity = String(row.stock ?? '').trim() === '' ? 0 : Number(row.stock)
    products.push({
      id: uid('prd'),
      name: String(row.name).trim(),
      category: String(row.category || '').trim(),
      collection: String(row.collection || '').trim(),
      description: '',
      status: 'Active',
      image: row.image || null,
      variants: [
        {
          id: variantId,
          sku: String(row.sku).trim(),
          barcode: String(row.barcode).trim(),
          size: String(row.size || '').trim(),
          color: String(row.color || '').trim(),
          price: Number(row.price),
          // The stall charges the list price unless somebody says otherwise.
          exhibitionPrice: null,
          cost: Number(row.cost || 0),
          minStock: 3,
        },
      ],
    })
    if (quantity > 0) stockEntries.push({ locationId: MAIN_LOCATION, variantId, quantity })
  }
  return { products, stockEntries }
}
