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
