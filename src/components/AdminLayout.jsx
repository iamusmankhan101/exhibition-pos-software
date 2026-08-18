import { useMemo, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useApp, useCurrency } from '../lib/store.jsx'
import { Avatar, Modal, SyncPill } from './ui.jsx'
import Icon from './Icon.jsx'
import { formatDate } from '../lib/format.js'
import { filterOrders, lowStockRows, salesSummary } from '../lib/analytics.js'

const SECTIONS = [
  {
    label: 'Main menu',
    items: [
      { to: '/admin', label: 'Dashboard', icon: 'dashboard', permission: 'admin.dashboard', end: true },
      { to: '/pos', label: 'Point of sale', icon: 'pos', permission: 'pos' },
      { to: '/admin/sales', label: 'Sales', icon: 'sales', permission: ['admin.sales', 'sales.own'], count: 'sales' },
      { to: '/admin/reports', label: 'Reports', icon: 'reports', permission: 'admin.reports' },
    ],
  },
  {
    label: 'Catalogue',
    items: [
      { to: '/admin/products', label: 'Products', icon: 'products', permission: 'admin.products', count: 'products' },
      { to: '/admin/inventory', label: 'Inventory', icon: 'inventory', permission: 'admin.inventory', count: 'lowStock' },
      { to: '/admin/exhibitions', label: 'Exhibitions', icon: 'exhibitions', permission: 'admin.exhibitions' },
    ],
  },
  {
    label: 'People',
    items: [
      { to: '/admin/customers', label: 'Customers', icon: 'customers', permission: 'admin.customers', count: 'customers' },
      { to: '/admin/staff', label: 'Staff', icon: 'staff', permission: 'admin.staff' },
    ],
  },
  {
    label: 'General',
    items: [
      { to: '/admin/activity', label: 'Activity log', icon: 'activity', permission: 'admin.settings' },
      { to: '/admin/settings', label: 'Settings', icon: 'settings', permission: 'admin.settings' },
    ],
  },
]

export default function AdminLayout() {
  const { state, user, activeExhibition, sellLocationId, sellLocationName, actions, can } = useApp()
  const currency = useCurrency()
  const navigate = useNavigate()
  const location = useLocation()
  const [drawer, setDrawer] = useState(false)
  const [bell, setBell] = useState(false)

  const unread = state.notifications.filter((entry) => !entry.read).length

  const counts = useMemo(
    () => ({
      sales: state.orders.filter((order) => order.exhibitionId === sellLocationId).length,
      products: state.products.length,
      customers: state.customers.length,
      lowStock: lowStockRows(state, sellLocationId).length,
    }),
    [state, sellLocationId],
  )

  const exhibitionSummary = useMemo(
    () => salesSummary(filterOrders(state, { exhibitionId: sellLocationId })),
    [state, sellLocationId],
  )

  const allowed = (permission) =>
    Array.isArray(permission) ? permission.some(can) : can(permission)

  const sections = SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => allowed(item.permission)),
  })).filter((section) => section.items.length > 0)

  const current = sections
    .flatMap((section) => section.items)
    .find((item) => (item.end ? item.to === location.pathname : location.pathname.startsWith(item.to)))

  const logo = state.settings.business.logo

  return (
    <div className="app-shell">
      {drawer && <div className="scrim" onClick={() => setDrawer(false)} />}

      <aside className={`sidebar ${drawer ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <div className="brand-mark">
            {logo ? <img src={logo} alt="" /> : state.settings.business.name.slice(0, 1)}
          </div>
          <div style={{ minWidth: 0 }}>
            <div className="brand-name">{state.settings.business.name}</div>
            <div className="brand-sub">POS &amp; Inventory</div>
          </div>
        </div>

        <button className="side-search" onClick={() => navigate('/admin/sales')}>
          <Icon name="search" size={15} />
          Search
          <kbd>⌘K</kbd>
        </button>

        <nav className="nav">
          {sections.map((section) => (
            <div key={section.label}>
              <div className="nav-label">{section.label}</div>
              {section.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                  onClick={() => setDrawer(false)}
                >
                  <Icon name={item.icon} size={17} />
                  {item.label}
                  {item.count && counts[item.count] > 0 && (
                    <span className="count">{counts[item.count]}</span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="promo">
            <div className="row" style={{ gap: 7 }}>
              {activeExhibition ? (
                <span className={`badge ${activeExhibition.status === 'Active' ? 'badge-good' : 'badge-warn'}`}>
                  <span className="dot" />
                  {activeExhibition.status}
                </span>
              ) : (
                <span className="badge">No exhibition</span>
              )}
            </div>
            <h4 style={{ marginTop: 4 }}>{sellLocationName}</h4>
            <p>
              {activeExhibition
                ? `${currency(exhibitionSummary.net)} from ${exhibitionSummary.count} sales`
                : `Selling from main stock · ${currency(exhibitionSummary.net)} so far`}
            </p>
            <div className="row" style={{ gap: 6, marginTop: 8 }}>
              <button className="btn btn-primary btn-sm grow" onClick={() => navigate('/pos')}>
                Sell
              </button>
              <button className="btn btn-sm grow" onClick={() => navigate('/select-exhibition')}>
                Switch
              </button>
            </div>
          </div>

          <div className="user-chip">
            <Avatar name={user.name} />
            <div className="grow">
              <div style={{ fontWeight: 620, fontSize: 13.5 }}>{user.name}</div>
              <div className="small muted" style={{ textTransform: 'capitalize' }}>
                {user.role}
              </div>
            </div>
            <button
              className="btn btn-ghost btn-sm"
              title="Sign out"
              onClick={() => {
                actions.logout()
                navigate('/login')
              }}
            >
              <Icon name="logout" size={16} />
            </button>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="icon-btn mobile-only" onClick={() => setDrawer(true)}>
            <Icon name="sales" size={17} />
          </button>

          <div className="nav-arrows desktop-only">
            <button className="icon-btn" onClick={() => navigate(-1)} title="Back">
              <Icon name="arrowLeft" size={16} />
            </button>
            <button className="icon-btn" onClick={() => navigate(1)} title="Forward">
              <Icon name="arrowRight" size={16} />
            </button>
          </div>

          <div className="crumbs grow">
            <span className="desktop-only">{state.settings.business.name}</span>
            <Icon name="chevronRight" size={13} className="desktop-only" />
            <span className="now nowrap" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {current?.label || 'Dashboard'}
            </span>
          </div>

          <SyncPill />

          <button className="icon-btn desktop-only" onClick={() => navigate('/admin/activity')} title="Help desk">
            <Icon name="help" size={17} />
          </button>

          <button
            className="icon-btn"
            title="Notifications"
            onClick={() => {
              setBell(true)
              actions.markNotificationsRead()
            }}
          >
            <Icon name="bell" size={17} />
            {unread > 0 && <span className="pip">{unread}</span>}
          </button>

          <button className="btn btn-primary" onClick={() => navigate('/pos')}>
            <Icon name="plus" size={16} />
            New sale
          </button>
        </header>

        <Outlet />
      </div>

      <Modal
        open={bell}
        onClose={() => setBell(false)}
        title="Notifications"
        subtitle={`${state.notifications.length} recent event${state.notifications.length === 1 ? '' : 's'}`}
        footer={
          <button className="btn" onClick={() => actions.clearNotifications()}>
            Clear all
          </button>
        }
      >
        {state.notifications.length === 0 && <p className="muted small">Nothing to report right now.</p>}
        <div className="stack-sm">
          {state.notifications.slice(0, 40).map((entry) => (
            <div key={entry.id} className="list-item" style={{ cursor: 'default' }}>
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
      </Modal>
    </div>
  )
}
