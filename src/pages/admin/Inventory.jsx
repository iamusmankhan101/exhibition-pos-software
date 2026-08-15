import { useMemo, useState } from 'react'
import { useApp, useCurrency } from '../../lib/store.jsx'
import { EmptyState, Field, Modal, Tabs } from '../../components/ui.jsx'
import { MAIN_LOCATION, formatDate, variantLabel } from '../../lib/format.js'
import { allVariants, getStock } from '../../lib/domain.js'
import { exportCsv } from '../../lib/csv.js'

export default function Inventory() {
  const { state, activeExhibition, actions, can } = useApp()
  const currency = useCurrency()
  const [tab, setTab] = useState('levels')
  const [query, setQuery] = useState('')
  const [transfers, setTransfers] = useState({})
  const [adjusting, setAdjusting] = useState(null)
  const [direction, setDirection] = useState('toExhibition')

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return allVariants(state)
      .map(({ product, variant }) => ({
        key: variant.id,
        product,
        variant,
        main: getStock(state, MAIN_LOCATION, variant.id),
        exhibition: activeExhibition ? getStock(state, activeExhibition.id, variant.id) : 0,
      }))
      .filter(
        (row) =>
          !needle ||
          row.product.name.toLowerCase().includes(needle) ||
          row.variant.sku.toLowerCase().includes(needle) ||
          String(row.variant.barcode).includes(needle) ||
          row.variant.color.toLowerCase().includes(needle),
      )
  }, [state, query, activeExhibition])

  const queued = Object.entries(transfers).filter(([, quantity]) => Number(quantity) > 0)

  const runTransfers = () => {
    if (!activeExhibition) return
    let moved = 0
    for (const [variantId, quantity] of queued) {
      const amount = Number(quantity)
      const source = direction === 'toExhibition' ? MAIN_LOCATION : activeExhibition.id
      const target = direction === 'toExhibition' ? activeExhibition.id : MAIN_LOCATION
      const available = getStock(state, source, variantId)
      if (amount > available) {
        actions.toast(`Not enough stock to move ${amount} units`, 'warn')
        continue
      }
      actions.transferStock({ variantId, fromLocation: source, toLocation: target, quantity: amount })
      moved += 1
    }
    if (moved) {
      actions.toast(
        `${moved} product${moved === 1 ? '' : 's'} moved ${direction === 'toExhibition' ? 'to' : 'from'} ${activeExhibition.name}`,
        'success',
      )
    }
    setTransfers({})
  }

  const movements = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return state.movements
      .map((movement) => {
        const match = allVariants(state).find((entry) => entry.variant.id === movement.variantId)
        return { ...movement, product: match?.product, variant: match?.variant }
      })
      .filter((movement) => movement.product)
      .filter(
        (movement) =>
          !needle ||
          movement.product.name.toLowerCase().includes(needle) ||
          movement.variant.sku.toLowerCase().includes(needle) ||
          movement.reference.toLowerCase().includes(needle),
      )
      .slice(0, 300)
  }, [state, query])

  const locationName = (id) =>
    id === MAIN_LOCATION ? 'Main warehouse' : state.exhibitions.find((entry) => entry.id === id)?.name || id

  const stockColumns = [
    { label: 'Product', value: (row) => row.product.name },
    { label: 'Variant', value: (row) => variantLabel(row.variant) },
    { label: 'SKU', value: (row) => row.variant.sku },
    { label: 'Barcode', value: (row) => row.variant.barcode },
    { label: 'Warehouse', value: (row) => row.main },
    { label: 'Exhibition', value: (row) => row.exhibition },
    { label: 'Price', value: (row) => row.variant.price.toFixed(2) },
  ]

  return (
    <div className="page">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'levels', label: 'Stock levels' },
          { value: 'movements', label: 'Stock movements' },
        ]}
      />

      <div className="row wrap" style={{ gap: 10 }}>
        <input
          className="input grow"
          style={{ minWidth: 200 }}
          placeholder="Search product, SKU, barcode…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {tab === 'levels' && (
          <>
            <select className="select" style={{ width: 210 }} value={direction} onChange={(e) => setDirection(e.target.value)}>
              <option value="toExhibition">Warehouse → Exhibition</option>
              <option value="toWarehouse">Exhibition → Warehouse</option>
            </select>
            <button className="btn" onClick={() => exportCsv('tareez-inventory', stockColumns, rows)}>
              Export
            </button>
            <button className="btn btn-primary" disabled={!queued.length || !activeExhibition} onClick={runTransfers}>
              Transfer {queued.length || ''}
            </button>
          </>
        )}
      </div>

      {tab === 'levels' ? (
        <>
          <div className="card" style={{ padding: 14, background: 'var(--surface-2)' }}>
            <div className="small muted">
              Enter quantities in the transfer column, then press Transfer. Exhibition stock is kept separate from
              the warehouse so stall sales never touch main inventory.
            </div>
          </div>

          {rows.length === 0 ? (
            <EmptyState title="No products found">Adjust your search.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>SKU</th>
                    <th className="right">Warehouse</th>
                    <th className="right">{activeExhibition?.name || 'Exhibition'}</th>
                    <th className="right" style={{ width: 130 }}>
                      Transfer
                    </th>
                    {can('stock.adjust') && <th />}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const low = row.exhibition <= (row.variant.minStock ?? state.settings.lowStockThreshold)
                    return (
                      <tr key={row.key}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{row.product.name}</div>
                          <div className="small muted">{variantLabel(row.variant)}</div>
                        </td>
                        <td className="mono small">{row.variant.sku}</td>
                        <td className="right mono">{row.main}</td>
                        <td className="right mono">
                          <span style={low ? { color: row.exhibition <= 0 ? 'var(--danger)' : 'var(--warn)' } : undefined}>
                            {row.exhibition}
                          </span>
                        </td>
                        <td className="right">
                          <input
                            className="input right"
                            style={{ width: 92, padding: '7px 9px' }}
                            type="number"
                            min="0"
                            placeholder="0"
                            value={transfers[row.key] || ''}
                            onChange={(event) =>
                              setTransfers((current) => ({ ...current, [row.key]: event.target.value }))
                            }
                          />
                        </td>
                        {can('stock.adjust') && (
                          <td className="right">
                            <button className="btn btn-ghost btn-sm" onClick={() => setAdjusting(row)}>
                              Adjust
                            </button>
                          </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>When</th>
                <th>Product</th>
                <th>Location</th>
                <th>Type</th>
                <th className="right">Change</th>
                <th className="right">Balance</th>
                <th>Reference</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((movement) => (
                <tr key={movement.id}>
                  <td className="small nowrap">{formatDate(movement.createdAt, true)}</td>
                  <td>
                    <div style={{ fontWeight: 600 }}>{movement.product.name}</div>
                    <div className="small muted mono">{movement.variant.sku}</div>
                  </td>
                  <td className="small">{locationName(movement.locationId)}</td>
                  <td>
                    <span className="badge">{movement.type}</span>
                  </td>
                  <td
                    className="right mono"
                    style={{ color: movement.quantity < 0 ? 'var(--danger)' : 'var(--good)', fontWeight: 650 }}
                  >
                    {movement.quantity > 0 ? '+' : ''}
                    {movement.quantity}
                  </td>
                  <td className="right mono">{movement.balanceAfter}</td>
                  <td className="small muted">{movement.reference || movement.note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adjusting && (
        <AdjustModal
          row={adjusting}
          onClose={() => setAdjusting(null)}
          currency={currency}
          onSave={(locationId, quantity, note) => {
            actions.adjustStock({ variantId: adjusting.variant.id, locationId, quantity, note })
            setAdjusting(null)
          }}
        />
      )}
    </div>
  )
}

function AdjustModal({ row, onClose, onSave }) {
  const { activeExhibition } = useApp()
  const [location, setLocation] = useState(activeExhibition?.id || MAIN_LOCATION)
  const [quantity, setQuantity] = useState(location === MAIN_LOCATION ? row.main : row.exhibition)
  const [note, setNote] = useState('')

  const current = location === MAIN_LOCATION ? row.main : row.exhibition

  return (
    <Modal
      open
      onClose={onClose}
      title="Adjust stock"
      subtitle={`${row.product.name} · ${variantLabel(row.variant)}`}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => onSave(location, Number(quantity), note)}>
            Save adjustment
          </button>
        </>
      }
    >
      <Field label="Location">
        <select
          className="select"
          value={location}
          onChange={(event) => {
            setLocation(event.target.value)
            setQuantity(event.target.value === MAIN_LOCATION ? row.main : row.exhibition)
          }}
        >
          <option value={MAIN_LOCATION}>Main warehouse</option>
          {activeExhibition && <option value={activeExhibition.id}>{activeExhibition.name}</option>}
        </select>
      </Field>

      <Field label="Counted quantity" hint={`System currently shows ${current}.`}>
        <input
          className="input"
          type="number"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value)}
        />
      </Field>

      <Field label="Reason" hint="Recorded in the audit log.">
        <input
          className="input"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Stock count, damaged item, sample…"
        />
      </Field>

      <p className="small muted" style={{ margin: 0 }}>
        The difference of {Number(quantity) - current > 0 ? '+' : ''}
        {Number(quantity) - current} units will be written as an adjustment movement.
      </p>
    </Modal>
  )
}
