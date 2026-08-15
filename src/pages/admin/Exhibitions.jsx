import { useMemo, useState } from 'react'
import { useApp, useCurrency } from '../../lib/store.jsx'
import { EmptyState, Field, Modal, StatCard, StatusBadge } from '../../components/ui.jsx'
import { formatDate, uid } from '../../lib/format.js'
import { getStock } from '../../lib/domain.js'
import { buildClosingReport, filterOrders, salesSummary } from '../../lib/analytics.js'
import { exportCsv, exportPdf } from '../../lib/csv.js'

const blank = () => ({
  id: uid('exh'),
  name: '',
  location: '',
  startDate: new Date().toISOString().slice(0, 10),
  endDate: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
  status: 'Upcoming',
  staffIds: [],
  notes: '',
  closedAt: null,
  closingReport: null,
})

export default function Exhibitions() {
  const { state, session, actions } = useApp()
  const currency = useCurrency()
  const [editing, setEditing] = useState(null)
  const [closing, setClosing] = useState(null)
  const [viewing, setViewing] = useState(null)

  const rows = useMemo(
    () =>
      state.exhibitions.map((exhibition) => {
        const summary = salesSummary(filterOrders(state, { exhibitionId: exhibition.id }))
        const stock = state.products.reduce(
          (sum, product) =>
            sum + product.variants.reduce((n, variant) => n + Math.max(0, getStock(state, exhibition.id, variant.id)), 0),
          0,
        )
        return { exhibition, summary, stock }
      }),
    [state],
  )

  return (
    <div className="page">
      <div className="row-between wrap">
        <p className="small muted" style={{ margin: 0 }}>
          Each exhibition holds its own stock, sales and reporting. Closing one returns unsold stock to the warehouse.
        </p>
        <button className="btn btn-primary" onClick={() => setEditing(blank())}>
          + New exhibition
        </button>
      </div>

      {rows.length === 0 ? (
        <EmptyState title="No exhibitions yet">Create one to start allocating stock and selling.</EmptyState>
      ) : (
        <div className="grid grid-2">
          {rows.map(({ exhibition, summary, stock }) => (
            <div key={exhibition.id} className="card">
              <div className="card-head">
                <div>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="card-title">{exhibition.name}</span>
                    <StatusBadge status={exhibition.status} />
                    {session.exhibitionId === exhibition.id && <span className="badge badge-brand">Selected</span>}
                  </div>
                  <div className="card-sub" style={{ marginTop: 3 }}>
                    {exhibition.location}
                  </div>
                </div>
              </div>

              <div className="small muted" style={{ marginBottom: 12 }}>
                {formatDate(exhibition.startDate)} – {formatDate(exhibition.endDate)} ·{' '}
                {exhibition.staffIds.length} staff assigned
              </div>

              <div className="grid grid-3" style={{ gap: 8 }}>
                <div className="stat" style={{ padding: 12 }}>
                  <div className="stat-label">Net sales</div>
                  <div className="stat-value" style={{ fontSize: 18 }}>
                    {currency(summary.net)}
                  </div>
                </div>
                <div className="stat" style={{ padding: 12 }}>
                  <div className="stat-label">Orders</div>
                  <div className="stat-value" style={{ fontSize: 18 }}>
                    {summary.count}
                  </div>
                </div>
                <div className="stat" style={{ padding: 12 }}>
                  <div className="stat-label">Stock left</div>
                  <div className="stat-value" style={{ fontSize: 18 }}>
                    {stock}
                  </div>
                </div>
              </div>

              <div className="row wrap" style={{ gap: 8, marginTop: 14 }}>
                <button className="btn btn-sm" onClick={() => actions.selectExhibition(exhibition.id)}>
                  Select
                </button>
                <button className="btn btn-sm" onClick={() => setEditing(structuredClone(exhibition))}>
                  Edit
                </button>
                {exhibition.status !== 'Completed' ? (
                  <button className="btn btn-sm btn-primary" onClick={() => setClosing(exhibition)}>
                    Close exhibition
                  </button>
                ) : (
                  exhibition.closingReport && (
                    <button className="btn btn-sm" onClick={() => setViewing(exhibition.closingReport)}>
                      Closing report
                    </button>
                  )
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <ExhibitionEditor
          exhibition={editing}
          onClose={() => setEditing(null)}
          onSave={(next) => {
            actions.saveExhibition(next)
            setEditing(null)
          }}
        />
      )}

      {closing && <CloseModal exhibition={closing} onClose={() => setClosing(null)} onView={setViewing} />}
      {viewing && <ReportModal report={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}

/* ---------------------------------------------------------------- editor */

function ExhibitionEditor({ exhibition, onClose, onSave }) {
  const { state } = useApp()
  const [draft, setDraft] = useState(exhibition)
  const [error, setError] = useState('')

  const patch = (fields) => setDraft((current) => ({ ...current, ...fields }))

  const toggleStaff = (userId) =>
    setDraft((current) => ({
      ...current,
      staffIds: current.staffIds.includes(userId)
        ? current.staffIds.filter((id) => id !== userId)
        : [...current.staffIds, userId],
    }))

  const save = () => {
    if (!draft.name.trim()) return setError('Give the exhibition a name.')
    if (draft.endDate < draft.startDate) return setError('The end date is before the start date.')
    return onSave({ ...draft, name: draft.name.trim() })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={exhibition.name || 'New exhibition'}
      footer={
        <>
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

      <Field label="Name">
        <input className="input" value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
      </Field>
      <Field label="Location">
        <input className="input" value={draft.location} onChange={(event) => patch({ location: event.target.value })} />
      </Field>

      <div className="grid grid-2" style={{ gap: 10 }}>
        <Field label="Start date">
          <input
            className="input"
            type="date"
            value={draft.startDate.slice(0, 10)}
            onChange={(event) => patch({ startDate: event.target.value })}
          />
        </Field>
        <Field label="End date">
          <input
            className="input"
            type="date"
            value={draft.endDate.slice(0, 10)}
            onChange={(event) => patch({ endDate: event.target.value })}
          />
        </Field>
      </div>

      <Field label="Status">
        <select className="select" value={draft.status} onChange={(event) => patch({ status: event.target.value })}>
          <option>Upcoming</option>
          <option>Active</option>
          <option>Completed</option>
        </select>
      </Field>

      <Field label="Assigned staff">
        <div className="stack-sm">
          {state.users
            .filter((account) => account.active)
            .map((account) => (
              <label key={account.id} className="checkbox">
                <input
                  type="checkbox"
                  checked={draft.staffIds.includes(account.id)}
                  onChange={() => toggleStaff(account.id)}
                />
                <span>
                  {account.name} <span className="muted small">({account.role})</span>
                </span>
              </label>
            ))}
        </div>
      </Field>

      <Field label="Notes">
        <textarea
          className="textarea"
          style={{ minHeight: 60 }}
          value={draft.notes}
          onChange={(event) => patch({ notes: event.target.value })}
        />
      </Field>
    </Modal>
  )
}

/* ----------------------------------------------------------------- close */

function CloseModal({ exhibition, onClose, onView }) {
  const { state, actions } = useApp()
  const currency = useCurrency()
  const [returnStock, setReturnStock] = useState(true)

  const report = useMemo(() => buildClosingReport(state, exhibition), [state, exhibition])
  const remaining = report.inventory.reduce((sum, row) => sum + row.closing, 0)

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Close ${exhibition.name}`}
      subtitle="Generates the final report and locks the exhibition"
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => {
              actions.closeExhibition(exhibition.id, report, returnStock)
              onClose()
              onView(report)
            }}
          >
            Close exhibition
          </button>
        </>
      }
    >
      <div className="grid grid-3" style={{ gap: 10 }}>
        <StatCard label="Gross sales" value={currency(report.grossSales)} />
        <StatCard label="Net sales" value={currency(report.netSales)} accent />
        <StatCard label="Orders" value={report.orders} />
        <StatCard label="Discounts" value={currency(report.discounts)} />
        <StatCard label="Refunds" value={currency(report.refunds)} />
        <StatCard label="Items sold" value={report.itemsSold} />
      </div>

      <label className="checkbox">
        <input type="checkbox" checked={returnStock} onChange={(event) => setReturnStock(event.target.checked)} />
        <span>
          Return the remaining <strong>{remaining}</strong> unsold items to the main warehouse
        </span>
      </label>

      <p className="small muted" style={{ margin: 0 }}>
        The report below is frozen at close time so later edits cannot change the historical record.
      </p>

      <ReportBody report={report} />
    </Modal>
  )
}

function ReportModal({ report, onClose }) {
  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`${report.exhibitionName} — closing report`}
      subtitle={`Generated ${formatDate(report.generatedAt, true)}`}
      footer={
        <>
          <button
            className="btn"
            onClick={() =>
              exportCsv(
                `closing-${report.exhibitionName.toLowerCase().replace(/\s+/g, '-')}`,
                [
                  { label: 'SKU', value: (row) => row.sku },
                  { label: 'Product', value: (row) => row.name },
                  { label: 'Variant', value: (row) => row.variant },
                  { label: 'Opening', value: (row) => row.opening },
                  { label: 'Sold', value: (row) => row.sold },
                  { label: 'Returned', value: (row) => row.returned },
                  { label: 'Closing', value: (row) => row.closing },
                  { label: 'Revenue', value: (row) => row.revenue.toFixed(2) },
                ],
                report.inventory,
              )
            }
          >
            Export inventory
          </button>
          <button
            className="btn btn-primary"
            onClick={() =>
              exportPdf(
                `${report.exhibitionName} — closing report`,
                [
                  { label: 'SKU', value: (row) => row.sku },
                  { label: 'Product', value: (row) => `${row.name} (${row.variant})` },
                  { label: 'Opening', value: (row) => row.opening },
                  { label: 'Sold', value: (row) => row.sold },
                  { label: 'Returned', value: (row) => row.returned },
                  { label: 'Closing', value: (row) => row.closing },
                ],
                report.inventory,
                `Net sales ${report.netSales} · ${report.orders} orders · ${report.itemsSold} items`,
              )
            }
          >
            Print / PDF
          </button>
        </>
      }
    >
      <ReportBody report={report} />
    </Modal>
  )
}

function ReportBody({ report }) {
  const currency = useCurrency()

  return (
    <>
      <div className="card" style={{ background: 'var(--surface-2)' }}>
        <div className="card-title" style={{ marginBottom: 10 }}>
          Payments
        </div>
        {report.payments.length === 0 ? (
          <p className="small muted">No payments recorded.</p>
        ) : (
          <>
            {report.payments.map((row) => (
              <div key={row.method} className="total-line">
                <span>{row.method}</span>
                <span className="mono">{currency(row.amount)}</span>
              </div>
            ))}
            <div className="total-line grand" style={{ fontSize: 16 }}>
              <span>Total</span>
              <span className="mono">
                {currency(report.payments.reduce((sum, row) => sum + row.amount, 0))}
              </span>
            </div>
          </>
        )}
      </div>

      <div className="card" style={{ background: 'var(--surface-2)' }}>
        <div className="card-title" style={{ marginBottom: 10 }}>
          Staff
        </div>
        {report.staff.length === 0 ? (
          <p className="small muted">No sales recorded.</p>
        ) : (
          report.staff.map((row) => (
            <div key={row.id} className="total-line">
              <span>
                {row.name} <span className="muted small">· {row.transactions} transactions</span>
              </span>
              <span className="mono">{currency(row.sales)}</span>
            </div>
          ))
        )}
      </div>

      <div className="card" style={{ background: 'var(--surface-2)' }}>
        <div className="card-title" style={{ marginBottom: 10 }}>
          Customers
        </div>
        <div className="total-line">
          <span>Identified customers</span>
          <span className="mono">{report.customers.identified}</span>
        </div>
        <div className="total-line">
          <span>New customers</span>
          <span className="mono">{report.customers.newCustomers}</span>
        </div>
        <div className="total-line">
          <span>Returning customers</span>
          <span className="mono">{report.customers.returning}</span>
        </div>
        <div className="total-line">
          <span>Walk-in sales</span>
          <span className="mono">{report.customers.walkIns}</span>
        </div>
        <div className="total-line">
          <span>Marketing consent on file</span>
          <span className="mono">{report.customers.marketingConsented}</span>
        </div>
      </div>

      <div className="table-wrap">
        <table className="data" style={{ minWidth: 480 }}>
          <thead>
            <tr>
              <th>Product</th>
              <th className="right">Opening</th>
              <th className="right">Sold</th>
              <th className="right">Returned</th>
              <th className="right">Closing</th>
            </tr>
          </thead>
          <tbody>
            {report.inventory.map((row) => (
              <tr key={row.sku}>
                <td>
                  {row.name}
                  <div className="small muted">
                    {row.variant} · {row.sku}
                  </div>
                </td>
                <td className="right mono">{row.opening}</td>
                <td className="right mono">{row.sold}</td>
                <td className="right mono">{row.returned}</td>
                <td className="right mono">{row.closing}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
