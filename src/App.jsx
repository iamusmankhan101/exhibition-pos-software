import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppProvider, useApp } from './lib/store.jsx'
import { Toasts } from './components/ui.jsx'
import UpdatePrompt from './components/UpdatePrompt.jsx'
import AdminLayout from './components/AdminLayout.jsx'

import Login from './pages/Login.jsx'
import Receipt from './pages/Receipt.jsx'
import SelectExhibition from './pages/SelectExhibition.jsx'
import POS from './pages/pos/POS.jsx'
import Dashboard from './pages/admin/Dashboard.jsx'
import Sales from './pages/admin/Sales.jsx'
import Products from './pages/admin/Products.jsx'
import Inventory from './pages/admin/Inventory.jsx'
import Exhibitions from './pages/admin/Exhibitions.jsx'
import Customers from './pages/admin/Customers.jsx'
import Staff from './pages/admin/Staff.jsx'
import Reports from './pages/admin/Reports.jsx'
import Activity from './pages/admin/Activity.jsx'
import Settings from './pages/admin/Settings.jsx'

function Booting() {
  return (
    <div className="boot">
      <div className="spinner" />
      <p className="small">Loading local data…</p>
    </div>
  )
}

/** Gates a route on a loaded dataset, a signed-in user and a permission. */
function Protected({ permission, children }) {
  const { state, user, can } = useApp()
  const location = useLocation()

  if (!state) return <Booting />
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />
  if (permission && !can(permission)) return <Navigate to="/pos" replace />
  return children
}

/**
 * Per-page permission gate. `permission` may be a list, in which case any one
 * of them grants access (a salesperson reaches Sales through `sales.own`).
 */
function Guard({ permission, children }) {
  const { can } = useApp()
  const allowed = Array.isArray(permission) ? permission.some(can) : can(permission)
  return allowed ? children : <Navigate to="/pos" replace />
}

function Shell() {
  const { state } = useApp()

  return (
    <>
      <Routes>
        <Route path="/r/:orderId" element={<Receipt />} />

        <Route path="/login" element={state ? <Login /> : <Booting />} />

        <Route
          path="/select-exhibition"
          element={
            <Protected>
              <SelectExhibition />
            </Protected>
          }
        />

        <Route
          path="/pos"
          element={
            <Protected permission="pos">
              <POS />
            </Protected>
          }
        />

        <Route
          path="/admin"
          element={
            <Protected>
              <AdminLayout />
            </Protected>
          }
        >
          <Route
            index
            element={
              <Guard permission="admin.dashboard">
                <Dashboard />
              </Guard>
            }
          />
          {['sales', 'sales/:orderId'].map((path) => (
            <Route
              key={path}
              path={path}
              element={
                <Guard permission={['admin.sales', 'sales.own']}>
                  <Sales />
                </Guard>
              }
            />
          ))}
          <Route
            path="products"
            element={
              <Guard permission="admin.products">
                <Products />
              </Guard>
            }
          />
          <Route
            path="inventory"
            element={
              <Guard permission="admin.inventory">
                <Inventory />
              </Guard>
            }
          />
          <Route
            path="exhibitions"
            element={
              <Guard permission="admin.exhibitions">
                <Exhibitions />
              </Guard>
            }
          />
          <Route
            path="customers"
            element={
              <Guard permission="admin.customers">
                <Customers />
              </Guard>
            }
          />
          <Route
            path="staff"
            element={
              <Guard permission="admin.staff">
                <Staff />
              </Guard>
            }
          />
          <Route
            path="reports"
            element={
              <Guard permission="admin.reports">
                <Reports />
              </Guard>
            }
          />
          <Route
            path="activity"
            element={
              <Guard permission="admin.settings">
                <Activity />
              </Guard>
            }
          />
          <Route
            path="settings"
            element={
              <Guard permission="admin.settings">
                <Settings />
              </Guard>
            }
          />
        </Route>

        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
      {state && <Toasts />}
      <UpdatePrompt />
    </>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Shell />
    </AppProvider>
  )
}
