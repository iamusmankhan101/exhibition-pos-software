import { useMemo, useState } from 'react'
import { useApp, useCurrency } from '../../lib/store.jsx'
import { Avatar, Confirm, Field, Modal, StatCard } from '../../components/ui.jsx'
import { uid } from '../../lib/format.js'
import { filterOrders, staffPerformance } from '../../lib/analytics.js'
import { exportCsv } from '../../lib/csv.js'

const blank = () => ({
  id: uid('usr'),
  name: '',
  email: '',
  phone: '',
  role: 'salesperson',
  pin: '',
  active: true,
  maxDiscountPercent: 10,
})

export default function Staff() {
  const { state, user, activeExhibition, actions, can } = useApp()
  const currency = useCurrency()
  const [scope, setScope] = useState('exhibition')
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)

  const filter = scope === 'exhibition' ? { exhibitionId: activeExhibition?.id } : {}
  const performance = useMemo(() => staffPerformance(state, filter), [state, filter])
  const orders = useMemo(() => filterOrders(state, filter), [state, filter])

  const byId = Object.fromEntries(performance.map((row) => [row.id, row]))
  const best = performance[0]

  const columns = [
    { label: 'Salesperson', value: (row) => row.name },
    { label: 'Sales', value: (row) => row.sales.toFixed(2) },
    { label: 'Transactions', value: (row) => row.transactions },
    { label: 'Items', value: (row) => row.items },
    { label: 'Average order', value: (row) => row.averageOrder.toFixed(2) },
    { label: 'Discounts given', value: (row) => row.discounts.toFixed(2) },
  ]

  return (
    <div className="page">
      <div className="row-between wrap">
        <div className="seg">
          <button className={scope === 'exhibition' ? 'active' : ''} onClick={() => setScope('exhibition')}>
            {activeExhibition?.name || 'Current exhibition'}
          </button>
          <button className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>
            All time
          </button>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" onClick={() => exportCsv('tareez-staff', columns, performance)}>
            Export
          </button>
          {can('admin.settings') && (
            <button className="btn btn-primary" onClick={() => setEditing(blank())}>
              + New user
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-4">
        <StatCard label="Team members" value={state.users.filter((entry) => entry.active).length} />
        <StatCard label="Transactions" value={orders.length} />
        <StatCard label="Top performer" value={best ? best.name.split(' ')[0] : '—'} meta={best ? currency(best.sales) : ''} accent />
        <StatCard
          label="Discounts given"
          value={currency(performance.reduce((sum, row) => sum + row.discounts, 0))}
        />
      </div>

      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Salesperson</th>
              <th>Role</th>
              <th className="right">Sales</th>
              <th className="right">Transactions</th>
              <th className="right">Items</th>
              <th className="right">Avg order</th>
              <th className="right">Discounts</th>
              <th>Payment mix</th>
              {can('admin.settings') && <th />}
            </tr>
          </thead>
          <tbody>
            {state.users.map((account) => {
              const row = byId[account.id]
              const methods = row ? Object.entries(row.methods).sort((a, b) => b[1] - a[1]) : []
              return (
                <tr key={account.id}>
                  <td>
                    <div className="row">
                      <Avatar name={account.name} size={32} />
                      <div>
                        <div style={{ fontWeight: 600 }}>
                          {account.name}
                          {account.id === user.id && <span className="small muted"> · you</span>}
                        </div>
                        <div className="small muted">{account.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`badge ${account.active ? 'badge-info' : ''}`} style={{ textTransform: 'capitalize' }}>
                      {state.roles.find((entry) => entry.id === account.role)?.name || account.role}
                    </span>
                    {!account.active && <span className="badge badge-danger" style={{ marginLeft: 6 }}>Inactive</span>}
                  </td>
                  <td className="right mono" style={{ fontWeight: 650 }}>
                    {currency(row?.sales || 0)}
                  </td>
                  <td className="right mono">{row?.transactions || 0}</td>
                  <td className="right mono">{row?.items || 0}</td>
                  <td className="right mono">{currency(row?.averageOrder || 0)}</td>
                  <td className="right mono">{currency(row?.discounts || 0)}</td>
                  <td className="small muted">
                    {methods.length ? methods.map(([method, value]) => `${method} ${currency(value)}`).join(' · ') : '—'}
                  </td>
                  {can('admin.settings') && (
                    <td className="right">
                      <button className="btn btn-ghost btn-sm" onClick={() => setEditing(structuredClone(account))}>
                        Edit
                      </button>
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {editing && (
        <UserEditor
          account={editing}
          onClose={() => setEditing(null)}
          onSave={(next) => {
            actions.saveUser(next)
            setEditing(null)
          }}
          onDelete={
            editing.id === user.id
              ? null
              : () => {
                  setDeleting(editing)
                  setEditing(null)
                }
          }
        />
      )}

      <Confirm
        open={Boolean(deleting)}
        title="Delete this user?"
        message={`${deleting?.name} will no longer be able to sign in. Their past sales stay on record.`}
        confirmLabel="Delete"
        danger
        onConfirm={() => actions.deleteUser(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </div>
  )
}

function UserEditor({ account, onClose, onSave, onDelete }) {
  const { state, actions } = useApp()
  const [draft, setDraft] = useState(account)
  const [error, setError] = useState('')
  const [password, setPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)

  const isNew = !state.users.some((entry) => entry.id === account.id)
  const patch = (fields) => setDraft((current) => ({ ...current, ...fields }))
  const role = state.roles.find((entry) => entry.id === draft.role)

  const setUserPassword = async () => {
    setSavingPassword(true)
    try {
      await actions.changePassword(draft.id, password)
      setPassword('')
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingPassword(false)
    }
  }

  const save = () => {
    if (!draft.name.trim()) return setError('A name is required.')
    if (!/^\d{4}$/.test(String(draft.pin))) return setError('The PIN must be exactly 4 digits.')
    const clash = state.users.find(
      (entry) => entry.id !== draft.id && entry.pin === String(draft.pin) && entry.active,
    )
    if (clash) return setError(`That PIN is already used by ${clash.name}.`)
    const emailClash = state.users.find(
      (entry) =>
        entry.id !== draft.id &&
        entry.email &&
        entry.email.toLowerCase() === draft.email.trim().toLowerCase(),
    )
    if (emailClash) return setError(`${emailClash.name} already uses that email address.`)
    return onSave({
      ...draft,
      name: draft.name.trim(),
      email: draft.email.trim().toLowerCase(),
      pin: String(draft.pin),
      maxDiscountPercent: Number(draft.maxDiscountPercent) || 0,
    })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={account.name || 'New user'}
      footer={
        <>
          {onDelete && (
            <button className="btn btn-danger" onClick={onDelete}>
              Delete
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      {error && (
        <div className="badge badge-danger" style={{ padding: '10px 14px', borderRadius: 12, whiteSpace: 'normal' }}>
          {error}
        </div>
      )}

      <Field label="Full name">
        <input className="input" value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
      </Field>

      <div className="grid grid-2" style={{ gap: 10 }}>
        <Field label="Email">
          <input className="input" value={draft.email} onChange={(event) => patch({ email: event.target.value })} />
        </Field>
        <Field label="Phone">
          <input className="input" value={draft.phone} onChange={(event) => patch({ phone: event.target.value })} />
        </Field>
      </div>

      <Field label="Role" hint={role?.description}>
        <select
          className="select"
          value={draft.role}
          onChange={(event) => {
            const next = state.roles.find((entry) => entry.id === event.target.value)
            patch({ role: event.target.value, maxDiscountPercent: next?.maxDiscountPercent ?? 0 })
          }}
        >
          {state.roles.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid grid-2" style={{ gap: 10 }}>
        <Field label="4-digit PIN" hint="Used to sign in on shared devices.">
          <input
            className="input mono"
            inputMode="numeric"
            maxLength={4}
            value={draft.pin}
            onChange={(event) => patch({ pin: event.target.value.replace(/\D/g, '').slice(0, 4) })}
          />
        </Field>
        <Field label="Max discount %" hint="Enforced at checkout.">
          <input
            className="input"
            type="number"
            min="0"
            max="100"
            value={draft.maxDiscountPercent}
            onChange={(event) => patch({ maxDiscountPercent: event.target.value })}
          />
        </Field>
      </div>

      <label className="checkbox">
        <input type="checkbox" checked={draft.active} onChange={(event) => patch({ active: event.target.checked })} />
        <span>
          Active — can sign in
          {!draft.active && !isNew && (
            <div className="small" style={{ color: 'var(--warn)' }}>
              This account cannot sign in until it is activated.
            </div>
          )}
        </span>
      </label>

      {!isNew && (
        <>
          <div className="card-title" style={{ fontSize: 13.5, marginTop: 4 }}>
            Password
          </div>
          <div className="row" style={{ gap: 8 }}>
            <input
              className="input grow"
              type="password"
              value={password}
              autoComplete="new-password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder={draft.passwordHash ? 'Set a new password' : 'No password set yet'}
            />
            <button className="btn" disabled={!password || savingPassword} onClick={setUserPassword}>
              {savingPassword ? 'Saving…' : 'Set'}
            </button>
          </div>
          <p className="small muted" style={{ margin: 0 }}>
            The password is saved immediately and separately from the rest of this form. Staff can also sign
            in with their 4-digit PIN on a shared device.
          </p>
        </>
      )}
    </Modal>
  )
}
