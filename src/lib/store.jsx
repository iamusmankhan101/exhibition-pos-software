/**
 * Application store: state, persistence, cross-device sync and every mutation
 * the UI is allowed to make. Domain rules live in `domain.js`; this file owns
 * side effects (persistence, audit logging, notifications, the outbox).
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { idbGet, idbSet } from './idb.js'
import { MAIN_LOCATION, money, nowIso, uid } from './format.js'
import {
  MOVEMENT_TYPES,
  applyStockChange,
  createOrder,
  getStock,
  refundOrder,
  settlePayment,
  transferStock,
} from './domain.js'
import { DEFAULT_SETTINGS, buildSeedState } from './seed.js'
import { drainOutbox } from './sync.js'

const STATE_KEY = 'state'
const SESSION_KEY = 'tareez.session'
const DEVICE_KEY = 'tareez.device'

const AppContext = createContext(null)

export const ROLE_PERMISSIONS = {
  admin: ['*'],
  manager: [
    'pos',
    'admin.dashboard',
    'admin.products',
    'admin.inventory',
    'admin.exhibitions',
    'admin.sales',
    'admin.customers',
    'admin.reports',
    'admin.staff',
    'view.cost',
    'refund',
    'stock.adjust',
  ],
  salesperson: ['pos', 'admin.customers', 'sales.own'],
}

export function can(user, permission) {
  if (!user) return false
  const granted = ROLE_PERMISSIONS[user.role] || []
  return granted.includes('*') || granted.includes(permission)
}

function getDeviceId() {
  let device = localStorage.getItem(DEVICE_KEY)
  if (!device) {
    device = uid('dev')
    localStorage.setItem(DEVICE_KEY, device)
  }
  return device
}

/** Short human-readable device tag used inside invoice numbers. */
function deviceCodeFrom(deviceId) {
  let hash = 0
  for (let i = 0; i < deviceId.length; i += 1) hash = (hash * 31 + deviceId.charCodeAt(i)) % 1296
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return `${alphabet[hash % alphabet.length]}${alphabet[Math.floor(hash / alphabet.length) % alphabet.length]}`
}

function loadSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY)) || {}
  } catch {
    return {}
  }
}

/** Fills in fields added after a state blob was first written. */
function migrate(state) {
  return {
    ...state,
    settings: {
      ...DEFAULT_SETTINGS,
      ...state.settings,
      business: { ...DEFAULT_SETTINGS.business, ...state.settings?.business },
      invoiceDesign: { ...DEFAULT_SETTINGS.invoiceDesign, ...state.settings?.invoiceDesign },
      receiptChannels: { ...DEFAULT_SETTINGS.receiptChannels, ...state.settings?.receiptChannels },
    },
    notifications: state.notifications || [],
    outbox: state.outbox || [],
    auditLogs: state.auditLogs || [],
    counters: state.counters || { invoice: 1 },
  }
}

export function AppProvider({ children }) {
  const [state, setStateRaw] = useState(null)
  const [session, setSession] = useState(loadSession)
  const [online, setOnline] = useState(navigator.onLine)
  const [syncing, setSyncing] = useState(false)
  const [toasts, setToasts] = useState([])

  const deviceId = useMemo(getDeviceId, [])
  const deviceCode = useMemo(() => deviceCodeFrom(deviceId), [deviceId])
  const stateRef = useRef(null)
  const channelRef = useRef(null)
  const saveTimer = useRef(null)

  stateRef.current = state

  /* --------------------------------------------------------------- boot */

  useEffect(() => {
    let cancelled = false
    idbGet(STATE_KEY).then((stored) => {
      if (cancelled) return
      setStateRaw(stored ? migrate(stored) : buildSeedState())
    })
    return () => {
      cancelled = true
    }
  }, [])

  /* -------------------------------------------------- persist + broadcast */

  const persist = useCallback((next) => {
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      idbSet(STATE_KEY, next).catch(() => {})
      channelRef.current?.postMessage({ origin: deviceId, state: next })
    }, 200)
  }, [deviceId])

  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return undefined
    const channel = new BroadcastChannel('tareez-pos')
    channelRef.current = channel
    channel.onmessage = (event) => {
      // Another device/tab on this machine changed the shared dataset.
      if (event.data?.origin === deviceId) return
      if (event.data?.state) setStateRaw(migrate(event.data.state))
    }
    return () => {
      channel.close()
      channelRef.current = null
    }
  }, [deviceId])

  const setState = useCallback(
    (updater) => {
      setStateRaw((current) => {
        if (!current) return current
        const next = typeof updater === 'function' ? updater(current) : updater
        if (next === current) return current
        stateRef.current = next
        persist(next)
        return next
      })
    },
    [persist],
  )

  /* ------------------------------------------------------------- helpers */

  const toast = useCallback((message, tone = 'info') => {
    const id = uid('toast')
    setToasts((current) => [...current, { id, message, tone }])
    setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 4200)
  }, [])

  const user = useMemo(
    () => state?.users.find((entry) => entry.id === session.userId) || null,
    [state, session.userId],
  )

  const activeExhibition = useMemo(
    () => state?.exhibitions.find((entry) => entry.id === session.exhibitionId) || null,
    [state, session.exhibitionId],
  )

  const updateSession = useCallback((patch) => {
    setSession((current) => {
      const next = { ...current, ...patch }
      localStorage.setItem(SESSION_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  /** Appends an audit row. Called from inside a state updater. */
  const withAudit = useCallback(
    (draft, action, detail, entity = '', entityId = '') => ({
      ...draft,
      auditLogs: [
        {
          id: uid('log'),
          userId: user?.id || 'system',
          userName: user?.name || 'System',
          action,
          entity,
          entityId,
          detail,
          deviceId,
          createdAt: nowIso(),
        },
        ...draft.auditLogs,
      ].slice(0, 800),
    }),
    [user, deviceId],
  )

  const withNotification = useCallback((draft, type, title, body, severity = 'info') => ({
    ...draft,
    notifications: [
      { id: uid('ntf'), type, title, body, severity, read: false, createdAt: nowIso() },
      ...draft.notifications,
    ].slice(0, 200),
  }), [])

  const withOutbox = useCallback(
    (draft, type, clientId, payload) => ({
      ...draft,
      outbox: [
        ...draft.outbox,
        {
          id: uid('obx'),
          type,
          clientId,
          payload,
          deviceId,
          status: 'pending',
          createdAt: nowIso(),
          syncedAt: null,
        },
      ],
    }),
    [deviceId],
  )

  /* ---------------------------------------------------------- sync loop */

  useEffect(() => {
    const goOnline = () => setOnline(true)
    const goOffline = () => setOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  useEffect(() => {
    if (!state) return undefined
    let stopped = false

    const tick = async () => {
      const pending = stateRef.current?.outbox.filter((entry) => entry.status === 'pending') || []
      if (!pending.length || !navigator.onLine) return
      setSyncing(true)
      await drainOutbox(
        () => stateRef.current?.outbox || [],
        (synced, failed) => {
          if (stopped) return
          const syncedIds = new Map(synced.map((entry) => [entry.id, entry.syncedAt]))
          setState((current) => ({
            ...current,
            outbox: current.outbox.map((entry) =>
              syncedIds.has(entry.id)
                ? { ...entry, status: 'synced', syncedAt: syncedIds.get(entry.id) }
                : failed.includes(entry.id)
                  ? { ...entry, status: 'pending', attempts: (entry.attempts || 0) + 1 }
                  : entry,
            ),
          }))
        },
      )
      if (!stopped) setSyncing(false)
    }

    tick()
    const interval = setInterval(tick, 4000)
    return () => {
      stopped = true
      clearInterval(interval)
    }
  }, [state, online, setState])

  /* ----------------------------------------------------------- actions */

  const actions = useMemo(() => {
    const guard = () => {
      if (!stateRef.current) throw new Error('Data is still loading.')
    }

    return {
      /* auth */
      login(userId, pin) {
        guard()
        const account = stateRef.current.users.find((entry) => entry.id === userId)
        if (!account) throw new Error('User not found.')
        if (!account.active) throw new Error('This account has been deactivated.')
        if (account.pin !== String(pin)) throw new Error('Incorrect PIN.')
        setState((current) => ({
          ...current,
          auditLogs: [
            {
              id: uid('log'),
              userId: account.id,
              userName: account.name,
              action: 'Signed in',
              entity: 'session',
              entityId: account.id,
              detail: `Device ${deviceCodeFrom(deviceId)}`,
              deviceId,
              createdAt: nowIso(),
            },
            ...current.auditLogs,
          ].slice(0, 800),
        }))
        const preferred =
          stateRef.current.exhibitions.find(
            (exhibition) => exhibition.status === 'Active' && exhibition.staffIds.includes(account.id),
          ) || stateRef.current.exhibitions.find((exhibition) => exhibition.status === 'Active')
        updateSession({ userId: account.id, exhibitionId: preferred?.id || null })
        return account
      },

      logout() {
        updateSession({ userId: null })
      },

      selectExhibition(exhibitionId) {
        updateSession({ exhibitionId })
      },

      /* products */
      saveProduct(product) {
        setState((current) => {
          const exists = current.products.some((entry) => entry.id === product.id)
          const products = exists
            ? current.products.map((entry) => (entry.id === product.id ? product : entry))
            : [{ ...product, createdAt: nowIso() }, ...current.products]
          const draft = withAudit(
            { ...current, products },
            exists ? 'Updated product' : 'Created product',
            product.name,
            'product',
            product.id,
          )
          return withOutbox(draft, 'product.save', product.id, product)
        })
        toast(`Saved "${product.name}"`, 'success')
      },

      deleteProduct(productId) {
        setState((current) => {
          const product = current.products.find((entry) => entry.id === productId)
          const draft = withAudit(
            { ...current, products: current.products.filter((entry) => entry.id !== productId) },
            'Deleted product',
            product?.name || productId,
            'product',
            productId,
          )
          return withOutbox(draft, 'product.delete', productId, { productId })
        })
        toast('Product deleted', 'warn')
      },

      /* inventory */
      transferStock({ variantId, fromLocation, toLocation, quantity }) {
        setState((current) => {
          const next = transferStock(current, {
            variantId,
            fromLocation,
            toLocation,
            quantity,
            userId: user?.id,
          })
          const draft = withAudit(
            next,
            'Stock transfer',
            `${quantity} × ${variantId} → ${toLocation}`,
            'inventory',
            variantId,
          )
          return withOutbox(draft, 'stock.transfer', uid('trn'), {
            variantId,
            fromLocation,
            toLocation,
            quantity,
          })
        })
      },

      adjustStock({ variantId, locationId, quantity, note }) {
        setState((current) => {
          const currentQty = getStock(current, locationId, variantId)
          const delta = money(quantity - currentQty)
          if (!delta) return current
          const next = applyStockChange(current, {
            locationId,
            variantId,
            delta,
            type: MOVEMENT_TYPES.ADJUSTMENT,
            reference: 'Manual adjustment',
            userId: user?.id,
            note,
          })
          const draft = withAudit(
            next,
            'Stock adjustment',
            `${currentQty} → ${quantity}${note ? ` · ${note}` : ''}`,
            'inventory',
            variantId,
          )
          return withOutbox(draft, 'stock.adjust', uid('adj'), { variantId, locationId, quantity, note })
        })
        toast('Stock adjusted', 'success')
      },

      /* exhibitions */
      saveExhibition(exhibition) {
        setState((current) => {
          const exists = current.exhibitions.some((entry) => entry.id === exhibition.id)
          const exhibitions = exists
            ? current.exhibitions.map((entry) => (entry.id === exhibition.id ? exhibition : entry))
            : [{ ...exhibition, createdAt: nowIso() }, ...current.exhibitions]
          const draft = withAudit(
            { ...current, exhibitions },
            exists ? 'Updated exhibition' : 'Created exhibition',
            exhibition.name,
            'exhibition',
            exhibition.id,
          )
          return withOutbox(draft, 'exhibition.save', exhibition.id, exhibition)
        })
        toast(`Saved "${exhibition.name}"`, 'success')
      },

      deleteExhibition(exhibitionId) {
        setState((current) =>
          withAudit(
            { ...current, exhibitions: current.exhibitions.filter((entry) => entry.id !== exhibitionId) },
            'Deleted exhibition',
            exhibitionId,
            'exhibition',
            exhibitionId,
          ),
        )
      },

      /** Freezes the closing report and returns unsold stock to the warehouse. */
      closeExhibition(exhibitionId, report, returnStock = true) {
        setState((current) => {
          let next = current
          if (returnStock) {
            for (const product of current.products) {
              for (const variant of product.variants) {
                const remaining = getStock(next, exhibitionId, variant.id)
                if (remaining > 0) {
                  next = transferStock(next, {
                    variantId: variant.id,
                    fromLocation: exhibitionId,
                    toLocation: MAIN_LOCATION,
                    quantity: remaining,
                    userId: user?.id,
                  })
                }
              }
            }
          }
          next = {
            ...next,
            exhibitions: next.exhibitions.map((entry) =>
              entry.id === exhibitionId
                ? { ...entry, status: 'Completed', closedAt: nowIso(), closingReport: report }
                : entry,
            ),
          }
          next = withNotification(
            next,
            'exhibition',
            'Exhibition closed',
            `${report.exhibitionName} closed with ${report.netSales} net sales.`,
            'info',
          )
          const draft = withAudit(next, 'Closed exhibition', report.exhibitionName, 'exhibition', exhibitionId)
          return withOutbox(draft, 'exhibition.close', exhibitionId, report)
        })
        toast('Exhibition closed and stock returned to main inventory', 'success')
      },

      /* customers */
      saveCustomer(customer) {
        let saved = customer
        setState((current) => {
          const exists = current.customers.some((entry) => entry.id === customer.id)
          const record = exists
            ? customer
            : {
                totalOrders: 0,
                totalSpend: 0,
                lastPurchaseAt: null,
                exhibitionIds: [],
                createdAt: nowIso(),
                ...customer,
              }
          saved = record
          const customers = exists
            ? current.customers.map((entry) => (entry.id === customer.id ? record : entry))
            : [record, ...current.customers]
          const draft = withAudit(
            { ...current, customers },
            exists ? 'Updated customer' : 'Created customer',
            customer.name,
            'customer',
            customer.id,
          )
          return withOutbox(draft, 'customer.save', customer.id, record)
        })
        return saved
      },

      deleteCustomer(customerId) {
        setState((current) =>
          withAudit(
            { ...current, customers: current.customers.filter((entry) => entry.id !== customerId) },
            'Deleted customer',
            customerId,
            'customer',
            customerId,
          ),
        )
        toast('Customer deleted', 'warn')
      },

      /* sales */
      completeSale(payload) {
        guard()
        let created = null
        let error = null
        setState((current) => {
          try {
            const result = createOrder(current, {
              ...payload,
              deviceCode,
              offlineCreated: !navigator.onLine,
            })
            created = result.order
            if (result.duplicate) return current

            let next = result.state

            // Low-stock and large-discount notifications.
            for (const item of payload.items) {
              const remaining = getStock(next, payload.exhibitionId, item.variantId)
              const found = next.products
                .flatMap((product) => product.variants)
                .find((variant) => variant.id === item.variantId)
              const threshold = found?.minStock ?? next.settings.lowStockThreshold
              if (remaining <= 0) {
                next = withNotification(
                  next,
                  'stock',
                  'Out of stock',
                  `${item.name} (${item.sku}) is now out of stock at this exhibition.`,
                  'danger',
                )
              } else if (remaining <= threshold) {
                next = withNotification(
                  next,
                  'stock',
                  'Low stock',
                  `${item.name} (${item.sku}) — ${remaining} left at this exhibition.`,
                  'warn',
                )
              }
            }

            const discountPercent = result.order.subtotal
              ? (result.order.discountAmount / result.order.subtotal) * 100
              : 0
            if (discountPercent >= next.settings.largeDiscountAlertPercent) {
              next = withNotification(
                next,
                'discount',
                'Large discount applied',
                `${result.order.invoiceNo} — ${discountPercent.toFixed(1)}% by ${result.order.salespersonName}.`,
                'warn',
              )
            }

            next = withAudit(
              next,
              'Completed sale',
              `${result.order.invoiceNo} · ${result.order.total} · ${result.order.paymentMethod}`,
              'order',
              result.order.id,
            )
            return withOutbox(next, 'order.create', payload.clientId, result.order)
          } catch (err) {
            error = err
            return current
          }
        })
        if (error) throw error
        return created
      },

      cancelOrder(orderId, reason) {
        setState((current) => {
          const order = current.orders.find((entry) => entry.id === orderId)
          if (!order || order.status !== 'Completed') return current
          let next = current
          // A cancelled sale returns everything that was not already returned.
          for (const item of order.items) {
            const remaining = item.quantity - (item.returnedQuantity || 0)
            if (remaining > 0) {
              next = applyStockChange(next, {
                locationId: order.exhibitionId,
                variantId: item.variantId,
                delta: remaining,
                type: MOVEMENT_TYPES.RETURN,
                reference: `${order.invoiceNo} (cancelled)`,
                userId: user?.id,
                note: reason,
              })
            }
          }
          next = {
            ...next,
            orders: next.orders.map((entry) =>
              entry.id === orderId ? { ...entry, status: 'Cancelled', note: reason } : entry,
            ),
            // Reverse only money that was actually taken, not the invoice total.
            payments: [
              {
                id: uid('ref'),
                orderId,
                invoiceNo: order.invoiceNo,
                method: order.paymentMethod,
                amount: -money((order.amountPaid ?? order.total) - (order.refundedAmount || 0)),
                status: 'Cancelled',
                reference: reason || '',
                kind: 'refund',
                exhibitionId: order.exhibitionId,
                createdAt: nowIso(),
              },
              ...next.payments,
            ],
          }
          next = withNotification(next, 'refund', 'Sale cancelled', `${order.invoiceNo} — ${reason}`, 'warn')
          return withAudit(next, 'Cancelled sale', `${order.invoiceNo} · ${reason}`, 'order', orderId)
        })
        toast('Sale cancelled and stock restored', 'warn')
      },

      settlePayment(payload) {
        let error = null
        let received = 0
        setState((current) => {
          try {
            const result = settlePayment(current, { ...payload, userId: user?.id })
            received = result.received
            const draft = withAudit(
              result.state,
              'Recorded balance payment',
              `${payload.invoiceNo} · ${result.received} · ${payload.method}${
                result.balanceDue > 0 ? ` · ${result.balanceDue} still due` : ' · settled'
              }`,
              'order',
              payload.orderId,
            )
            return withOutbox(draft, 'order.settle', uid('stl'), payload)
          } catch (err) {
            error = err
            return current
          }
        })
        if (error) throw error
        toast('Payment recorded', 'success')
        return received
      },

      refund(payload) {
        let error = null
        let amount = 0
        setState((current) => {
          try {
            const result = refundOrder(current, { ...payload, userId: user?.id, userName: user?.name })
            amount = result.refundAmount
            const detail = [
              result.refundAmount > 0 ? `${result.refundAmount} via ${payload.refundMethod}` : null,
              result.balanceCleared > 0 ? `${result.balanceCleared} written off the balance due` : null,
            ]
              .filter(Boolean)
              .join(' · ')
            let next = withNotification(
              result.state,
              'refund',
              'Return processed',
              `${payload.invoiceNo} — ${detail}.`,
              'warn',
            )
            next = withAudit(next, 'Processed return', `${payload.invoiceNo} · ${detail}`, 'order', payload.orderId)
            return withOutbox(next, 'order.refund', uid('rfd'), payload)
          } catch (err) {
            error = err
            return current
          }
        })
        if (error) throw error
        toast(
          amount > 0 ? 'Refund processed and stock restored' : 'Return recorded and stock restored',
          'success',
        )
        return amount
      },

      /* staff */
      saveUser(account) {
        setState((current) => {
          const exists = current.users.some((entry) => entry.id === account.id)
          const users = exists
            ? current.users.map((entry) => (entry.id === account.id ? account : entry))
            : [{ ...account, createdAt: nowIso() }, ...current.users]
          return withAudit(
            { ...current, users },
            exists ? 'Updated user' : 'Created user',
            `${account.name} (${account.role})`,
            'user',
            account.id,
          )
        })
        toast(`Saved ${account.name}`, 'success')
      },

      deleteUser(userId) {
        setState((current) =>
          withAudit(
            { ...current, users: current.users.filter((entry) => entry.id !== userId) },
            'Deleted user',
            userId,
            'user',
            userId,
          ),
        )
      },

      /* settings */
      saveSettings(settings) {
        setState((current) => withAudit({ ...current, settings }, 'Updated settings', '', 'settings', 'settings'))
        toast('Settings saved', 'success')
      },

      /* notifications */
      markNotificationsRead() {
        setState((current) => ({
          ...current,
          notifications: current.notifications.map((entry) => ({ ...entry, read: true })),
        }))
      },

      clearNotifications() {
        setState((current) => ({ ...current, notifications: [] }))
      },

      /* data */
      resetDemoData() {
        const fresh = buildSeedState()
        setStateRaw(fresh)
        persist(fresh)
        updateSession({ exhibitionId: fresh.exhibitions[0].id })
        toast('Demo data restored', 'success')
      },

      exportBackup() {
        const blob = new Blob([JSON.stringify(stateRef.current, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const link = document.createElement('a')
        link.href = url
        link.download = `tareez-backup-${new Date().toISOString().slice(0, 10)}.json`
        link.click()
        setTimeout(() => URL.revokeObjectURL(url), 1000)
        toast('Backup downloaded', 'success')
      },

      importBackup(json) {
        const parsed = typeof json === 'string' ? JSON.parse(json) : json
        if (!parsed?.products || !parsed?.settings) throw new Error('That file is not a Tareez backup.')
        const restored = migrate(parsed)
        setStateRaw(restored)
        persist(restored)
        toast('Backup restored', 'success')
      },

      toast,
    }
  }, [setState, withAudit, withNotification, withOutbox, toast, user, deviceId, deviceCode, updateSession, persist])

  const value = useMemo(
    () => ({
      state,
      session,
      user,
      activeExhibition,
      online,
      syncing,
      deviceId,
      deviceCode,
      pendingSync: state?.outbox.filter((entry) => entry.status === 'pending').length || 0,
      toasts,
      actions,
      can: (permission) => can(user, permission),
    }),
    [state, session, user, activeExhibition, online, syncing, deviceId, deviceCode, toasts, actions],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const context = useContext(AppContext)
  if (!context) throw new Error('useApp must be used inside <AppProvider>')
  return context
}

/** Convenience hook for currency formatting bound to the configured symbol. */
export function useCurrency() {
  const { state } = useApp()
  const symbol = state?.settings.currencySymbol || '£'
  return useCallback(
    (value) => {
      const n = money(value || 0)
      const sign = n < 0 ? '-' : ''
      return `${sign}${symbol}${Math.abs(n).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`
    },
    [symbol],
  )
}
