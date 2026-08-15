import { useNavigate } from 'react-router-dom'
import { useApp, useCurrency } from '../lib/store.jsx'
import { StatusBadge, SyncPill } from '../components/ui.jsx'
import { formatDate } from '../lib/format.js'
import { filterOrders, salesSummary } from '../lib/analytics.js'

export default function SelectExhibition() {
  const { state, user, session, actions, can } = useApp()
  const currency = useCurrency()
  const navigate = useNavigate()

  const visible = state.exhibitions
    .filter((exhibition) =>
      can('admin.exhibitions') ? true : exhibition.staffIds.includes(user.id) || exhibition.status === 'Active',
    )
    .sort((a, b) => {
      const rank = { Active: 0, Upcoming: 1, Completed: 2 }
      return rank[a.status] - rank[b.status] || a.startDate.localeCompare(b.startDate)
    })

  const choose = (exhibition) => {
    actions.selectExhibition(exhibition.id)
    navigate(user.role === 'salesperson' ? '/pos' : '/admin')
  }

  return (
    <div className="login-screen" style={{ alignItems: 'flex-start', paddingTop: 40 }}>
      <div className="login-card" style={{ maxWidth: 560 }}>
        <div className="row-between" style={{ marginBottom: 18 }}>
          <div>
            <h1 style={{ fontSize: 20 }}>Choose an exhibition</h1>
            <p className="small muted" style={{ margin: '3px 0 0' }}>
              Signed in as {user.name}
            </p>
          </div>
          <SyncPill />
        </div>

        <div className="stack-sm">
          {visible.map((exhibition) => {
            const summary = salesSummary(filterOrders(state, { exhibitionId: exhibition.id }))
            const active = session.exhibitionId === exhibition.id
            return (
              <button
                key={exhibition.id}
                className="list-item"
                style={{
                  borderColor: active ? 'var(--brand)' : 'var(--line)',
                  background: active ? 'var(--brand-soft)' : 'var(--surface-2)',
                  alignItems: 'flex-start',
                }}
                onClick={() => choose(exhibition)}
              >
                <div className="grow">
                  <div className="row" style={{ gap: 8 }}>
                    <span style={{ fontWeight: 650 }}>{exhibition.name}</span>
                    <StatusBadge status={exhibition.status} />
                  </div>
                  <div className="small muted" style={{ marginTop: 3 }}>
                    {exhibition.location}
                  </div>
                  <div className="small muted">
                    {formatDate(exhibition.startDate)} – {formatDate(exhibition.endDate)}
                  </div>
                </div>
                <div className="right nowrap">
                  <div className="mono" style={{ fontWeight: 680 }}>
                    {currency(summary.net)}
                  </div>
                  <div className="small muted">{summary.count} sales</div>
                </div>
              </button>
            )
          })}
        </div>

        <div className="row" style={{ marginTop: 18, gap: 8 }}>
          {can('admin.dashboard') && (
            <button className="btn grow" onClick={() => navigate('/admin')}>
              Admin dashboard
            </button>
          )}
          {session.exhibitionId && (
            <button className="btn grow" onClick={() => navigate('/pos')}>
              Back to POS
            </button>
          )}
          <button
            className="btn btn-ghost"
            onClick={() => {
              actions.logout()
              navigate('/login')
            }}
          >
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
