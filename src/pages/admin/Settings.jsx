import { useRef, useState } from 'react'
import { useApp, useCurrency } from '../../lib/store.jsx'
import { Avatar, Confirm, EmptyState, Field, ImagePicker, Modal, Tabs } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'
import { uid } from '../../lib/format.js'
import { ALL_PERMISSIONS, PERMISSION_GROUPS } from '../../lib/permissions.js'

const CURRENCIES = [
  ['GBP', '£'],
  ['USD', '$'],
  ['EUR', '€'],
  ['AED', 'AED '],
  ['SAR', 'SAR '],
  ['PKR', 'Rs '],
]

export default function Settings() {
  const { state, actions, deviceCode, deviceId, can } = useApp()
  const [tab, setTab] = useState('business')
  const [draft, setDraft] = useState(state.settings)
  const [resetting, setResetting] = useState(false)
  const [pdfBusy, setPdfBusy] = useState(false)
  const fileRef = useRef(null)

  const patch = (fields) => setDraft((current) => ({ ...current, ...fields }))
  const patchBusiness = (fields) =>
    setDraft((current) => ({ ...current, business: { ...current.business, ...fields } }))
  const patchDesign = (fields) =>
    setDraft((current) => ({ ...current, invoiceDesign: { ...current.invoiceDesign, ...fields } }))

  const design = draft.invoiceDesign

  /** Renders the sample invoice through the real PDF generator. */
  const previewPdf = async () => {
    setPdfBusy(true)
    try {
      const { downloadInvoicePdf } = await import('../../lib/pdf.js')
      await downloadInvoicePdf(sampleInvoice(draft))
    } catch {
      actions.toast('Could not build the sample', 'error')
    } finally {
      setPdfBusy(false)
    }
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(state.settings)

  const toggleChannel = (key) =>
    patch({ receiptChannels: { ...draft.receiptChannels, [key]: !draft.receiptChannels[key] } })

  const toggleMethod = (method) =>
    patch({
      paymentMethods: draft.paymentMethods.includes(method)
        ? draft.paymentMethods.filter((entry) => entry !== method)
        : [...draft.paymentMethods, method],
    })

  const importFile = (file) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        actions.importBackup(reader.result)
      } catch (error) {
        actions.toast(error.message, 'error')
      }
    }
    reader.readAsText(file)
  }

  return (
    <div className="page">
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'business', label: 'Business' },
          { value: 'sales', label: 'Sales rules' },
          { value: 'receipts', label: 'Receipts' },
          { value: 'invoice', label: 'Invoice design' },
          { value: 'roles', label: 'Roles & access' },
          ...(can('promo.manage') ? [{ value: 'promos', label: 'Promo codes' }] : []),
          { value: 'data', label: 'Data & devices' },
        ]}
      />

      {tab === 'business' && (
        <div className="grid grid-2">
          <div className="card col">
            <div className="card-title">Business identity</div>
            <ImagePicker
              value={draft.business.logo}
              name={draft.business.name}
              onChange={(logo) => patchBusiness({ logo })}
            />
            <Field label="Trading name">
              <input
                className="input"
                value={draft.business.name}
                onChange={(event) => patchBusiness({ name: event.target.value })}
              />
            </Field>
            <Field label="Legal name">
              <input
                className="input"
                value={draft.business.legalName}
                onChange={(event) => patchBusiness({ legalName: event.target.value })}
              />
            </Field>
            <Field label="Tagline">
              <input
                className="input"
                value={draft.business.tagline}
                onChange={(event) => patchBusiness({ tagline: event.target.value })}
              />
            </Field>
          </div>

          <div className="card col">
            <div className="card-title">Contact details</div>
            <Field label="Phone">
              <input
                className="input"
                value={draft.business.phone}
                onChange={(event) => patchBusiness({ phone: event.target.value })}
              />
            </Field>
            <Field label="Email">
              <input
                className="input"
                value={draft.business.email}
                onChange={(event) => patchBusiness({ email: event.target.value })}
              />
            </Field>
            <Field label="Website">
              <input
                className="input"
                value={draft.business.website}
                onChange={(event) => patchBusiness({ website: event.target.value })}
              />
            </Field>
            <Field label="Address">
              <textarea
                className="textarea"
                style={{ minHeight: 60 }}
                value={draft.business.address}
                onChange={(event) => patchBusiness({ address: event.target.value })}
              />
            </Field>
            <Field label="VAT number">
              <input
                className="input"
                value={draft.business.vatNumber}
                onChange={(event) => patchBusiness({ vatNumber: event.target.value })}
              />
            </Field>
          </div>
        </div>
      )}

      {tab === 'sales' && (
        <div className="grid grid-2">
          <div className="card col">
            <div className="card-title">Currency &amp; tax</div>
            <Field label="Currency">
              <select
                className="select"
                value={draft.currency}
                onChange={(event) => {
                  const found = CURRENCIES.find(([code]) => code === event.target.value)
                  patch({ currency: found[0], currencySymbol: found[1] })
                }}
              >
                {CURRENCIES.map(([code, symbol]) => (
                  <option key={code} value={code}>
                    {code} ({symbol.trim()})
                  </option>
                ))}
              </select>
            </Field>

            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.taxEnabled}
                onChange={(event) => patch({ taxEnabled: event.target.checked })}
              />
              <span>Apply VAT / sales tax</span>
            </label>

            {draft.taxEnabled && (
              <>
                <Field label="Tax rate %">
                  <input
                    className="input"
                    type="number"
                    step="0.5"
                    value={draft.taxRate}
                    onChange={(event) => patch({ taxRate: Number(event.target.value) })}
                  />
                </Field>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={draft.taxInclusive}
                    onChange={(event) => patch({ taxInclusive: event.target.checked })}
                  />
                  <span>Prices already include tax</span>
                </label>
              </>
            )}

            <Field label="Invoice prefix" hint={`Invoices look like ${draft.invoicePrefix}-250815-${deviceCode}001`}>
              <input
                className="input mono"
                value={draft.invoicePrefix}
                onChange={(event) => patch({ invoicePrefix: event.target.value.toUpperCase().slice(0, 6) })}
              />
            </Field>
          </div>

          <div className="card col">
            <div className="card-title">Discounts &amp; stock rules</div>
            <Field label="Default max discount %" hint="Per-user limits override this in Staff.">
              <input
                className="input"
                type="number"
                value={draft.maxDiscountPercent}
                onChange={(event) => patch({ maxDiscountPercent: Number(event.target.value) })}
              />
            </Field>
            <Field label="Alert admins above %" hint="Large-discount notification threshold.">
              <input
                className="input"
                type="number"
                value={draft.largeDiscountAlertPercent}
                onChange={(event) => patch({ largeDiscountAlertPercent: Number(event.target.value) })}
              />
            </Field>
            <Field label="Low-stock threshold" hint="Used when a variant has no specific threshold.">
              <input
                className="input"
                type="number"
                value={draft.lowStockThreshold}
                onChange={(event) => patch({ lowStockThreshold: Number(event.target.value) })}
              />
            </Field>

            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.allowOverselling}
                onChange={(event) => patch({ allowOverselling: event.target.checked })}
              />
              <span>
                Allow overselling
                <div className="small muted">
                  Staff can sell past zero; the stock goes negative and is flagged for review.
                </div>
              </span>
            </label>

            <div className="card-title" style={{ marginTop: 6 }}>
              Payment methods
            </div>
            <div className="stack-sm">
              {['Cash', 'Card', 'Bank Transfer', 'Online Payment', 'Other'].map((method) => (
                <label key={method} className="checkbox">
                  <input
                    type="checkbox"
                    checked={draft.paymentMethods.includes(method)}
                    onChange={() => toggleMethod(method)}
                  />
                  <span>{method}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {tab === 'receipts' && (
        <div className="grid grid-2">
          <div className="card col">
            <div className="card-title">Delivery channels</div>
            {[
              ['whatsapp', 'WhatsApp'],
              ['sms', 'SMS'],
              ['email', 'Email'],
              ['qr', 'On-screen QR code'],
            ].map(([key, label]) => (
              <label key={key} className="checkbox">
                <input type="checkbox" checked={draft.receiptChannels[key]} onChange={() => toggleChannel(key)} />
                <span>{label}</span>
              </label>
            ))}
            <p className="small muted" style={{ margin: 0 }}>
              Receipt links carry the invoice inside the link itself, so a customer can open it on their own phone
              straight after scanning.
            </p>
          </div>

          <div className="card col">
            <div className="card-title">Wording</div>
            <Field label="Marketing consent wording" hint="Shown at checkout and on the customer record.">
              <textarea
                className="textarea"
                value={draft.marketingConsentText}
                onChange={(event) => patch({ marketingConsentText: event.target.value })}
              />
            </Field>
            <Field label="Terms &amp; conditions">
              <textarea
                className="textarea"
                value={draft.terms}
                onChange={(event) => patch({ terms: event.target.value })}
              />
            </Field>
            <Field label="Receipt footer">
              <input
                className="input"
                value={draft.receiptFooter}
                onChange={(event) => patch({ receiptFooter: event.target.value })}
              />
            </Field>
          </div>
        </div>
      )}

      {tab === 'invoice' && (
        <div className="grid grid-split">
          <div className="card col">
            <div className="card-title">Layout</div>

            <Field label="Accent colour" hint="Used on the invoice header, footer bar and logo tile.">
              <div className="row wrap" style={{ gap: 8 }}>
                {['#0d9e59', '#14171c', '#2f75d8', '#7c5cd6', '#c2410c', '#be185d'].map((swatch) => (
                  <button
                    key={swatch}
                    onClick={() => patchDesign({ accent: swatch })}
                    aria-label={swatch}
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 9,
                      background: swatch,
                      border: design.accent === swatch ? '3px solid var(--text)' : '1px solid var(--line)',
                      cursor: 'pointer',
                    }}
                  />
                ))}
                <input
                  className="input"
                  style={{ width: 110 }}
                  value={design.accent}
                  onChange={(event) => patchDesign({ accent: event.target.value })}
                />
              </div>
            </Field>

            <Field label="Paper size">
              <select
                className="select"
                value={design.paperSize}
                onChange={(event) => patchDesign({ paperSize: event.target.value })}
              >
                <option value="a4">A4 — standard invoice</option>
                <option value="a5">A5 — compact</option>
              </select>
            </Field>

            <div className="card-title" style={{ marginTop: 6 }}>
              Show on the invoice
            </div>
            {[
              ['showLogo', 'Business logo'],
              ['showCustomerContact', 'Customer phone and email'],
              ['showExhibition', 'Exhibition name'],
              ['showSalesperson', 'Salesperson name'],
              ['showTaxBreakdown', 'VAT breakdown'],
              ['showQr', 'QR code'],
              ['showTerms', 'Terms & conditions'],
            ].map(([key, label]) => (
              <label key={key} className="checkbox">
                <input
                  type="checkbox"
                  checked={design[key] !== false}
                  onChange={(event) => patchDesign({ [key]: event.target.checked })}
                />
                <span>{label}</span>
              </label>
            ))}
          </div>

          <div className="card col">
            <div className="row-between">
              <div className="card-title">Preview</div>
              <button className="btn btn-sm" disabled={pdfBusy} onClick={previewPdf}>
                {pdfBusy ? 'Building…' : 'Download sample PDF'}
              </button>
            </div>
            <InvoicePreview settings={draft} />
          </div>
        </div>
      )}

      {tab === 'roles' && <RolesPanel draft={draft} patch={patch} />}

      {tab === 'promos' && can('promo.manage') && <PromoPanel />}

      {tab === 'data' && (
        <div className="grid grid-2">
          <div className="card col">
            <div className="card-title">This device</div>
            <div className="total-line">
              <span>Device code</span>
              <span className="mono">{deviceCode}</span>
            </div>
            <div className="total-line">
              <span>Device id</span>
              <span className="mono small">{deviceId}</span>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              The device code is embedded in every invoice number, so two tablets selling at the same stall can never
              produce the same invoice — even while both are offline.
            </p>
          </div>

          <div className="card col">
            <div className="card-title">Backup &amp; restore</div>
            <button className="btn" onClick={() => actions.exportBackup()}>
              Download backup (JSON)
            </button>
            <button className="btn" onClick={() => fileRef.current?.click()}>
              Restore from backup
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="application/json"
              style={{ display: 'none' }}
              onChange={(event) => importFile(event.target.files?.[0])}
            />
            <button className="btn btn-danger" onClick={() => setResetting(true)}>
              Reset to demo data
            </button>
            <p className="small muted" style={{ margin: 0 }}>
              Data is stored in this browser (IndexedDB) and shared live between tabs on this machine. Take a backup
              before resetting.
            </p>
          </div>
        </div>
      )}

      <div className="row" style={{ position: 'sticky', bottom: 0, paddingBottom: 8 }}>
        <button className="btn" disabled={!dirty} onClick={() => setDraft(state.settings)}>
          Discard changes
        </button>
        <button className="btn btn-primary" disabled={!dirty} onClick={() => actions.saveSettings(draft)}>
          {dirty ? 'Save settings' : 'Saved'}
        </button>
      </div>

      <Confirm
        open={resetting}
        key="reset"
        title="Reset everything to demo data?"
        message="All products, sales, customers and settings on this device will be replaced with a fresh demo dataset."
        confirmLabel="Reset"
        danger
        onConfirm={() => actions.resetDemoData()}
        onClose={() => setResetting(false)}
      />
    </div>
  )
}

/* ---------------------------------------------------------------- roles */

/* ----------------------------------------------------------- promo codes */

/**
 * Promo codes are the admin's own discount, separate from what a salesperson
 * may give away: a code that reaches the till has already been authorised, so
 * it does not eat into anyone's discount ceiling.
 */
function PromoPanel() {
  const { state, actions } = useApp()
  const currency = useCurrency()
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)

  const codes = state.promoCodes || []
  const today = new Date().toISOString().slice(0, 10)

  const newCode = () => ({
    id: uid('pmo'),
    code: '',
    description: '',
    type: 'percentage',
    value: 10,
    minSpend: 0,
    usageLimit: 0,
    usedCount: 0,
    startsAt: '',
    expiresAt: '',
    exhibitionId: 'all',
    active: true,
  })

  /** Why a code would be refused at the till right now. */
  const statusOf = (promo) => {
    if (!promo.active) return { label: 'Inactive', tone: 'var(--muted-2)' }
    if (promo.startsAt && today < promo.startsAt) return { label: 'Scheduled', tone: 'var(--warn)' }
    if (promo.expiresAt && today > promo.expiresAt) return { label: 'Expired', tone: 'var(--danger)' }
    if (promo.usageLimit > 0 && (promo.usedCount || 0) >= promo.usageLimit) {
      return { label: 'Used up', tone: 'var(--danger)' }
    }
    return { label: 'Live', tone: 'var(--brand)' }
  }

  return (
    <div className="col">
      <div className="card col">
        <div className="row-between">
          <div>
            <div className="card-title">Promo codes</div>
            <div className="card-sub">
              Typed in at checkout. A code discounts the order on top of anything the salesperson
              gave, and does not count against their limit.
            </div>
          </div>
          <button className="btn btn-sm btn-primary" onClick={() => setEditing(newCode())}>
            <Icon name="plus" size={14} />
            New code
          </button>
        </div>

        {codes.length === 0 ? (
          <EmptyState title="No promo codes yet">
            Create one and staff can apply it at the discount step of checkout.
          </EmptyState>
        ) : (
          <div className="stack-sm">
            {codes.map((promo) => {
              const status = statusOf(promo)
              const scope =
                promo.exhibitionId && promo.exhibitionId !== 'all'
                  ? state.exhibitions.find((entry) => entry.id === promo.exhibitionId)?.name
                  : null
              return (
                <button
                  key={promo.id}
                  className="list-item"
                  onClick={() => setEditing(structuredClone(promo))}
                >
                  <div className="grow">
                    <div className="row" style={{ gap: 7 }}>
                      <span className="mono" style={{ fontWeight: 700 }}>
                        {promo.code}
                      </span>
                      <span className="status-cell" style={{ color: status.tone }}>
                        <span className="dot" />
                        <span style={{ color: 'var(--text)' }}>{status.label}</span>
                      </span>
                    </div>
                    <div className="small muted">{promo.description || 'No description'}</div>
                    <div className="small muted" style={{ marginTop: 3 }}>
                      {promo.type === 'percentage' ? `${promo.value}% off` : `${currency(promo.value)} off`}
                      {promo.minSpend > 0 && ` · min spend ${currency(promo.minSpend)}`}
                      {promo.usageLimit > 0
                        ? ` · used ${promo.usedCount || 0} of ${promo.usageLimit}`
                        : ` · used ${promo.usedCount || 0} time${(promo.usedCount || 0) === 1 ? '' : 's'}`}
                      {promo.expiresAt && ` · ends ${promo.expiresAt}`}
                      {scope && ` · ${scope} only`}
                    </div>
                  </div>
                  <Icon name="chevronRight" size={16} />
                </button>
              )
            })}
          </div>
        )}
      </div>

      {editing && (
        <PromoEditor
          promo={editing}
          onClose={() => setEditing(null)}
          onDelete={() => {
            setDeleting(editing)
            setEditing(null)
          }}
        />
      )}

      <Confirm
        open={Boolean(deleting)}
        title={`Delete ${deleting?.code}?`}
        message={
          deleting?.usedCount
            ? `${deleting.code} has been used ${deleting.usedCount} time(s). Past sales keep their discount, but the code disappears from reporting.`
            : 'The code stops working immediately.'
        }
        confirmLabel="Delete code"
        danger
        onConfirm={() => actions.deletePromoCode(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}

function PromoEditor({ promo, onClose, onDelete }) {
  const { state, actions } = useApp()
  const [entry, setEntry] = useState(promo)
  const [error, setError] = useState('')

  const isNew = !(state.promoCodes || []).some((existing) => existing.id === promo.id)
  const set = (fields) => setEntry((current) => ({ ...current, ...fields }))

  const save = () => {
    try {
      actions.savePromoCode(entry)
      onClose()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'New promo code' : entry.code}
      subtitle={
        isNew ? 'Staff type this in at the discount step' : `Used ${entry.usedCount || 0} time(s) so far`
      }
      footer={
        <>
          {!isNew && (
            <button className="btn btn-danger" onClick={onDelete}>
              <Icon name="trash" size={15} />
              Delete
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save}>
            Save code
          </button>
        </>
      }
    >
      {error && (
        <div className="badge badge-danger" style={{ padding: '10px 14px', borderRadius: 12, whiteSpace: 'normal' }}>
          {error}
        </div>
      )}

      <div className="grid grid-2" style={{ gap: 10 }}>
        <Field label="Code" hint="Case does not matter — it is stored in capitals.">
          <input
            className="input mono"
            value={entry.code}
            autoCapitalize="characters"
            placeholder="STALL10"
            onChange={(event) => set({ code: event.target.value.toUpperCase() })}
          />
        </Field>
        <Field label="Description">
          <input
            className="input"
            value={entry.description}
            placeholder="What this code is for"
            onChange={(event) => set({ description: event.target.value })}
          />
        </Field>
      </div>

      <div className="grid grid-2" style={{ gap: 10 }}>
        <Field label="Discount type">
          <div className="seg">
            <button
              className={entry.type === 'percentage' ? 'active' : ''}
              onClick={() => set({ type: 'percentage' })}
            >
              Percentage
            </button>
            <button className={entry.type === 'fixed' ? 'active' : ''} onClick={() => set({ type: 'fixed' })}>
              Fixed amount
            </button>
          </div>
        </Field>
        <Field label={entry.type === 'percentage' ? 'Percent off' : 'Amount off'}>
          <input
            className="input"
            type="number"
            min="0"
            step={entry.type === 'percentage' ? '1' : '0.01'}
            value={entry.value}
            onChange={(event) => set({ value: event.target.value })}
          />
        </Field>
      </div>

      <div className="grid grid-2" style={{ gap: 10 }}>
        <Field label="Minimum spend" hint="0 for no minimum. Measured before any discount.">
          <input
            className="input"
            type="number"
            min="0"
            step="0.01"
            value={entry.minSpend}
            onChange={(event) => set({ minSpend: event.target.value })}
          />
        </Field>
        <Field label="Usage limit" hint="0 for unlimited.">
          <input
            className="input"
            type="number"
            min="0"
            value={entry.usageLimit}
            onChange={(event) => set({ usageLimit: event.target.value })}
          />
        </Field>
        <Field label="Valid from" hint="Leave blank to start straight away.">
          <input
            className="input"
            type="date"
            value={entry.startsAt || ''}
            onChange={(event) => set({ startsAt: event.target.value })}
          />
        </Field>
        <Field label="Expires after" hint="Leave blank for no end date.">
          <input
            className="input"
            type="date"
            value={entry.expiresAt || ''}
            onChange={(event) => set({ expiresAt: event.target.value })}
          />
        </Field>
      </div>

      <Field label="Where it works">
        <select
          className="select"
          value={entry.exhibitionId || 'all'}
          onChange={(event) => set({ exhibitionId: event.target.value })}
        >
          <option value="all">Everywhere, including direct sales</option>
          {state.exhibitions.map((exhibition) => (
            <option key={exhibition.id} value={exhibition.id}>
              {exhibition.name}
            </option>
          ))}
        </select>
      </Field>

      <label className="checkbox">
        <input type="checkbox" checked={entry.active !== false} onChange={(event) => set({ active: event.target.checked })} />
        <span>
          Active
          <div className="small muted">
            Turn off to retire a code without losing it from past sales and reports.
          </div>
        </span>
      </label>
    </Modal>
  )
}

function RolesPanel({ draft, patch }) {
  const { state, actions, user } = useApp()
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)

  const memberCount = (roleId) => state.users.filter((entry) => entry.role === roleId).length
  const pendingUsers = state.users.filter((entry) => !entry.active)

  const newRole = () => ({
    id: uid('role'),
    name: '',
    description: '',
    system: false,
    permissions: ['pos', 'sales.own'],
    maxDiscountPercent: 10,
  })

  return (
    <div className="col">
      {pendingUsers.length > 0 && (
        <div className="card">
          <div className="card-head">
            <div>
              <div className="card-title">Awaiting approval</div>
              <div className="card-sub">
                {pendingUsers.length} account{pendingUsers.length === 1 ? '' : 's'} signed up and cannot
                sign in yet
              </div>
            </div>
          </div>
          <div className="stack-sm">
            {pendingUsers.map((account) => (
              <div key={account.id} className="list-item" style={{ cursor: 'default' }}>
                <Avatar name={account.name} size={32} />
                <div className="grow">
                  <div style={{ fontWeight: 620, fontSize: 13.5 }}>{account.name}</div>
                  <div className="small muted">
                    {account.email} · requested{' '}
                    {state.roles.find((role) => role.id === account.role)?.name || account.role}
                  </div>
                </div>
                <button className="btn btn-sm btn-primary" onClick={() => actions.approveUser(account.id)}>
                  Approve
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-split">
        <div className="card col">
          <div className="card-title">Sign-ups</div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.signup?.enabled !== false}
              onChange={(event) => patch({ signup: { ...draft.signup, enabled: event.target.checked } })}
            />
            <span>
              Allow people to create their own account
              <div className="small muted">Turn this off to add staff by hand only.</div>
            </span>
          </label>

          <Field label="New accounts get this role">
            <select
              className="select"
              value={draft.signup?.defaultRole || 'salesperson'}
              onChange={(event) => patch({ signup: { ...draft.signup, defaultRole: event.target.value } })}
            >
              {state.roles
                .filter((role) => !role.permissions.includes('*'))
                .map((role) => (
                  <option key={role.id} value={role.id}>
                    {role.name}
                  </option>
                ))}
            </select>
          </Field>

          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.signup?.requireApproval !== false}
              onChange={(event) =>
                patch({ signup: { ...draft.signup, requireApproval: event.target.checked } })
              }
            />
            <span>
              An admin must approve new accounts
              <div className="small muted">
                Recommended — otherwise anyone with the link can sign in and start selling.
              </div>
            </span>
          </label>
        </div>

        <div className="card col">
          <div className="row-between">
            <div>
              <div className="card-title">Roles</div>
              <div className="card-sub">What each kind of user is allowed to do</div>
            </div>
            <button className="btn btn-sm btn-primary" onClick={() => setEditing(newRole())}>
              <Icon name="plus" size={14} />
              New role
            </button>
          </div>

          <div className="stack-sm">
            {state.roles.map((role) => {
              const count = memberCount(role.id)
              const full = role.permissions.includes('*')
              return (
                <button key={role.id} className="list-item" onClick={() => setEditing(structuredClone(role))}>
                  <div className="grow">
                    <div className="row" style={{ gap: 7 }}>
                      <span style={{ fontWeight: 620 }}>{role.name}</span>
                      {role.system && <span className="badge">Built-in</span>}
                      {role.id === user.role && <span className="badge badge-brand">You</span>}
                    </div>
                    <div className="small muted">{role.description || 'No description'}</div>
                    <div className="small muted" style={{ marginTop: 3 }}>
                      {full ? 'Full access' : `${role.permissions.length} permissions`} · max discount{' '}
                      {role.maxDiscountPercent}% · {count} member{count === 1 ? '' : 's'}
                    </div>
                  </div>
                  <Icon name="chevronRight" size={16} />
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {editing && (
        <RoleEditor
          role={editing}
          onClose={() => setEditing(null)}
          onDelete={() => {
            setDeleting(editing)
            setEditing(null)
          }}
        />
      )}

      {deleting && <DeleteRoleModal role={deleting} onClose={() => setDeleting(null)} />}
    </div>
  )
}

function RoleEditor({ role, onClose, onDelete }) {
  const { state, actions } = useApp()
  const [entry, setEntry] = useState(role)
  const [error, setError] = useState('')

  const isNew = !state.roles.some((existing) => existing.id === role.id)
  const fullAccess = entry.permissions.includes('*')
  const members = state.users.filter((account) => account.role === role.id).length

  const toggle = (key) => {
    setEntry((current) => {
      const base = current.permissions.includes('*') ? ALL_PERMISSIONS : current.permissions
      const next = base.includes(key) ? base.filter((item) => item !== key) : [...base, key]
      return { ...current, permissions: next }
    })
  }

  const save = () => {
    if (!entry.name.trim()) return setError('Give the role a name.')
    try {
      actions.saveRole({
        ...entry,
        name: entry.name.trim(),
        maxDiscountPercent: Number(entry.maxDiscountPercent) || 0,
      })
      onClose()
    } catch (err) {
      setError(err.message)
    }
    return undefined
  }

  const active = fullAccess ? ALL_PERMISSIONS : entry.permissions

  return (
    <Modal
      open
      onClose={onClose}
      size="lg"
      title={isNew ? 'New role' : entry.name}
      subtitle={
        entry.system
          ? 'Built-in role — permissions can be tuned but it cannot be deleted'
          : `${members} member${members === 1 ? '' : 's'}`
      }
      footer={
        <>
          {!isNew && !entry.system && (
            <button className="btn btn-danger" onClick={onDelete}>
              <Icon name="trash" size={15} />
              Delete role
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save}>
            Save role
          </button>
        </>
      }
    >
      {error && (
        <div className="badge badge-danger" style={{ padding: '10px 14px', borderRadius: 12, whiteSpace: 'normal' }}>
          {error}
        </div>
      )}

      <div className="grid grid-2" style={{ gap: 10 }}>
        <Field label="Role name">
          <input
            className="input"
            value={entry.name}
            onChange={(event) => setEntry({ ...entry, name: event.target.value })}
          />
        </Field>
        <Field label="Max discount %" hint="Default for new users with this role.">
          <input
            className="input"
            type="number"
            min="0"
            max="100"
            value={entry.maxDiscountPercent}
            onChange={(event) => setEntry({ ...entry, maxDiscountPercent: event.target.value })}
          />
        </Field>
      </div>

      <Field label="Description">
        <input
          className="input"
          value={entry.description}
          onChange={(event) => setEntry({ ...entry, description: event.target.value })}
          placeholder="What this role is for"
        />
      </Field>

      <label className="checkbox">
        <input
          type="checkbox"
          checked={fullAccess}
          onChange={(event) =>
            setEntry({ ...entry, permissions: event.target.checked ? ['*'] : [...ALL_PERMISSIONS] })
          }
        />
        <span>
          Full access to everything
          <div className="small muted">
            Keeps this role in step with any permissions added in future versions.
          </div>
        </span>
      </label>

      {PERMISSION_GROUPS.map((group) => (
        <div key={group.label}>
          <div className="card-title" style={{ fontSize: 13.5, marginBottom: 8 }}>
            {group.label}
          </div>
          <div className="stack-sm">
            {group.items.map((item) => (
              <label key={item.key} className="checkbox" style={{ opacity: fullAccess ? 0.55 : 1 }}>
                <input
                  type="checkbox"
                  disabled={fullAccess}
                  checked={active.includes(item.key)}
                  onChange={() => toggle(item.key)}
                />
                <span>
                  {item.label}
                  {item.hint && <div className="small muted">{item.hint}</div>}
                </span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </Modal>
  )
}

function DeleteRoleModal({ role, onClose }) {
  const { state, actions } = useApp()
  const members = state.users.filter((account) => account.role === role.id)
  const alternatives = state.roles.filter((entry) => entry.id !== role.id)
  const [reassignTo, setReassignTo] = useState(alternatives[0]?.id)
  const [error, setError] = useState('')

  return (
    <Modal
      open
      onClose={onClose}
      title={`Delete "${role.name}"?`}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-danger"
            onClick={() => {
              try {
                actions.deleteRole(role.id, reassignTo)
                onClose()
              } catch (err) {
                setError(err.message)
              }
            }}
          >
            Delete role
          </button>
        </>
      }
    >
      {error && (
        <div className="badge badge-danger" style={{ padding: '10px 14px', borderRadius: 12, whiteSpace: 'normal' }}>
          {error}
        </div>
      )}

      {members.length > 0 ? (
        <>
          <p className="small muted" style={{ margin: 0 }}>
            {members.length} user{members.length === 1 ? ' is' : 's are'} on this role and must be moved to
            another one.
          </p>
          <Field label="Move them to">
            <select className="select" value={reassignTo} onChange={(event) => setReassignTo(event.target.value)}>
              {alternatives.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </Field>
        </>
      ) : (
        <p className="small muted" style={{ margin: 0 }}>
          Nobody is using this role, so nothing else changes.
        </p>
      )}
    </Modal>
  )
}

/* -------------------------------------------------------------- preview */

/** A fixed example order so the preview never depends on real sales. */
function sampleInvoice(settings) {
  return {
    business: settings.business,
    currencySymbol: settings.currencySymbol,
    design: settings.invoiceDesign,
    invoiceNo: `${settings.invoicePrefix}-260816-A1042`,
    createdAt: new Date().toISOString(),
    exhibitionName: 'London Fashion Exhibition',
    salespersonName: 'Ahmed Khan',
    customerName: 'Amina Hassan',
    customerContact: '+44 7700 900123 · amina@example.com',
    items: [
      { name: 'Black Silk Scarf', variant: 'Black / One Size', quantity: 2, unitPrice: 68 },
      { name: 'Linen Wrap Abaya', variant: 'Stone / M', quantity: 1, unitPrice: 210 },
    ],
    subtotal: 346,
    discountAmount: 34.6,
    tax: 51.9,
    taxRate: settings.taxRate,
    taxInclusive: settings.taxInclusive,
    total: 311.4,
    paymentMethod: 'Card',
    terms: settings.terms,
  }
}

function InvoicePreview({ settings }) {
  const design = settings.invoiceDesign
  const sample = sampleInvoice(settings)
  const cur = (value) => `${settings.currencySymbol}${Number(value).toFixed(2)}`

  return (
    <div
      style={{
        background: '#fff',
        border: '1px solid var(--line)',
        borderRadius: 10,
        overflow: 'hidden',
        color: '#14171c',
        fontSize: 11,
        boxShadow: 'var(--shadow-xs)',
      }}
    >
      <div style={{ height: 5, background: design.accent }} />
      <div style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          {design.showLogo !== false && (
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 8,
                background: design.accent,
                color: '#fff',
                display: 'grid',
                placeItems: 'center',
                fontWeight: 700,
                overflow: 'hidden',
                flexShrink: 0,
              }}
            >
              {settings.business.logo ? (
                <img src={settings.business.logo} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                settings.business.name.slice(0, 1)
              )}
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 700, fontSize: 13 }}>{settings.business.name}</div>
            <div style={{ color: '#8a8f9a', fontSize: 9.5 }}>
              {[settings.business.phone, settings.business.email].filter(Boolean).join(' · ')}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 700, fontSize: 14, color: design.accent }}>INVOICE</div>
            <div style={{ color: '#8a8f9a', fontSize: 9.5 }}>{sample.invoiceNo}</div>
          </div>
        </div>

        <div style={{ borderTop: '1px solid #eceef2', margin: '12px 0' }} />

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 9.5 }}>
          <div>
            <div style={{ color: '#8a8f9a' }}>BILLED TO</div>
            <div style={{ fontWeight: 600 }}>{sample.customerName}</div>
            {design.showCustomerContact !== false && (
              <div style={{ color: '#6f7784' }}>{sample.customerContact}</div>
            )}
          </div>
          <div style={{ textAlign: 'right' }}>
            {design.showExhibition !== false && (
              <div>
                <span style={{ color: '#8a8f9a' }}>Exhibition </span>
                <strong>{sample.exhibitionName}</strong>
              </div>
            )}
            {design.showSalesperson !== false && (
              <div>
                <span style={{ color: '#8a8f9a' }}>Served by </span>
                <strong>{sample.salespersonName}</strong>
              </div>
            )}
            <div>
              <span style={{ color: '#8a8f9a' }}>Payment </span>
              <strong>{sample.paymentMethod}</strong>
            </div>
          </div>
        </div>

        <div style={{ background: '#f6f7f9', padding: '5px 8px', margin: '12px 0 6px', fontSize: 8.5, color: '#8a8f9a', display: 'flex', fontWeight: 700 }}>
          <span style={{ flex: 1 }}>DESCRIPTION</span>
          <span style={{ width: 34, textAlign: 'right' }}>QTY</span>
          <span style={{ width: 54, textAlign: 'right' }}>TOTAL</span>
        </div>

        {sample.items.map((item) => (
          <div key={item.name} style={{ display: 'flex', padding: '5px 8px', borderBottom: '1px solid #f4f5f7' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{item.name}</div>
              <div style={{ color: '#8a8f9a', fontSize: 9 }}>{item.variant}</div>
            </div>
            <span style={{ width: 34, textAlign: 'right' }}>{item.quantity}</span>
            <span style={{ width: 54, textAlign: 'right', fontWeight: 600 }}>
              {cur(item.quantity * item.unitPrice)}
            </span>
          </div>
        ))}

        <div style={{ marginTop: 10, marginLeft: 'auto', width: 150 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#6f7784' }}>
            <span>Subtotal</span>
            <span>{cur(sample.subtotal)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', color: '#6f7784' }}>
            <span>Discount</span>
            <span>−{cur(sample.discountAmount)}</span>
          </div>
          {design.showTaxBreakdown !== false && settings.taxEnabled && (
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#6f7784' }}>
              <span>VAT {settings.taxRate}%</span>
              <span>{cur(sample.tax)}</span>
            </div>
          )}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontWeight: 700,
              fontSize: 12,
              borderTop: '1.5px solid #14171c',
              marginTop: 4,
              paddingTop: 4,
            }}
          >
            <span>TOTAL</span>
            <span>{cur(sample.total)}</span>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginTop: 16 }}>
          {design.showQr !== false && (
            <div
              style={{
                width: 34,
                height: 34,
                background: '#eceef2',
                borderRadius: 4,
                display: 'grid',
                placeItems: 'center',
                fontSize: 7,
                color: '#8a8f9a',
                flexShrink: 0,
              }}
            >
              QR
            </div>
          )}
          {design.showTerms !== false && (
            <div style={{ color: '#8a8f9a', fontSize: 8.5, lineHeight: 1.5 }}>{settings.terms}</div>
          )}
        </div>
      </div>
      <div style={{ height: 5, background: design.accent }} />
    </div>
  )
}
