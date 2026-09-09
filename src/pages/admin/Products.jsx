import { useMemo, useState } from 'react'
import { useApp, useCurrency } from '../../lib/store.jsx'
import { EmptyState, Field, ImagePicker, Modal, StatusBadge, Thumb } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import { BulkBar, RowBox, SelectAllBox, useSelection } from '../../components/Selection.jsx'
import { MAIN_LOCATION, uid, variantLabel } from '../../lib/format.js'
import { getStock, hasExhibitionPrice, productCategories } from '../../lib/domain.js'
import { exportCsv } from '../../lib/csv.js'
import { ean13Svg, generateBarcode, isValidEan13, usedBarcodes } from '../../lib/barcode.js'
import {
  CUSTOM_LAYOUT,
  CUSTOM_RANGE,
  DEFAULT_LAYOUT,
  DEFAULT_THERMAL,
  LABEL_LAYOUTS,
  MIN_MODULE_WIDTH,
  MODULE_WIDTH,
  THERMAL_LAYOUT,
  THERMAL_RANGE,
  bestColumns,
  buildLabels,
  customLayout,
  labelSheetHtml,
  sheetSummary,
  symbolWidth,
  thermalLayout,
} from '../../lib/labels.js'

/** Sentinel option value — never a real category name. */
const NEW_CATEGORY = '\u0000new'

const blankVariant = (taken = new Set()) => ({
  id: uid('var'),
  sku: '',
  barcode: generateBarcode(taken),
  size: 'One Size',
  color: '',
  price: 0,
  // `null` means the list price applies at the stall too.
  exhibitionPrice: null,
  cost: 0,
  minStock: 3,
})

const blankProduct = (taken = new Set()) => ({
  id: uid('prd'),
  name: '',
  category: '',
  collection: '',
  description: '',
  status: 'Active',
  image: null,
  variants: [blankVariant(taken)],
})

export default function Products() {
  const { state, activeExhibition, sellLocationId, actions, can } = useApp()
  const currency = useCurrency()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [labels, setLabels] = useState(null)
  const [stocking, setStocking] = useState(null)
  const [barcodes, setBarcodes] = useState(false)
  const canDelete = can('records.delete')
  const canStock = can('stock.adjust')

  const categories = useMemo(() => ['All', ...productCategories(state)], [state])

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return state.products
      .filter((product) => category === 'All' || product.category === category)
      .filter(
        (product) =>
          !needle ||
          product.name.toLowerCase().includes(needle) ||
          product.variants.some(
            (variant) =>
              variant.sku.toLowerCase().includes(needle) || String(variant.barcode).includes(needle),
          ),
      )
      .map((product) => ({
        product,
        mainStock: product.variants.reduce((sum, variant) => sum + getStock(state, MAIN_LOCATION, variant.id), 0),
        exhibitionStock: product.variants.reduce(
          (sum, variant) => sum + getStock(state, sellLocationId, variant.id),
          0,
        ),
      }))
  }, [state, query, category, sellLocationId])

  const selection = useSelection(rows, (row) => row.product.id)

  /*
   * Everything that needs a look: codes that are missing or shared, and codes
   * that are fine as identifiers but cannot be drawn as bars — a barcode from
   * before EAN-13 generation existed prints as plain digits and a laser scanner
   * has nothing to read. Both have to open this door, or a catalogue whose only
   * problem is unprintable codes offers no way in.
   */
  const barcodeGaps = useMemo(
    () => auditBarcodes(state.products).length + unprintable(state.products).length,
    [state.products],
  )

  const exportColumns = [
    { label: 'Product', value: (row) => row.product.name },
    { label: 'Category', value: (row) => row.product.category },
    { label: 'Collection', value: (row) => row.product.collection },
    { label: 'Variants', value: (row) => row.product.variants.length },
    { label: 'Barcodes', value: (row) => row.product.variants.map((v) => v.barcode).join(' ') },
    { label: 'Main stock', value: (row) => row.mainStock },
    { label: 'Exhibition stock', value: (row) => row.exhibitionStock },
    { label: 'Status', value: (row) => row.product.status },
  ]

  return (
    <div className="page">
      <div className="row wrap" style={{ gap: 10 }}>
        <input
          className="input grow"
          style={{ minWidth: 200 }}
          placeholder="Search products, SKU or barcode"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select className="select" style={{ width: 170 }} value={category} onChange={(e) => setCategory(e.target.value)}>
          {categories.map((entry) => (
            <option key={entry}>{entry}</option>
          ))}
        </select>
        <button className="btn" onClick={() => exportCsv('tareez-products', exportColumns, rows)}>
          Export
        </button>
        {/* Whatever the search and category filter have narrowed to — printing
            "the scarves" is a filter away, and needs no delete permission the
            way the tick-box selection does. */}
        <button className="btn" disabled={rows.length === 0} onClick={() => setLabels(rows.map((row) => row.product))}>
          Print labels
        </button>
        {barcodeGaps > 0 && (
          <button className="btn" onClick={() => setBarcodes(true)}>
            Barcodes ({barcodeGaps})
          </button>
        )}
        <button className="btn btn-primary" onClick={() => setEditing(blankProduct(usedBarcodes(state.products)))}>
          + New product
        </button>
      </div>

      {rows.length === 0 && state.products.length > 0 ? (
        <EmptyState title="No products match">
          Nothing in {category === 'All' ? 'the catalogue' : category} matches that search.
        </EmptyState>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No products yet"
          action={
            <button className="btn btn-primary" onClick={() => setEditing(blankProduct(usedBarcodes(state.products)))}>
              Add your first product
            </button>
          }
        >
          Add products with their sizes and colours, then allocate stock to an exhibition.
        </EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                {canDelete && (
                  <th className="check-col">
                    <SelectAllBox selection={selection} />
                  </th>
                )}
                <th>Product</th>
                <th>Category</th>
                <th className="right">Price</th>
                {can('view.cost') && <th className="right">Cost</th>}
                <th className="right">Warehouse</th>
                <th className="right">{activeExhibition ? 'Exhibition' : 'Selling from'}</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map(({ product, mainStock, exhibitionStock }) => {
                const prices = product.variants.map((variant) => variant.price)
                const min = Math.min(...prices)
                const max = Math.max(...prices)
                // Only worth showing when the stall actually charges something else.
                const stallPrices = product.variants
                  .filter((variant) => hasExhibitionPrice(variant) && variant.exhibitionPrice !== variant.price)
                  .map((variant) => Number(variant.exhibitionPrice))
                return (
                  <tr
                    key={product.id}
                    className={`clickable ${selection.isSelected(product.id) ? 'selected' : ''}`}
                    onClick={() => setEditing(structuredClone(product))}
                  >
                    {canDelete && (
                      <td className="check-col" onClick={(event) => event.stopPropagation()}>
                        <RowBox selection={selection} id={product.id} />
                      </td>
                    )}
                    <td>
                      <div className="row">
                        <Thumb src={product.image} name={product.name} style={{ width: 38, height: 38 }} />
                        <div>
                          <div style={{ fontWeight: 620 }}>{product.name}</div>
                          <div className="small muted">
                            {product.variants.length} variant{product.variants.length === 1 ? '' : 's'} ·{' '}
                            {product.collection}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="small">{product.category}</td>
                    <td className="right mono">
                      {min === max ? currency(min) : `${currency(min)}–${currency(max)}`}
                      {stallPrices.length > 0 && (
                        <div className="small muted" style={{ fontWeight: 500 }}>
                          stall{' '}
                          {Math.min(...stallPrices) === Math.max(...stallPrices)
                            ? currency(Math.min(...stallPrices))
                            : `${currency(Math.min(...stallPrices))}–${currency(Math.max(...stallPrices))}`}
                        </div>
                      )}
                    </td>
                    {can('view.cost') && (
                      <td className="right mono small muted">
                        {currency(Math.min(...product.variants.map((variant) => variant.cost)))}
                      </td>
                    )}
                    <td className="right mono">{mainStock}</td>
                    <td className="right mono">{exhibitionStock}</td>
                    <td>
                      <StatusBadge status={product.status} />
                    </td>
                    <td className="right nowrap" onClick={(event) => event.stopPropagation()}>
                      {canStock && (
                        <button className="btn btn-ghost btn-sm" onClick={() => setStocking(product)}>
                          Stock
                        </button>
                      )}
                      <button className="btn btn-ghost btn-sm" onClick={() => setLabels([product])}>
                        Labels
                      </button>
                      {canDelete && (
                        <button
                          className="btn btn-ghost btn-sm"
                          title="Delete product"
                          onClick={() => setDeleting([product])}
                        >
                          <Icon name="trash" size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ProductEditor
          product={editing}
          onClose={() => setEditing(null)}
          onSave={(next, stockEntries) => {
            actions.saveProduct(next)
            if (stockEntries?.length) actions.setStockLevels(stockEntries, 'Set in product editor')
            setEditing(null)
          }}
          onDelete={() => {
            setDeleting([editing])
            setEditing(null)
          }}
        />
      )}

      {labels?.length > 0 && <LabelSheet products={labels} onClose={() => setLabels(null)} />}

      {stocking && <StockModal product={stocking} onClose={() => setStocking(null)} />}

      {barcodes && <BarcodeAudit onClose={() => setBarcodes(false)} />}

      {canDelete && (
        <BulkBar
          selection={selection}
          noun="product"
          onDelete={() => setDeleting(state.products.filter((entry) => selection.isSelected(entry.id)))}
        >
          {/* Printed in catalogue order rather than the order they were ticked,
              so a sheet is easy to check against the products list. */}
          <button
            className="btn btn-sm"
            onClick={() => setLabels(state.products.filter((entry) => selection.isSelected(entry.id)))}
          >
            Labels
          </button>
        </BulkBar>
      )}

      {deleting && (
        <DeleteProductsModal
          products={deleting}
          onClose={() => setDeleting(null)}
          onDone={() => {
            selection.clear()
            setDeleting(null)
          }}
        />
      )}
    </div>
  )
}

/* ---------------------------------------------------------------- delete */

function DeleteProductsModal({ products, onClose, onDone }) {
  const { state, actions } = useApp()
  const currency = useCurrency()

  // Deleting a product that still has stock or sales history is usually a
  // mistake, so show the exposure before the button is pressed.
  const impact = useMemo(() => {
    const variantIds = new Set(products.flatMap((p) => p.variants.map((v) => v.id)))
    let stock = 0
    let value = 0
    for (const product of products) {
      for (const variant of product.variants) {
        for (const row of Object.values(state.inventory)) {
          if (row.variantId === variant.id && row.quantity > 0) {
            stock += row.quantity
            value += row.quantity * variant.price
          }
        }
      }
    }
    const soldIn = state.orders.filter((order) =>
      order.items.some((item) => variantIds.has(item.variantId)),
    ).length
    return { stock, value, soldIn, variants: variantIds.size }
  }, [products, state])

  return (
    <Modal
      open
      onClose={onClose}
      title={products.length === 1 ? 'Delete this product?' : `Delete ${products.length} products?`}
      subtitle={products.length === 1 ? products[0].name : `${impact.variants} variants in total`}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-danger"
            onClick={() => {
              actions.deleteProducts(products.map((product) => product.id))
              onDone()
            }}
          >
            <Icon name="trash" size={15} />
            Delete permanently
          </button>
        </>
      }
    >
      <div className="danger-note">
        This removes the {products.length === 1 ? 'product' : 'products'}, every variant, and their
        stock balances and movement history.
        {impact.stock > 0 && (
          <ul>
            <li>
              {impact.stock} units still in stock ({currency(impact.value)} at retail) will be written off
            </li>
          </ul>
        )}
      </div>

      {impact.soldIn > 0 && (
        <p className="small muted" style={{ margin: 0 }}>
          {impact.soldIn} past sale{impact.soldIn === 1 ? '' : 's'} include{impact.soldIn === 1 ? 's' : ''}{' '}
          {products.length === 1 ? 'this product' : 'these products'}. Those invoices keep their line
          items, so historical revenue reports stay correct — only the catalogue entry goes.
        </p>
      )}

      {products.length > 1 && (
        <div className="stack-sm" style={{ maxHeight: 180, overflowY: 'auto' }}>
          {products.map((product) => (
            <div key={product.id} className="row-between small" style={{ padding: '3px 0' }}>
              <span>{product.name}</span>
              <span className="muted">{product.variants.length} variants</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

/* -------------------------------------------------------------- barcodes */

/**
 * Which variants cannot be labelled as they stand.
 *
 * Deliberately narrow. A blank code has nothing to print, and a shared one
 * scans as the wrong dress — both have to be fixed. Anything else is left
 * alone, because a code that is not EAN-13 is very often a real barcode
 * scanned off a supplier's own garment, and regenerating that would break a
 * label already sewn into the item.
 */
function auditBarcodes(products) {
  const seen = new Set()
  const issues = []
  for (const product of products) {
    for (const variant of product.variants) {
      const code = String(variant.barcode || '').trim()
      if (!code) issues.push({ product, variant, code, reason: 'missing' })
      else if (seen.has(code)) issues.push({ product, variant, code, reason: 'duplicate' })
      if (code) seen.add(code)
    }
  }
  return issues
}

/** Variants whose code is fine but is not a printable EAN-13. */
function unprintable(products) {
  const rows = []
  for (const product of products) {
    for (const variant of product.variants) {
      const code = String(variant.barcode || '').trim()
      if (code && !isValidEan13(code)) rows.push({ product, variant, code })
    }
  }
  return rows
}

function BarcodeAudit({ onClose }) {
  const { state, actions } = useApp()
  const broken = useMemo(() => auditBarcodes(state.products), [state.products])
  const legacy = useMemo(() => unprintable(state.products), [state.products])
  // Pre-ticked when unprintable codes are the only reason this screen opened —
  // otherwise it presents a list of problems with the fix switched off.
  const [alsoReplace, setAlsoReplace] = useState(broken.length === 0 && legacy.length > 0)
  const targets = alsoReplace
    ? [...broken, ...legacy.filter((row) => !broken.some((issue) => issue.variant.id === row.variant.id))]
    : broken

  const run = () => {
    const taken = usedBarcodes(state.products)
    const wanted = new Set(targets.map((row) => row.variant.id))
    // Codes being replaced stop being reservations.
    for (const row of targets) taken.delete(row.code)

    const touched = state.products.filter((product) =>
      product.variants.some((variant) => wanted.has(variant.id)),
    )
    for (const product of touched) {
      const variants = product.variants.map((variant) => {
        if (!wanted.has(variant.id)) return variant
        const fresh = generateBarcode(taken)
        taken.add(fresh)
        return { ...variant, barcode: fresh }
      })
      actions.saveProduct({ ...product, variants })
    }
    actions.toast(`${targets.length} barcode${targets.length === 1 ? '' : 's'} regenerated`, 'success')
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Barcodes"
      subtitle={`${targets.length} variant${targets.length === 1 ? '' : 's'} will get a new code`}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={!targets.length} onClick={run}>
            Generate {targets.length || ''}
          </button>
        </>
      }
    >
      <p className="small muted" style={{ margin: 0 }}>
        New codes are EAN-13 in the 20–29 range, which GS1 reserves for in-store use — they can never
        collide with a real product from a supplier.
      </p>

      {broken.length === 0 ? (
        <p className="small muted" style={{ margin: 0 }}>
          Every variant has its own barcode — nothing is missing or shared.
        </p>
      ) : (
        <div className="stack-sm" style={{ maxHeight: 220, overflowY: 'auto' }}>
          {broken.map((issue) => (
            <div key={issue.variant.id} className="row-between small" style={{ padding: '3px 0' }}>
              <span>
                {issue.product.name} <span className="muted">{variantLabel(issue.variant)}</span>
              </span>
              <span className="badge badge-danger">{issue.reason}</span>
            </div>
          ))}
        </div>
      )}

      {legacy.length > 0 && (
        <label className="checkbox">
          <input
            type="checkbox"
            checked={alsoReplace}
            onChange={(event) => setAlsoReplace(event.target.checked)}
          />
          <span>
            Replace {legacy.length} code{legacy.length === 1 ? '' : 's'} that will not print as a barcode
            <span className="small muted" style={{ display: 'block' }}>
              These still scan as a QR, but they are not valid EAN-13, so the label prints plain digits
              and a laser scanner has nothing to read. Untick this if any of them were scanned from a
              supplier’s own label — regenerating one would break a tag already in the garment.
            </span>
          </span>
        </label>
      )}
    </Modal>
  )
}

/* ----------------------------------------------------------------- stock */

/**
 * The places stock can sit from this screen: the warehouse always, plus the
 * exhibition currently selected for selling. Anything further afield stays on
 * the Inventory page, which can target any exhibition.
 */
function stockLocations(activeExhibition) {
  const list = [{ id: MAIN_LOCATION, label: 'Warehouse stock' }]
  if (activeExhibition) list.push({ id: activeExhibition.id, label: `${activeExhibition.name} stock` })
  return list
}

const stockKey = (locationId, variantId) => `${locationId}:${variantId}`

/**
 * Turns the editable map into absolute counts. A blank box means "leave this
 * count alone" rather than zero, so clearing a field can never write stock off
 * by accident; anything unusable is reported back so the caller can complain.
 */
function stockEntriesFrom(edits, variants) {
  const live = new Set(variants.map((variant) => variant.id))
  const entries = []
  let invalid = false
  for (const [key, raw] of Object.entries(edits)) {
    const split = key.indexOf(':')
    const variantId = key.slice(split + 1)
    // A variant removed in the editor takes its pending counts with it.
    if (!live.has(variantId)) continue
    if (String(raw).trim() === '') continue
    const quantity = Number(raw)
    if (!Number.isFinite(quantity) || quantity < 0) {
      invalid = true
      continue
    }
    entries.push({ locationId: key.slice(0, split), variantId, quantity })
  }
  return { entries, invalid }
}

/** Quick counts-only editor, reached from the Stock button on a product row. */
function StockModal({ product, onClose }) {
  const { state, activeExhibition, actions } = useApp()
  const locations = useMemo(() => stockLocations(activeExhibition), [activeExhibition])
  const [edits, setEdits] = useState({})
  const [note, setNote] = useState('')
  const [error, setError] = useState('')

  const valueFor = (locationId, variant) => {
    const key = stockKey(locationId, variant.id)
    return edits[key] ?? String(getStock(state, locationId, variant.id))
  }

  const save = () => {
    const { entries, invalid } = stockEntriesFrom(edits, product.variants)
    if (invalid) return setError('Stock counts must be zero or more.')
    actions.setStockLevels(entries, note || `Stock set on ${product.name}`)
    return onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Update stock"
      subtitle={product.name}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save}>
            Save stock
          </button>
        </>
      }
    >
      {error && (
        <div className="badge badge-danger" style={{ padding: '10px 14px', borderRadius: 12, whiteSpace: 'normal' }}>
          {error}
        </div>
      )}

      <p className="small muted" style={{ margin: 0 }}>
        Type the count you want each variant to end up on — the difference is written to the stock log
        as an adjustment.
        {!activeExhibition && ' Pick an exhibition to also set stall stock, or use Inventory to transfer.'}
      </p>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Variant</th>
              {locations.map((location) => (
                <th key={location.id} className="right" style={{ width: 130 }}>
                  {location.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {product.variants.map((variant) => (
              <tr key={variant.id}>
                <td>
                  <div style={{ fontWeight: 600 }}>{variantLabel(variant)}</div>
                  <div className="small muted mono">{variant.sku}</div>
                </td>
                {locations.map((location) => (
                  <td key={location.id} className="right">
                    <input
                      className="input right"
                      style={{ width: 92, padding: '7px 9px' }}
                      type="number"
                      min="0"
                      value={valueFor(location.id, variant)}
                      onChange={(event) =>
                        setEdits((current) => ({
                          ...current,
                          [stockKey(location.id, variant.id)]: event.target.value,
                        }))
                      }
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Field label="Reason" hint="Recorded against every line that changes.">
        <input
          className="input"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Delivery received, stock count, damaged…"
        />
      </Field>
    </Modal>
  )
}

/* ---------------------------------------------------------------- editor */

function ProductEditor({ product, onClose, onSave, onDelete }) {
  const { state, activeExhibition, actions, can } = useApp()
  const [draft, setDraft] = useState(product)
  const [stock, setStock] = useState({})
  const [error, setError] = useState('')
  const isNew = !state.products.some((entry) => entry.id === product.id)
  const canStock = can('stock.adjust')
  const locations = useMemo(() => stockLocations(activeExhibition), [activeExhibition])
  const categories = useMemo(() => productCategories(state), [state])
  const [adding, setAdding] = useState(false)
  const [newCategory, setNewCategory] = useState('')

  const cancelCategory = () => {
    setAdding(false)
    setNewCategory('')
  }

  /** Adds the typed category to the managed list and selects it. */
  const commitCategory = () => {
    const name = actions.addCategory(newCategory)
    if (!name) return setError('Give the category a name.')
    patch({ category: name })
    return cancelCategory()
  }

  const patch = (fields) => setDraft((current) => ({ ...current, ...fields }))

  const patchVariant = (id, fields) =>
    setDraft((current) => ({
      ...current,
      variants: current.variants.map((variant) => (variant.id === id ? { ...variant, ...fields } : variant)),
    }))

  /** Codes already spoken for: the rest of the catalogue, plus this draft. */
  const takenBarcodes = (exceptVariantId = null) => {
    const taken = usedBarcodes(state.products, draft.id)
    for (const variant of draft.variants) {
      if (variant.id !== exceptVariantId && variant.barcode) taken.add(String(variant.barcode))
    }
    return taken
  }

  const addVariant = () => {
    const last = draft.variants[draft.variants.length - 1]
    setDraft((current) => ({
      ...current,
      variants: [
        ...current.variants,
        { ...blankVariant(takenBarcodes()), price: last?.price || 0, cost: last?.cost || 0 },
      ],
    }))
  }

  const regenerateBarcode = (variantId) =>
    patchVariant(variantId, { barcode: generateBarcode(takenBarcodes(variantId)) })

  /** Fills in anything blank or duplicated, leaving good codes alone. */
  const fillBarcodes = () =>
    setDraft((current) => {
      const taken = usedBarcodes(state.products, current.id)
      const variants = current.variants.map((variant) => {
        const code = String(variant.barcode || '')
        if (code && !taken.has(code)) {
          taken.add(code)
          return variant
        }
        const fresh = generateBarcode(taken)
        taken.add(fresh)
        return { ...variant, barcode: fresh }
      })
      return { ...current, variants }
    })

  const removeVariant = (id) =>
    setDraft((current) => ({ ...current, variants: current.variants.filter((variant) => variant.id !== id) }))

  /** Builds SKUs from the product name and colour, e.g. Black Silk Scarf → TBSS-BLA-001. */
  const autoSku = () => {
    const base = draft.name
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 3)
    setDraft((current) => ({
      ...current,
      variants: current.variants.map((variant, index) => ({
        ...variant,
        sku: `T${base || 'PRD'}-${(variant.color || 'STD').slice(0, 3).toUpperCase()}-${String(index + 1).padStart(3, '0')}`,
      })),
    }))
  }

  const save = () => {
    if (!draft.name.trim()) return setError('Give the product a name.')
    if (!draft.variants.length) return setError('Add at least one variant.')
    for (const variant of draft.variants) {
      if (!variant.sku.trim()) return setError('Every variant needs a SKU.')
      if (!(variant.price > 0)) return setError(`Set a selling price for ${variant.sku}.`)
      if (hasExhibitionPrice(variant) && !(Number(variant.exhibitionPrice) > 0)) {
        return setError(`Clear the exhibition price for ${variant.sku} or set it above zero.`)
      }
    }
    const skus = draft.variants.map((variant) => variant.sku.trim().toLowerCase())
    if (new Set(skus).size !== skus.length) return setError('Two variants share the same SKU.')

    const clash = state.products
      .filter((entry) => entry.id !== draft.id)
      .flatMap((entry) => entry.variants)
      .find((variant) => skus.includes(variant.sku.toLowerCase()))
    if (clash) return setError(`SKU ${clash.sku} is already used by another product.`)

    // A barcode is printed onto a garment and scanned at the till, so a blank or
    // shared one is worse than a wrong price: it rings up the wrong dress.
    const codes = draft.variants.map((variant) => String(variant.barcode || '').trim())
    if (codes.some((code) => !code)) return setError('Every variant needs a barcode.')
    if (new Set(codes).size !== codes.length) return setError('Two variants share the same barcode.')

    const outside = usedBarcodes(state.products, draft.id)
    const shared = codes.find((code) => outside.has(code))
    if (shared) return setError(`Barcode ${shared} is already used by another product.`)

    // Stock edits ride along with the save.
    const { entries: stockEntries, invalid } = stockEntriesFrom(stock, draft.variants)
    if (invalid) return setError('Stock counts must be zero or more.')

    return onSave(
      {
        ...draft,
        name: draft.name.trim(),
        variants: draft.variants.map((variant) => ({
          ...variant,
          sku: variant.sku.trim(),
          barcode: String(variant.barcode).trim(),
          price: Number(variant.price),
          exhibitionPrice: hasExhibitionPrice(variant) ? Number(variant.exhibitionPrice) : null,
          cost: Number(variant.cost),
          minStock: Number(variant.minStock) || 0,
        })),
      },
      stockEntries,
    )
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={isNew ? 'New product' : draft.name}
      subtitle={isNew ? 'Add a product and its variants' : 'Edit product details'}
      footer={
        <>
          {!isNew && (
            <button className="btn btn-danger" onClick={onDelete}>
              Delete
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save}>
            Save product
          </button>
        </>
      }
    >
      {error && (
        <div className="badge badge-danger" style={{ padding: '10px 14px', borderRadius: 12, whiteSpace: 'normal' }}>
          {error}
        </div>
      )}

      <ImagePicker value={draft.image} name={draft.name} onChange={(image) => patch({ image })} />

      <Field label="Product name">
        <input className="input" value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
      </Field>

      <div className="grid grid-3" style={{ gap: 10 }}>
        <Field label="Category">
          {adding ? (
            <div className="row" style={{ gap: 6 }}>
              <input
                className="input grow"
                autoFocus
                value={newCategory}
                placeholder="e.g. Scarves"
                onChange={(event) => setNewCategory(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    commitCategory()
                  }
                  if (event.key === 'Escape') cancelCategory()
                }}
              />
              <button className="btn btn-sm" onClick={commitCategory}>
                Add
              </button>
              <button className="btn btn-sm btn-ghost" onClick={cancelCategory} aria-label="Cancel">
                ✕
              </button>
            </div>
          ) : (
            <select
              className="select"
              value={draft.category || ''}
              onChange={(event) =>
                event.target.value === NEW_CATEGORY ? setAdding(true) : patch({ category: event.target.value })
              }
            >
              <option value="">No category</option>
              {categories.map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
              <option value={NEW_CATEGORY}>+ New category…</option>
            </select>
          )}
        </Field>
        <Field label="Collection">
          <input
            className="input"
            value={draft.collection}
            onChange={(event) => patch({ collection: event.target.value })}
          />
        </Field>
        <Field label="Status">
          <select className="select" value={draft.status} onChange={(event) => patch({ status: event.target.value })}>
            <option>Active</option>
            <option>Draft</option>
          </select>
        </Field>
      </div>

      <Field label="Description">
        <textarea
          className="textarea"
          style={{ minHeight: 60 }}
          value={draft.description}
          onChange={(event) => patch({ description: event.target.value })}
        />
      </Field>

      <div className="row-between">
        <div className="card-title">Variants</div>
        <div className="row" style={{ gap: 6 }}>
          <button className="btn btn-sm" onClick={autoSku}>
            Auto SKU
          </button>
          <button className="btn btn-sm" title="Fill in missing or duplicated barcodes" onClick={fillBarcodes}>
            Fix barcodes
          </button>
          <button className="btn btn-sm btn-primary" onClick={addVariant}>
            + Variant
          </button>
        </div>
      </div>

      <div className="stack-sm">
        {draft.variants.map((variant) => (
          <div key={variant.id} className="card" style={{ background: 'var(--surface-2)', padding: 12 }}>
            <div className="grid grid-2" style={{ gap: 8 }}>
              <Field label="Colour">
                <input
                  className="input"
                  value={variant.color}
                  onChange={(event) => patchVariant(variant.id, { color: event.target.value })}
                />
              </Field>
              <Field label="Size">
                <input
                  className="input"
                  value={variant.size}
                  onChange={(event) => patchVariant(variant.id, { size: event.target.value })}
                />
              </Field>
              {canStock &&
                locations.map((location) => (
                  <Field
                    key={location.id}
                    label={isNew && location.id === MAIN_LOCATION ? 'Opening stock' : location.label}
                    hint={location.id === MAIN_LOCATION ? 'Saved as a stock adjustment.' : undefined}
                  >
                    <input
                      className="input"
                      type="number"
                      min="0"
                      value={
                        stock[stockKey(location.id, variant.id)] ??
                        String(getStock(state, location.id, variant.id))
                      }
                      onChange={(event) =>
                        setStock((current) => ({
                          ...current,
                          [stockKey(location.id, variant.id)]: event.target.value,
                        }))
                      }
                    />
                  </Field>
                ))}
              <Field label="SKU">
                <input
                  className="input mono"
                  value={variant.sku}
                  onChange={(event) => patchVariant(variant.id, { sku: event.target.value })}
                />
              </Field>
              <Field
                label="Barcode"
                hint={
                  isValidEan13(variant.barcode)
                    ? 'EAN-13 · ready to print and scan'
                    : 'Not a valid EAN-13 — it will still scan, but the check digit is what catches a misread label.'
                }
              >
                <div className="row" style={{ gap: 6 }}>
                  <input
                    className="input mono grow"
                    value={variant.barcode}
                    onChange={(event) => patchVariant(variant.id, { barcode: event.target.value })}
                  />
                  <button
                    className="btn btn-sm"
                    title="Generate a fresh unique barcode"
                    onClick={() => regenerateBarcode(variant.id)}
                  >
                    New
                  </button>
                </div>
              </Field>
              <Field label="Selling price">
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  value={variant.price}
                  onChange={(event) => patchVariant(variant.id, { price: event.target.value })}
                />
              </Field>
              <Field label="Exhibition price" hint="Leave blank to charge the list price at the stall.">
                <input
                  className="input"
                  type="number"
                  step="0.01"
                  placeholder="Same as list"
                  value={hasExhibitionPrice(variant) ? variant.exhibitionPrice : ''}
                  onChange={(event) =>
                    patchVariant(variant.id, {
                      exhibitionPrice: event.target.value === '' ? null : event.target.value,
                    })
                  }
                />
              </Field>
              {can('view.cost') && (
                <Field label="Cost price">
                  <input
                    className="input"
                    type="number"
                    step="0.01"
                    value={variant.cost}
                    onChange={(event) => patchVariant(variant.id, { cost: event.target.value })}
                  />
                </Field>
              )}
              <Field label="Low-stock alert at">
                <input
                  className="input"
                  type="number"
                  value={variant.minStock}
                  onChange={(event) => patchVariant(variant.id, { minStock: event.target.value })}
                />
              </Field>
            </div>
            {draft.variants.length > 1 && (
              <button
                className="btn btn-sm btn-ghost"
                style={{ marginTop: 8 }}
                onClick={() => removeVariant(variant.id)}
              >
                Remove variant
              </button>
            )}
          </div>
        ))}
      </div>
    </Modal>
  )
}

/* ---------------------------------------------------------------- labels */

/** The typed roll size, snapped to what a roll printer will accept. */
const clampRoll = ({ width, height }) => {
  const { label } = thermalLayout({ width, height })
  return { width: label.width, height: label.height }
}

/**
 * The label printer, for one product or for a whole selection.
 *
 * The controls here are the ones that change what comes out of the printer and
 * nothing else: which stock is loaded, how many stickers per variant, and
 * whether the cut lines are wanted. Everything about how a label is drawn lives
 * in `labels.js`, so the preview below and the printed page are built from the
 * same description of the label.
 */
function LabelSheet({ products, onClose }) {
  const { state } = useApp()
  const currency = useCurrency()
  const [layoutId, setLayoutId] = useState(DEFAULT_LAYOUT)
  const [copies, setCopies] = useState(1)
  const [guides, setGuides] = useState(true)
  const [perSheet, setPerSheet] = useState(12)
  // 0 means "work it out from the count" — the column count only becomes the
  // operator's business when they are matching a sheet they already have.
  const [columns, setColumns] = useState(0)
  // The roll in the printer, which nothing here can detect — the operator
  // measures the sticker and types it, and the layout is built from that.
  const [roll, setRoll] = useState(DEFAULT_THERMAL)

  const custom = layoutId === CUSTOM_LAYOUT
  const thermal = layoutId === THERMAL_LAYOUT
  const layout = useMemo(() => {
    if (thermal) return thermalLayout(roll)
    if (custom) return customLayout({ perSheet, columns })
    return LABEL_LAYOUTS[layoutId]
  }, [thermal, roll, custom, layoutId, perSheet, columns])
  const autoColumns = useMemo(() => (custom ? bestColumns(layout.perSheet) : 0), [custom, layout.perSheet])

  /** What a label this size has had to give up, in the words the operator uses. */
  const dropped = useMemo(() => {
    const wording = { name: 'the product name', color: 'the colour', sku: 'the SKU', price: 'the price' }
    return Object.entries(wording)
      .filter(([key]) => layout.lines && !layout.lines[key])
      .map(([, label]) => label)
  }, [layout])
  const labels = useMemo(() => buildLabels(products, copies), [products, copies])
  const summary = sheetSummary(labels.length, layout)

  // One card per variant, not per sticker: a preview that repeated itself
  // twelve times would say nothing the count above it does not already say.
  const previews = useMemo(
    () => products.flatMap((product) => product.variants.map((variant) => ({ product, variant }))),
    [products],
  )
  const unprintable = previews.filter(({ variant }) => !ean13Svg(variant.barcode)).length

  const print = () => {
    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(
      labelSheetHtml(labels, {
        layout,
        currencySymbol: state.settings.currencySymbol,
        guides,
        // The layout decides the scale, having already checked the symbol fits
        // its label — bars stretched to suit a box are bars a scanner refuses.
        renderBarcode: (code, options) => ean13Svg(code, options),
        title: products.length === 1 ? `${products[0].name} labels` : `${products.length} products — labels`,
      }),
    )
    win.document.close()
    setTimeout(() => win.print(), 400)
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title="Product labels"
      subtitle={
        products.length === 1
          ? `${products[0].name} · one barcode per variant`
          : `${products.length} products · one barcode per variant`
      }
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button className="btn btn-primary" onClick={print} disabled={labels.length === 0}>
            Print {labels.length} label{labels.length === 1 ? '' : 's'}
          </button>
        </>
      }
    >
      <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
        <Field label="Sheet layout">
          <select
            className="select"
            style={{ width: 190 }}
            value={layoutId}
            onChange={(event) => setLayoutId(event.target.value)}
          >
            {Object.values(LABEL_LAYOUTS).map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
            <option value={CUSTOM_LAYOUT}>Custom number per sheet</option>
            <option value={THERMAL_LAYOUT}>Thermal roll (one at a time)</option>
          </select>
        </Field>

        {thermal && (
          <>
            {/*
              Stepped in hundredths, not halves: the stock is imperial, so the
              sizes actually sold land on hundredths of a millimetre — 2.25in is
              57.15mm — and a half-millimetre step could neither reach them nor
              hold the default once the spinner was touched.
            */}
            <Field label="Label width (mm)">
              <input
                className="input"
                style={{ width: 120 }}
                type="number"
                min={THERMAL_RANGE.minWidth}
                max={THERMAL_RANGE.maxWidth}
                step="0.05"
                value={roll.width}
                onChange={(event) => setRoll((current) => ({ ...current, width: event.target.value }))}
                onBlur={() => setRoll(({ width, height }) => clampRoll({ width, height }))}
              />
            </Field>
            <Field label="Label height (mm)">
              <input
                className="input"
                style={{ width: 120 }}
                type="number"
                min={THERMAL_RANGE.minHeight}
                max={THERMAL_RANGE.maxHeight}
                step="0.05"
                value={roll.height}
                onChange={(event) => setRoll((current) => ({ ...current, height: event.target.value }))}
                onBlur={() => setRoll(({ width, height }) => clampRoll({ width, height }))}
              />
            </Field>
          </>
        )}

        {custom && (
          <>
            <Field label="Labels per sheet">
              <input
                className="input"
                style={{ width: 120 }}
                type="number"
                min={CUSTOM_RANGE.min}
                max={CUSTOM_RANGE.max}
                value={perSheet}
                onChange={(event) => setPerSheet(event.target.value)}
                onBlur={() =>
                  setPerSheet((current) =>
                    Math.min(
                      CUSTOM_RANGE.max,
                      Math.max(CUSTOM_RANGE.min, Math.floor(Number(current) || CUSTOM_RANGE.min)),
                    ),
                  )
                }
              />
            </Field>
            <Field label="Columns">
              <select
                className="select"
                style={{ width: 130 }}
                value={columns}
                onChange={(event) => setColumns(Number(event.target.value))}
              >
                {/* Reports what Auto would choose, not what is chosen — once
                    overridden, `layout.columns` is the override. */}
                <option value={0}>Auto ({autoColumns})</option>
                {Array.from({ length: Math.min(8, layout.perSheet) }, (_, index) => index + 1).map((count) => (
                  <option key={count} value={count}>
                    {count} across
                  </option>
                ))}
              </select>
            </Field>
          </>
        )}
        <Field label="Copies per variant">
          <input
            className="input"
            style={{ width: 120 }}
            type="number"
            min="1"
            max="200"
            value={copies}
            onChange={(event) => setCopies(event.target.value)}
            onBlur={() => setCopies((current) => Math.min(200, Math.max(1, Math.floor(Number(current) || 1))))}
          />
        </Field>
        {/* A roll is die-cut, so its edge is the cut — a printed guide would
            only be a line sitting just inside it. */}
        {!thermal && (
          <label className="row" style={{ gap: 7, paddingBottom: 9 }}>
            <input
              type="checkbox"
              className="row-check"
              checked={guides}
              onChange={(event) => setGuides(event.target.checked)}
            />
            <span className="small">Show cut guides</span>
          </label>
        )}
      </div>

      <div className="small muted">{layout.hint}</div>

      {dropped.length > 0 && (
        <div className="badge badge-warn" style={{ padding: '10px 14px', borderRadius: 12, whiteSpace: 'normal' }}>
          Too short for everything — {dropped.join(' and ')} {dropped.length === 1 ? 'is' : 'are'} left off so the
          barcode is not clipped. {thermal ? 'A taller roll' : 'Fewer per sheet'} fits{' '}
          {dropped.length === 1 ? 'it' : 'them'} back on.
        </div>
      )}

      {!layout.barcode.scannable && (
        <div className="badge badge-danger" style={{ padding: '10px 14px', borderRadius: 12, whiteSpace: 'normal' }}>
          These labels are too narrow for a readable barcode — at {layout.label.width}mm the symbol prints below
          the {Math.round((MIN_MODULE_WIDTH / MODULE_WIDTH) * 100)}% minimum a scanner can resolve.{' '}
          {thermal
            ? `An EAN-13 needs ${Math.ceil(symbolWidth(MIN_MODULE_WIDTH) + 3)}mm of label at the very least — use a wider roll.`
            : `Use fewer per sheet, or ${layout.columns > 1 ? 'fewer columns' : 'a wider label'}.`}
        </div>
      )}

      <div className="badge badge-brand" style={{ padding: '10px 14px', borderRadius: 12, whiteSpace: 'normal' }}>
        {labels.length} label{labels.length === 1 ? '' : 's'}
        {thermal && ` · ${layout.label.width} x ${layout.label.height}mm · one per print`}
        {!thermal && summary.perSheet > 0 && (
          <>
            {' · '}
            {summary.sheets} sheet{summary.sheets === 1 ? '' : 's'}
            {summary.blanks > 0 &&
              ` · ${summary.blanks} unused label${summary.blanks === 1 ? '' : 's'} on the last sheet`}
          </>
        )}
      </div>

      {unprintable > 0 && (
        <div className="badge badge-danger" style={{ padding: '10px 14px', borderRadius: 12, whiteSpace: 'normal' }}>
          {unprintable} variant{unprintable === 1 ? ' has a barcode that' : 's have barcodes that'} cannot be
          encoded — use Barcodes on the products list to regenerate {unprintable === 1 ? 'it' : 'them'} before
          printing.
        </div>
      )}

      <div className="grid grid-2" style={{ gap: 10 }}>
        {previews.map(({ product, variant }) => (
          <div
            key={variant.id}
            className="card"
            style={{ background: 'var(--surface-2)', padding: 12, textAlign: 'center', gap: 2 }}
          >
            {products.length > 1 && <div style={{ fontWeight: 620, fontSize: 13.5 }}>{product.name}</div>}
            {/* The label carries the colour but not the size, so the preview
                does the same. The SKU underneath is what tells two sizes of the
                same colour apart. */}
            <div className={products.length > 1 ? 'small muted' : ''} style={{ fontWeight: 620, fontSize: 13.5 }}>
              {variant.color}
            </div>
            <div className="small muted mono">{variant.sku}</div>
            {ean13Svg(variant.barcode) ? (
              <div
                style={{ margin: '6px 0' }}
                // The same renderer the printout uses, so the preview is what
                // comes out of the printer.
                dangerouslySetInnerHTML={{ __html: ean13Svg(variant.barcode, { height: 14 }) }}
              />
            ) : (
              <div className="small muted mono" style={{ margin: '6px 0' }}>
                {variant.barcode} — not printable, use Barcodes to regenerate
              </div>
            )}
            <div style={{ fontWeight: 700 }}>{currency(variant.price)}</div>
          </div>
        ))}
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        {thermal
          ? `Set the printer's paper size to ${layout.label.width} x ${layout.label.height}mm and print at 100% with no "fit to page" — a barcode the driver has scaled is a barcode that will not scan.`
          : 'Print at 100% with no "fit to page" — scaling a barcode is what stops it scanning.'}
      </p>
    </Modal>
  )
}
