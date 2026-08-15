import { useRef, useState } from 'react'
import { useApp } from '../../lib/store.jsx'
import { Confirm, Field, ImagePicker, Tabs } from '../../components/ui.jsx'

const CURRENCIES = [
  ['GBP', '£'],
  ['USD', '$'],
  ['EUR', '€'],
  ['AED', 'AED '],
  ['SAR', 'SAR '],
  ['PKR', 'Rs '],
]

export default function Settings() {
  const { state, actions, deviceCode, deviceId } = useApp()
  const [tab, setTab] = useState('business')
  const [draft, setDraft] = useState(state.settings)
  const [resetting, setResetting] = useState(false)
  const fileRef = useRef(null)

  const patch = (fields) => setDraft((current) => ({ ...current, ...fields }))
  const patchBusiness = (fields) =>
    setDraft((current) => ({ ...current, business: { ...current.business, ...fields } }))

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
