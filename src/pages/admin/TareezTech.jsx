/**
 * Tareez Tech — the marketing business that shares this till.
 *
 * Two things live here: the identity printed on a service invoice, and the
 * services the till can put on one. Neither is stock, so neither touches the
 * inventory the stall counts, and every invoice raised here is numbered on its
 * own sequence rather than eating holes in the till's.
 */

import { useMemo, useState } from 'react'
import { useApp, useCurrency } from '../../lib/store.jsx'
import { Confirm, EmptyState, Field, ImagePicker, Modal } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import { isTechOrder, SERVICE_PREFIX } from '../../lib/domain.js'
import { DEFAULT_SETTINGS } from '../../lib/seed.js'
import { money, uid } from '../../lib/format.js'

const blank = () => ({ id: uid('tsc'), name: '', price: '', note: '' })

/**
 * The catalogue id behind a cart line.
 *
 * A tech line carries the fee it was sold at — `svc_tsc_web:45000` — so two jobs
 * of the same service priced differently stay two lines on the invoice. The
 * revenue figures below belong to the service, not the price, so the suffix is
 * stripped before counting.
 */
const serviceIdOf = (variantId) =>
  String(variantId || '')
    .slice(SERVICE_PREFIX.length)
    .split(':')[0]
    .split('#')[0]

export default function TareezTech() {
  const { state, actions } = useApp()
  const currency = useCurrency()
  const settings = state.settings
  const services = settings.techServices || []

  const [draft, setDraft] = useState(() => ({
    techBusiness: { name: '', legalName: '', tagline: '', phone: '', email: '', website: '', address: '', vatNumber: '', logo: '', ...(settings.techBusiness || {}) },
    techInvoicePrefix: settings.techInvoicePrefix || '',
    techDueDays: settings.techDueDays ?? 14,
    techMarketingConsentText: settings.techMarketingConsentText || '',
  }))
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)

  const patch = (fields) => setDraft((current) => ({ ...current, ...fields }))
  const patchBusiness = (fields) =>
    setDraft((current) => ({ ...current, techBusiness: { ...current.techBusiness, ...fields } }))

  // How much each service has actually brought in, net of cancelled invoices.
  const sold = useMemo(() => {
    const counts = {}
    for (const order of state.orders) {
      if (!isTechOrder(order) || order.status === 'Cancelled') continue
      for (const item of order.items) {
        if (!String(item.variantId).startsWith(SERVICE_PREFIX)) continue
        const id = serviceIdOf(item.variantId)
        const qty = item.quantity - (item.returnedQuantity || 0)
        counts[id] = counts[id] || { quantity: 0, revenue: 0 }
        counts[id].quantity += qty
        counts[id].revenue = money(counts[id].revenue + (item.lineTotal ?? qty * item.unitPrice))
      }
    }
    return counts
  }, [state.orders])

  const saveProfile = () => {
    actions.saveTechSettings(
      {
        techBusiness: {
          ...draft.techBusiness,
          name: String(draft.techBusiness.name || '').trim() || 'Tareez Tech',
          legalName: String(draft.techBusiness.legalName || '').trim(),
        },
        techInvoicePrefix: String(draft.techInvoicePrefix || '').trim().toUpperCase(),
        techDueDays: Math.max(0, Math.round(Number(draft.techDueDays) || 0)),
        // Blank would leave a consent checkbox with nothing next to it.
        techMarketingConsentText:
          String(draft.techMarketingConsentText || '').trim() ||
          DEFAULT_SETTINGS.techMarketingConsentText,
      },
      'Tareez Tech details saved',
    )
  }

  const save = (option) => {
    const exists = services.some((entry) => entry.id === option.id)
    actions.saveTechSettings(
      {
        techServices: exists
          ? services.map((entry) => (entry.id === option.id ? option : entry))
          : [...services, option],
      },
      exists ? `${option.name} updated` : `${option.name} added`,
    )
    setEditing(null)
  }

  return (
    <div className="page">
      <div className="row-between wrap">
        <div>
          <div style={{ fontWeight: 650 }}>Tareez Tech</div>
          <div className="small muted">
            Invoices for marketing work, raised from the till under its own name.
          </div>
          {services.some((option) => !(Number(option.price) > 0)) && (
            <div className="small" style={{ color: 'var(--warn)' }}>
              A service with no usual fee starts every invoice at zero — set one and the till fills it in.
            </div>
          )}
        </div>
        <button className="btn btn-primary" onClick={() => setEditing(blank())}>
          + New service
        </button>
      </div>

      <div className="grid grid-2">
        <div className="card col">
          <div className="card-title">What the invoice says</div>
          <ImagePicker
            value={draft.techBusiness.logo}
            name={draft.techBusiness.name}
            fit="contain"
            onChange={(logo) => patchBusiness({ logo })}
          />
          <Field label="Business name" hint="On the till as a tab, and across the top of the invoice.">
            <input
              className="input"
              value={draft.techBusiness.name}
              maxLength={40}
              onChange={(event) => patchBusiness({ name: event.target.value })}
            />
          </Field>
          <Field label="Legal name">
            <input
              className="input"
              value={draft.techBusiness.legalName}
              onChange={(event) => patchBusiness({ legalName: event.target.value })}
            />
          </Field>
          <Field label="Tagline" hint="Printed under the legal name on a service invoice.">
            <input
              className="input"
              value={draft.techBusiness.tagline}
              onChange={(event) => patchBusiness({ tagline: event.target.value })}
            />
          </Field>
          <Field label="VAT number" hint="Shown on the invoice reference line when set.">
            <input
              className="input mono"
              value={draft.techBusiness.vatNumber}
              onChange={(event) => patchBusiness({ vatNumber: event.target.value })}
            />
          </Field>
        </div>

        <div className="card col">
          <div className="card-title">Contact &amp; invoicing</div>
          <Field label="Phone">
            <input
              className="input"
              value={draft.techBusiness.phone}
              onChange={(event) => patchBusiness({ phone: event.target.value })}
            />
          </Field>
          <Field label="Email">
            <input
              className="input"
              value={draft.techBusiness.email}
              inputMode="email"
              onChange={(event) => patchBusiness({ email: event.target.value })}
            />
          </Field>
          <Field label="Website">
            <input
              className="input"
              value={draft.techBusiness.website}
              onChange={(event) => patchBusiness({ website: event.target.value })}
            />
          </Field>
          <Field label="Address">
            <textarea
              className="textarea"
              style={{ minHeight: 56 }}
              value={draft.techBusiness.address}
              onChange={(event) => patchBusiness({ address: event.target.value })}
            />
          </Field>
          <div className="row" style={{ gap: 12 }}>
            <div className="grow">
              <Field label="Invoice prefix" hint="e.g. TT gives TT-261103-A1001">
                <input
                  className="input mono"
                  value={draft.techInvoicePrefix}
                  maxLength={6}
                  onChange={(event) => patch({ techInvoicePrefix: event.target.value })}
                />
              </Field>
            </div>
            <div className="grow">
              <Field label="Payment term" hint="Days after the issue date">
                <input
                  className="input mono"
                  type="number"
                  min="0"
                  step="1"
                  value={draft.techDueDays}
                  onChange={(event) => patch({ techDueDays: event.target.value })}
                />
              </Field>
            </div>
          </div>
          <Field
            label="Marketing opt-in line"
            hint="Asked when saving a new client at the till. The stall's own wording is used for retail customers."
          >
            <input
              className="input"
              value={draft.techMarketingConsentText}
              onChange={(event) => patch({ techMarketingConsentText: event.target.value })}
            />
          </Field>
          <div className="row" style={{ gap: 10 }}>
            <button className="btn btn-primary" onClick={saveProfile}>
              Save details
            </button>
          </div>
        </div>
      </div>

      {services.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No services listed yet"
            action={
              <button className="btn btn-primary" onClick={() => setEditing(blank())}>
                + Add the first one
              </button>
            }
          >
            Website development, social media management, video editing, Meta Ads — anything this
            side of the business sells. The fee you set is only a starting point: whoever raises the
            invoice confirms or changes it per job.
          </EmptyState>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Service</th>
                <th className="right">Usual fee</th>
                <th className="right">Invoiced</th>
                <th className="right">Revenue</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {services.map((option) => (
                <tr key={option.id} className="clickable" onClick={() => setEditing({ ...option })}>
                  <td>
                    <div className="row">
                      <div
                        className="cart-thumb"
                        style={{ width: 40, height: 40, background: 'var(--surface-2)', color: 'var(--brand)' }}
                      >
                        <Icon name="globe" size={18} />
                      </div>
                      <div>
                        <div style={{ fontWeight: 620 }}>{option.name}</div>
                        {option.note && <div className="small muted">{option.note}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="right mono">{Number(option.price) > 0 ? currency(option.price) : '—'}</td>
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
        <ServiceEditor
          option={editing}
          isNew={!services.some((entry) => entry.id === editing.id)}
          names={services.filter((entry) => entry.id !== editing.id).map((entry) => entry.name.toLowerCase())}
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
        title="Delete this service?"
        message={`${deleting?.name || ''} will no longer be offered at the till. Invoices already raised keep their line.`}
        confirmLabel="Delete"
        danger
        onConfirm={() =>
          actions.saveTechSettings(
            { techServices: services.filter((entry) => entry.id !== deleting.id) },
            `${deleting.name} deleted`,
          )
        }
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}

function ServiceEditor({ option, isNew, names, onClose, onSave, onDelete }) {
  const [draft, setDraft] = useState(option)
  const [error, setError] = useState('')
  const patch = (fields) => setDraft((current) => ({ ...current, ...fields }))

  const save = () => {
    const name = draft.name.trim()
    const price = Number(draft.price)
    if (!name) return setError('Name the service, e.g. Website development.')
    if (names.includes(name.toLowerCase())) return setError(`${name} is already on the list.`)
    if (draft.price !== '' && (!Number.isFinite(price) || price < 0)) return setError('Enter a fee of 0 or more, or leave it blank.')
    return onSave({
      ...draft,
      name,
      price: draft.price === '' ? 0 : money(price),
      note: (draft.note || '').trim(),
    })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'New service' : option.name}
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
      <Field label="Service">
        <input
          className="input"
          placeholder="Website development, Meta Ads management…"
          value={draft.name}
          autoFocus
          onChange={(event) => patch({ name: event.target.value })}
        />
      </Field>
      <Field label="Usual fee" hint="What the till starts the invoice at. It can be changed per job.">
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
      <Field label="Note" hint="Optional — shown under the name, e.g. “monthly retainer”.">
        <input className="input" value={draft.note || ''} onChange={(event) => patch({ note: event.target.value })} />
      </Field>
    </Modal>
  )
}
