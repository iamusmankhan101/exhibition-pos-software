import { useMemo, useState } from 'react'
import { useApp } from '../../lib/store.jsx'
import { EmptyState, StatCard, Tabs } from '../../components/ui.jsx'
import { formatDate } from '../../lib/format.js'
import { exportCsv } from '../../lib/csv.js'

export default function Activity() {
  const { state, pendingSync, online, cloudAuth, actions, can } = useApp()
  const [tab, setTab] = useState('audit')
  const [query, setQuery] = useState('')
  const [push, setPush] = useState(null)
  const [pull, setPull] = useState(null)
  const [password, setPassword] = useState('')
  const [reconnect, setReconnect] = useState(null)

  const logs = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return state.auditLogs.filter(
      (entry) =>
        !needle ||
        entry.action.toLowerCase().includes(needle) ||
        entry.userName.toLowerCase().includes(needle) ||
        String(entry.detail).toLowerCase().includes(needle),
    )
  }, [state.auditLogs, query])

  const outbox = [...state.outbox].reverse()

  return (
    <div className="page">
      <div className="grid grid-4">
        <StatCard label="Audit entries" value={state.auditLogs.length} accent />
        <StatCard label="Notifications" value={state.notifications.length} />
        <StatCard label="Queued for sync" value={pendingSync} meta={online ? 'Online' : 'Offline — will retry'} />
        <StatCard label="Synced records" value={state.outbox.filter((entry) => entry.status === 'synced').length} />
      </div>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'audit', label: 'Audit log' },
          { value: 'sync', label: 'Sync queue' },
          { value: 'notifications', label: 'Notifications' },
        ]}
      />

      {tab === 'audit' && (
        <>
          <div className="row wrap" style={{ gap: 10 }}>
            <input
              className="input grow"
              style={{ minWidth: 200 }}
              placeholder="Search actions, users, details…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <button
              className="btn"
              onClick={() =>
                exportCsv(
                  'tareez-audit-log',
                  [
                    { label: 'When', value: (row) => formatDate(row.createdAt, true) },
                    { label: 'User', value: (row) => row.userName },
                    { label: 'Action', value: (row) => row.action },
                    { label: 'Entity', value: (row) => row.entity },
                    { label: 'Detail', value: (row) => row.detail },
                    { label: 'Device', value: (row) => row.deviceId },
                  ],
                  logs,
                )
              }
            >
              Export
            </button>
          </div>

          {logs.length === 0 ? (
            <EmptyState title="No activity recorded">Discounts, refunds and stock changes are logged here.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>User</th>
                    <th>Action</th>
                    <th>Detail</th>
                    <th>Device</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.slice(0, 300).map((entry) => (
                    <tr key={entry.id}>
                      <td className="small nowrap">{formatDate(entry.createdAt, true)}</td>
                      <td className="small">{entry.userName}</td>
                      <td>
                        <span className="badge">{entry.action}</span>
                      </td>
                      <td className="small muted">{entry.detail || '—'}</td>
                      <td className="small muted mono">{entry.deviceId?.slice(-6)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'sync' && (
        <>
          <div className="card" style={{ padding: 14, background: 'var(--surface-2)' }}>
            <div className="small muted">
              Every change is queued with a client-generated idempotency key. When the connection drops the queue
              keeps growing locally; once it returns the queue drains in order and duplicate keys are rejected, so a
              replayed sale can never be recorded twice. In the other direction this device checks for everyone
              else's work every few seconds, so a product added on the laptop reaches the phone on its own.
            </div>
          </div>

          {cloudAuth === 'signed-out' && (
            <div className="card" style={{ padding: 14, borderColor: 'var(--danger)' }}>
              <div style={{ fontWeight: 620, fontSize: 13.5 }}>This device is signed out of the cloud</div>
              <div className="small muted" style={{ marginTop: 4 }}>
                Nothing has been lost — every sale is on this device and the queue below is holding them. But the
                backend is rejecting them until somebody signs in again, so no other till can see this one's work and
                this one cannot see theirs. A PIN sign-in is local to this device and does not renew the connection,
                which is why a long-running till drifts into this on its own.
              </div>
              <form
                className="row wrap"
                style={{ gap: 10, marginTop: 12, alignItems: 'center' }}
                onSubmit={async (event) => {
                  event.preventDefault()
                  setReconnect({ running: true, label: 'Signing in…' })
                  try {
                    await actions.reconnectCloud(password)
                    setPassword('')
                    setReconnect(null)
                  } catch (error) {
                    setReconnect({ running: false, label: error.message, failed: true })
                  }
                }}
              >
                <input
                  className="input"
                  style={{ minWidth: 200 }}
                  type="password"
                  autoComplete="current-password"
                  placeholder="Your password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button className="btn btn-primary" type="submit" disabled={!online || !password || reconnect?.running}>
                  {reconnect?.running ? 'Reconnecting…' : 'Reconnect'}
                </button>
                {reconnect?.failed && (
                  <span className="small" style={{ color: 'var(--danger)' }} role="alert">
                    {reconnect.label}
                  </span>
                )}
                {!online && <span className="small muted">Offline — connect first.</span>}
              </form>
            </div>
          )}

          <div className="card" style={{ padding: 14 }}>
            <div style={{ fontWeight: 620, fontSize: 13.5 }}>Refresh from the cloud</div>
            <div className="small muted" style={{ marginTop: 4 }}>
              Runs automatically in the background. Use this when somebody is standing there waiting for something
              another till has only just added. It never overwrites work this device has not sent yet — anything in
              the queue above is left alone until it drains.
            </div>
            <div className="row wrap" style={{ gap: 10, marginTop: 12, alignItems: 'center' }}>
              <button
                className="btn"
                disabled={!online || pull?.running}
                onClick={async () => {
                  setPull({ running: true, label: 'Checking…' })
                  try {
                    const changed = await actions.pullAll()
                    setPull({
                      running: false,
                      label: changed ? 'Brought this device up to date.' : 'Already up to date.',
                    })
                  } catch (error) {
                    setPull({ running: false, label: `Failed: ${error.message}`, failed: true })
                  }
                }}
              >
                {pull?.running ? 'Refreshing…' : 'Refresh now'}
              </button>
              {pull && (
                <span
                  className={pull.failed ? 'small' : 'small muted'}
                  style={pull.failed ? { color: 'var(--danger)' } : undefined}
                  role={pull.failed ? 'alert' : undefined}
                >
                  {pull.label}
                </span>
              )}
              {!online && <span className="small muted">Offline — connect to refresh.</span>}
            </div>
          </div>

          {can('admin.settings') && (
            <div className="card" style={{ padding: 14 }}>
              <div style={{ fontWeight: 620, fontSize: 13.5 }}>Push everything to the cloud</div>
              <div className="small muted" style={{ marginTop: 4 }}>
                The queue above only carries changes made since this device was connected to the backend. Anything
                recorded before that is still on this till and has never been sent, which is why a phone signing in
                elsewhere can come up empty. This sends the whole dataset up. It only adds and overwrites, so it is
                safe to run more than once and cannot delete a sale another till has already sent.
              </div>
              <div className="row wrap" style={{ gap: 10, marginTop: 12, alignItems: 'center' }}>
                <button
                  className="btn btn-primary"
                  disabled={!online || push?.running}
                  onClick={async () => {
                    setPush({ running: true, label: 'Starting…' })
                    try {
                      const summary = await actions.pushAll(({ table, done, total }) =>
                        setPush({ running: true, label: `${table} · ${done} of ${total}` }),
                      )
                      setPush({ running: false, label: `Sent ${summary.total} record(s).` })
                    } catch (error) {
                      setPush({ running: false, label: `Failed: ${error.message}`, failed: true })
                    }
                  }}
                >
                  {push?.running ? 'Pushing…' : 'Push all data'}
                </button>
                {push && (
                  <span
                    className={push.failed ? 'small' : 'small muted'}
                    style={push.failed ? { color: 'var(--danger)' } : undefined}
                    role={push.failed ? 'alert' : undefined}
                  >
                    {push.label}
                  </span>
                )}
                {!online && <span className="small muted">Offline — connect to push.</span>}
              </div>
            </div>
          )}

          {outbox.length === 0 ? (
            <EmptyState title="Queue is empty">Nothing waiting to sync.</EmptyState>
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Created</th>
                    <th>Type</th>
                    <th>Idempotency key</th>
                    <th>Status</th>
                    <th>Synced</th>
                  </tr>
                </thead>
                <tbody>
                  {outbox.slice(0, 200).map((entry) => (
                    <tr key={entry.id}>
                      <td className="small nowrap">{formatDate(entry.createdAt, true)}</td>
                      <td className="small mono">{entry.type}</td>
                      <td className="small mono muted">{entry.clientId}</td>
                      <td>
                        <span className={`badge ${entry.status === 'synced' ? 'badge-good' : 'badge-warn'}`}>
                          {entry.status}
                        </span>
                      </td>
                      <td className="small muted">{entry.syncedAt ? formatDate(entry.syncedAt, true) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {tab === 'notifications' && (
        <>
          {state.notifications.length === 0 ? (
            <EmptyState title="No notifications">Low stock, large discounts and refunds appear here.</EmptyState>
          ) : (
            <div className="stack-sm">
              {state.notifications.map((entry) => (
                <div key={entry.id} className="card row" style={{ padding: 14 }}>
                  <span
                    className={`badge badge-${
                      entry.severity === 'danger' ? 'danger' : entry.severity === 'warn' ? 'warn' : 'info'
                    }`}
                  >
                    {entry.type}
                  </span>
                  <div className="grow">
                    <div style={{ fontWeight: 620, fontSize: 13.5 }}>{entry.title}</div>
                    <div className="small muted">{entry.body}</div>
                  </div>
                  <div className="small muted nowrap">{formatDate(entry.createdAt, true)}</div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
