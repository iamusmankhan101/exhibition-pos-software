import { useMemo, useState } from 'react'
import { useApp } from '../../lib/store.jsx'
import { EmptyState, StatCard, Tabs } from '../../components/ui.jsx'
import { formatDate } from '../../lib/format.js'
import { exportCsv } from '../../lib/csv.js'

export default function Activity() {
  const { state, pendingSync, online } = useApp()
  const [tab, setTab] = useState('audit')
  const [query, setQuery] = useState('')

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
              replayed sale can never be recorded twice.
            </div>
          </div>

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
