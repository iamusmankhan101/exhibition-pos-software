/**
 * Stitching price list. Each entry is a service the till can add to a sale —
 * "Shirt", "3-piece suit" — at a set price. Nothing here is stocked.
 */

import { useMemo, useState } from 'react'
import { useApp, useCurrency } from '../../lib/store.jsx'
import { Confirm, EmptyState, Field, Modal } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import { money, uid } from '../../lib/format.js'
import { SERVICE_PREFIX } from '../../lib/domain.js'

const blank = () => ({ id: uid('stc'), name: '', price: '', note: '' })

export default function Stitching() {
  const { state, actions } = useApp()
  const currency = useCurrency()
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)

  const options = state.settings.stitching || []

  // How often each option has been sold, net of returns.
  const sold = useMemo(() => {
    const counts = {}
    for (const order of state.orders) {
      if (order.status === 'Cancelled') continue
      for (const item of order.items) {
        if (!String(item.variantId).startsWith(SERVICE_PREFIX)) continue
        const id = item.variantId.slice(SERVICE_PREFIX.length)
        const qty = item.quantity - (item.returnedQuantity || 0)
        counts[id] = counts[id] || { quantity: 0, revenue: 0 }
        counts[id].quantity += qty
        counts[id].revenue = money(counts[id].revenue + (item.lineTotal ?? qty * item.unitPrice))
      }
    }
    return counts
  }, [state.orders])

  const save = (option) => {
    const exists = options.some((entry) => entry.id === option.id)
    actions.saveStitching(
      exists ? options.map((entry) => (entry.id === option.id ? option : entry)) : [...options, option],
      exists ? `${option.name} updated` : `${option.name} added`,
    )
    setEditing(null)
  }

  return (
    <div className="page">
      <div className="row-between wrap">
        <div>
          <div style={{ fontWeight: 650 }}>Stitching prices</div>
          <div className="small muted">Add these to any sale from the till with the Stitching button.</div>
        </div>
        <button className="btn btn-primary" onClick={() => setEditing(blank())}>
          + New stitching
        </button>
      </div>

      {options.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No stitching prices yet"
            action={
              <button className="btn btn-primary" onClick={() => setEditing(blank())}>
                + Add the first one
              </button>
            }
          >
            Set a price for each kind of garment you stitch — shirt, trouser, 3-piece suit — and pick it at the
            till when a customer wants their cloth made up.
          </EmptyState>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Garment</th>
                <th className="right">Price</th>
                <th className="right">Sold</th>
                <th className="right">Revenue</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {options.map((option) => (
                <tr key={option.id} className="clickable" onClick={() => setEditing({ ...option })}>
                  <td>
                    <div className="row">
                      <div
                        className="cart-thumb"
                        style={{ width: 40, height: 40, background: 'var(--surface-2)', color: 'var(--brand)' }}
                      >
                        <Icon name="scissors" size={18} />
                      </div>
                      <div>
                        <div style={{ fontWeight: 620 }}>{option.name}</div>
                        {option.note && <div className="small muted">{option.note}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="right mono">{currency(option.price)}</td>
                  <td className="right mono">{sold[option.id]?.quantity || 0}</td>
                  <td className="right mono">{currency(sold[option.id]?.revenue || 0)}</td>
                  <td className="right" onClick={(event) => event.stopPropagation()}>
                    <button className="btn btn-ghost btn-sm" title="Delete" onClick={() => setDeleting(option)}>
                      <Icon name="trash" size={16} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <StitchingEditor
          option={editing}
          isNew={!options.some((entry) => entry.id === editing.id)}
          names={options.filter((entry) => entry.id !== editing.id).map((entry) => entry.name.toLowerCase())}
          onClose={() => setEditing(null)}
          onSave={save}
          onDelete={() => {
            setDeleting(editing)
            setEditing(null)
          }}
        />
      )}

      <Confirm
        open={Boolean(deleting)}
        title="Delete this stitching price?"
        message={`${deleting?.name} will no longer be offered at the till. Past sales keep their line.`}
        confirmLabel="Delete"
        danger
        onConfirm={() =>
          actions.saveStitching(
            options.filter((entry) => entry.id !== deleting.id),
            `${deleting.name} deleted`,
          )
        }
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}

function StitchingEditor({ option, isNew, names, onClose, onSave, onDelete }) {
  const [draft, setDraft] = useState(option)
  const [error, setError] = useState('')
  const patch = (fields) => setDraft((current) => ({ ...current, ...fields }))

  const save = () => {
    const name = draft.name.trim()
    const price = Number(draft.price)
    if (!name) return setError('Give the garment a name, e.g. Shirt.')
    if (names.includes(name.toLowerCase())) return setError(`${name} already has a price.`)
    if (!Number.isFinite(price) || price < 0 || draft.price === '') return setError('Enter a price of 0 or more.')
    return onSave({ ...draft, name, price: money(price), note: (draft.note || '').trim() })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'New stitching price' : option.name}
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
            Save
          </button>
        </>
      }
    >
      {error && (
        <div className="badge badge-danger" style={{ padding: '10px 14px', borderRadius: 12, whiteSpace: 'normal' }}>
          {error}
        </div>
      )}
      <Field label="Garment">
        <input
          className="input"
          placeholder="Shirt, Trouser, 3-piece suit…"
          value={draft.name}
          autoFocus
          onChange={(event) => patch({ name: event.target.value })}
        />
      </Field>
      <Field label="Stitching price">
        <input
          className="input mono"
          type="number"
          inputMode="decimal"
          min="0"
          step="0.01"
          value={draft.price}
          onChange={(event) => patch({ price: event.target.value })}
        />
      </Field>
      <Field label="Note" hint="Optional — shown under the name, e.g. “with lining”.">
        <input className="input" value={draft.note || ''} onChange={(event) => patch({ note: event.target.value })} />
      </Field>
    </Modal>
  )
}
