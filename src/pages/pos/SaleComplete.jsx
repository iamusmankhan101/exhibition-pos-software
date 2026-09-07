/** Post-sale screen: show the QR, send the receipt, start the next sale. */

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp, useCurrency } from '../../lib/store.jsx'
import { Field, Modal } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import { money } from '../../lib/format.js'
import { loadChunk } from '../../lib/chunk.js'
import { buildReceiptImage, copyReceiptImage, saveReceiptImage } from '../../lib/receiptImage.js'
import {
  canShareToWhatsApp,
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
  const [image, setImage] = useState(null)
  const [showQr, setShowQr] = useState(false)
  const [busy, setBusy] = useState(false)

  const customer = state.customers.find((entry) => entry.id === order.customerId) || null
  const [contact, setContact] = useState(customer?.whatsapp || customer?.phone || '')
  const [email, setEmail] = useState(customer?.email || '')

  const url = useMemo(
    () => receiptUrl(order, state.settings, activeExhibition?.name || '', customer),
    [order, state.settings, activeExhibition, customer],
  )

  const pdfData = useMemo(
    () => ({
      business: state.settings.business,
      currencySymbol: state.settings.currencySymbol,
      design: state.settings.invoiceDesign,
      invoiceNo: order.invoiceNo,
      createdAt: order.createdAt,
      exhibitionName: activeExhibition?.name || '',
      salespersonName: order.salespersonName,
      customerName: order.customerName,
      customerContact: [customer?.whatsapp || customer?.phone, customer?.email].filter(Boolean).join(' · '),
      items: order.items.map((item) => ({
        name: item.name,
        variant: [item.color, item.size].filter(Boolean).join(' / '),
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        listPrice: item.listPrice || 0,
      })),
      subtotal: order.subtotal,
      discountAmount: money(order.discountAmount + (order.lineDiscounts || 0)),
      promoCode: order.promoCode || '',
      promoAmount: order.promoAmount || 0,
      paymentParts: order.paymentParts?.length > 1 ? order.paymentParts : [],
      tax: order.tax,
      taxRate: state.settings.taxRate,
      taxInclusive: state.settings.taxInclusive,
      total: order.total,
      amountPaid: order.amountPaid,
      balanceDue: order.balanceDue,
      status: order.status,
      paymentMethod: order.paymentMethod,
      terms: state.settings.terms,
    }),
    [order, state.settings, activeExhibition, customer],
  )
  const message = useMemo(() => receiptMessage(order, state.settings, url), [order, state.settings, url])
  // The covering note that travels with an attached PDF — no link, because the
  // receipt itself is in the message.
  const note = useMemo(() => receiptMessage(order, state.settings), [order, state.settings])
  const canAttach = useMemo(() => canShareToWhatsApp(), [])
  const pasteKey = useMemo(() => (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘V' : 'Ctrl+V'), [])

  useEffect(() => {
    receiptQr(url).then(setQr).catch(() => setQr(null))
  }, [url])

  /*
   * Rendered as soon as the screen opens rather than on the click.
   *
   * Two reasons, both about the clipboard. Safari drops the user gesture if
   * anything is awaited before `clipboard.write`, and the write is refused
   * outright once the document loses focus — which is precisely what opening
   * WhatsApp does. A blob that is already sitting here makes the copy instant,
   * so neither race is left to lose.
   */
  useEffect(() => {
    let cancelled = false
    buildReceiptImage(pdfData, qr)
      .then((blob) => !cancelled && setImage(blob))
      .catch(() => !cancelled && setImage(null))
    return () => {
      cancelled = true
    }
  }, [pdfData, qr])

  const channels = state.settings.receiptChannels

  const share = async () => {
    const result = await shareOrCopy(`Receipt ${order.invoiceNo}`, message, url)
    if (result === 'copied') actions.toast('Receipt link copied', 'success')
    if (result === 'failed') actions.toast('Could not copy the link', 'warn')
  }

  /** Hands the PDF to the share sheet so it can be attached to an email. */
  const attachPdf = async () => {
    setBusy(true)
    try {
      const { shareInvoicePdf } = await loadChunk(
        () => import('../../lib/pdf.js'),
        () => actions.toast('A new version was deployed — reloading…', 'warn'),
      )
      const result = await shareInvoicePdf(pdfData, qr, note)
      if (result === 'downloaded') {
        actions.toast('PDF saved — attach it to your email', 'success')
      }
    } catch {
      actions.toast('Could not build the PDF', 'error')
    } finally {
      setBusy(false)
    }
  }

  /**
   * Sends the receipt to WhatsApp as the PDF itself.
   *
   * On a phone the share sheet carries the file straight into a chat. Nothing
   * else can: WhatsApp Desktop registers no share extension, and `wa.me` takes
   * text only — so everywhere else the PDF is downloaded and the chat is opened
   * beside it with the covering note ready to send.
   */
  const whatsappPdf = async () => {
    setBusy(true)
    try {
      const pdf = await loadChunk(
        () => import('../../lib/pdf.js'),
        () => actions.toast('A new version was deployed — reloading…', 'warn'),
      )
      if (canAttach) {
        await pdf.shareInvoicePdf(pdfData, qr, note)
      } else {
        await pdf.downloadInvoicePdf(pdfData, qr)
        actions.toast('PDF saved — attach it in the chat', 'success')
      }
    } catch {
      actions.toast('Could not build the PDF', 'error')
    } finally {
      setBusy(false)
    }
  }

  /**
   * The desktop route: copy the receipt as an image, then open the chat so it
   * can be pasted in. WhatsApp on a computer takes no file from a browser, but
   * every chat app accepts a pasted image — and an image previews inline in the
   * conversation, which a PDF attachment does not.
   *
   * Synchronous up front on purpose. Both the clipboard write and the app
   * hand-off have to happen inside the click: after an `await` the user gesture
   * is gone, Safari refuses the clipboard, and the window is blocked as a popup.
   * `copyReceiptImage` is handed the unresolved promise for exactly that reason.
   */
  /** Copy on its own, with no chat hand-off to steal focus. */
  const copyImage = () =>
    copyReceiptImage(Promise.resolve(image)).then((ok) => {
      if (ok) return actions.toast(`Receipt copied — press ${pasteKey} to paste it`, 'success')
      saveReceiptImage(image, order.invoiceNo)
      return actions.toast('Clipboard unavailable — image saved instead', 'warn')
    })

  const whatsappImage = () => {
    setBusy(true)
    // Called synchronously so Safari still counts this as the click that asked
    // for it. The blob is normally already rendered; the promise form covers the
    // case where the screen was only just opened.
    const pending = image ? Promise.resolve(image) : buildReceiptImage(pdfData, qr)

    return copyReceiptImage(pending)
      .then(async (ok) => {
        if (ok) {
          actions.toast(`Receipt copied — press ${pasteKey} in the chat, then Enter`, 'success')
        } else {
          // No clipboard, or it was refused: hand over the file instead.
          saveReceiptImage(await pending, order.invoiceNo)
          actions.toast('Receipt image saved — drag it into the chat', 'warn')
        }
        /*
         * Opened last, and only once the clipboard actually holds the image.
         * Handing off to WhatsApp takes focus away from the page, and a
         * clipboard write on an unfocused document is rejected — doing this
         * first is why the paste came up empty. The protocol launch still
         * counts as user-initiated: transient activation outlives the copy.
         *
         * The box is left empty on purpose. Pasting an image into a chat that
         * already has text opens WhatsApp's image preview with its own caption
         * field, and the typed note is stranded behind it — press Enter out of
         * habit and the text goes on its own, which is exactly what happened.
         * The image is a complete receipt, so it needs no covering note.
         */
        sendWhatsApp(contact, '')
      })
      .catch(() => actions.toast('Could not build the receipt image', 'error'))
      .finally(() => setBusy(false))
  }

  const onWhatsApp = () => {
    // A phone shares the PDF properly through the share sheet; nothing beats it.
    if (canAttach) return whatsappPdf()
    if (!contact.trim()) return actions.toast('Enter a number first', 'warn')
    return whatsappImage()
  }

  const savePdf = async () => {
    setBusy(true)
    try {
      const { downloadInvoicePdf } = await loadChunk(
        () => import('../../lib/pdf.js'),
        () => actions.toast('A new version was deployed — reloading…', 'warn'),
      )
      await downloadInvoicePdf(pdfData, qr)
    } catch {
      actions.toast('Could not build the PDF', 'error')
    } finally {
      setBusy(false)
    }
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
          {order.discountAmount + (order.lineDiscounts || 0) > 0 &&
            ` · ${currency(order.discountAmount + (order.lineDiscounts || 0))} discount`}
          {order.promoAmount > 0 && ` · ${order.promoCode} −${currency(order.promoAmount)}`}
        </div>

        {order.paymentParts?.length > 1 && (
          <div className="small muted" style={{ marginTop: 4 }}>
            {order.paymentParts.map((part) => `${part.method} ${currency(part.amount)}`).join(' + ')}
          </div>
        )}

        {order.balanceDue > 0 && (
          <div
            className="card"
            style={{ background: 'var(--warn-soft)', borderColor: 'transparent', marginTop: 12, textAlign: 'left' }}
          >
            <div className="row-between">
              <span style={{ fontWeight: 620, color: '#a9660b' }}>Balance due</span>
              <span className="mono" style={{ fontWeight: 750, color: '#a9660b' }}>
                {currency(order.balanceDue)}
              </span>
            </div>
            <div className="small" style={{ color: '#a9660b', marginTop: 3 }}>
              {currency(order.amountPaid)} received · settle the rest from the Sales page.
            </div>
          </div>
        )}
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
        {/* Sending the receipt on WhatsApp is the thing nearly every sale ends
            with, so it gets the full width and the brand colour rather than
            sharing a row with SMS. */}
        {channels.whatsapp && (
          <button
            className="btn btn-lg btn-block btn-whatsapp"
            disabled={busy || (!canAttach && !contact.trim())}
            onClick={onWhatsApp}
          >
            <Icon name="whatsapp" size={19} />
            {busy ? 'Building PDF…' : 'Send receipt on WhatsApp'}
          </button>
        )}

        {channels.sms && (
          <button className="btn btn-block" disabled={!contact.trim()} onClick={() => sendSms(contact, message)}>
            SMS
          </button>
        )}

        {channels.whatsapp && (
          <p className="small muted" style={{ margin: '-2px 0 0' }}>
            {canAttach ? (
              'Opens the share sheet with the receipt PDF attached — choose WhatsApp, then the customer.'
            ) : (
              <>
                Copies the receipt as an image and opens the chat with an empty box — press {pasteKey},
                then Enter.{' '}
                {/* If the desktop app is not installed the scheme above does
                    nothing at all, so the web client stays one click away. */}
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ padding: 0, height: 'auto', textDecoration: 'underline' }}
                  onClick={() => sendWhatsApp(contact, note, { web: true }) || actions.toast('Enter a number first', 'warn')}
                >
                  Use WhatsApp Web instead
                </button>
              </>
            )}
          </p>
        )}

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
            <div className="row" style={{ gap: 8 }}>
              <button
                className="btn grow"
                disabled={!email.trim()}
                onClick={() =>
                  sendEmail(email, `Your ${state.settings.business.name} invoice ${order.invoiceNo}`, message)
                }
              >
                Email link
              </button>
              <button className="btn grow" disabled={busy} onClick={attachPdf}>
                {busy ? 'Building…' : 'Send PDF'}
              </button>
            </div>
          </>
        )}

        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn grow" onClick={share}>
            Share link
          </button>
          {/* A standalone copy, for when the paste is missed or the chat was
              already open. Same image the WhatsApp button puts on the clipboard. */}
          <button className="btn grow" disabled={!image} onClick={copyImage}>
            Copy image
          </button>
          <button className="btn grow" disabled={busy} onClick={savePdf}>
            {busy ? 'Building…' : 'Download PDF'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
