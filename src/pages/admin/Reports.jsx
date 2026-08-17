import { useMemo, useState } from 'react'
import { useApp, useCurrency } from '../../lib/store.jsx'
import { EmptyState, StatCard, Tabs } from '../../components/ui.jsx'
import { formatDate } from '../../lib/format.js'
import { orderPaymentParts } from '../../lib/domain.js'
import {
  customerSummary,
  discountReport,
  filterOrders,
  inventoryReport,
  paymentBreakdown,
  productSales,
  returnsReport,
  returnsSummary,
  salesByCategory,
  salesByDay,
  salesSummary,
  staffPerformance,
} from '../../lib/analytics.js'
import { exportCsv, exportExcel, exportPdf } from '../../lib/csv.js'

const TABS = [
  { value: 'sales', label: 'Sales' },
  { value: 'products', label: 'Products' },
  { value: 'categories', label: 'Categories' },
  { value: 'inventory', label: 'Inventory' },
  { value: 'payments', label: 'Payments' },
  { value: 'discounts', label: 'Discounts' },
  { value: 'returns', label: 'Returns' },
  { value: 'staff', label: 'Staff' },
  { value: 'customers', label: 'Customers' },
]

export default function Reports() {
  const { state, activeExhibition, can } = useApp()
  const currency = useCurrency()
  const [tab, setTab] = useState('sales')
  const [exhibitionId, setExhibitionId] = useState(activeExhibition?.id || 'all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const filter = useMemo(
    () => ({
      exhibitionId: exhibitionId === 'all' ? undefined : exhibitionId,
      from: from || undefined,
      to: to || undefined,
    }),
    [exhibitionId, from, to],
  )

  const orders = useMemo(() => filterOrders(state, filter), [state, filter])
  const summary = useMemo(() => salesSummary(orders), [orders])
  const exhibitionName =
    exhibitionId === 'all' ? 'All exhibitions' : state.exhibitions.find((e) => e.id === exhibitionId)?.name || ''
  const period = `${exhibitionName}${from || to ? ` · ${from || 'start'} → ${to || 'today'}` : ''}`

  const report = useMemo(() => {
    switch (tab) {
      case 'sales':
        return {
          title: 'Sales report',
          rows: orders,
          columns: [
            { label: 'Date', value: (row) => formatDate(row.createdAt, true) },
            { label: 'Invoice', value: (row) => row.invoiceNo },
            { label: 'Customer', value: (row) => row.customerName },
            {
              label: 'Products',
              value: (row) => row.items.map((item) => `${item.name} ×${item.quantity}`).join('; '),
            },
            { label: 'Salesperson', value: (row) => row.salespersonName },
            {
              label: 'Payment',
              value: (row) =>
                orderPaymentParts(row)
                  .map((part) => `${part.method} ${part.amount.toFixed(2)}`)
                  .join(' + ') || row.paymentMethod,
            },
            { label: 'Promo', value: (row) => row.promoCode || '' },
            {
              label: 'Discount',
              numeric: true,
              value: (row) =>
                (row.discountAmount + (row.promoAmount || 0) + (row.lineDiscounts || 0)).toFixed(2),
            },
            { label: 'Total', numeric: true, value: (row) => row.total.toFixed(2) },
            { label: 'Status', value: (row) => row.status },
          ],
          key: (row) => row.id,
        }
      case 'products':
        return {
          title: 'Product sales report',
          rows: productSales(state, filter),
          columns: [
            { label: 'Product', value: (row) => row.name },
            { label: 'Variant', value: (row) => row.variant },
            { label: 'SKU', value: (row) => row.sku },
            { label: 'Category', value: (row) => row.category },
            { label: 'Units sold', numeric: true, value: (row) => row.quantity },
            { label: 'Returned', numeric: true, value: (row) => row.returned },
            { label: 'Item discounts', numeric: true, value: (row) => row.discounts.toFixed(2) },
            { label: 'Revenue', numeric: true, value: (row) => row.revenue.toFixed(2) },
          ],
          key: (row) => row.key,
        }
      case 'categories':
        return {
          title: 'Category sales report',
          rows: salesByCategory(state, filter),
          columns: [
            { label: 'Category', value: (row) => row.category },
            { label: 'Variants sold', numeric: true, value: (row) => row.lines },
            { label: 'Units sold', numeric: true, value: (row) => row.quantity },
            { label: 'Returned', numeric: true, value: (row) => row.returned },
            { label: 'Revenue', numeric: true, value: (row) => row.revenue.toFixed(2) },
          ],
          key: (row) => row.key,
        }
      case 'discounts':
        return {
          title: 'Discount report',
          rows: discountReport(state, filter),
          columns: [
            { label: 'Date', value: (row) => formatDate(row.createdAt, true) },
            { label: 'Invoice', value: (row) => row.invoiceNo },
            { label: 'Customer', value: (row) => row.customerName },
            { label: 'Salesperson', value: (row) => row.salespersonName },
            { label: 'Ticket', numeric: true, value: (row) => row.ticket.toFixed(2) },
            { label: 'Item discounts', numeric: true, value: (row) => row.lineDiscounts.toFixed(2) },
            { label: 'Order discount', numeric: true, value: (row) => row.orderDiscount.toFixed(2) },
            { label: 'Promo', value: (row) => (row.promoCode ? `${row.promoCode} ${row.promoAmount.toFixed(2)}` : '') },
            { label: 'Total given', numeric: true, value: (row) => row.total.toFixed(2) },
            { label: 'Share', numeric: true, value: (row) => `${row.percent.toFixed(1)}%` },
          ],
          key: (row) => row.key,
        }
      case 'returns': {
        const rows = returnsReport(state, filter)
        const stats = returnsSummary(rows)
        return {
          title: 'Returns and refunds report',
          rows,
          cards: [
            { label: 'Returns', value: stats.count, meta: `${stats.cancellations} full cancellation(s)` },
            { label: 'Units back', value: stats.units },
            { label: 'Refunded', value: currency(stats.refunded) },
            { label: 'Balance written off', value: currency(stats.writtenOff) },
          ],
          columns: [
            { label: 'Date', value: (row) => formatDate(row.createdAt, true) },
            { label: 'Invoice', value: (row) => row.invoiceNo },
            { label: 'Type', value: (row) => (row.kind === 'cancellation' ? 'Cancellation' : 'Return') },
            { label: 'Customer', value: (row) => row.customerName },
            { label: 'Items', value: (row) => row.itemSummary },
            { label: 'Units', numeric: true, value: (row) => row.quantity },
            { label: 'Refunded', numeric: true, value: (row) => (row.refundAmount || 0).toFixed(2) },
            { label: 'Method', value: (row) => row.method },
            { label: 'Reason', value: (row) => row.reason },
            { label: 'Authorised by', value: (row) => row.userName },
          ],
          key: (row) => row.key,
        }
      }
      case 'inventory': {
        const rows = exhibitionId === 'all' ? [] : inventoryReport(state, exhibitionId)
        return {
          title: 'Inventory report',
          rows,
          columns: [
            { label: 'Product', value: (row) => row.product.name },
            { label: 'Variant', value: (row) => [row.variant.color, row.variant.size].filter(Boolean).join(' · ') },
            { label: 'SKU', value: (row) => row.variant.sku },
            { label: 'Opening', numeric: true, value: (row) => row.opening },
            { label: 'Sold', numeric: true, value: (row) => row.sold },
            { label: 'Returned', numeric: true, value: (row) => row.returned },
            { label: 'Closing', numeric: true, value: (row) => row.closing },
            { label: 'Revenue', numeric: true, value: (row) => row.revenue.toFixed(2) },
            ...(can('view.cost') ? [{ label: 'Cost of goods', numeric: true, value: (row) => row.cost.toFixed(2) }] : []),
          ],
          key: (row) => row.key,
          note: exhibitionId === 'all' ? 'Choose a single exhibition to see its stock movement.' : '',
        }
      }
      case 'payments':
        return {
          title: 'Payment report',
          rows: paymentBreakdown(state, filter),
          columns: [
            { label: 'Method', value: (row) => row.method },
            { label: 'Transactions', numeric: true, value: (row) => row.count },
            { label: 'Refunded', numeric: true, value: (row) => row.refunded.toFixed(2) },
            { label: 'Net amount', numeric: true, value: (row) => row.amount.toFixed(2) },
          ],
          key: (row) => row.method,
        }
      case 'staff':
        return {
          title: 'Staff report',
          rows: staffPerformance(state, filter),
          columns: [
            { label: 'Salesperson', value: (row) => row.name },
            { label: 'Sales', numeric: true, value: (row) => row.sales.toFixed(2) },
            { label: 'Transactions', numeric: true, value: (row) => row.transactions },
            { label: 'Items sold', numeric: true, value: (row) => row.items },
            { label: 'Average order', numeric: true, value: (row) => row.averageOrder.toFixed(2) },
            { label: 'Discounts given', numeric: true, value: (row) => row.discounts.toFixed(2) },
          ],
          key: (row) => row.id,
        }
      default: {
        const stats = customerSummary(state, filter)
        const buyers = state.customers.filter((customer) =>
          orders.some((order) => order.customerId === customer.id),
        )
        return {
          title: 'Customer report',
          rows: buyers,
          cards: [
            { label: 'New customers', value: stats.newCustomers },
            { label: 'Returning', value: stats.returning },
            { label: 'Walk-in sales', value: stats.walkIns },
            {
              label: 'Marketing consent',
              value: stats.marketingConsented,
              meta: `${stats.consentRate}% of database`,
            },
          ],
          columns: [
            { label: 'Customer', value: (row) => row.name },
            { label: 'WhatsApp', value: (row) => row.whatsapp },
            { label: 'Email', value: (row) => row.email },
            { label: 'Orders', numeric: true, value: (row) => row.totalOrders || 0 },
            { label: 'Total spend', numeric: true, value: (row) => (row.totalSpend || 0).toFixed(2) },
            { label: 'Marketing consent', value: (row) => (row.marketingConsent ? 'Yes' : 'No') },
          ],
          key: (row) => row.id,
        }
      }
    }
  }, [tab, orders, state, filter, exhibitionId, can, currency])

  const daily = useMemo(() => salesByDay(state, filter), [state, filter])
  const dailyMax = Math.max(1, ...daily.map((row) => row.total))

  const fileName = `tareez-${tab}-report`

  return (
    <div className="page">
      <div className="row wrap" style={{ gap: 10 }}>
        <select
          className="select"
          style={{ width: 230 }}
          value={exhibitionId}
          onChange={(event) => setExhibitionId(event.target.value)}
        >
          <option value="all">All exhibitions</option>
          {state.exhibitions.map((exhibition) => (
            <option key={exhibition.id} value={exhibition.id}>
              {exhibition.name}
            </option>
          ))}
        </select>
        <input className="input" style={{ width: 160 }} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        <input className="input" style={{ width: 160 }} type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        <div className="grow" />
        <button className="btn" onClick={() => exportCsv(fileName, report.columns, report.rows)}>
          CSV
        </button>
        <button className="btn" onClick={() => exportExcel(fileName, report.columns, report.rows)}>
          Excel
        </button>
        <button className="btn btn-primary" onClick={() => exportPdf(report.title, report.columns, report.rows, period)}>
          PDF
        </button>
      </div>

      <div className="grid grid-4">
        <StatCard label="Net sales" value={currency(summary.net)} meta={period} accent />
        <StatCard label="Gross sales" value={currency(summary.gross)} />
        <StatCard
          label="Discounts"
          value={currency(summary.discounts)}
          meta={summary.promoDiscounts > 0 ? `${currency(summary.promoDiscounts)} on promo codes` : undefined}
        />
        <StatCard label="VAT collected" value={currency(summary.tax)} />
      </div>

      {daily.length > 1 && (
        <div className="card">
          <div className="card-head">
            <div className="card-title">Daily sales</div>
            <div className="card-sub">{daily.length} trading days</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 160 }}>
            {daily.map((row) => (
              <div key={row.day} className="grow" style={{ textAlign: 'center', minWidth: 0 }} title={currency(row.total)}>
                <div className="small mono muted" style={{ fontSize: 10, marginBottom: 4 }}>
                  {Math.round(row.total)}
                </div>
                <div
                  style={{
                    height: `${Math.max(4, (row.total / dailyMax) * 100)}px`,
                    background: 'var(--brand)',
                    borderRadius: '5px 5px 0 0',
                  }}
                />
                <div className="small muted" style={{ fontSize: 10, marginTop: 5, whiteSpace: 'nowrap' }}>
                  {row.day.slice(5)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <Tabs tabs={TABS} value={tab} onChange={setTab} />

      {report.cards && (
        <div className="grid grid-4">
          {report.cards.map((card) => (
            <StatCard key={card.label} label={card.label} value={card.value} meta={card.meta} />
          ))}
        </div>
      )}

      {report.note ? (
        <EmptyState title="Select one exhibition">{report.note}</EmptyState>
      ) : report.rows.length === 0 ? (
        <EmptyState title="Nothing to report">No data matches the selected period.</EmptyState>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                {report.columns.map((column) => (
                  <th key={column.label} className={column.numeric ? 'right' : ''}>
                    {column.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr key={report.key(row)}>
                  {report.columns.map((column) => (
                    <td key={column.label} className={column.numeric ? 'right mono' : ''}>
                      {String(column.value(row) ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
