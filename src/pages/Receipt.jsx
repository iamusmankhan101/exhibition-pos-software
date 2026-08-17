/**
 * Customer-facing digital receipt.
 *
 * Renders from the self-contained payload in the URL fragment when present, so
 * the link works on the customer's own phone; otherwise it resolves the order
 * from local data (staff viewing a past sale).
 */

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useApp } from '../lib/store.jsx'
import { formatDate, money } from '../lib/format.js'
import { decodeReceipt, receiptQr } from '../lib/receipt.js'

function fragmentPayload() {
  const hash = window.location.hash
  const match = /[#&]d=([^&]+)/.exec(hash)
  return match ? decodeReceipt(match[1]) : null
}

export default function Receipt() {
  const { orderId } = useParams()
  const context = useApp()
  const [qr, setQr] = useState(null)
  const [busy, setBusy] = useState(false)

  const fromFragment = useMemo(fragmentPayload, [])

  const data = useMemo(() => {
    if (fromFragment) return fromFragment
    const state = context.state
    if (!state) return null
    const order = state.orders.find((entry) => entry.id === orderId)
    if (!order) return null
    const exhibition = state.exhibitions.find((entry) => entry.id === order.exhibitionId)
    const customer = state.customers.find((entry) => entry.id === order.customerId)
    return {
      business: state.settings.business,
      currencySymbol: state.settings.currencySymbol,
      design: state.settings.invoiceDesign || {},
      invoiceNo: order.invoiceNo,
      createdAt: order.createdAt,
      exhibitionName: exhibition?.name || '',
      salespersonName: order.salespersonName,
      customerName: order.customerName,
      customerContact: [customer?.whatsapp || customer?.phone, customer?.email].filter(Boolean).join(' · '),
      items: order.items.map((item) => ({
        name: item.name,
        variant: [item.color, item.size].filter(Boolean).join(' / '),
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
      subtotal: order.subtotal,
      discountAmount: money(order.discountAmount + (order.lineDiscounts || 0)),
      promoCode: order.promoCode || '',
      promoAmount: order.promoAmount || 0,
      paymentParts: order.paymentParts?.length > 1 ? order.paymentParts : [],
      tax: order.tax,
      taxInclusive: state.settings.taxInclusive,
      taxRate: state.settings.taxRate,
      total: order.total,
      amountPaid: order.amountPaid,
      balanceDue: order.balanceDue,
      paymentMethod: order.paymentMethod,
      terms: state.settings.terms,
      footer: state.settings.receiptFooter,
      status: order.status,
    }
  }, [fromFragment, context.state, orderId])

  useEffect(() => {
    receiptQr(window.location.href).then(setQr).catch(() => setQr(null))
  }, [])

  const savePdf = async () => {
    setBusy(true)
    try {
      const { downloadInvoicePdf } = await import('../lib/pdf.js')
      await downloadInvoicePdf(data, qr)
    } catch {
      /* the print button remains as a fallback */
    } finally {
      setBusy(false)
    }
  }

  if (!data) {
    // A link without an embedded payload needs local data to resolve.
    if (!fromFragment && !context.state) {
      return (
        <div className="boot">
          <div className="spinner" />
        </div>
      )
    }
    return (
      <div className="boot">
        <p>This receipt could not be found on this device.</p>
      </div>
    )
  }

  const design = data.design || {}

  const cur = (value) =>
    `${data.currencySymbol}${Number(money(value || 0)).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`

  return (
    <div className="receipt-page">
      <div style={{ width: '100%', maxWidth: 430 }}>
        <div className="receipt-actions no-print">
          <button className="btn" disabled={busy} onClick={savePdf}>
            {busy ? 'Building…' : 'Download PDF'}
          </button>
          <button className="btn" onClick={() => window.print()}>
            Print
          </button>
          <button className="btn" onClick={() => navigator.clipboard?.writeText(window.location.href)}>
            Copy link
          </button>
        </div>

        <article className="receipt">
          {design.showLogo !== false && (
            <div className="receipt-logo" style={design.accent ? { background: design.accent } : undefined}>
              {data.business.logo ? <img src={data.business.logo} alt="" /> : data.business.name?.slice(0, 1)}
            </div>
          )}
          <h1>{data.business.name}</h1>
          {data.business.tagline && <p className="tagline">{data.business.tagline}</p>}
          <p className="tagline">
            {[data.business.phone, data.business.email].filter(Boolean).join(' · ')}
          </p>
          {data.business.address && <p className="tagline">{data.business.address}</p>}

          {data.status && data.status !== 'Completed' && (
            <p
              className="center"
              style={{
                marginTop: 14,
                marginBottom: 0,
                fontWeight: 700,
                color: data.status === 'Cancelled' ? '#c0392b' : '#b7791f',
              }}
            >
              {data.status.toUpperCase()}
            </p>
          )}

          <hr />

          <div className="kv">
            <span>Invoice</span>
            <span>{data.invoiceNo}</span>
          </div>
          <div className="kv">
            <span>Date</span>
            <span>{formatDate(data.createdAt, true)}</span>
          </div>
          {design.showExhibition !== false && data.exhibitionName && (
            <div className="kv">
              <span>Exhibition</span>
              <span>{data.exhibitionName}</span>
            </div>
          )}
          {design.showSalesperson !== false && (
            <div className="kv">
              <span>Served by</span>
              <span>{data.salespersonName}</span>
            </div>
          )}
          <div className="kv">
            <span>Customer</span>
            <span>{data.customerName}</span>
          </div>
          {design.showCustomerContact !== false && data.customerContact && (
            <div className="kv">
              <span>Contact</span>
              <span>{data.customerContact}</span>
            </div>
          )}

          <hr />

          {data.items.map((item, index) => (
            <div className="receipt-line" key={index}>
              <div className="desc">
                {item.name}
                <small>
                  {[item.variant, `${item.quantity} × ${cur(item.unitPrice)}`].filter(Boolean).join(' · ')}
                </small>
              </div>
              <div style={{ fontWeight: 600 }}>{cur(item.quantity * item.unitPrice)}</div>
            </div>
          ))}

          <hr />

          <div className="kv">
            <span>Subtotal</span>
            <span>{cur(data.subtotal)}</span>
          </div>
          {data.discountAmount > 0 && (
            <div className="kv">
              <span>Discount</span>
              <span>−{cur(data.discountAmount)}</span>
            </div>
          )}
          {data.promoAmount > 0 && (
            <div className="kv">
              <span>Promo {data.promoCode}</span>
              <span>−{cur(data.promoAmount)}</span>
            </div>
          )}
          {design.showTaxBreakdown !== false && data.tax > 0 && (
            <div className="kv">
              <span>
                VAT {data.taxRate}% {data.taxInclusive ? '(included)' : ''}
              </span>
              <span>{cur(data.tax)}</span>
            </div>
          )}

          <div className="receipt-total">
            <span>Total</span>
            <span>{cur(data.total)}</span>
          </div>
          <div className="kv" style={{ marginTop: 8 }}>
            <span>Paid by</span>
            <span>{data.paymentMethod}</span>
          </div>
          {data.paymentParts?.map((part) => (
            <div className="kv" key={part.method} style={{ opacity: 0.75 }}>
              <span>&nbsp;&nbsp;{part.method}</span>
              <span>{cur(part.amount)}</span>
            </div>
          ))}
          {data.balanceDue > 0 && (
            <>
              <div className="kv">
                <span>Amount received</span>
                <span>{cur(data.amountPaid)}</span>
              </div>
              <div className="kv">
                <span style={{ color: '#c0343d' }}>Balance due</span>
                <span style={{ color: '#c0343d' }}>{cur(data.balanceDue)}</span>
              </div>
            </>
          )}

          {design.showQr !== false && qr && (
            <div className="receipt-qr">
              <img src={qr} alt="Receipt QR code" />
              <p className="tagline" style={{ marginTop: 6 }}>
                Scan to reopen this receipt
              </p>
            </div>
          )}

          <div className="receipt-foot">
            {data.business.vatNumber && <div>VAT No. {data.business.vatNumber}</div>}
            {design.showTerms !== false && data.terms && <p style={{ margin: '8px 0 0' }}>{data.terms}</p>}
            {data.footer && <p style={{ margin: '8px 0 0' }}>{data.footer}</p>}
          </div>
        </article>
      </div>
    </div>
  )
}
