import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useApp, useCurrency } from '../../lib/store.jsx'
import { EmptyState, StatCard, StatusBadge, Thumb } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import BarChart from '../../components/BarChart.jsx'
import { formatDate, formatNumber, formatTime, money } from '../../lib/format.js'
import { getStock } from '../../lib/domain.js'
import {
  customerSummary,
  filterOrders,
  lowStockRows,
  paymentBreakdown,
  salesByCategory,
  salesByHour,
  salesSummary,
  staffPerformance,
  topProducts,
} from '../../lib/analytics.js'

const RANGES = (locationName) => [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'exhibition', label: `All of ${locationName}` },
  { value: 'all', label: 'Everything, all time' },
]

const METHOD_STYLE = {
  Cash: { icon: 'cash', color: '#021b8d' },
  Card: { icon: 'card', color: '#2f75d8' },
  'Bank Transfer': { icon: 'bank', color: '#7c5cd6' },
  'Online Payment': { icon: 'globe', color: '#d98613' },
  Other: { icon: 'wallet', color: '#6f7784' },
}

const dayString = (date) => date.toISOString().slice(0, 10)
const shiftDays = (days) => {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return dayString(date)
}

export default function Dashboard() {
  const { state, activeExhibition, sellLocationId, sellLocationName } = useApp()
  const currency = useCurrency()
  const navigate = useNavigate()
  const [range, setRange] = useState('today')
  const [chartMode, setChartMode] = useState('daily')

  /* --------------------------------------------------------- filters */

  const { filter, priorFilter, periodLabel } = useMemo(() => {
    const exhibitionId = sellLocationId
    if (range === 'today') {
      return {
        filter: { exhibitionId, from: shiftDays(0), to: shiftDays(0) },
        priorFilter: { exhibitionId, from: shiftDays(-1), to: shiftDays(-1) },
        periodLabel: 'vs yesterday',
      }
    }
    if (range === 'week') {
      return {
        filter: { exhibitionId, from: shiftDays(-6), to: shiftDays(0) },
        priorFilter: { exhibitionId, from: shiftDays(-13), to: shiftDays(-7) },
        periodLabel: 'vs previous 7 days',
      }
    }
    if (range === 'all') return { filter: {}, priorFilter: null, periodLabel: '' }
    return { filter: { exhibitionId }, priorFilter: null, periodLabel: '' }
  }, [range, sellLocationId])

  const orders = useMemo(() => filterOrders(state, filter), [state, filter])
  const summary = useMemo(() => salesSummary(orders), [orders])
  const prior = useMemo(
    () => (priorFilter ? salesSummary(filterOrders(state, priorFilter)) : null),
    [state, priorFilter],
  )

  const payments = useMemo(() => paymentBreakdown(state, filter), [state, filter])
  const staff = useMemo(() => staffPerformance(state, filter), [state, filter])
  const products = useMemo(() => topProducts(state, filter, 5), [state, filter])
  const customers = useMemo(() => customerSummary(state, filter), [state, filter])
  const lowStock = useMemo(() => lowStockRows(state, sellLocationId), [state, sellLocationId])
  const categories = useMemo(() => salesByCategory(state, filter), [state, filter])

  /**
   * Trading hours only. All 24 buckets would squash the bars that matter into
   * the middle of a chart that is mostly empty overnight.
   */
  const hourly = useMemo(() => {
    const buckets = salesByHour(state, filter)
    const active = buckets.filter((row) => row.count > 0)
    if (!active.length) return []
    const first = Math.max(0, Math.min(...active.map((row) => row.hour)) - 1)
    const last = Math.min(23, Math.max(...active.map((row) => row.hour)) + 1)
    return buckets.slice(first, last + 1).map((row) => ({
      label: String(row.hour).padStart(2, '0'),
      value: row.total,
      meta: { date: `${String(row.hour).padStart(2, '0')}:00 – ${String(row.hour + 1).padStart(2, '0')}:00`, ...row },
    }))
  }, [state, filter])

  const peakHour = useMemo(
    () => hourly.reduce((best, row) => (best && best.value >= row.value ? best : row), null),
    [hourly],
  )
  const categoryTotal = categories.reduce((sum, row) => sum + row.revenue, 0)

  const exhibitionStock = useMemo(
    () =>
      state.products.reduce(
        (sum, product) =>
          sum +
          product.variants.reduce((n, variant) => n + Math.max(0, getStock(state, sellLocationId, variant.id)), 0),
        0,
      ),
    [state, sellLocationId],
  )

  const delta = (current, previous) => {
    if (previous === null || previous === undefined || !previous) return null
    return money(((current - previous) / previous) * 100)
  }
  const salesDelta = prior ? delta(summary.net, prior.net) : null
  const ordersDelta = prior ? delta(summary.count, prior.count) : null

  /* ----------------------------------------------------------- chart */

  const chartData = useMemo(() => {
    const scoped = state.orders.filter(
      (order) =>
        order.status !== 'Cancelled' &&
        (range === 'all' ? true : order.exhibitionId === sellLocationId),
    )

    if (chartMode === 'monthly') {
      const months = []
      for (let back = 6; back >= 0; back -= 1) {
        const date = new Date()
        date.setDate(1)
        date.setMonth(date.getMonth() - back)
        const key = date.toISOString().slice(0, 7)
        const rows = scoped.filter((order) => order.createdAt.slice(0, 7) === key)
        months.push({
          label: date.toLocaleDateString(undefined, { month: 'short' }),
          value: money(rows.reduce((sum, order) => sum + order.total, 0)),
          meta: {
            date: date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
            orders: rows.length,
            items: rows.reduce((sum, o) => sum + o.items.reduce((n, i) => n + i.quantity, 0), 0),
          },
        })
      }
      return months
    }

    const days = []
    for (let back = 6; back >= 0; back -= 1) {
      const key = shiftDays(-back)
      const rows = scoped.filter((order) => order.createdAt.slice(0, 10) === key)
      const date = new Date(`${key}T12:00:00`)
      days.push({
        label: date.toLocaleDateString(undefined, { weekday: 'short' }),
        value: money(rows.reduce((sum, order) => sum + order.total, 0)),
        meta: {
          date: date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }),
          orders: rows.length,
          items: rows.reduce((sum, o) => sum + o.items.reduce((n, i) => n + i.quantity, 0), 0),
        },
      })
    }
    return days
  }, [state.orders, chartMode, range, sellLocationId])

  const ranges = RANGES(sellLocationName)
  const chartTotal = chartData.reduce((sum, row) => sum + row.value, 0)
  const paymentTotal = payments.reduce((sum, row) => sum + Math.max(0, row.amount), 0)

  /* ------------------------------------------------------------ view */

  return (
    <div className="page">
      <div className="row-between wrap page-head">
        <div>
          <h2>Overview</h2>
          <p>Here is the summary of {activeExhibition ? activeExhibition.name : 'your direct sales'}</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <select
            className="select"
            style={{ width: 168 }}
            value={range}
            onChange={(event) => setRange(event.target.value)}
          >
            {ranges.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <button className="btn" onClick={() => navigate('/admin/reports')}>
            <Icon name="download" size={15} />
            Reports
          </button>
        </div>
      </div>

      {/* ------------------------------------------------- overview cards */}
      <div className="grid grid-3">
        <OverviewCard
          featured
          icon="wallet"
          name="Net sales"
          sub="Takings after discounts"
          value={currency(summary.net)}
          delta={salesDelta}
          deltaLabel={periodLabel}
          footer="See all sales"
          to="/admin/sales"
        />
        <OverviewCard
          icon="box"
          name={activeExhibition ? 'Exhibition stock' : 'Warehouse stock'}
          sub={activeExhibition ? activeExhibition.name : 'Main warehouse stock'}
          value={formatNumber(exhibitionStock)}
          meta={lowStock.length ? `${lowStock.length} low or out of stock` : 'All lines healthy'}
          metaTone={lowStock.length ? 'warn' : 'good'}
          footer="Manage inventory"
          to="/admin/inventory"
        />
        <OverviewCard
          icon="users"
          name="Customers served"
          sub="Identified at checkout"
          value={formatNumber(customers.identified)}
          meta={`${customers.newCustomers} new · ${customers.walkIns} walk-in`}
          footer="View customers"
          to="/admin/customers"
        />
      </div>

      {/* ------------------------------------------------------ key metrics */}
      <div className="grid grid-4">
        <StatCard
          label="Transactions"
          value={formatNumber(summary.count)}
          meta={summary.cancelled ? `${summary.cancelled} cancelled` : 'None cancelled'}
          delta={ordersDelta}
        />
        <StatCard label="Items sold" value={formatNumber(summary.itemsSold)} />
        <StatCard label="Average order" value={currency(summary.averageOrder)} />
        <StatCard
          label="Discounts given"
          value={currency(summary.discounts)}
          meta={
            summary.refunds > 0 || summary.outstanding > 0
              ? `${currency(summary.refunds)} refunded${
                  summary.outstanding > 0 ? ` · ${currency(summary.outstanding)} outstanding` : ''
                }`
              : 'No refunds'
          }
        />
      </div>

      {/* ---------------------------------------------- payments + chart */}
      <div className="grid grid-split">
        <div className="card">
          <div className="row-between" style={{ marginBottom: 4 }}>
            <div>
              <div className="card-title">Payment methods</div>
              <div className="card-sub">{ranges.find((r) => r.value === range).label}</div>
            </div>
            <Link className="btn btn-sm" to="/admin/reports">
              <Icon name="plus" size={14} />
              Detail
            </Link>
          </div>

          <div className="tile-grid" style={{ marginTop: 14 }}>
            {state.settings.paymentMethods.map((method) => {
              const row = payments.find((entry) => entry.method === method)
              const style = METHOD_STYLE[method] || METHOD_STYLE.Other
              const share = paymentTotal ? Math.round((Math.max(0, row?.amount || 0) / paymentTotal) * 100) : 0
              return (
                <div className="tile" key={method}>
                  <div className="tile-head">
                    <span className="tile-badge" style={{ background: style.color }}>
                      <Icon name={style.icon} size={12} strokeWidth={2} />
                    </span>
                    <span className="tile-name">{method}</span>
                  </div>
                  <div className="tile-value">{currency(row?.amount || 0)}</div>
                  <div className="tile-meta">
                    {row?.count || 0} transaction{(row?.count || 0) === 1 ? '' : 's'}
                  </div>
                  <div
                    className="tile-status"
                    style={{ color: share > 0 ? 'var(--brand)' : 'var(--muted-2)' }}
                  >
                    {share > 0 ? `${share}% of takings` : 'Not used'}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="row-between" style={{ marginTop: 14, paddingTop: 12, borderTop: '1px dashed var(--line)' }}>
            <span className="small muted">Total collected</span>
            <strong className="mono">{currency(paymentTotal)}</strong>
          </div>
        </div>

        <div className="card">
          <div className="row-between wrap" style={{ marginBottom: 18 }}>
            <div>
              <div className="card-sub">Sales trend</div>
              <div style={{ fontSize: 28, fontWeight: 720, letterSpacing: '-0.025em' }} className="mono">
                {currency(chartTotal)}
              </div>
            </div>
            <div className="seg">
              <button className={chartMode === 'daily' ? 'active' : ''} onClick={() => setChartMode('daily')}>
                Daily
              </button>
              <button className={chartMode === 'monthly' ? 'active' : ''} onClick={() => setChartMode('monthly')}>
                Monthly
              </button>
            </div>
          </div>

          <BarChart
            data={chartData}
            format={currency}
            tooltipRows={(row) => [
              ['Sales', currency(row.value)],
              ['Orders', String(row.meta.orders)],
              ['Items', String(row.meta.items)],
            ]}
          />
        </div>
      </div>

      {/* ------------------------------------------------ staff + sellers */}
      <div className="grid grid-2">
        <div className="card">
          <div className="card-head">
            <div className="card-title">Salesperson performance</div>
            <Link className="card-sub" to="/admin/staff">
              Full report →
            </Link>
          </div>
          {staff.length === 0 ? (
            <p className="small muted">No sales recorded in this period.</p>
          ) : (
            <div className="stack-sm">
              {staff.map((row) => (
                <div key={row.id} className="row">
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div className="row-between" style={{ marginBottom: 5 }}>
                      <span style={{ fontWeight: 600, fontSize: 13.5 }}>{row.name}</span>
                      <span className="mono small" style={{ fontWeight: 650 }}>
                        {currency(row.sales)}
                      </span>
                    </div>
                    <div className="bar-track">
                      <div className="bar-fill" style={{ width: `${(row.sales / staff[0].sales) * 100}%` }} />
                    </div>
                    <div className="small muted" style={{ marginTop: 4 }}>
                      {row.transactions} transactions · {row.items} items · avg {currency(row.averageOrder)}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <div className="card-title">Best sellers</div>
            <Link className="card-sub" to="/admin/products">
              All products →
            </Link>
          </div>
          {products.length === 0 ? (
            <p className="small muted">Nothing sold in this period.</p>
          ) : (
            <div className="stack-sm">
              {products.map((row, index) => (
                <div key={row.variantId} className="row">
                  <span className="badge" style={{ width: 24, justifyContent: 'center' }}>
                    {index + 1}
                  </span>
                  <Thumb name={row.name} style={{ width: 34, height: 34, borderRadius: 9 }} />
                  <div className="grow" style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 13.5 }}>{row.name}</div>
                    <div className="small muted">
                      {row.variant} · {row.sku}
                    </div>
                  </div>
                  <div className="right nowrap">
                    <div className="mono" style={{ fontWeight: 650 }}>
                      {currency(row.revenue)}
                    </div>
                    <div className="small muted">{row.quantity} sold</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ------------------------------------------------ hours + categories */}
      <div className="grid grid-2">
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Sales by hour</div>
              <div className="card-sub">
                {peakHour ? `Busiest at ${peakHour.label}:00 · ${currency(peakHour.value)}` : 'When the stand is busy'}
              </div>
            </div>
          </div>
          {hourly.length === 0 ? (
            <p className="small muted">No sales recorded in this period.</p>
          ) : (
            <BarChart
              data={hourly}
              format={currency}
              height={180}
              tooltipRows={(row) => [
                ['Sales', currency(row.value)],
                ['Orders', String(row.meta.count)],
              ]}
            />
          )}
        </div>

        <div className="card">
          <div className="card-head">
            <div className="card-title">Sales by category</div>
            <Link className="card-sub" to="/admin/reports">
              Full report →
            </Link>
          </div>
          {categories.length === 0 ? (
            <p className="small muted">Nothing sold in this period.</p>
          ) : (
            <div className="stack-sm">
              {categories.slice(0, 6).map((row) => (
                <div key={row.key} className="grow" style={{ minWidth: 0 }}>
                  <div className="row-between" style={{ marginBottom: 5 }}>
                    <span style={{ fontWeight: 600, fontSize: 13.5 }}>{row.category}</span>
                    <span className="mono small" style={{ fontWeight: 650 }}>
                      {currency(row.revenue)}
                    </span>
                  </div>
                  <div className="bar-track">
                    <div className="bar-fill" style={{ width: `${(row.revenue / categories[0].revenue) * 100}%` }} />
                  </div>
                  <div className="small muted" style={{ marginTop: 4 }}>
                    {row.quantity} items ·{' '}
                    {categoryTotal ? Math.round((row.revenue / categoryTotal) * 100) : 0}% of sales
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* --------------------------------------------------------- low stock */}
      {lowStock.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div className="row-between wrap" style={{ padding: '16px 18px' }}>
            <div>
              <div className="card-title">Low &amp; out of stock</div>
              <div className="card-sub">{sellLocationName}</div>
            </div>
            <Link className="btn btn-sm" to="/admin/inventory">
              Restock
              <Icon name="chevronRight" size={14} />
            </Link>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Product</th>
                  <th>SKU</th>
                  <th className="right">At exhibition</th>
                  <th className="right">In warehouse</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {lowStock.slice(0, 8).map((row) => (
                  <tr key={row.key}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{row.product.name}</div>
                      <div className="small muted">
                        {[row.variant.color, row.variant.size].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td className="mono small muted">{row.variant.sku}</td>
                    <td className="right mono" style={{ fontWeight: 650 }}>
                      {row.quantity}
                    </td>
                    <td className="right mono">{row.mainStock}</td>
                    <td>
                      <span className={`badge ${row.quantity <= 0 ? 'badge-danger' : 'badge-warn'}`}>
                        {row.quantity <= 0 ? 'Out of stock' : 'Low stock'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ----------------------------------------------- recent activities */}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="row-between wrap" style={{ padding: '16px 18px' }}>
          <div className="card-title">Recent activities</div>
          <Link className="btn btn-sm" to="/admin/sales">
            View all
            <Icon name="chevronRight" size={14} />
          </Link>
        </div>

        {orders.length === 0 ? (
          <div style={{ padding: 18 }}>
            <EmptyState title="No sales in this period">
              Completed sales appear here the moment a salesperson takes payment.
            </EmptyState>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="data">
              <thead>
                <tr>
                  <th>Activity</th>
                  <th>Invoice</th>
                  <th>Date</th>
                  <th>Time</th>
                  <th>Salesperson</th>
                  <th className="right">Price</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.slice(0, 8).map((order) => {
                  const first = order.items[0]
                  const extra = order.items.length - 1
                  return (
                    <tr key={order.id} className="clickable" onClick={() => navigate(`/admin/sales/${order.id}`)}>
                      <td>
                        <div className="row">
                          <Thumb
                            src={first?.image}
                            name={first?.name || '?'}
                            style={{ width: 32, height: 32, borderRadius: 8, fontSize: 11 }}
                          />
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontWeight: 600 }}>{first?.name || '—'}</div>
                            <div className="small muted">
                              {order.customerName}
                              {extra > 0 && ` · +${extra} more`}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="mono small muted">{order.invoiceNo}</td>
                      <td className="small nowrap">{formatDate(order.createdAt)}</td>
                      <td className="small nowrap">{formatTime(order.createdAt)}</td>
                      <td className="small">{order.salespersonName}</td>
                      <td className="right mono" style={{ fontWeight: 650 }}>
                        {currency(order.total)}
                      </td>
                      <td>
                        <StatusBadge status={order.status} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- pieces */

function OverviewCard({ featured, icon, name, sub, value, delta, deltaLabel, meta, metaTone, footer, to }) {
  const navigate = useNavigate()
  const up = delta !== null && delta !== undefined && delta >= 0

  return (
    <div className={`ov-card ${featured ? 'featured' : ''}`}>
      <div className="ov-top">
        <div className="ov-icon">
          <Icon name={icon} size={19} />
        </div>
        <div className="grow">
          <div className="ov-name">{name}</div>
          <div className="ov-sub">{sub}</div>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          style={featured ? { color: 'rgba(255,255,255,0.8)' } : undefined}
          onClick={() => navigate(to)}
          aria-label={footer}
        >
          <Icon name="more" size={16} />
        </button>
      </div>

      <div className="row" style={{ gap: 9, flexWrap: 'wrap' }}>
        <span className="ov-value">{value}</span>
        {delta !== null && delta !== undefined && (
          <span className={`delta ${up ? '' : 'down'}`} title={deltaLabel}>
            {up ? '+' : ''}
            {delta.toFixed(1)}% {up ? '↑' : '↓'}
          </span>
        )}
      </div>

      {meta && (
        <div
          className="small"
          style={{
            marginTop: -6,
            color: featured
              ? 'rgba(255,255,255,0.8)'
              : metaTone === 'warn'
                ? 'var(--warn)'
                : metaTone === 'good'
                  ? 'var(--brand)'
                  : 'var(--muted)',
          }}
        >
          {meta}
        </div>
      )}

      <Link className="ov-foot" to={to}>
        {footer}
        <Icon name="arrowRight" size={17} />
      </Link>
    </div>
  )
}
