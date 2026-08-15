/**
 * Checkout wizard: Customer → Discount → Payment.
 * Every step has a sensible default so a fast sale is three taps.
 */

import { useMemo, useState } from 'react'
import { useApp, useCurrency } from '../../lib/store.jsx'
import { computeTotals } from '../../lib/domain.js'
import { money, uid } from '../../lib/format.js'
import { Avatar, Field, Modal } from '../../components/ui.jsx'

const STEPS = ['Customer', 'Discount', 'Payment']

export default function CheckoutModal({ cart, onClose, onComplete }) {
  const { state, user, activeExhibition, actions, online } = useApp()
  const currency = useCurrency()

  const [step, setStep] = useState(0)
  const [customer, setCustomer] = useState(null)
  const [walkIn, setWalkIn] = useState(false)
  const [discount, setDiscount] = useState({ type: 'percentage', value: 0 })
  const [method, setMethod] = useState(state.settings.paymentMethods[0] || 'Cash')
  const [tendered, setTendered] = useState('')
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const maxDiscount = user.maxDiscountPercent ?? state.settings.maxDiscountPercent
  const totals = useMemo(() => computeTotals(cart, discount, state.settings), [cart, discount, state.settings])

  const percentApplied = totals.subtotal ? (totals.discountAmount / totals.subtotal) * 100 : 0
  const overDiscountLimit = percentApplied > maxDiscount + 0.001

  const changeDue = method === 'Cash' && tendered ? money(Number(tendered) - totals.total) : null

  const complete = () => {
    setError('')
    setBusy(true)
    try {
      const order = actions.completeSale({
        clientId: uid('cli'),
        exhibitionId: activeExhibition.id,
        customerId: customer?.id || null,
        customerName: customer?.name || 'Walk-in Customer',
        salespersonId: user.id,
        salespersonName: user.name,
        items: cart,
        discount,
        paymentMethod: method,
        paymentReference: reference,
      })
      onComplete(order)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  // The discount ceiling is enforced, not just flagged.
  const canAdvance =
    step === 0 ? Boolean(customer) || walkIn : step === 1 ? !overDiscountLimit : Boolean(method) && !overDiscountLimit

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`Checkout · ${STEPS[step]}`}
      subtitle={`${totals.itemCount} item${totals.itemCount === 1 ? '' : 's'} · ${currency(totals.total)}${
        online ? '' : ' · offline — will sync automatically'
      }`}
      footer={
        <>
          <button
            className="btn"
            onClick={() => (step === 0 ? onClose() : setStep(step - 1))}
            disabled={busy}
          >
            {step === 0 ? 'Cancel' : 'Back'}
          </button>
          {step < 2 ? (
            <button className="btn btn-primary" disabled={!canAdvance} onClick={() => setStep(step + 1)}>
              Continue
            </button>
          ) : (
            <button className="btn btn-primary" disabled={busy || !canAdvance} onClick={complete}>
              {busy ? 'Saving…' : `Complete sale · ${currency(totals.total)}`}
            </button>
          )}
        </>
      }
    >
      <StepBar step={step} onJump={setStep} />

      {error && (
        <div className="badge badge-danger" style={{ padding: '10px 14px', borderRadius: 12, whiteSpace: 'normal' }}>
          {error}
        </div>
      )}

      {step === 0 && (
        <CustomerStep
          customer={customer}
          onSelect={(next) => {
            setCustomer(next)
            setWalkIn(false)
            setStep(1)
          }}
          onWalkIn={() => {
            setCustomer(null)
            setWalkIn(true)
            setStep(1)
          }}
        />
      )}

      {step === 1 && (
        <DiscountStep
          discount={discount}
          setDiscount={setDiscount}
          totals={totals}
          maxDiscount={maxDiscount}
          percentApplied={percentApplied}
          overLimit={overDiscountLimit}
        />
      )}

      {step === 2 && (
        <PaymentStep
          methods={state.settings.paymentMethods}
          method={method}
          setMethod={setMethod}
          tendered={tendered}
          setTendered={setTendered}
          reference={reference}
          setReference={setReference}
          totals={totals}
          changeDue={changeDue}
          customer={customer}
        />
      )}
    </Modal>
  )
}

function StepBar({ step, onJump }) {
  return (
    <div className="row" style={{ gap: 6 }}>
      {STEPS.map((label, index) => (
        <button
          key={label}
          className="grow"
          onClick={() => index < step && onJump(index)}
          style={{
            border: 'none',
            background: 'transparent',
            padding: 0,
            cursor: index < step ? 'pointer' : 'default',
            textAlign: 'left',
          }}
        >
          <div
            style={{
              height: 4,
              borderRadius: 999,
              background: index <= step ? 'var(--brand)' : 'var(--surface-3)',
              marginBottom: 6,
            }}
          />
          <div className="small" style={{ color: index <= step ? 'var(--brand)' : 'var(--muted-2)', fontWeight: 620 }}>
            {label}
          </div>
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------- customer */

function CustomerStep({ customer, onSelect, onWalkIn }) {
  const { state, actions } = useApp()
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState({ name: '', whatsapp: '', email: '', marketingConsent: false })
  const [error, setError] = useState('')

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) {
      return [...state.customers]
        .sort((a, b) => (b.lastPurchaseAt || '').localeCompare(a.lastPurchaseAt || ''))
        .slice(0, 6)
    }
    return state.customers
      .filter((entry) =>
        [entry.name, entry.phone, entry.whatsapp, entry.email]
          .filter(Boolean)
          .some((field) => field.toLowerCase().replace(/\s/g, '').includes(needle.replace(/\s/g, ''))),
      )
      .slice(0, 12)
  }, [state.customers, query])

  const save = () => {
    if (!draft.name.trim()) {
      setError('A name is required.')
      return
    }
    if (!draft.whatsapp.trim() && !draft.email.trim()) {
      setError('Add a WhatsApp number or an email so the receipt can be sent.')
      return
    }
    const created = actions.saveCustomer({
      id: uid('cus'),
      name: draft.name.trim(),
      phone: draft.whatsapp.trim(),
      whatsapp: draft.whatsapp.trim(),
      email: draft.email.trim(),
      marketingConsent: draft.marketingConsent,
      consentAt: draft.marketingConsent ? new Date().toISOString() : null,
      notes: '',
    })
    onSelect(created)
  }

  if (creating) {
    return (
      <div className="col">
        <Field label="Full name">
          <input
            className="input"
            value={draft.name}
            autoFocus
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            placeholder="Amina Hassan"
          />
        </Field>
        <Field label="WhatsApp number" hint="Used to deliver the receipt.">
          <input
            className="input"
            value={draft.whatsapp}
            inputMode="tel"
            onChange={(event) => setDraft({ ...draft, whatsapp: event.target.value })}
            placeholder="+44 7700 900123"
          />
        </Field>
        <Field label="Email (optional)">
          <input
            className="input"
            value={draft.email}
            inputMode="email"
            onChange={(event) => setDraft({ ...draft, email: event.target.value })}
            placeholder="amina@example.com"
          />
        </Field>

        <label className="checkbox">
          <input
            type="checkbox"
            checked={draft.marketingConsent}
            onChange={(event) => setDraft({ ...draft, marketingConsent: event.target.checked })}
          />
          <span className="small">{state.settings.marketingConsentText}</span>
        </label>
        <p className="small muted" style={{ margin: 0 }}>
          The receipt for this purchase is sent either way — this consent only covers future marketing.
        </p>

        {error && <div className="small" style={{ color: 'var(--danger)' }}>{error}</div>}

        <div className="row">
          <button className="btn grow" onClick={() => setCreating(false)}>
            Back
          </button>
          <button className="btn btn-primary grow" onClick={save}>
            Save &amp; continue
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="col">
      <input
        className="input"
        placeholder="Search by name, phone or email"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoComplete="off"
      />

      <div className="row" style={{ gap: 8 }}>
        <button className="btn grow" onClick={onWalkIn}>
          Walk-in customer
        </button>
        <button className="btn btn-primary grow" onClick={() => setCreating(true)}>
          + New customer
        </button>
      </div>

      <div className="stack-sm">
        {matches.map((entry) => (
          <button
            key={entry.id}
            className="list-item"
            style={{ borderColor: customer?.id === entry.id ? 'var(--brand)' : 'transparent' }}
            onClick={() => onSelect(entry)}
          >
            <Avatar name={entry.name} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 620 }}>{entry.name}</div>
              <div className="small muted">
                {entry.whatsapp || entry.email || 'No contact'}
                {entry.totalOrders ? ` · ${entry.totalOrders} previous order${entry.totalOrders === 1 ? '' : 's'}` : ''}
              </div>
            </div>
            {entry.marketingConsent && <span className="badge badge-good">Opted in</span>}
          </button>
        ))}
        {matches.length === 0 && (
          <p className="small muted center" style={{ margin: '10px 0' }}>
            No customer matches that search.
          </p>
        )}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- discount */

function DiscountStep({ discount, setDiscount, totals, maxDiscount, percentApplied, overLimit }) {
  const currency = useCurrency()
  const quick = [0, 5, 10, 15, 20].filter((value) => value <= maxDiscount || value === 0)

  return (
    <div className="col">
      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        <button
          className={discount.type === 'percentage' ? 'active' : ''}
          onClick={() => setDiscount({ type: 'percentage', value: 0 })}
        >
          Percentage
        </button>
        <button
          className={discount.type === 'fixed' ? 'active' : ''}
          onClick={() => setDiscount({ type: 'fixed', value: 0 })}
        >
          Fixed amount
        </button>
      </div>

      {discount.type === 'percentage' ? (
        <>
          <div className="row wrap" style={{ gap: 8 }}>
            {quick.map((value) => (
              <button
                key={value}
                className={`chip ${discount.value === value ? 'active' : ''}`}
                onClick={() => setDiscount({ type: 'percentage', value })}
              >
                {value === 0 ? 'No discount' : `${value}%`}
              </button>
            ))}
          </div>
          <Field label="Custom percentage" hint={`Your limit is ${maxDiscount}%.`}>
            <input
              className="input"
              type="number"
              min="0"
              max="100"
              inputMode="decimal"
              value={discount.value || ''}
              onChange={(event) =>
                setDiscount({ type: 'percentage', value: Math.max(0, Number(event.target.value) || 0) })
              }
              placeholder="0"
            />
          </Field>
        </>
      ) : (
        <Field label={`Discount amount`} hint={`Your limit is ${maxDiscount}% of the subtotal.`}>
          <input
            className="input"
            type="number"
            min="0"
            inputMode="decimal"
            value={discount.value || ''}
            onChange={(event) => setDiscount({ type: 'fixed', value: Math.max(0, Number(event.target.value) || 0) })}
            placeholder="0.00"
          />
        </Field>
      )}

      {overLimit && (
        <div className="badge badge-danger" style={{ padding: '10px 14px', borderRadius: 12, whiteSpace: 'normal' }}>
          {percentApplied.toFixed(1)}% exceeds your {maxDiscount}% limit — ask a manager to approve it.
        </div>
      )}

      <div className="card" style={{ background: 'var(--surface-2)' }}>
        <div className="total-line">
          <span>Subtotal</span>
          <span className="mono">{currency(totals.subtotal)}</span>
        </div>
        <div className="total-line">
          <span>Discount</span>
          <span className="mono" style={{ color: totals.discountAmount ? 'var(--good)' : undefined }}>
            −{currency(totals.discountAmount)}
          </span>
        </div>
        <div className="total-line grand">
          <span>Total</span>
          <span className="mono">{currency(totals.total)}</span>
        </div>
      </div>
    </div>
  )
}

/* --------------------------------------------------------------- payment */

function PaymentStep({
  methods,
  method,
  setMethod,
  tendered,
  setTendered,
  reference,
  setReference,
  totals,
  changeDue,
  customer,
}) {
  const currency = useCurrency()
  const suggestions = useMemo(() => {
    const total = totals.total
    const options = new Set([Math.ceil(total)])
    for (const note of [5, 10, 20, 50]) options.add(Math.ceil(total / note) * note)
    return [...options].filter((value) => value >= total).sort((a, b) => a - b).slice(0, 4)
  }, [totals.total])

  return (
    <div className="col">
      <div className="grid grid-2" style={{ gap: 10 }}>
        {methods.map((entry) => (
          <button
            key={entry}
            className={`btn btn-lg ${method === entry ? 'btn-primary' : ''}`}
            onClick={() => setMethod(entry)}
          >
            {entry}
          </button>
        ))}
      </div>

      {method === 'Cash' && (
        <>
          <Field label="Cash received">
            <input
              className="input"
              type="number"
              inputMode="decimal"
              value={tendered}
              onChange={(event) => setTendered(event.target.value)}
              placeholder={totals.total.toFixed(2)}
            />
          </Field>
          <div className="row wrap" style={{ gap: 8 }}>
            {suggestions.map((value) => (
              <button key={value} className="chip" onClick={() => setTendered(String(value))}>
                {currency(value)}
              </button>
            ))}
          </div>
          {changeDue !== null && (
            <div
              className="card"
              style={{
                background: changeDue >= 0 ? 'var(--good-soft)' : 'var(--danger-soft)',
                borderColor: 'transparent',
              }}
            >
              <div className="row-between">
                <span style={{ fontWeight: 620 }}>{changeDue >= 0 ? 'Change due' : 'Still owing'}</span>
                <span className="mono" style={{ fontSize: 21, fontWeight: 750 }}>
                  {currency(Math.abs(changeDue))}
                </span>
              </div>
            </div>
          )}
        </>
      )}

      {(method === 'Bank Transfer' || method === 'Online Payment' || method === 'Other') && (
        <Field label="Reference (optional)" hint="Transaction ID, terminal reference or note.">
          <input
            className="input"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
            placeholder="e.g. TRX-88210"
          />
        </Field>
      )}

      <div className="card" style={{ background: 'var(--surface-2)' }}>
        <div className="total-line">
          <span>Customer</span>
          <span>{customer?.name || 'Walk-in Customer'}</span>
        </div>
        <div className="total-line">
          <span>Subtotal</span>
          <span className="mono">{currency(totals.subtotal)}</span>
        </div>
        {totals.discountAmount > 0 && (
          <div className="total-line">
            <span>Discount</span>
            <span className="mono">−{currency(totals.discountAmount)}</span>
          </div>
        )}
        {totals.tax > 0 && (
          <div className="total-line">
            <span>VAT</span>
            <span className="mono">{currency(totals.tax)}</span>
          </div>
        )}
        <div className="total-line grand">
          <span>To pay</span>
          <span className="mono">{currency(totals.total)}</span>
        </div>
      </div>
    </div>
  )
}
