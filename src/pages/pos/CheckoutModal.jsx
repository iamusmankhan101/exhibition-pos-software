/**
 * Checkout wizard: Customer → Discount → Payment.
 * Every step has a sensible default so a fast sale is three taps.
 *
 * `tech` runs the same wizard for a Tareez Tech service invoice: the client is
 * named rather than walked in, and the invoice carries issue and due dates.
 */

import { useMemo, useState } from 'react'
import { useApp, useCurrency } from '../../lib/store.jsx'
import { computeTotals, dueDateFor, TECH_PROFILE, validatePromo } from '../../lib/domain.js'
import { money, nowIso, uid } from '../../lib/format.js'
import { Avatar, Field, Modal } from '../../components/ui.jsx'

const STEPS = ['Customer', 'Discount', 'Payment']
const TECH_STEPS = ['Client', 'Discount', 'Payment']

/**
 * The day as the till sees it.
 *
 * `dayKey` reads the UTC day, which for a tablet east of Greenwich is the day
 * before the one on its own clock — and an invoice dated a day early is a
 * document that disagrees with the conversation it came out of.
 */
const localDay = (iso) => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export default function CheckoutModal({ cart, tech = false, oversellApproval, onClose, onComplete }) {
  const { state, user, sellLocationId, actions, online } = useApp()
  const currency = useCurrency()
  const steps = tech ? TECH_STEPS : STEPS

  const [step, setStep] = useState(0)
  const [customer, setCustomer] = useState(null)
  const [walkIn, setWalkIn] = useState(false)
  // A marketing job is often invoiced after the work, so both dates are editable
  // rather than fixed to the clock on the tablet.
  const [issuedAt, setIssuedAt] = useState(() => nowIso())
  const [dueDate, setDueDate] = useState(() => dueDateFor(nowIso(), state.settings.techDueDays))
  const [clientContact, setClientContact] = useState('')
  const [discount, setDiscount] = useState({ type: 'percentage', value: 0 })
  const [promo, setPromo] = useState(null)
  const [method, setMethod] = useState(state.settings.paymentMethods[0] || 'Cash')
  const [tendered, setTendered] = useState('')
  const [reference, setReference] = useState('')
  const [partPayment, setPartPayment] = useState(false)
  const [paidNow, setPaidNow] = useState('')
  const [paymentMode, setPaymentMode] = useState('single')
  const [splitParts, setSplitParts] = useState(() => [
    { id: uid('sp'), method: 'Cash', amount: '' },
    { id: uid('sp'), method: 'Card', amount: '' },
  ])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const maxDiscount = user.maxDiscountPercent ?? state.settings.maxDiscountPercent
  const totals = useMemo(
    () => computeTotals(cart, discount, state.settings, promo),
    [cart, discount, promo, state.settings],
  )

  // Line discounts count towards the cap too, otherwise they would be a way
  // around the order-level limit. A promo code does not: it was authorised by an
  // admin when it was created, so it is not the salesperson's discretion.
  const grossSubtotal = money(totals.subtotal + totals.lineDiscounts)
  const staffDiscount = money(totals.discountAmount + totals.lineDiscounts)
  const percentApplied = grossSubtotal ? (staffDiscount / grossSubtotal) * 100 : 0
  const overDiscountLimit = percentApplied > maxDiscount + 0.001

  const splitAllocated = money(
    splitParts.reduce((sum, part) => sum + (part.method ? Number(part.amount) || 0 : 0), 0),
  )
  const splitting = paymentMode === 'split'
  const paidNowValue = splitting
    ? money(Math.min(splitAllocated, totals.total))
    : partPayment
      ? money(Number(paidNow) || 0)
      : totals.total
  const balanceDue = money(totals.total - paidNowValue)
  const isPending = balanceDue > 0

  const changeDue =
    !splitting && method === 'Cash' && tendered ? money(Number(tendered) - totals.total) : null

  /*
   * Both dates are noon local, not midnight UTC, so a tablet west of Greenwich
   * does not print the day before the one the operator picked. Moving the issue
   * date moves the deadline with it: a job invoiced late is still due the agreed
   * number of days after it was raised.
   */
  const applyIssueDay = (value) => {
    if (!value) return
    const iso = new Date(`${value}T12:00:00`).toISOString()
    setIssuedAt(iso)
    setDueDate(dueDateFor(iso, state.settings.techDueDays))
  }

  const applyDueDay = (value) => setDueDate(value ? new Date(`${value}T12:00:00`).toISOString() : '')

  const complete = () => {
    setError('')
    setBusy(true)
    try {
      const order = actions.completeSale({
        clientId: uid('cli'),
        exhibitionId: sellLocationId,
        customerId: customer?.id || null,
        customerName: customer?.name || 'Walk-in Customer',
        salespersonId: user.id,
        salespersonName: user.name,
        items: cart,
        discount,
        promo,
        paymentMethod: method,
        paymentReference: reference,
        paymentParts: splitting
          ? splitParts
              .filter((part) => part.method && Number(part.amount) > 0)
              .map((part) => ({ method: part.method, amount: money(Number(part.amount)) }))
          : null,
        amountPaid: !splitting && partPayment ? paidNowValue : null,
        overrideOversell: Boolean(oversellApproval),
        overrideBy: oversellApproval,
        ...(tech
          ? { profile: TECH_PROFILE, clientContact: clientContact.trim(), issuedAt, dueDate }
          : {}),
      })
      onComplete(order)
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  // The discount ceiling is enforced, not just flagged. A tech invoice also has
  // to say who it is billed to, so it cannot proceed on a walk-in.
  const paymentReady = splitting ? splitAllocated > 0 : Boolean(method)
  const canAdvance =
    step === 0
      ? tech
        ? Boolean(customer)
        : Boolean(customer) || walkIn
      : step === 1
        ? !overDiscountLimit
        : paymentReady && !overDiscountLimit

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={`${tech ? 'Invoice' : 'Checkout'} · ${steps[step]}`}
      subtitle={`${
        tech
          ? `${cart.length} service${cart.length === 1 ? '' : 's'}`
          : `${totals.itemCount} item${totals.itemCount === 1 ? '' : 's'}`
      } · ${currency(totals.total)}${online ? '' : ' · offline — will sync automatically'}`}
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
              {busy
                ? 'Saving…'
                : isPending
                  ? `Take ${currency(paidNowValue)} · ${tech ? 'bill the balance' : 'hold balance'}`
                  : `${tech ? 'Issue invoice' : 'Complete sale'} · ${currency(totals.total)}`}
            </button>
          )}
        </>
      }
    >
      <StepBar steps={steps} step={step} onJump={setStep} />

      {oversellApproval && (
        <div className="badge badge-warn" style={{ padding: '10px 14px', borderRadius: 12, whiteSpace: 'normal' }}>
          Stock limit overridden by {oversellApproval.name} — this sale will be flagged for review.
        </div>
      )}

      {error && (
        <div className="badge badge-danger" style={{ padding: '10px 14px', borderRadius: 12, whiteSpace: 'normal' }}>
          {error}
        </div>
      )}

      {step === 0 && (
        <>
          <CustomerStep
            tech={tech}
            customer={customer}
            onSelect={(next) => {
              setCustomer(next)
              setWalkIn(false)
              // A tech invoice still has its dates on this step, so it waits for
              // the operator to press Continue rather than jumping ahead.
              if (!tech) setStep(1)
            }}
            onWalkIn={() => {
              setCustomer(null)
              setWalkIn(true)
              if (!tech) setStep(1)
            }}
          />
          {tech && (
            <InvoiceDetails
              contact={clientContact}
              setContact={setClientContact}
              issuedAt={issuedAt}
              dueDate={dueDate}
              onIssueDay={applyIssueDay}
              onDueDay={applyDueDay}
            />
          )}
        </>
      )}

      {step === 1 && (
        <DiscountStep
          discount={discount}
          setDiscount={setDiscount}
          promo={promo}
          setPromo={setPromo}
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
          partPayment={partPayment}
          setPartPayment={setPartPayment}
          paidNow={paidNow}
          setPaidNow={setPaidNow}
          paidNowValue={paidNowValue}
          balanceDue={balanceDue}
          paymentMode={paymentMode}
          setPaymentMode={setPaymentMode}
          splitParts={splitParts}
          setSplitParts={setSplitParts}
          splitAllocated={splitAllocated}
          tech={tech}
        />
      )}
    </Modal>
  )
}

function StepBar({ steps, step, onJump }) {
  return (
    <div className="row" style={{ gap: 6 }}>
      {steps.map((label, index) => (
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

function CustomerStep({ customer, onSelect, onWalkIn, tech }) {
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
      setError(tech ? 'Who is being invoiced? A name is required.' : 'A name is required.')
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
    // Back to the list with the new client selected — coming "back" to this step
    // must not reopen a form whose work is already saved.
    setCreating(false)
    setError('')
    onSelect(created)
  }

  if (creating) {
    return (
      <div className="col">
        <Field label={tech ? 'Client or company' : 'Full name'}>
          <input
            className="input"
            value={draft.name}
            autoFocus
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            placeholder={tech ? 'Brew & Bean Ltd' : 'Amina Hassan'}
          />
        </Field>
        <Field label="WhatsApp number" hint={tech ? 'Where the invoice is sent.' : 'Used to deliver the receipt.'}>
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
          <span className="small">
            {tech
              ? state.settings.techMarketingConsentText
              : state.settings.marketingConsentText}
          </span>
        </label>
        <p className="small muted" style={{ margin: 0 }}>
          {tech
            ? 'This invoice is sent either way — the consent only covers future marketing.'
            : 'The receipt for this purchase is sent either way — this consent only covers future marketing.'}
        </p>

        {error && <div className="small" style={{ color: 'var(--danger)' }}>{error}</div>}

        <div className="row">
          <button className="btn grow" onClick={() => setCreating(false)}>
            Back
          </button>
          <button className="btn btn-primary grow" onClick={save}>
            {tech ? 'Save client' : 'Save & continue'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="col">
      <input
        className="input"
        placeholder={tech ? 'Search saved clients' : 'Search by name, phone or email'}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        autoComplete="off"
      />

      <div className="row" style={{ gap: 8 }}>
        {!tech && (
          <button className="btn grow" onClick={onWalkIn}>
            Walk-in customer
          </button>
        )}
        <button className="btn btn-primary grow" onClick={() => setCreating(true)}>
          + New {tech ? 'client' : 'customer'}
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
            {`No ${tech ? 'client' : 'customer'} matches that search.`}
          </p>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ dates */

/**
 * The dates a service invoice is asked to carry.
 *
 * A stall sale is paid at the counter and needs neither of these. An invoice for
 * marketing work usually arrives after the work, states who to ask about it, and
 * asks for payment within a term the business sets in Admin.
 */
function InvoiceDetails({ contact, setContact, issuedAt, dueDate, onIssueDay, onDueDay }) {
  const { state } = useApp()
  return (
    <div className="card" style={{ display: 'grid', gap: 12, background: 'var(--surface-2)' }}>
      <Field label="Contact for this invoice" hint="Printed under the client name">
        <input
          className="input"
          value={contact}
          maxLength={60}
          onChange={(event) => setContact(event.target.value)}
          placeholder="accounts@brewbean.co · Amina"
        />
      </Field>
      <div className="row wrap" style={{ gap: 12 }}>
        <div className="grow" style={{ minWidth: 150 }}>
          <Field label="Issued on">
            <input className="input" type="date" value={localDay(issuedAt)} onChange={(e) => onIssueDay(e.target.value)} />
          </Field>
        </div>
        <div className="grow" style={{ minWidth: 150 }}>
          <Field
            label="Payment due"
            hint={
              state.settings.techDueDays > 0
                ? `Moves with the issue date, ${state.settings.techDueDays} days ahead`
                : 'No term set yet — Admin → Tareez Tech'
            }
          >
            <input
              className="input"
              type="date"
              value={dueDate ? localDay(dueDate) : ''}
              onChange={(e) => onDueDay(e.target.value)}
            />
          </Field>
        </div>
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- discount */

function DiscountStep({
  discount,
  setDiscount,
  promo,
  setPromo,
  totals,
  maxDiscount,
  percentApplied,
  overLimit,
}) {
  const { state, sellLocationId } = useApp()
  const currency = useCurrency()
  const quick = [0, 5, 10, 15, 20].filter((value) => value <= maxDiscount || value === 0)

  return (
    <div className="col">
      <PromoField
        promo={promo}
        setPromo={setPromo}
        // The code is checked against the ticket before any manual discount, so
        // a minimum-spend rule means what the customer actually brought to the till.
        subtotal={money(totals.subtotal + totals.lineDiscounts)}
        state={state}
        locationId={sellLocationId}
      />
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
          <span className="mono">{currency(totals.subtotal + totals.lineDiscounts)}</span>
        </div>
        {totals.lineDiscounts > 0 && (
          <div className="total-line">
            <span>Item discounts</span>
            <span className="mono" style={{ color: 'var(--good)' }}>
              −{currency(totals.lineDiscounts)}
            </span>
          </div>
        )}
        <div className="total-line">
          <span>Order discount</span>
          <span className="mono" style={{ color: totals.discountAmount ? 'var(--good)' : undefined }}>
            −{currency(totals.discountAmount)}
          </span>
        </div>
        {totals.promoAmount > 0 && (
          <div className="total-line">
            <span>Promo {totals.promoCode}</span>
            <span className="mono" style={{ color: 'var(--good)' }}>
              −{currency(totals.promoAmount)}
            </span>
          </div>
        )}
        <div className="total-line small" style={{ color: 'var(--muted-2)' }}>
          <span>Counts against your limit</span>
          <span className="mono">
            {percentApplied.toFixed(1)}% of {currency(totals.subtotal + totals.lineDiscounts)}
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

/** Promo code entry. Validation lives in the domain so the rules are testable. */
function PromoField({ promo, setPromo, subtotal, state, locationId }) {
  const currency = useCurrency()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')

  const apply = () => {
    const result = validatePromo(state, code, subtotal, { locationId })
    if (!result.ok) {
      setError(result.error)
      return
    }
    setError('')
    setCode('')
    setPromo(result.promo)
  }

  if (promo) {
    return (
      <div
        className="card row-between"
        style={{ background: 'var(--good-soft)', borderColor: 'transparent', padding: 12 }}
      >
        <div style={{ minWidth: 0 }}>
          <div className="mono" style={{ fontWeight: 700 }}>
            {promo.code}
          </div>
          <div className="small" style={{ color: 'var(--muted)' }}>
            {promo.description ||
              `${promo.type === 'percentage' ? `${promo.value}%` : currency(promo.value)} off`}
          </div>
        </div>
        <button className="btn btn-sm" onClick={() => setPromo(null)}>
          Remove
        </button>
      </div>
    )
  }

  return (
    <Field label="Promo code (optional)" hint="Codes are set by an admin and ignore your discount limit.">
      <div className="row" style={{ gap: 8 }}>
        <input
          className="input mono grow"
          value={code}
          autoCapitalize="characters"
          onChange={(event) => {
            setCode(event.target.value.toUpperCase())
            setError('')
          }}
          onKeyDown={(event) => event.key === 'Enter' && code.trim() && apply()}
          placeholder="STALL10"
        />
        <button className="btn" disabled={!code.trim()} onClick={apply}>
          Apply
        </button>
      </div>
      {error && (
        <div className="small" style={{ color: 'var(--danger)', marginTop: 6 }}>
          {error}
        </div>
      )}
    </Field>
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
  partPayment,
  setPartPayment,
  paidNow,
  setPaidNow,
  paidNowValue,
  balanceDue,
  paymentMode,
  setPaymentMode,
  splitParts,
  setSplitParts,
  splitAllocated,
  tech = false,
}) {
  const currency = useCurrency()
  const splitting = paymentMode === 'split'
  const suggestions = useMemo(() => {
    const total = totals.total
    const options = new Set([Math.ceil(total)])
    for (const note of [5, 10, 20, 50]) options.add(Math.ceil(total / note) * note)
    return [...options].filter((value) => value >= total).sort((a, b) => a - b).slice(0, 4)
  }, [totals.total])

  return (
    <div className="col">
      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        <button className={!splitting ? 'active' : ''} onClick={() => setPaymentMode('single')}>
          One method
        </button>
        <button className={splitting ? 'active' : ''} onClick={() => setPaymentMode('split')}>
          Split payment
        </button>
      </div>

      {splitting ? (
        <SplitPanel
          methods={methods}
          parts={splitParts}
          setParts={setSplitParts}
          total={totals.total}
          allocated={splitAllocated}
        />
      ) : (
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
      )}

      {!splitting && (
        <div className="seg" style={{ alignSelf: 'flex-start' }}>
          <button className={!partPayment ? 'active' : ''} onClick={() => setPartPayment(false)}>
            Pay in full
          </button>
          <button className={partPayment ? 'active' : ''} onClick={() => setPartPayment(true)}>
            Part payment
          </button>
        </div>
      )}

      {!splitting && partPayment && (
        <>
          <Field
            label="Amount received now"
            hint={`The rest is held as a balance due and the ${tech ? 'invoice' : 'sale'} is saved as Pending.`}
          >
            <input
              className="input"
              type="number"
              inputMode="decimal"
              value={paidNow}
              autoFocus
              onChange={(event) => setPaidNow(event.target.value)}
              placeholder="0.00"
            />
          </Field>
          <div className="row wrap" style={{ gap: 8 }}>
            {[0.25, 0.5, 0.75].map((fraction) => (
              <button
                key={fraction}
                className="chip"
                onClick={() => setPaidNow(String(money(totals.total * fraction)))}
              >
                {fraction * 100}% · {currency(totals.total * fraction)}
              </button>
            ))}
            <button className="chip" onClick={() => setPaidNow('0')}>
              Nothing yet
            </button>
          </div>
          {balanceDue > 0 && (
            <div
              className="card"
              style={{ background: 'var(--warn-soft)', borderColor: 'transparent' }}
            >
              <div className="row-between">
                <span style={{ fontWeight: 620, color: '#a9660b' }}>Balance due</span>
                <span className="mono" style={{ fontSize: 20, fontWeight: 750, color: '#a9660b' }}>
                  {currency(balanceDue)}
                </span>
              </div>
              <div className="small" style={{ color: '#a9660b', marginTop: 4 }}>
                {tech
                  ? 'Nothing is taken out of stock — the rest stays owed until settled from the Sales page.'
                  : 'Stock leaves with the customer now. Settle the balance from the Sales page.'}
              </div>
            </div>
          )}
        </>
      )}

      {!splitting && method === 'Cash' && !partPayment && (
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

      {!splitting && (method === 'Bank Transfer' || method === 'Online Payment' || method === 'Other') && (
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
          <span>{tech ? 'Client' : 'Customer'}</span>
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
        {totals.promoAmount > 0 && (
          <div className="total-line">
            <span>Promo {totals.promoCode}</span>
            <span className="mono">−{currency(totals.promoAmount)}</span>
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
        {splitting &&
          splitParts
            .filter((part) => Number(part.amount) > 0)
            .map((part) => (
              <div key={part.id} className="total-line small" style={{ color: 'var(--muted)' }}>
                <span>{part.method}</span>
                <span className="mono">{currency(Number(part.amount))}</span>
              </div>
            ))}
        {balanceDue > 0 && (
          <>
            <div className="total-line" style={{ marginTop: 8 }}>
              <span>Receiving now</span>
              <span className="mono">{currency(paidNowValue)}</span>
            </div>
            <div className="total-line" style={{ color: 'var(--warn)', fontWeight: 620 }}>
              <span>Outstanding</span>
              <span className="mono">{currency(balanceDue)}</span>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/**
 * Split payment rows. The customer pays part on one method and part on another;
 * each row becomes its own payment record so every till reconciles on its own.
 */
function SplitPanel({ methods, parts, setParts, total, allocated }) {
  const currency = useCurrency()
  const remaining = money(total - allocated)

  const patch = (id, values) =>
    setParts((current) => current.map((part) => (part.id === id ? { ...part, ...values } : part)))

  const addRow = () =>
    setParts((current) => [
      ...current,
      { id: uid('sp'), method: methods.find((m) => !current.some((p) => p.method === m)) || methods[0], amount: '' },
    ])

  return (
    <div className="col">
      <div className="stack-sm">
        {parts.map((part, index) => (
          <div key={part.id} className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
            <Field label={index === 0 ? 'Method' : ''}>
              <select
                className="select"
                style={{ width: 150 }}
                value={part.method}
                onChange={(event) => patch(part.id, { method: event.target.value })}
              >
                {methods.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={index === 0 ? 'Amount' : ''}>
              <input
                className="input mono"
                type="number"
                inputMode="decimal"
                min="0"
                value={part.amount}
                onChange={(event) => patch(part.id, { amount: event.target.value })}
                placeholder="0.00"
              />
            </Field>
            <button
              className="btn"
              title="Put the rest on this method"
              onClick={() =>
                patch(part.id, {
                  amount: String(money(Math.max(0, remaining + (Number(part.amount) || 0)))),
                })
              }
            >
              Rest
            </button>
            {parts.length > 2 && (
              <button
                className="btn btn-ghost"
                aria-label="Remove"
                onClick={() => setParts((current) => current.filter((entry) => entry.id !== part.id))}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>

      {parts.length < methods.length && (
        <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={addRow}>
          + Another method
        </button>
      )}

      <div
        className="card"
        style={{
          background: remaining === 0 ? 'var(--good-soft)' : 'var(--warn-soft)',
          borderColor: 'transparent',
        }}
      >
        <div className="row-between">
          <span style={{ fontWeight: 620 }}>
            {remaining === 0 ? 'Fully allocated' : remaining > 0 ? 'Left to allocate' : 'Over-allocated'}
          </span>
          <span className="mono" style={{ fontSize: 20, fontWeight: 750 }}>
            {currency(Math.abs(remaining))}
          </span>
        </div>
        {remaining > 0 && (
          <div className="small" style={{ marginTop: 4 }}>
            Complete the sale like this and the rest is held as a balance due.
          </div>
        )}
        {remaining < 0 && (
          <div className="small" style={{ marginTop: 4 }}>
            Only {currency(total)} will be recorded — the excess is change.
          </div>
        )}
      </div>
    </div>
  )
}
