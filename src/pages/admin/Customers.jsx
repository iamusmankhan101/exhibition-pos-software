import { useMemo, useState } from 'react'
import { useApp, useCurrency } from '../../lib/store.jsx'
import { Avatar, Confirm, EmptyState, Field, Modal, StatCard } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import { BulkBar, RowBox, SelectAllBox, useSelection } from '../../components/Selection.jsx'
import { formatDate, uid } from '../../lib/format.js'
import { exportCsv, exportExcel } from '../../lib/csv.js'

const blank = () => ({
  id: uid('cus'),
  name: '',
  phone: '',
  whatsapp: '',
  email: '',
  marketingConsent: false,
  consentAt: null,
  notes: '',
})

export default function Customers() {
  const { state, actions, can } = useApp()
  const currency = useCurrency()
  const [query, setQuery] = useState('')
  const [consentOnly, setConsentOnly] = useState(false)
  const [editing, setEditing] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [deleting, setDeleting] = useState(null)

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase().replace(/\s/g, '')
    return state.customers
      .filter((customer) => !consentOnly || customer.marketingConsent)
      .filter(
        (customer) =>
          !needle ||
          [customer.name, customer.phone, customer.whatsapp, customer.email]
            .filter(Boolean)
            .some((field) => field.toLowerCase().replace(/\s/g, '').includes(needle)),
      )
      .sort((a, b) => (b.lastPurchaseAt || '').localeCompare(a.lastPurchaseAt || ''))
  }, [state.customers, query, consentOnly])

  const selection = useSelection(rows)
  const canDelete = can('admin.settings')

  const consented = state.customers.filter((customer) => customer.marketingConsent).length
  const totalSpend = state.customers.reduce((sum, customer) => sum + (customer.totalSpend || 0), 0)

  const columns = [
    { label: 'Name', value: (row) => row.name },
    { label: 'WhatsApp', value: (row) => row.whatsapp },
    { label: 'Phone', value: (row) => row.phone },
    { label: 'Email', value: (row) => row.email },
    { label: 'Orders', value: (row) => row.totalOrders || 0 },
    { label: 'Total spend', value: (row) => (row.totalSpend || 0).toFixed(2) },
    { label: 'Last purchase', value: (row) => (row.lastPurchaseAt ? formatDate(row.lastPurchaseAt) : '') },
    { label: 'Marketing consent', value: (row) => (row.marketingConsent ? 'Yes' : 'No') },
  ]

  return (
    <div className="page">
      <div className="grid grid-4">
        <StatCard label="Customers" value={state.customers.length} accent />
        <StatCard label="Marketing consent" value={consented} meta={`${state.customers.length ? Math.round((consented / state.customers.length) * 100) : 0}% of database`} />
        <StatCard label="Lifetime spend" value={currency(totalSpend)} />
        <StatCard
          label="Repeat buyers"
          value={state.customers.filter((customer) => (customer.totalOrders || 0) > 1).length}
        />
      </div>

      <div className="row wrap" style={{ gap: 10 }}>
        <input
          className="input grow"
          style={{ minWidth: 200 }}
          placeholder="Search name, phone, WhatsApp or email"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button
          className={`btn ${consentOnly ? 'btn-primary' : ''}`}
          onClick={() => setConsentOnly((current) => !current)}
        >
          Opted in only
        </button>
        <button className="btn" onClick={() => exportCsv('tareez-customers', columns, rows)}>
          CSV
        </button>
        <button className="btn" onClick={() => exportExcel('tareez-customers', columns, rows)}>
          Excel
        </button>
        <button className="btn btn-primary" onClick={() => setEditing(blank())}>
          + New customer
        </button>
      </div>

      {consentOnly && (
        <div className="card" style={{ padding: 14, background: 'var(--surface-2)' }}>
          <div className="small muted">
            This list contains only customers who explicitly agreed to marketing. Customers without consent must
            never be added to a campaign.
          </div>
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState title="No customers found">Customers are created at checkout or added here manually.</EmptyState>
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
                <th>Customer</th>
                <th>Contact</th>
                <th className="right">Orders</th>
                <th className="right">Spend</th>
                <th>Last purchase</th>
                <th>Marketing</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((customer) => (
                <tr
                  key={customer.id}
                  className={`clickable ${selection.isSelected(customer.id) ? 'selected' : ''}`}
                  onClick={() => setViewing(customer)}
                >
                  {canDelete && (
                    <td className="check-col" onClick={(event) => event.stopPropagation()}>
                      <RowBox selection={selection} id={customer.id} />
                    </td>
                  )}
                  <td>
                    <div className="row">
                      <Avatar name={customer.name} size={32} />
                      <span style={{ fontWeight: 600 }}>{customer.name}</span>
                    </div>
                  </td>
                  <td className="small muted">
                    {customer.whatsapp || customer.phone || '—'}
                    <div>{customer.email}</div>
                  </td>
                  <td className="right mono">{customer.totalOrders || 0}</td>
                  <td className="right mono">{currency(customer.totalSpend || 0)}</td>
                  <td className="small">{customer.lastPurchaseAt ? formatDate(customer.lastPurchaseAt) : '—'}</td>
                  <td>
                    <span className={`badge ${customer.marketingConsent ? 'badge-good' : ''}`}>
                      {customer.marketingConsent ? 'Opted in' : 'No consent'}
                    </span>
                  </td>
                  <td className="right nowrap" onClick={(event) => event.stopPropagation()}>
                    <button className="btn btn-ghost btn-sm" onClick={() => setEditing(structuredClone(customer))}>
                      Edit
                    </button>
                    {canDelete && (
                      <button
                        className="btn btn-ghost btn-sm"
                        title="Delete customer"
                        onClick={() => setDeleting([customer])}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <CustomerEditor
          customer={editing}
          onClose={() => setEditing(null)}
          onSave={(next) => {
            actions.saveCustomer(next)
            actions.toast('Customer saved', 'success')
            setEditing(null)
          }}
          onDelete={canDelete ? () => { setDeleting([editing]); setEditing(null) } : null}
        />
      )}

      {viewing && <CustomerDetail customer={viewing} onClose={() => setViewing(null)} onEdit={() => { setEditing(structuredClone(viewing)); setViewing(null) }} />}

      {canDelete && (
        <BulkBar
          selection={selection}
          noun="customer"
          onDelete={() => setDeleting(rows.filter((entry) => selection.isSelected(entry.id)))}
        />
      )}

      <Confirm
        open={Boolean(deleting)}
        title={
          deleting?.length === 1 ? 'Delete this customer?' : `Delete ${deleting?.length || 0} customers?`
        }
        message={
          deleting?.length === 1
            ? `${deleting[0].name} will be removed from the database, along with their purchase history and marketing consent. Past invoices keep the name that was on the sale.`
            : 'These customers, their purchase history and their marketing consent will be removed. Past invoices keep the names that were on the sales.'
        }
        confirmLabel="Delete"
        danger
        onConfirm={() => {
          actions.deleteCustomers(deleting.map((entry) => entry.id))
          selection.clear()
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}

function CustomerEditor({ customer, onClose, onSave, onDelete }) {
  const { state } = useApp()
  const [draft, setDraft] = useState(customer)
  const [error, setError] = useState('')

  const patch = (fields) => setDraft((current) => ({ ...current, ...fields }))

  const save = () => {
    if (!draft.name.trim()) return setError('A name is required.')
    return onSave({
      ...draft,
      name: draft.name.trim(),
      consentAt: draft.marketingConsent ? draft.consentAt || new Date().toISOString() : null,
    })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={customer.name || 'New customer'}
      footer={
        <>
          {onDelete && (
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
        <div className="badge badge-danger" style={{ padding: '10px 14px', borderRadius: 12 }}>
          {error}
        </div>
      )}

      <Field label="Name">
        <input className="input" value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
      </Field>
      <Field label="WhatsApp number">
        <input
          className="input"
          value={draft.whatsapp}
          onChange={(event) => patch({ whatsapp: event.target.value, phone: event.target.value })}
        />
      </Field>
      <Field label="Email">
        <input className="input" value={draft.email} onChange={(event) => patch({ email: event.target.value })} />
      </Field>
      <Field label="Notes">
        <textarea
          className="textarea"
          style={{ minHeight: 60 }}
          value={draft.notes}
          onChange={(event) => patch({ notes: event.target.value })}
        />
      </Field>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={draft.marketingConsent}
          onChange={(event) => patch({ marketingConsent: event.target.checked })}
        />
        <span className="small">{state.settings.marketingConsentText}</span>
      </label>
      {draft.consentAt && <p className="small muted" style={{ margin: 0 }}>Consent recorded {formatDate(draft.consentAt, true)}.</p>}
    </Modal>
  )
}

function CustomerDetail({ customer, onClose, onEdit }) {
  const { state } = useApp()
  const currency = useCurrency()
  const orders = state.orders.filter((order) => order.customerId === customer.id)

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={customer.name}
      subtitle={[customer.whatsapp, customer.email].filter(Boolean).join(' · ')}
      footer={
        <button className="btn btn-primary" onClick={onEdit}>
          Edit customer
        </button>
      }
    >
      <div className="grid grid-3" style={{ gap: 10 }}>
        <StatCard label="Orders" value={customer.totalOrders || 0} />
        <StatCard label="Total spend" value={currency(customer.totalSpend || 0)} accent />
        <StatCard
          label="Average order"
          value={currency(customer.totalOrders ? (customer.totalSpend || 0) / customer.totalOrders : 0)}
        />
      </div>

      <div className="row wrap" style={{ gap: 8 }}>
        <span className={`badge ${customer.marketingConsent ? 'badge-good' : ''}`}>
          {customer.marketingConsent ? 'Marketing consent given' : 'No marketing consent'}
        </span>
        {(customer.exhibitionIds || []).map((id) => (
          <span key={id} className="badge badge-info">
            {state.exhibitions.find((entry) => entry.id === id)?.name || id}
          </span>
        ))}
      </div>

      {customer.notes && <p className="small muted">{customer.notes}</p>}

      <div className="card-title">Purchase history</div>
      {orders.length === 0 ? (
        <p className="small muted">No purchases recorded yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="data" style={{ minWidth: 420 }}>
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Date</th>
                <th className="right">Items</th>
                <th className="right">Total</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr key={order.id}>
                  <td className="mono small">{order.invoiceNo}</td>
                  <td className="small">{formatDate(order.createdAt)}</td>
                  <td className="right mono">{order.items.reduce((sum, item) => sum + item.quantity, 0)}</td>
                  <td className="right mono">{currency(order.total)}</td>
                  <td className="small">{order.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}
