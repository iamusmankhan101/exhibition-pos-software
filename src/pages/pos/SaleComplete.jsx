/** Post-sale screen: show the QR, send the receipt, start the next sale. */

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp, useCurrency } from '../../lib/store.jsx'
import { Field, Modal } from '../../components/ui.jsx'
import {
  receiptMessage,
  receiptQr,
  receiptUrl,
  sendEmail,
  sendSms,
  sendWhatsApp,
  shareOrCopy,
} from '../../lib/receipt.js'

export default function SaleComplete({ order, onClose }) {
  const { state, actions, activeExhibition } = useApp()
  const currency = useCurrency()
  const [qr, setQr] = useState(null)
  const [showQr, setShowQr] = useState(false)

  const customer = state.customers.find((entry) => entry.id === order.customerId) || null
  const [contact, setContact] = useState(customer?.whatsapp || customer?.phone || '')
  const [email, setEmail] = useState(customer?.email || '')

  const url = useMemo(
    () => receiptUrl(order, state.settings, activeExhibition?.name || ''),
    [order, state.settings, activeExhibition],
  )
  const message = useMemo(() => receiptMessage(order, state.settings, url), [order, state.settings, url])

  useEffect(() => {
    receiptQr(url).then(setQr).catch(() => setQr(null))
  }, [url])

  const channels = state.settings.receiptChannels

  const share = async () => {
    const result = await shareOrCopy(`Receipt ${order.invoiceNo}`, message, url)
    if (result === 'copied') actions.toast('Receipt link copied', 'success')
    if (result === 'failed') actions.toast('Could not copy the link', 'warn')
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Sale complete"
      subtitle={`${order.invoiceNo} · ${order.paymentMethod}`}
      footer={
        <>
          <Link className="btn" to={`/r/${order.id}`} target="_blank" rel="noopener">
            View receipt
          </Link>
          <button className="btn btn-primary" onClick={onClose}>
            New sale
          </button>
        </>
      }
    >
      <div className="center" style={{ padding: '4px 0 6px' }}>
        <div
          style={{
            width: 62,
            height: 62,
            margin: '0 auto 12px',
            borderRadius: '50%',
            background: 'var(--good-soft)',
            color: 'var(--good)',
            display: 'grid',
            placeItems: 'center',
            fontSize: 30,
          }}
        >
          ✓
        </div>
        <div style={{ fontSize: 32, fontWeight: 760, letterSpacing: '-0.02em' }} className="mono">
          {currency(order.total)}
        </div>
        <div className="small muted">
          {order.customerName} · {order.items.reduce((sum, item) => sum + item.quantity, 0)} item
          {order.items.reduce((sum, item) => sum + item.quantity, 0) === 1 ? '' : 's'}
          {order.discountAmount > 0 && ` · ${currency(order.discountAmount)} discount`}
        </div>
      </div>

      {channels.qr && (
        <div className="card" style={{ background: 'var(--surface-2)', textAlign: 'center' }}>
          {showQr && qr ? (
            <>
              <img
                src={qr}
                alt="Receipt QR code"
                style={{ width: 210, height: 210, background: '#fff', borderRadius: 12, padding: 8 }}
              />
              <p className="small muted" style={{ margin: '10px 0 0' }}>
                Hold the screen up — the customer scans this to open their receipt.
              </p>
            </>
          ) : (
            <button className="btn btn-block" onClick={() => setShowQr(true)}>
              ⧉ Show QR code for the customer
            </button>
          )}
        </div>
      )}

      <div className="stack-sm">
        {(channels.whatsapp || channels.sms) && (
          <Field label="Mobile number">
            <input
              className="input"
              value={contact}
              inputMode="tel"
              onChange={(event) => setContact(event.target.value)}
              placeholder="+44 7700 900123"
            />
          </Field>
        )}
        <div className="row wrap" style={{ gap: 8 }}>
          {channels.whatsapp && (
            <button
              className="btn grow"
              disabled={!contact.trim()}
              onClick={() => sendWhatsApp(contact, message) || actions.toast('Enter a number first', 'warn')}
            >
              WhatsApp
            </button>
          )}
          {channels.sms && (
            <button
              className="btn grow"
              disabled={!contact.trim()}
              onClick={() => sendSms(contact, message)}
            >
              SMS
            </button>
          )}
        </div>

        {channels.email && (
          <>
            <Field label="Email">
              <input
                className="input"
                value={email}
                inputMode="email"
                onChange={(event) => setEmail(event.target.value)}
                placeholder="customer@example.com"
              />
            </Field>
            <button
              className="btn btn-block"
              disabled={!email.trim()}
              onClick={() => sendEmail(email, `Your ${state.settings.business.name} receipt ${order.invoiceNo}`, message)}
            >
              Email receipt
            </button>
          </>
        )}

        <button className="btn btn-block" onClick={share}>
          Share / copy link
        </button>
      </div>
    </Modal>
  )
}
