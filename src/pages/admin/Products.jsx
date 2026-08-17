import { useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { useApp, useCurrency } from '../../lib/store.jsx'
import { EmptyState, Field, ImagePicker, Modal, StatusBadge, Thumb } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import { BulkBar, RowBox, SelectAllBox, useSelection } from '../../components/Selection.jsx'
import { MAIN_LOCATION, uid } from '../../lib/format.js'
import { getStock, hasExhibitionPrice } from '../../lib/domain.js'
import { exportCsv } from '../../lib/csv.js'

const blankVariant = () => ({
  id: uid('var'),
  sku: '',
  barcode: String(Date.now()).slice(-12),
  size: 'One Size',
  color: '',
  price: 0,
  // `null` means the list price applies at the stall too.
  exhibitionPrice: null,
  cost: 0,
  minStock: 3,
})

const blankProduct = () => ({
  id: uid('prd'),
  name: '',
  category: '',
  collection: '',
  description: '',
  status: 'Active',
  image: null,
  variants: [blankVariant()],
})

export default function Products() {
  const { state, activeExhibition, sellLocationId, actions, can } = useApp()
  const currency = useCurrency()
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [labels, setLabels] = useState(null)
  const canDelete = can('records.delete')

  const categories = useMemo(
    () => ['All', ...new Set(state.products.map((product) => product.category).filter(Boolean))],
    [state.products],
  )

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

  const exportColumns = [
    { label: 'Product', value: (row) => row.product.name },
    { label: 'Category', value: (row) => row.product.category },
    { label: 'Collection', value: (row) => row.product.collection },
    { label: 'Variants', value: (row) => row.product.variants.length },
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
        <button className="btn btn-primary" onClick={() => setEditing(blankProduct())}>
          + New product
        </button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="No products yet"
          action={
            <button className="btn btn-primary" onClick={() => setEditing(blankProduct())}>
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
                      <button className="btn btn-ghost btn-sm" onClick={() => setLabels(product)}>
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
          onSave={(next) => {
            actions.saveProduct(next)
            setEditing(null)
          }}
          onDelete={() => {
            setDeleting([editing])
            setEditing(null)
          }}
        />
      )}

      {labels && <LabelSheet product={labels} onClose={() => setLabels(null)} />}

      {canDelete && (
        <BulkBar
          selection={selection}
          noun="product"
          onDelete={() => setDeleting(state.products.filter((entry) => selection.isSelected(entry.id)))}
        />
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

/* ---------------------------------------------------------------- editor */

function ProductEditor({ product, onClose, onSave, onDelete }) {
  const { state, can } = useApp()
  const [draft, setDraft] = useState(product)
  const [error, setError] = useState('')
  const isNew = !state.products.some((entry) => entry.id === product.id)

  const patch = (fields) => setDraft((current) => ({ ...current, ...fields }))

  const patchVariant = (id, fields) =>
    setDraft((current) => ({
      ...current,
      variants: current.variants.map((variant) => (variant.id === id ? { ...variant, ...fields } : variant)),
    }))

  const addVariant = () => {
    const last = draft.variants[draft.variants.length - 1]
    setDraft((current) => ({
      ...current,
      variants: [...current.variants, { ...blankVariant(), price: last?.price || 0, cost: last?.cost || 0 }],
    }))
  }

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

    return onSave({
      ...draft,
      name: draft.name.trim(),
      variants: draft.variants.map((variant) => ({
        ...variant,
        sku: variant.sku.trim(),
        price: Number(variant.price),
        exhibitionPrice: hasExhibitionPrice(variant) ? Number(variant.exhibitionPrice) : null,
        cost: Number(variant.cost),
        minStock: Number(variant.minStock) || 0,
      })),
    })
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
          <input
            className="input"
            list="category-list"
            value={draft.category}
            onChange={(event) => patch({ category: event.target.value })}
          />
          <datalist id="category-list">
            {[...new Set(state.products.map((entry) => entry.category))].map((entry) => (
              <option key={entry} value={entry} />
            ))}
          </datalist>
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
              <Field label="SKU">
                <input
                  className="input mono"
                  value={variant.sku}
                  onChange={(event) => patchVariant(variant.id, { sku: event.target.value })}
                />
              </Field>
              <Field label="Barcode">
                <input
                  className="input mono"
                  value={variant.barcode}
                  onChange={(event) => patchVariant(variant.id, { barcode: event.target.value })}
                />
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

function LabelSheet({ product, onClose }) {
  const { state } = useApp()
  const currency = useCurrency()
  const [codes, setCodes] = useState({})

  useEffect(() => {
    let cancelled = false
    Promise.all(
      product.variants.map(async (variant) => [
        variant.id,
        await QRCode.toDataURL(variant.barcode, { margin: 0, width: 220, errorCorrectionLevel: 'M' }),
      ]),
    ).then((pairs) => !cancelled && setCodes(Object.fromEntries(pairs)))
    return () => {
      cancelled = true
    }
  }, [product])

  const print = () => {
    const win = window.open('', '_blank')
    if (!win) return
    const cards = product.variants
      .map(
        (variant) => `
        <div class="label">
          <img src="${codes[variant.id] || ''}" />
          <div class="meta">
            <strong>${product.name}</strong>
            <span>${[variant.color, variant.size].filter(Boolean).join(' / ')}</span>
            <span class="sku">${variant.sku}</span>
            <span class="code">${variant.barcode}</span>
            <span class="price">${state.settings.currencySymbol}${Number(variant.price).toFixed(2)}</span>
          </div>
        </div>`,
      )
      .join('')
    win.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${product.name} labels</title><style>
      body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; padding: 14px; display: flex; flex-wrap: wrap; gap: 10px; }
      .label { width: 175px; border: 1px dashed #bbb; border-radius: 8px; padding: 10px; display: flex; gap: 9px; align-items: center; }
      .label img { width: 62px; height: 62px; }
      .meta { display: flex; flex-direction: column; font-size: 10px; line-height: 1.35; min-width: 0; }
      .meta strong { font-size: 11px; }
      .sku, .code { font-family: monospace; color: #555; }
      .price { font-weight: 700; font-size: 13px; margin-top: 3px; }
    </style></head><body>${cards}</body></html>`)
    win.document.close()
    setTimeout(() => win.print(), 400)
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Product labels"
      subtitle={`${product.name} · scannable QR per variant`}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Close
          </button>
          <button className="btn btn-primary" onClick={print}>
            Print labels
          </button>
        </>
      }
    >
      <div className="grid grid-2" style={{ gap: 10 }}>
        {product.variants.map((variant) => (
          <div key={variant.id} className="card row" style={{ background: 'var(--surface-2)', padding: 12 }}>
            {codes[variant.id] ? (
              <img
                src={codes[variant.id]}
                alt=""
                style={{ width: 64, height: 64, background: '#fff', borderRadius: 6, padding: 4 }}
              />
            ) : (
              <div className="spinner" />
            )}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 620, fontSize: 13.5 }}>
                {[variant.color, variant.size].filter(Boolean).join(' / ')}
              </div>
              <div className="small muted mono">{variant.sku}</div>
              <div className="small muted mono">{variant.barcode}</div>
              <div style={{ fontWeight: 700, marginTop: 3 }}>{currency(variant.price)}</div>
            </div>
          </div>
        ))}
      </div>
      <p className="small muted" style={{ margin: 0 }}>
        The POS scanner reads these QR labels as well as printed retail barcodes (EAN, UPC, Code 128/39).
      </p>
    </Modal>
  )
}
