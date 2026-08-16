import { useMemo, useState } from 'react'
import { useApp, useCurrency } from '../../lib/store.jsx'
import { Confirm, EmptyState, Field, Modal, Tabs } from '../../components/ui.jsx'
import { BulkBar, RowBox, SelectAllBox, useSelection } from '../../components/Selection.jsx'
import { MAIN_LOCATION, formatDate, variantLabel } from '../../lib/format.js'
import { allVariants, getStock } from '../../lib/domain.js'
import { exportCsv } from '../../lib/csv.js'

export default function Inventory() {
  const { state, activeExhibition, actions, can } = useApp()
  // Transfers always need a real exhibition, whether or not one is selected for
  // selling, so this page keeps its own target.
  const [targetId, setTargetId] = useState(
    () => activeExhibition?.id || state.exhibitions.find((entry) => entry.status !== 'Completed')?.id || '',
  )
  const target = state.exhibitions.find((entry) => entry.id === targetId) || null
  const currency = useCurrency()
  const [tab, setTab] = useState('levels')
  const [query, setQuery] = useState('')
  const [transfers, setTransfers] = useState({})
  const [adjusting, setAdjusting] = useState(null)
  const [direction, setDirection] = useState('toExhibition')
  const [deletingMovements, setDeletingMovements] = useState(null)
  const [deletingStock, setDeletingStock] = useState(null)
  const canDelete = can('records.delete')

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return allVariants(state)
      .map(({ product, variant }) => ({
        key: variant.id,
        product,
        variant,
        main: getStock(state, MAIN_LOCATION, variant.id),
        exhibition: target ? getStock(state, target.id, variant.id) : 0,
      }))
      .filter(
        (row) =>
          !needle ||
          row.product.name.toLowerCase().includes(needle) ||
          row.variant.sku.toLowerCase().includes(needle) ||
          String(row.variant.barcode).includes(needle) ||
          row.variant.color.toLowerCase().includes(needle),
      )
  }, [state, query, target])

  const queued = Object.entries(transfers).filter(([, quantity]) => Number(quantity) > 0)

  const runTransfers = () => {
    if (!target) return
    let moved = 0
    for (const [variantId, quantity] of queued) {
      const amount = Number(quantity)
      const source = direction === 'toExhibition' ? MAIN_LOCATION : target.id
      const destination = direction === 'toExhibition' ? target.id : MAIN_LOCATION
      const available = getStock(state, source, variantId)
      if (amount > available) {
        actions.toast(`Not enough stock to move ${amount} units`, 'warn')
        continue
      }
      actions.transferStock({ variantId, fromLocation: source, toLocation: destination, quantity: amount })
      moved += 1
    }
    if (moved) {
      actions.toast(
        `${moved} product${moved === 1 ? '' : 's'} moved ${direction === 'toExhibition' ? 'to' : 'from'} ${target.name}`,
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

  const stockSelection = useSelection(rows, (row) => row.key)
  const movementSelection = useSelection(movements, (movement) => movement.id)

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
            <select
              className="select"
              style={{ width: 210 }}
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
            >
              <option value="">No exhibition</option>
              {state.exhibitions.map((exhibition) => (
                <option key={exhibition.id} value={exhibition.id}>
                  {exhibition.name}
                </option>
              ))}
            </select>
            <select className="select" style={{ width: 210 }} value={direction} onChange={(e) => setDirection(e.target.value)}>
              <option value="toExhibition">Warehouse → Exhibition</option>
              <option value="toWarehouse">Exhibition → Warehouse</option>
            </select>
            <button className="btn" onClick={() => exportCsv('tareez-inventory', stockColumns, rows)}>
              Export
            </button>
            <button className="btn btn-primary" disabled={!queued.length || !target} onClick={runTransfers}>
              Transfer {queued.length || ''}
            </button>
          </>
        )}
      </div>

      {tab === 'levels' ? (
        <>
          <div className="card" style={{ padding: 14, background: 'var(--surface-2)' }}>
            <div className="small muted">
              {target ? (
                <>
                  Enter quantities in the transfer column, then press Transfer. Exhibition stock is kept
                  separate from the warehouse so stall sales never touch main inventory.
                </>
              ) : (
                <>
                  Showing warehouse stock only. Pick an exhibition above to move stock onto a stand — sales
                  made without an exhibition come straight out of the warehouse.
                </>
              )}
            </div>
          </div>

          {rows.length === 0 ? (
            <EmptyState title="No products found">Adjust your search.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    {canDelete && (
                      <th className="check-col">
                        <SelectAllBox selection={stockSelection} />
                      </th>
                    )}
                    <th>Product</th>
                    <th>SKU</th>
                    <th className="right">Warehouse</th>
                    <th className="right">{target?.name || 'Exhibition'}</th>
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
                      <tr key={row.key} className={stockSelection.isSelected(row.key) ? 'selected' : ''}>
                        {canDelete && (
                          <td className="check-col">
                            <RowBox selection={stockSelection} id={row.key} />
                          </td>
                        )}
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
                {canDelete && (
                  <th className="check-col">
                    <SelectAllBox selection={movementSelection} />
                  </th>
                )}
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
                <tr key={movement.id} className={movementSelection.isSelected(movement.id) ? 'selected' : ''}>
                  {canDelete && (
                    <td className="check-col">
                      <RowBox selection={movementSelection} id={movement.id} />
                    </td>
                  )}
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

      {canDelete && tab === 'movements' && (
        <BulkBar
          selection={movementSelection}
          noun="log entry"
          onDelete={() => setDeletingMovements(movementSelection.ids)}
        />
      )}

      {canDelete && tab === 'levels' && (
        <BulkBar
          selection={stockSelection}
          noun="product"
          onDelete={() => setDeletingStock(rows.filter((row) => stockSelection.isSelected(row.key)))}
        />
      )}

      <Confirm
        open={Boolean(deletingMovements)}
        title={`Delete ${deletingMovements?.length || 0} log entries?`}
        message="This removes history from the movement log only — current stock balances are not recalculated, so the running balances on older rows may no longer add up."
        confirmLabel="Delete entries"
        danger
        onConfirm={() => {
          actions.deleteMovements(deletingMovements)
          movementSelection.clear()
        }}
        onClose={() => setDeletingMovements(null)}
      />

      {deletingStock && (
        <ClearStockModal
          rows={deletingStock}
          target={target}
          onClose={() => setDeletingStock(null)}
          onDone={() => {
            stockSelection.clear()
            setDeletingStock(null)
          }}
        />
      )}

      {adjusting && (
        <AdjustModal
          row={adjusting}
          target={target}
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

/**
 * Bulk clear-down for exhibition stock: either send it back to the warehouse or
 * write it off. Both are recorded as movements so the numbers stay explainable.
 */
function ClearStockModal({ rows, target, onClose, onDone }) {
  const { actions } = useApp()
  const currency = useCurrency()
  const [mode, setMode] = useState('return')

  const affected = rows.filter((row) => row.exhibition > 0)
  const units = affected.reduce((sum, row) => sum + row.exhibition, 0)
  const value = affected.reduce((sum, row) => sum + row.exhibition * row.variant.price, 0)

  const run = () => {
    for (const row of affected) {
      if (mode === 'return') {
        actions.transferStock({
          variantId: row.variant.id,
          fromLocation: target.id,
          toLocation: MAIN_LOCATION,
          quantity: row.exhibition,
        })
      } else {
        actions.adjustStock({
          variantId: row.variant.id,
          locationId: target.id,
          quantity: 0,
          note: 'Stock cleared by admin',
        })
      }
    }
    actions.toast(
      mode === 'return'
        ? `${units} items returned to the warehouse`
        : `${units} items written off`,
      'warn',
    )
    onDone()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Clear exhibition stock"
      subtitle={`${rows.length} product${rows.length === 1 ? '' : 's'} selected`}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className={`btn ${mode === 'return' ? 'btn-primary' : 'btn-danger'}`} disabled={!units} onClick={run}>
            {mode === 'return' ? `Return ${units} items` : `Write off ${units} items`}
          </button>
        </>
      }
    >
      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        <button className={mode === 'return' ? 'active' : ''} onClick={() => setMode('return')}>
          Return to warehouse
        </button>
        <button className={mode === 'writeoff' ? 'active' : ''} onClick={() => setMode('writeoff')}>
          Write off
        </button>
      </div>

      {mode === 'return' ? (
        <p className="small muted" style={{ margin: 0 }}>
          Moves the stock out of {target?.name} and back into the main warehouse. Nothing is
          lost — this is the usual way to strip a stand at the end of an event.
        </p>
      ) : (
        <div className="danger-note">
          Writes the stock down to zero and it does not come back. Use this only for damaged, lost or
          stolen goods — {currency(value)} of stock at retail.
        </div>
      )}

      {units === 0 ? (
        <p className="small muted" style={{ margin: 0 }}>
          None of the selected products have stock at this exhibition.
        </p>
      ) : (
        <div className="stack-sm" style={{ maxHeight: 200, overflowY: 'auto' }}>
          {affected.map((row) => (
            <div key={row.key} className="row-between small" style={{ padding: '3px 0' }}>
              <span>
                {row.product.name} <span className="muted">{variantLabel(row.variant)}</span>
              </span>
              <span className="mono">{row.exhibition}</span>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

function AdjustModal({ row, target, onClose, onSave }) {
  const [location, setLocation] = useState(target?.id || MAIN_LOCATION)
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
          {target && <option value={target.id}>{target.name}</option>}
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
