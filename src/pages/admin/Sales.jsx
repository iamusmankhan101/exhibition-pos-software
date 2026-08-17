import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useApp, useCurrency } from '../../lib/store.jsx'
import { Confirm, EmptyState, Field, Modal, StatusBadge } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import { BulkBar, RowBox, SelectAllBox, useSelection } from '../../components/Selection.jsx'
import { formatDate, money } from '../../lib/format.js'
import { filterOrders, salesSummary } from '../../lib/analytics.js'
import { isSplitPayment, locationName, orderPaymentParts } from '../../lib/domain.js'
import { exportCsv, exportExcel, exportPdf } from '../../lib/csv.js'

export default function Sales() {
  const { state, user, sellLocationId, sellLocationName, actions, can } = useApp()
  const currency = useCurrency()
  const navigate = useNavigate()
  const { orderId } = useParams()

  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('All')
  const [scope, setScope] = useState('exhibition')
  const [salesperson, setSalesperson] = useState('All')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [refunding, setRefunding] = useState(null)
  const [cancelling, setCancelling] = useState(null)
  const [settling, setSettling] = useState(null)
  const [deleting, setDeleting] = useState(null)

  const ownOnly = !can('admin.sales')
  const canDelete = can('records.delete')

  const orders = useMemo(() => {
    const base = filterOrders(state, {
      exhibitionId: scope === 'exhibition' ? sellLocationId : undefined,
      from: from || undefined,
      to: to || undefined,
      salespersonId: ownOnly ? user.id : salesperson === 'All' ? undefined : salesperson,
    })
    const needle = query.trim().toLowerCase()
    return base.filter((order) => {
      if (status !== 'All' && order.status !== status) return false
      if (!needle) return true
      return (
        order.invoiceNo.toLowerCase().includes(needle) ||
        order.customerName.toLowerCase().includes(needle) ||
        order.salespersonName.toLowerCase().includes(needle) ||
        order.items.some((item) => item.name.toLowerCase().includes(needle) || item.sku.toLowerCase().includes(needle))
      )
    })
  }, [state, scope, sellLocationId, from, to, salesperson, ownOnly, user.id, status, query])

  const summary = useMemo(() => salesSummary(orders), [orders])
  const selected = orderId ? state.orders.find((entry) => entry.id === orderId) : null
  const selection = useSelection(orders)

  const columns = [
    { label: 'Invoice', value: (order) => order.invoiceNo },
    { label: 'Date', value: (order) => formatDate(order.createdAt, true) },
    { label: 'Sold at', value: (order) => locationName(state, order.exhibitionId) },
    { label: 'Customer', value: (order) => order.customerName },
    { label: 'Salesperson', value: (order) => order.salespersonName },
    { label: 'Items', value: (order) => order.items.reduce((sum, item) => sum + item.quantity, 0) },
    { label: 'Subtotal', value: (order) => order.subtotal.toFixed(2) },
    {
      label: 'Discount',
      value: (order) =>
        (order.discountAmount + (order.promoAmount || 0) + (order.lineDiscounts || 0)).toFixed(2),
    },
    { label: 'Promo', value: (order) => order.promoCode || '' },
    { label: 'Tax', value: (order) => order.tax.toFixed(2) },
    { label: 'Total', value: (order) => order.total.toFixed(2) },
    {
      label: 'Payment',
      value: (order) =>
        orderPaymentParts(order)
          .map((part) => `${part.method} ${part.amount.toFixed(2)}`)
          .join(' + ') || order.paymentMethod,
    },
    { label: 'Status', value: (order) => order.status },
  ]

  return (
    <div className="page">
      <div className="grid grid-4">
        <div className="stat stat-accent">
          <div className="stat-label">Net sales</div>
          <div className="stat-value">{currency(summary.net)}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Transactions</div>
          <div className="stat-value">{summary.count}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Items</div>
          <div className="stat-value">{summary.itemsSold}</div>
        </div>
        <div className="stat">
          <div className="stat-label">{summary.outstanding > 0 ? 'Outstanding' : 'Refunded'}</div>
          <div className="stat-value" style={summary.outstanding > 0 ? { color: 'var(--warn)' } : undefined}>
            {currency(summary.outstanding > 0 ? summary.outstanding : summary.refunds)}
          </div>
          {summary.outstanding > 0 && (
            <div className="stat-meta">
              {summary.pending} pending · {currency(summary.refunds)} refunded
            </div>
          )}
        </div>
      </div>

      <div className="card">
        <div className="row wrap" style={{ gap: 10 }}>
          <input
            className="input grow"
            style={{ minWidth: 200 }}
            placeholder="Search invoice, customer, product…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <select className="select" style={{ width: 170 }} value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="exhibition">{sellLocationName}</option>
            <option value="all">All exhibitions</option>
          </select>
          <select className="select" style={{ width: 150 }} value={status} onChange={(e) => setStatus(e.target.value)}>
            {['All', 'Completed', 'Partially Refunded', 'Refunded', 'Cancelled'].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
          {!ownOnly && (
            <select
              className="select"
              style={{ width: 170 }}
              value={salesperson}
              onChange={(e) => setSalesperson(e.target.value)}
            >
              <option value="All">All staff</option>
              {state.users.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.name}
                </option>
              ))}
            </select>
          )}
          <input className="input" style={{ width: 150 }} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input className="input" style={{ width: 150 }} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>

        <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
          <button className="btn btn-sm" onClick={() => exportCsv('tareez-sales', columns, orders)}>
            Export CSV
          </button>
          <button className="btn btn-sm" onClick={() => exportExcel('tareez-sales', columns, orders)}>
            Excel
          </button>
          <button
            className="btn btn-sm"
            onClick={() => exportPdf('Sales report', columns, orders, `${orders.length} transactions`)}
          >
            PDF
          </button>
        </div>
      </div>

      {orders.length === 0 ? (
        <EmptyState title="No sales match those filters">Try widening the date range or clearing the search.</EmptyState>
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
                <th>Invoice</th>
                <th>Date</th>
                <th>Customer</th>
                <th>Salesperson</th>
                <th className="right">Items</th>
                <th className="right">Discount</th>
                <th className="right">Total</th>
                <th>Payment</th>
                <th>Status</th>
                {canDelete && <th />}
              </tr>
            </thead>
            <tbody>
              {orders.map((order) => (
                <tr
                  key={order.id}
                  className={`clickable ${selection.isSelected(order.id) ? 'selected' : ''}`}
                  onClick={() => navigate(`/admin/sales/${order.id}`)}
                >
                  {canDelete && (
                    <td className="check-col" onClick={(event) => event.stopPropagation()}>
                      <RowBox selection={selection} id={order.id} />
                    </td>
                  )}
                  <td className="mono small">{order.invoiceNo}</td>
                  <td className="small nowrap">{formatDate(order.createdAt, true)}</td>
                  <td>{order.customerName}</td>
                  <td className="small">{order.salespersonName}</td>
                  <td className="right mono">{order.items.reduce((sum, item) => sum + item.quantity, 0)}</td>
                  <td className="right mono">
                    {order.discountAmount || order.promoAmount
                      ? `−${currency(order.discountAmount + (order.promoAmount || 0))}`
                      : '—'}
                    {order.promoCode && <div className="small muted">{order.promoCode}</div>}
                  </td>
                  <td className="right mono" style={{ fontWeight: 650 }}>
                    {currency(order.total)}
                    {order.balanceDue > 0 && (
                      <div className="small" style={{ color: 'var(--warn)', fontWeight: 600 }}>
                        {currency(order.balanceDue)} due
                      </div>
                    )}
                  </td>
                  <td className="small">
                    {order.paymentMethod}
                    {isSplitPayment(order) && (
                      <div className="small muted">
                        {orderPaymentParts(order)
                          .map((part) => part.method)
                          .join(' + ')}
                      </div>
                    )}
                  </td>
                  <td>
                    <StatusBadge status={order.status} />
                  </td>
                  {canDelete && (
                    <td className="right" onClick={(event) => event.stopPropagation()}>
                      <button
                        className="btn btn-ghost btn-sm"
                        title="Delete sale"
                        onClick={() => setDeleting([order])}
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canDelete && (
        <BulkBar
          selection={selection}
          noun="sale"
          onDelete={() => setDeleting(orders.filter((order) => selection.isSelected(order.id)))}
        />
      )}

      {deleting && (
        <DeleteSalesModal
          orders={deleting}
          onClose={() => setDeleting(null)}
          onDone={() => {
            selection.clear()
            setDeleting(null)
            if (orderId) navigate('/admin/sales')
          }}
        />
      )}

      {selected && (
        <OrderDetail
          order={selected}
          onClose={() => navigate('/admin/sales')}
          onRefund={() => setRefunding(selected)}
          onCancel={() => setCancelling(selected)}
          onSettle={() => setSettling(selected)}
          onDelete={() => setDeleting([selected])}
        />
      )}

      {refunding && <RefundModal order={refunding} onClose={() => setRefunding(null)} />}
      {settling && <SettleModal order={settling} onClose={() => setSettling(null)} />}

      <Confirm
        open={Boolean(cancelling)}
        title="Cancel this sale?"
        message={`${cancelling?.invoiceNo} will be marked cancelled, the full amount reversed and every item returned to exhibition stock.`}
        confirmLabel="Cancel sale"
        danger
        onConfirm={() => actions.cancelOrder(cancelling.id, 'Cancelled by staff')}
        onClose={() => setCancelling(null)}
      />
    </div>
  )
}

/* ---------------------------------------------------------------- detail */

function OrderDetail({ order, onClose, onRefund, onCancel, onSettle, onDelete }) {
  const { state, can } = useApp()
  const currency = useCurrency()
  const refundable =
    order.status === 'Completed' || order.status === 'Partially Refunded' || order.status === 'Pending'

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={order.invoiceNo}
      subtitle={`${formatDate(order.createdAt, true)} · ${locationName(state, order.exhibitionId)}`}
      footer={
        <>
          <Link className="btn" to={`/r/${order.id}`} target="_blank" rel="noopener">
            Receipt
          </Link>
          {order.balanceDue > 0 && (
            <button className="btn btn-primary" onClick={onSettle}>
              Record payment
            </button>
          )}
          {can('refund') && refundable && (
            <button className="btn" onClick={onRefund}>
              Return / refund
            </button>
          )}
          {can('refund') && order.status === 'Completed' && (
            <button className="btn" onClick={onCancel}>
              Cancel sale
            </button>
          )}
          {can('records.delete') && (
            <button className="btn btn-danger" onClick={onDelete}>
              <Icon name="trash" size={15} />
              Delete
            </button>
          )}
        </>
      }
    >
      <div className="row-between wrap">
        <StatusBadge status={order.status} />
        <span className="small muted">
          {order.salespersonName} · {order.paymentMethod}
          {order.offlineCreated && ' · created offline'}
        </span>
      </div>

      {order.oversell && (
        <div className="badge badge-danger" style={{ padding: '10px 14px', borderRadius: 12, whiteSpace: 'normal' }}>
          Sold past available stock, authorised by {order.oversell.by || 'an override'} —{' '}
          {order.oversell.lines
            .map((line) => `${line.name} (${line.requested} of ${line.available})`)
            .join(', ')}
        </div>
      )}

      <div className="grid grid-2" style={{ gap: 10 }}>
        <div className="card" style={{ background: 'var(--surface-2)', padding: 14 }}>
          <div className="small muted">Customer</div>
          <div style={{ fontWeight: 620 }}>{order.customerName}</div>
        </div>
        <div className="card" style={{ background: 'var(--surface-2)', padding: 14 }}>
          <div className="small muted">{isSplitPayment(order) ? 'Paid across' : 'Payment reference'}</div>
          {isSplitPayment(order) ? (
            <div style={{ fontWeight: 620 }}>
              {orderPaymentParts(order).map((part) => (
                <div key={part.method} className="row-between">
                  <span>{part.method}</span>
                  <span className="mono">{currency(part.amount)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontWeight: 620 }}>{order.paymentReference || '—'}</div>
          )}
        </div>
      </div>

      <div className="table-wrap">
        <table className="data" style={{ minWidth: 420 }}>
          <thead>
            <tr>
              <th>Item</th>
              <th className="right">Qty</th>
              <th className="right">Price</th>
              <th className="right">Total</th>
            </tr>
          </thead>
          <tbody>
            {order.items.map((item) => (
              <tr key={item.variantId}>
                <td>
                  {item.name}
                  <div className="small muted">
                    {[item.color, item.size].filter(Boolean).join(' · ')} · {item.sku}
                  </div>
                  {item.returnedQuantity > 0 && (
                    <span className="badge badge-warn" style={{ marginTop: 4 }}>
                      {item.returnedQuantity} returned
                    </span>
                  )}
                </td>
                <td className="right mono">{item.quantity}</td>
                <td className="right mono">{currency(item.unitPrice)}</td>
                <td className="right mono">{currency(item.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ background: 'var(--surface-2)' }}>
        <div className="total-line">
          <span>Subtotal</span>
          <span className="mono">{currency(order.subtotal)}</span>
        </div>
        {order.discountAmount > 0 && (
          <div className="total-line">
            <span>
              Discount ({order.discountType === 'percentage' ? `${order.discountValue}%` : 'fixed'})
            </span>
            <span className="mono">−{currency(order.discountAmount)}</span>
          </div>
        )}
        {order.promoAmount > 0 && (
          <div className="total-line">
            <span>Promo {order.promoCode}</span>
            <span className="mono">−{currency(order.promoAmount)}</span>
          </div>
        )}
        {order.tax > 0 && (
          <div className="total-line">
            <span>VAT</span>
            <span className="mono">{currency(order.tax)}</span>
          </div>
        )}
        {order.refundedAmount > 0 && (
          <div className="total-line">
            <span style={{ color: 'var(--danger)' }}>Refunded</span>
            <span className="mono" style={{ color: 'var(--danger)' }}>
              −{currency(order.refundedAmount)}
            </span>
          </div>
        )}
        <div className="total-line grand">
          <span>Total</span>
          <span className="mono">{currency(order.total)}</span>
        </div>
        {order.balanceDue > 0 && (
          <>
            <div className="total-line" style={{ marginTop: 8 }}>
              <span>Received</span>
              <span className="mono">{currency(order.amountPaid)}</span>
            </div>
            <div className="total-line" style={{ color: 'var(--warn)', fontWeight: 650 }}>
              <span>Balance due</span>
              <span className="mono">{currency(order.balanceDue)}</span>
            </div>
          </>
        )}
      </div>

      {order.note && <p className="small muted">Note: {order.note}</p>}
    </Modal>
  )
}

/* ---------------------------------------------------------------- delete */

function DeleteSalesModal({ orders, onClose, onDone }) {
  const { actions } = useApp()
  const currency = useCurrency()
  const [restoreStock, setRestoreStock] = useState(true)

  const revenue = orders.reduce((sum, order) => sum + (order.status === 'Cancelled' ? 0 : order.total), 0)
  const units = orders.reduce(
    (sum, order) =>
      sum +
      (order.status === 'Cancelled'
        ? 0
        : order.items.reduce((n, item) => n + (item.quantity - (item.returnedQuantity || 0)), 0)),
    0,
  )

  return (
    <Modal
      open
      onClose={onClose}
      title={orders.length === 1 ? 'Delete this sale?' : `Delete ${orders.length} sales?`}
      subtitle={orders.length === 1 ? orders[0].invoiceNo : 'This cannot be undone'}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-danger"
            onClick={() => {
              actions.deleteOrders(orders.map((order) => order.id), { restoreStock })
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
        Deleting is permanent and rewrites your history. These sales will vanish from every report,
        the payment breakdown and salesperson performance.
        <ul>
          <li>{currency(revenue)} removed from recorded sales</li>
          <li>Payment and refund records deleted</li>
          <li>Customer order counts and lifetime spend reduced</li>
        </ul>
      </div>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={restoreStock}
          onChange={(event) => setRestoreStock(event.target.checked)}
        />
        <span>
          Return {units} unsold item{units === 1 ? '' : 's'} to exhibition stock
          <div className="small muted">
            Leave this on unless the goods really did leave with the customer — otherwise the stock
            count will be short.
          </div>
        </span>
      </label>

      {orders.length > 1 && (
        <div className="stack-sm" style={{ maxHeight: 190, overflowY: 'auto' }}>
          {orders.slice(0, 40).map((order) => (
            <div key={order.id} className="row-between small" style={{ padding: '4px 0' }}>
              <span className="mono muted">{order.invoiceNo}</span>
              <span>{order.customerName}</span>
              <span className="mono">{currency(order.total)}</span>
            </div>
          ))}
        </div>
      )}

      <p className="small muted" style={{ margin: 0 }}>
        Prefer <strong>Cancel sale</strong> if you only want to reverse the transaction — it keeps the
        record and the audit trail intact.
      </p>
    </Modal>
  )
}

/* ---------------------------------------------------------------- settle */

function SettleModal({ order, onClose }) {
  const { state, actions } = useApp()
  const currency = useCurrency()
  const [method, setMethod] = useState(order.paymentMethod)
  const [amount, setAmount] = useState(String(order.balanceDue))
  const [reference, setReference] = useState('')
  const [error, setError] = useState('')

  const received = Math.max(0, Math.min(Number(amount) || 0, order.balanceDue))
  const remaining = money(order.balanceDue - received)

  const submit = () => {
    try {
      actions.settlePayment({
        orderId: order.id,
        invoiceNo: order.invoiceNo,
        method,
        amount: received,
        reference,
      })
      onClose()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Record payment"
      subtitle={`${order.invoiceNo} · ${currency(order.balanceDue)} outstanding`}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={received <= 0} onClick={submit}>
            Take {currency(received)}
          </button>
        </>
      }
    >
      {error && (
        <div className="badge badge-danger" style={{ padding: '10px 14px', borderRadius: 12, whiteSpace: 'normal' }}>
          {error}
        </div>
      )}

      <Field label="Amount received">
        <input
          className="input"
          type="number"
          inputMode="decimal"
          value={amount}
          autoFocus
          onChange={(event) => setAmount(event.target.value)}
        />
      </Field>

      <div className="row wrap" style={{ gap: 8 }}>
        <button className="chip" onClick={() => setAmount(String(order.balanceDue))}>
          Settle in full · {currency(order.balanceDue)}
        </button>
        <button className="chip" onClick={() => setAmount(String(money(order.balanceDue / 2)))}>
          Half
        </button>
      </div>

      <Field label="Payment method">
        <select className="select" value={method} onChange={(event) => setMethod(event.target.value)}>
          {state.settings.paymentMethods.map((entry) => (
            <option key={entry}>{entry}</option>
          ))}
        </select>
      </Field>

      <Field label="Reference (optional)">
        <input className="input" value={reference} onChange={(event) => setReference(event.target.value)} />
      </Field>

      <div className="card" style={{ background: 'var(--surface-2)' }}>
        <div className="total-line">
          <span>Already received</span>
          <span className="mono">{currency(order.amountPaid)}</span>
        </div>
        <div className="total-line">
          <span>Taking now</span>
          <span className="mono">{currency(received)}</span>
        </div>
        <div className="total-line grand" style={{ fontSize: 16, color: remaining > 0 ? 'var(--warn)' : 'var(--brand)' }}>
          <span>{remaining > 0 ? 'Still due' : 'Fully settled'}</span>
          <span className="mono">{currency(remaining)}</span>
        </div>
      </div>
    </Modal>
  )
}

/* ---------------------------------------------------------------- refund */

function RefundModal({ order, onClose }) {
  const { state, actions } = useApp()
  const currency = useCurrency()
  const [lines, setLines] = useState(() =>
    order.items.map((item) => ({ variantId: item.variantId, quantity: 0 })),
  )
  const [method, setMethod] = useState(order.paymentMethod)
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  const setQuantity = (variantId, quantity) =>
    setLines((current) =>
      current.map((line) => (line.variantId === variantId ? { ...line, quantity: Math.max(0, quantity) } : line)),
    )

  const estimate = order.items.reduce((sum, item) => {
    const line = lines.find((entry) => entry.variantId === item.variantId)
    if (!line?.quantity) return sum
    return sum + (item.lineTotal / item.quantity) * line.quantity
  }, 0)

  // Must match refundOrder: a promo code reduced the order just as a manual
  // discount did, so the estimate has to come off both.
  const orderDiscount = money(order.discountAmount + (order.promoAmount || 0))
  const discountRatio = order.subtotal ? (order.subtotal - orderDiscount) / order.subtotal : 1
  const taxMultiplier =
    state.settings.taxEnabled && !state.settings.taxInclusive ? 1 + state.settings.taxRate / 100 : 1
  const estimatedRefund = estimate * discountRatio * taxMultiplier

  const submit = () => {
    try {
      actions.refund({
        orderId: order.id,
        invoiceNo: order.invoiceNo,
        lines: lines.filter((line) => line.quantity > 0),
        refundMethod: method,
        reason,
      })
      onClose()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Return &amp; refund"
      subtitle={order.invoiceNo}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={estimatedRefund <= 0} onClick={submit}>
            Refund {currency(estimatedRefund)}
          </button>
        </>
      }
    >
      {error && (
        <div className="badge badge-danger" style={{ padding: '10px 14px', borderRadius: 12, whiteSpace: 'normal' }}>
          {error}
        </div>
      )}

      <div className="stack-sm">
        {order.items.map((item) => {
          const remaining = item.quantity - (item.returnedQuantity || 0)
          const line = lines.find((entry) => entry.variantId === item.variantId)
          return (
            <div key={item.variantId} className="cart-item">
              <div className="cart-info">
                <div className="cart-name">{item.name}</div>
                <div className="cart-var">
                  {[item.color, item.size].filter(Boolean).join(' · ')} · {remaining} returnable
                </div>
              </div>
              <div className="qty">
                <button onClick={() => setQuantity(item.variantId, line.quantity - 1)} disabled={remaining === 0}>
                  −
                </button>
                <span>{line.quantity}</span>
                <button
                  onClick={() => setQuantity(item.variantId, Math.min(remaining, line.quantity + 1))}
                  disabled={remaining === 0}
                >
                  +
                </button>
              </div>
            </div>
          )
        })}
      </div>

      <Field label="Refund method">
        <select className="select" value={method} onChange={(event) => setMethod(event.target.value)}>
          {state.settings.paymentMethods.map((entry) => (
            <option key={entry}>{entry}</option>
          ))}
        </select>
      </Field>

      <Field label="Reason">
        <input
          className="input"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Wrong size, changed mind…"
        />
      </Field>

      <p className="small muted" style={{ margin: 0 }}>
        Returned items go straight back into this exhibition's stock and the refund is recorded against the
        original payment method for reconciliation.
      </p>
    </Modal>
  )
}
