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
import { buildInvoiceData } from '../lib/invoiceData.js'
import { decodeReceipt } from '../lib/receipt.js'
import { buildReceiptImage } from '../lib/receiptImage.js'
import { loadChunk } from '../lib/chunk.js'
import { TAREEZ_LOGO } from '../lib/seed.js'

function fragmentPayload() {
  const hash = window.location.hash
  const match = /[#&]d=([^&]+)/.exec(hash)
  return match ? decodeReceipt(match[1]) : null
}

export default function Receipt() {
  const { orderId } = useParams()
  const context = useApp()
  const [image, setImage] = useState(null)
  const [busy, setBusy] = useState(false)

  const fromFragment = useMemo(fragmentPayload, [])

  const data = useMemo(() => {
    // The link cannot carry a logo, so a customer's phone draws the bundled one —
    // but only for the stall. Stamping Tareez's logo on a Tareez Tech invoice
    // would be the wrong company on the customer's copy of their own bill, so a
    // tech link falls back to the drawn initial instead.
    if (fromFragment) {
      if (fromFragment.tech) return fromFragment
      return { ...fromFragment, business: { logo: TAREEZ_LOGO, ...fromFragment.business } }
    }
    const state = context.state
    if (!state) return null
    const order = state.orders.find((entry) => entry.id === orderId)
    if (!order) return null
    const exhibition = state.exhibitions.find((entry) => entry.id === order.exhibitionId)
    return buildInvoiceData(order, state, {
      exhibitionName: exhibition?.name || '',
      customer: state.customers.find((entry) => entry.id === order.customerId) || null,
    })
  }, [fromFragment, context.state, orderId])

  useEffect(() => {
    if (!data) return undefined
    let url = null
    buildReceiptImage(data)
      .then((blob) => {
        if (!blob) return
        url = URL.createObjectURL(blob)
        setImage(url)
      })
      .catch(() => setImage(null))
    return () => url && URL.revokeObjectURL(url)
  }, [data])

  const savePdf = async () => {
    setBusy(true)
    try {
      const { downloadInvoicePdf } = await loadChunk(() => import('../lib/pdf.js'))
      await downloadInvoicePdf(data)
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

  return (
    <div className="receipt-page">
      <div style={{ width: '100%', maxWidth: 720 }}>
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

        {image ? (
          <img className="invoice-sheet" src={image} alt={`Invoice ${data.invoiceNo}`} />
        ) : (
          <div className="boot" style={{ minHeight: 300 }}>
            <div className="spinner" />
          </div>
        )}
      </div>
    </div>
  )
}
