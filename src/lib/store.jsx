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
  deleteCustomers,
  deleteExhibition,
  deleteOrders,
  deleteProducts,
  getStock,
  orderPaymentParts,
  refundOrder,
  releasePromoUse,
  settlePayment,
  transferStock,
} from './domain.js'
import { DEFAULT_SETTINGS, buildSeedState } from './seed.js'
import { drainOutbox, setSyncAdapter } from './sync.js'
import { isConfigured as supabaseConfigured } from './supabase.js'
import { createSupabaseAdapter } from './supabaseAdapter.js'
import { DEFAULT_ROLES, userCan, wouldLoseAdminAccess } from './permissions.js'
import {
  createCredential,
  createPinCredential,
  emailProblem,
  normaliseEmail,
  passwordProblem,
  verifyPassword,
  verifyPin,
} from './auth.js'
import { getSupabase } from './supabase.js'
import {
  blockedBy,
  clearAttempts,
  lockMessage,
  recordFailure,
  settleFailure,
} from './throttle.js'

const STATE_KEY = 'state'
const SESSION_KEY = 'tareez.session'
const DEVICE_KEY = 'tareez.device'

const AppContext = createContext(null)

export { userCan as can } from './permissions.js'

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

/**
 * Decides whether a device that predates the bundled logo should get it.
 *
 * Only once, tracked by `logoSeeded`. Without the flag the spread below would
 * hand the default back every time the app loaded, so an admin who removed the
 * logo on purpose would watch it reappear on the next refresh.
 */
function seedLogo(settings) {
  const business = { ...DEFAULT_SETTINGS.business, ...settings?.business }
  if (settings?.logoSeeded || business.logo) return { business, logoSeeded: true }
  return { business: { ...business, logo: DEFAULT_SETTINGS.business.logo }, logoSeeded: true }
}

/** Fills in fields added after a state blob was first written. */
function migrate(state) {
  const { business, logoSeeded } = seedLogo(state.settings)
  return {
    ...state,
    settings: {
      ...DEFAULT_SETTINGS,
      ...state.settings,
      logoSeeded,
      business,
      invoiceDesign: { ...DEFAULT_SETTINGS.invoiceDesign, ...state.settings?.invoiceDesign },
      receiptChannels: { ...DEFAULT_SETTINGS.receiptChannels, ...state.settings?.receiptChannels },
    },
    roles: state.roles?.length ? state.roles : DEFAULT_ROLES.map((role) => ({ ...role })),
    notifications: state.notifications || [],
    outbox: state.outbox || [],
    auditLogs: state.auditLogs || [],
    promoCodes: state.promoCodes || [],
    returns: state.returns || [],
    devices: state.devices || [],
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
    idbGet(STATE_KEY)
      .then(async (stored) => (stored ? migrate(stored) : await buildSeedState()))
      .then((next) => {
        if (!cancelled) setStateRaw(next)
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

  /* ---------------------------------------------------------- devices */

  /**
   * Keeps a registry of the devices trading on this dataset.
   *
   * There is no server to hold a session table, so a device records itself in
   * the shared state and refreshes a heartbeat. That is what makes an owner able
   * to see which tablets are live and cut one off if it goes missing.
   */
  const currentDevice = useMemo(
    () => (state?.devices || []).find((entry) => entry.id === deviceId) || null,
    [state, deviceId],
  )

  useEffect(() => {
    if (!state) return
    const known = state.devices?.find((entry) => entry.id === deviceId)
    const stale = !known?.lastSeenAt || Date.now() - new Date(known.lastSeenAt).getTime() > 5 * 60 * 1000
    const userChanged = (known?.lastUserId || null) !== (session.userId || null)
    // Writing on every render would loop, so only a real change or a cold
    // heartbeat is worth persisting.
    if (known && !stale && !userChanged) return

    setState((current) => {
      const account = current.users.find((entry) => entry.id === session.userId) || null
      const existing = (current.devices || []).find((entry) => entry.id === deviceId)
      const record = {
        id: deviceId,
        code: deviceCode,
        label: existing?.label || '',
        firstSeenAt: existing?.firstSeenAt || nowIso(),
        lastSeenAt: nowIso(),
        lastUserId: account?.id || null,
        lastUserName: account?.name || '',
        revokedAt: existing?.revokedAt || null,
        userAgent: existing?.userAgent || navigator.userAgent,
      }
      return {
        ...current,
        devices: existing
          ? current.devices.map((entry) => (entry.id === deviceId ? record : entry))
          : [...(current.devices || []), record],
      }
    })
  }, [state, session.userId, deviceId, deviceCode, setState])

  // A revoked device signs itself out as soon as it sees the revocation.
  useEffect(() => {
    if (!currentDevice?.revokedAt || !session.userId) return
    updateSession({ userId: null })
    toast('This device was signed out by an administrator', 'warn')
  }, [currentDevice?.revokedAt, session.userId, updateSession, toast])

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

  /** Audit entry attributed to a specific account (sign-in has no session yet). */
  const withAuditAs = useCallback(
    (draft, account, action, detail, entity = 'session') => ({
      ...draft,
      auditLogs: [
        {
          id: uid('log'),
          userId: account.id,
          userName: account.name,
          action,
          entity,
          entityId: account.id,
          detail,
          deviceId,
          createdAt: nowIso(),
        },
        ...draft.auditLogs,
      ].slice(0, 800),
    }),
    [deviceId],
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

  // Point the outbox at Supabase when credentials are present. Without them the
  // local adapter stays in place and the app runs exactly as it always has, so
  // an unreachable backend can never stop a sale being taken.
  useEffect(() => {
    if (!supabaseConfigured) return
    setSyncAdapter(createSupabaseAdapter({ getState: () => stateRef.current }))
  }, [])

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
      // A revoked device must not be able to sign anybody back in.
      const device = (stateRef.current.devices || []).find((entry) => entry.id === deviceId)
      if (device?.revokedAt) {
        throw new Error('This device has been blocked by an administrator.')
      }
    }

    /**
     * Refuses an attempt that is still inside a lockout.
     *
     * Called before the credential is even looked at, so a locked-out attacker
     * gets no signal about whether the guess was close.
     */
    const throttleGuard = (kind, id) => {
      const blocked = blockedBy(kind, id)
      if (blocked) throw new Error(lockMessage(blocked))
    }

    /**
     * Books a failed attempt and produces the message the form will show.
     *
     * Only lockouts reach the audit log, never individual failures: the log is
     * capped at 800 rows, so a script could otherwise wash the day's real
     * history out of it simply by guessing. One row per lockout keeps the
     * signal — somebody is attacking this device — without the flood.
     */
    const noteFailure = (kind, id, account, message) => {
      const status = recordFailure(kind, id)
      if (status.blocked) {
        const who = account ? `${account.name} (${account.email || 'no email'})` : String(id)
        setState((current) => {
          const draft = account
            ? withAuditAs(current, account, 'Sign-in locked', `${status.failures} failed attempts · device ${deviceCode}`)
            : withAudit(
                current,
                'Sign-in locked',
                `${status.failures} failed attempts for ${who} · device ${deviceCode}`,
                'session',
                String(id),
              )
          return withNotification(
            draft,
            'security',
            'Sign-in temporarily locked',
            `${status.failures} failed ${kind === 'pin' ? 'PIN' : 'password'} attempts for ${who} on device ${deviceCode}.`,
            'warn',
          )
        })
        return lockMessage(status)
      }
      return message
    }

    const removeProducts = (productIds) => {
      let removed = 0
      setState((current) => {
        const names = current.products
          .filter((entry) => productIds.includes(entry.id))
          .map((entry) => entry.name)
        const result = deleteProducts(current, productIds)
        removed = result.deleted
        if (!removed) return current
        const draft = withAudit(
          result.state,
          removed === 1 ? 'Deleted product' : `Deleted ${removed} products`,
          names.join(', ').slice(0, 200),
          'product',
          productIds.join(','),
        )
        return withOutbox(draft, 'product.delete', uid('del'), { productIds })
      })
      if (removed) {
        toast(`${removed} product${removed === 1 ? '' : 's'} deleted with their stock records`, 'warn')
      }
      return removed
    }

    const removeCustomers = (customerIds) => {
      let removed = 0
      setState((current) => {
        const names = current.customers
          .filter((entry) => customerIds.includes(entry.id))
          .map((entry) => entry.name)
        removed = names.length
        if (!removed) return current
        const draft = withAudit(
          deleteCustomers(current, customerIds),
          removed === 1 ? 'Deleted customer' : `Deleted ${removed} customers`,
          names.join(', ').slice(0, 200),
          'customer',
          customerIds.join(','),
        )
        return withOutbox(draft, 'customer.delete', uid('del'), { customerIds })
      })
      if (removed) toast(`${removed} customer${removed === 1 ? '' : 's'} deleted`, 'warn')
      return removed
    }

    // Named so actions can call one another (sign-in delegates to startSession).
    const api = {
      /* auth */

      /** Signs a verified account in and picks a sensible starting exhibition. */
      startSession(account, method) {
        setState((current) =>
          withAuditAs(current, account, 'Signed in', `${method} · device ${deviceCodeFrom(deviceId)}`),
        )
        const preferred =
          stateRef.current.exhibitions.find(
            (exhibition) => exhibition.status === 'Active' && exhibition.staffIds.includes(account.id),
          ) || stateRef.current.exhibitions.find((exhibition) => exhibition.status === 'Active')
        updateSession({ userId: account.id, exhibitionId: preferred?.id || null, signedInAt: nowIso() })
        return account
      },

      /**
       * PIN sign-in: fast switching between staff on a shared stall device.
       *
       * Always local, and deliberately so. Once a device has a staff list the
       * stall keeps trading through a dead connection, which is the whole point
       * of the offline design — a salesperson must never be locked out of the
       * till because the venue wifi dropped.
       */
      async login(userId, pin) {
        guard()
        // Four digits is the weakest credential in the building, so the lockout
        // check comes first and a wrong one is charged for.
        throttleGuard('pin', userId)
        const startedAt = Date.now()
        const account = stateRef.current.users.find((entry) => entry.id === userId)
        if (!account) throw new Error('User not found.')
        if (!account.active) throw new Error('This account is awaiting approval or has been deactivated.')
        if (!(await verifyPin(pin, account))) {
          const message = noteFailure('pin', userId, account, 'Incorrect PIN.')
          await settleFailure(startedAt)
          throw new Error(message)
        }
        clearAttempts('pin', userId)
        return api.startSession(account, 'PIN')
      },

      /**
       * Password sign-in.
       *
       * With Supabase configured this is the one step that needs a connection:
       * it is what mints the session the row-level security policies check, and
       * it refreshes the cached staff list that PIN sign-in then works against
       * offline. Set the device up before the show, and the show itself needs
       * nothing.
       */
      async signIn(email, password) {
        guard()

        const address = normaliseEmail(email)
        // Keyed on the address, so locking one account out does not lock out
        // the colleague standing behind them — while the device-wide counter
        // inside the throttle still catches somebody working down a list. An
        // empty box gets its own bucket rather than sharing one with whatever
        // else normalises to '', and the form watches the same key.
        const attemptKey = address || 'anonymous'
        throttleGuard('password', attemptKey)
        const startedAt = Date.now()

        if (supabaseConfigured) {
          if (!navigator.onLine) {
            throw new Error(
              'You need to be online to sign in with a password. Use your PIN if you have signed in on this device before.',
            )
          }
          const sb = await getSupabase()
          const { data, error } = await sb.auth.signInWithPassword({
            email: address,
            password,
          })
          // Supabase's own message is deliberately vague about which half was
          // wrong, which is the behaviour we want anyway. Its server-side
          // limiter is the real backstop; this one only spares the round trip.
          if (error) {
            const message = noteFailure('password', attemptKey, null, error.message)
            await settleFailure(startedAt)
            throw new Error(message)
          }

          const account = await api.refreshIdentity(data.user)
          if (!account) {
            // Distinguish "nobody has been set up yet" from "you specifically
            // are not linked", because the first is a seeding step and the
            // second is usually an auth id that does not match.
            const empty = !stateRef.current.users.some((entry) => entry.authId)
            throw new Error(
              empty
                ? 'No staff records exist yet. Run supabase/seed.sql to create the first account.'
                : `No staff record is linked to ${data.user.email}. An admin needs to finish setting it up.`,
            )
          }
          if (!account.active) {
            throw new Error('This account is awaiting approval or has been deactivated.')
          }
          clearAttempts('password', attemptKey)
          return api.startSession(account, 'Password')
        }

        const account = stateRef.current.users.find(
          (entry) => normaliseEmail(entry.email) === normaliseEmail(email),
        )
        // Same message either way so the form cannot be used to probe for
        // which email addresses exist. `settleFailure` finishes the job: an
        // unknown address would otherwise fail instantly while a real one
        // spends a PBKDF2 derivation first, and that gap is the answer.
        const ok = account ? await verifyPassword(password, account) : false
        if (!ok) {
          const message = noteFailure('password', attemptKey, account, 'That email and password do not match.')
          await settleFailure(startedAt)
          throw new Error(message)
        }
        if (!account.active) throw new Error('This account is awaiting approval or has been deactivated.')
        clearAttempts('password', attemptKey)
        return api.startSession(account, 'Password')
      },

      /**
       * Pulls the staff list and roles down and merges them into local state.
       *
       * Only identity — never sales. Replacing the whole dataset here would
       * throw away anything this device took offline and has not yet synced,
       * which is precisely how a day's takings goes missing.
       */
      async refreshIdentity(authUser) {
        const sb = await getSupabase()
        if (!sb) return null

        const [staffResult, roleResult] = await Promise.all([
          sb.from('staff').select('*'),
          sb.from('roles').select('*'),
        ])
        // Surface a failed query rather than letting it look like an empty
        // table — the two need very different fixes and the message is the only
        // clue anyone gets.
        if (staffResult.error) throw new Error(`Could not read staff: ${staffResult.error.message}`)
        const staffRows = staffResult.data
        const roleRows = roleResult.data

        const users = (staffRows || []).map((row) => ({
          id: row.id,
          authId: row.auth_id,
          name: row.name,
          email: row.email,
          role: row.role,
          active: row.active,
          maxDiscountPercent: row.max_discount_percent ?? undefined,
          pinHash: row.pin_hash || '',
          pinSalt: row.pin_salt || '',
          createdAt: row.created_at,
        }))

        const roles = (roleRows || []).map((row) => ({
          id: row.id,
          name: row.name,
          description: row.description || '',
          system: row.system,
          permissions: row.permissions || [],
          maxDiscountPercent: Number(row.max_discount_percent) || 0,
        }))

        if (users.length) {
          setState((current) => ({
            ...current,
            users,
            roles: roles.length ? roles : current.roles,
          }))
        }

        return (
          users.find((entry) => entry.authId === authUser?.id) ||
          users.find((entry) => normaliseEmail(entry.email) === normaliseEmail(authUser?.email)) ||
          null
        )
      },

      async signUp({ name, email, password }) {
        guard()
        const current = stateRef.current
        const isFirstAccount = current.users.length === 0

        if (!isFirstAccount && !current.settings.signup?.enabled) {
          throw new Error('Sign-ups are turned off. Ask an admin to create your account.')
        }
        // Open sign-up plus an approval queue is an invitation to bury the
        // admin under a thousand pending accounts. The first account is exempt:
        // there is nobody to attack yet, and locking someone out of setting the
        // system up would be its own denial of service.
        if (!isFirstAccount) throttleGuard('signup', 'this-device')
        if (!name?.trim()) throw new Error('Enter your name.')

        const emailError = emailProblem(email)
        if (emailError) throw new Error(emailError)
        const passwordError = passwordProblem(password)
        if (passwordError) throw new Error(passwordError)

        if (current.users.some((entry) => normaliseEmail(entry.email) === normaliseEmail(email))) {
          throw new Error('An account already uses that email address.')
        }

        // Register with Supabase first: if the address is already taken there,
        // nothing should be written locally.
        let authId = null
        if (supabaseConfigured) {
          if (!navigator.onLine) {
            throw new Error('You need to be online to create an account.')
          }
          const sb = await getSupabase()
          const { data, error } = await sb.auth.signUp({
            email: normaliseEmail(email),
            password,
          })
          if (error) throw new Error(error.message)
          authId = data.user?.id || null
        }

        const credential = await createCredential(password)
        // The very first account owns the system, otherwise use the configured
        // default role and approval rule.
        const roleId = isFirstAccount ? 'admin' : current.settings.signup.defaultRole
        const role = current.roles.find((entry) => entry.id === roleId) || current.roles[0]
        const needsApproval = !isFirstAccount && current.settings.signup.requireApproval

        // A free PIN so the account can also use fast stall sign-in.
        const takenPins = new Set(current.users.map((entry) => entry.pin))
        let pin = ''
        for (let attempt = 0; attempt < 500 && !pin; attempt += 1) {
          const candidate = String(Math.floor(1000 + Math.random() * 9000))
          if (!takenPins.has(candidate)) pin = candidate
        }

        const account = {
          id: uid('usr'),
          authId,
          name: name.trim(),
          email: normaliseEmail(email),
          phone: '',
          role: role.id,
          pin,
          ...(await createPinCredential(pin)),
          active: !needsApproval,
          maxDiscountPercent: role.maxDiscountPercent ?? 0,
          createdAt: nowIso(),
          ...credential,
        }

        setState((draft) => {
          let next = { ...draft, users: [...draft.users, account] }
          next = withAuditAs(
            next,
            account,
            'Created account',
            `${account.email} · ${role.name}${needsApproval ? ' · awaiting approval' : ''}`,
          )
          if (needsApproval) {
            next = withNotification(
              next,
              'account',
              'New account awaiting approval',
              `${account.name} (${account.email}) signed up as ${role.name}.`,
              'warn',
            )
          }
          return withOutbox(next, 'user.signup', account.id, { id: account.id, email: account.email })
        })

        // Counted after the account exists, so a rejected password or a taken
        // address costs nothing — the limit is on accounts created, not on
        // attempts made.
        if (!isFirstAccount) recordFailure('signup', 'this-device')

        if (needsApproval) {
          return { account, pending: true }
        }
        api.startSession(account, 'Sign-up')
        return { account, pending: false }
      },

      async changePassword(userId, password) {
        const problem = passwordProblem(password)
        if (problem) throw new Error(problem)
        const credential = await createCredential(password)
        setState((current) => {
          const account = current.users.find((entry) => entry.id === userId)
          return withAudit(
            {
              ...current,
              users: current.users.map((entry) =>
                entry.id === userId ? { ...entry, ...credential } : entry,
              ),
            },
            'Changed password',
            account?.name || userId,
            'user',
            userId,
          )
        })
        toast('Password updated', 'success')
      },

      approveUser(userId) {
        setState((current) => {
          const account = current.users.find((entry) => entry.id === userId)
          if (!account) return current
          const record = { ...account, active: true }
          const draft = withAudit(
            {
              ...current,
              users: current.users.map((entry) => (entry.id === userId ? record : entry)),
            },
            'Approved account',
            account.name || userId,
            'user',
            userId,
          )
          // Approval is the switch that lets RLS see them at all, so it has to
          // reach the server, not just this device.
          return withOutbox(draft, 'user.save', uid('apr'), record)
        })
        toast('Account approved', 'success')
      },

      logout() {
        updateSession({ userId: null })
        // Drop the Supabase session too, but never block the sign-out on it —
        // offline, `signOut` cannot reach the server and the user still expects
        // the till to lock.
        if (supabaseConfigured) {
          getSupabase()
            .then((sb) => sb?.auth.signOut())
            .catch(() => {})
        }
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

      deleteProduct: (productId) => removeProducts([productId]),
      deleteProducts: removeProducts,

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

      deleteExhibition(exhibitionId, { returnStock = true, deleteSales = true } = {}) {
        // Resolve the fallback before mutating: setState updaters are deferred,
        // so stateRef would still be stale immediately after the call.
        const fallback = stateRef.current?.exhibitions.find((entry) => entry.id !== exhibitionId)
        setState((current) => {
          const exhibition = current.exhibitions.find((entry) => entry.id === exhibitionId)
          const salesCount = current.orders.filter((order) => order.exhibitionId === exhibitionId).length
          const next = deleteExhibition(current, { exhibitionId, returnStock, deleteSales })
          const draft = withAudit(
            next,
            'Deleted exhibition',
            `${exhibition?.name || exhibitionId} · ${
              deleteSales ? `${salesCount} sales removed` : 'sales kept'
            } · stock ${returnStock ? 'returned to warehouse' : 'discarded'}`,
            'exhibition',
            exhibitionId,
          )
          return withOutbox(draft, 'exhibition.delete', uid('del'), { exhibitionId, returnStock, deleteSales })
        })
        // The active exhibition must not point at something that no longer exists.
        if (session.exhibitionId === exhibitionId) {
          updateSession({ exhibitionId: fallback?.id || null })
        }
        toast('Exhibition deleted', 'warn')
      },

      deleteOrders(orderIds, { restoreStock = true } = {}) {
        let removed = 0
        let restored = 0
        setState((current) => {
          const invoices = current.orders
            .filter((order) => orderIds.includes(order.id))
            .map((order) => order.invoiceNo)
          const result = deleteOrders(current, { orderIds, restoreStock })
          removed = result.deleted
          restored = result.restored
          if (!removed) return current
          let next = withNotification(
            result.state,
            'refund',
            removed === 1 ? 'Sale deleted' : `${removed} sales deleted`,
            `${invoices.slice(0, 5).join(', ')}${invoices.length > 5 ? '…' : ''}${
              restored ? ` · ${restored} items returned to stock` : ''
            }`,
            'danger',
          )
          next = withAudit(
            next,
            removed === 1 ? 'Deleted sale' : `Deleted ${removed} sales`,
            `${invoices.join(', ').slice(0, 220)} · ${
              restoreStock ? `${restored} items restored` : 'stock not restored'
            }`,
            'order',
            orderIds.join(','),
          )
          return withOutbox(next, 'order.delete', uid('del'), { orderIds, restoreStock })
        })
        if (removed) {
          toast(
            `${removed} sale${removed === 1 ? '' : 's'} deleted${restored ? ` · ${restored} items back in stock` : ''}`,
            'warn',
          )
        }
        return removed
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

      deleteCustomer: (customerId) => removeCustomers([customerId]),
      deleteCustomers: removeCustomers,

      /** Trims movement log rows. Balances are left untouched by design. */
      deleteMovements(movementIds) {
        let removed = 0
        setState((current) => {
          removed = current.movements.filter((entry) => movementIds.includes(entry.id)).length
          if (!removed) return current
          return withAudit(
            { ...current, movements: current.movements.filter((entry) => !movementIds.includes(entry.id)) },
            `Deleted ${removed} stock movement${removed === 1 ? '' : 's'}`,
            'Log entries removed; stock balances unchanged',
            'inventory',
            movementIds.join(','),
          )
        })
        if (removed) toast(`${removed} movement${removed === 1 ? '' : 's'} removed from the log`, 'warn')
        return removed
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

            // Selling past the shelf count is a decision someone made, so it is
            // named in the log and raised to the owner rather than passing quietly.
            if (result.order.oversell) {
              const lines = result.order.oversell.lines
                .map((line) => `${line.name} (${line.requested} of ${line.available})`)
                .join(', ')
              next = withNotification(
                next,
                'stock',
                'Sold past available stock',
                `${result.order.invoiceNo} — ${lines}. Authorised by ${
                  result.order.oversell.by || 'an override'
                }.`,
                'danger',
              )
              next = withAudit(
                next,
                'Overrode stock limit',
                `${result.order.invoiceNo} · ${lines}`,
                'order',
                result.order.id,
              )
            }

            const promoDetail = result.order.promoCode ? ` · promo ${result.order.promoCode}` : ''
            next = withAudit(
              next,
              'Completed sale',
              `${result.order.invoiceNo} · ${result.order.total} · ${result.order.paymentMethod}${promoDetail}`,
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
          const reversed = money((order.amountPaid ?? order.total) - (order.refundedAmount || 0))
          const returnedUnits = order.items.reduce(
            (sum, item) => sum + (item.quantity - (item.returnedQuantity || 0)),
            0,
          )

          // The sale is void, so its promo code is available again.
          next = releasePromoUse(next, order.promoCode)

          next = {
            ...next,
            orders: next.orders.map((entry) =>
              entry.id === orderId ? { ...entry, status: 'Cancelled', note: reason } : entry,
            ),
            // Reverse only money that was actually taken, not the invoice total,
            // and give each method back what it took on a split sale.
            payments: [
              ...orderPaymentParts(order).map((part) => ({
                id: uid('ref'),
                orderId,
                invoiceNo: order.invoiceNo,
                method: part.method,
                amount: -money(
                  reversed * (order.amountPaid ? part.amount / order.amountPaid : 1),
                ),
                status: 'Cancelled',
                reference: reason || '',
                kind: 'refund',
                exhibitionId: order.exhibitionId,
                createdAt: nowIso(),
              })),
              ...next.payments,
            ],
            // Cancellations belong in the same ledger as returns — both are ways
            // a completed sale gets reversed, and the report covers both.
            returns: [
              {
                id: uid('ret'),
                kind: 'cancellation',
                orderId,
                invoiceNo: order.invoiceNo,
                exhibitionId: order.exhibitionId,
                customerId: order.customerId || null,
                customerName: order.customerName,
                salespersonName: order.salespersonName,
                lines: order.items
                  .filter((item) => item.quantity - (item.returnedQuantity || 0) > 0)
                  .map((item) => ({
                    variantId: item.variantId,
                    name: item.name,
                    sku: item.sku,
                    category: item.category || '',
                    quantity: item.quantity - (item.returnedQuantity || 0),
                  })),
                quantity: returnedUnits,
                refundAmount: reversed,
                balanceCleared: money(order.balanceDue || 0),
                method: order.paymentMethod,
                reason: reason || '',
                userId: user?.id || '',
                userName: user?.name || '',
                createdAt: nowIso(),
              },
              ...(next.returns || []),
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
      async saveUser(account) {
        // Hash here rather than in the form, so every path that saves a user —
        // the staff editor, sign-up, anything added later — gets it. A plaintext
        // `pin` on the way in is replaced, never stored and never synced.
        const { pin, ...rest } = account
        const account_ = /^\d{4,6}$/.test(String(pin || ''))
          ? { ...rest, ...(await createPinCredential(pin)) }
          : account

        setState((current) => {
          const exists = current.users.some((entry) => entry.id === account_.id)
          const record = exists ? account_ : { ...account_, createdAt: nowIso() }
          const users = exists
            ? current.users.map((entry) => (entry.id === account_.id ? record : entry))
            : [record, ...current.users]
          const draft = withAudit(
            { ...current, users },
            exists ? 'Updated user' : 'Created user',
            `${account_.name} (${account_.role})`,
            'user',
            account_.id,
          )
          return withOutbox(draft, 'user.save', account_.id, record)
        })
        toast(`Saved ${account_.name}`, 'success')
      },

      deleteUser(userId) {
        setState((current) => {
          const draft = withAudit(
            { ...current, users: current.users.filter((entry) => entry.id !== userId) },
            'Deleted user',
            userId,
            'user',
            userId,
          )
          return withOutbox(draft, 'user.delete', uid('del'), { userId })
        })
      },

      /* roles */
      saveRole(role) {
        let error = null
        setState((current) => {
          const exists = current.roles.some((entry) => entry.id === role.id)
          const roles = exists
            ? current.roles.map((entry) => (entry.id === role.id ? role : entry))
            : [...current.roles, role]

          // Never allow a change that leaves nobody able to reach Settings.
          if (wouldLoseAdminAccess(current.users, roles)) {
            error = new Error(
              'That would leave no active user with access to Settings. Give another role admin access first.',
            )
            return current
          }

          return withAudit(
            { ...current, roles },
            exists ? 'Updated role' : 'Created role',
            `${role.name} · ${role.permissions.includes('*') ? 'full access' : `${role.permissions.length} permissions`}`,
            'role',
            role.id,
          )
        })
        if (error) throw error
        toast(`Role "${role.name}" saved`, 'success')
      },

      deleteRole(roleId, reassignTo) {
        let error = null
        setState((current) => {
          const role = current.roles.find((entry) => entry.id === roleId)
          if (!role) return current
          if (role.system) {
            error = new Error('Built-in roles cannot be deleted.')
            return current
          }

          const users = current.users.map((entry) =>
            entry.role === roleId ? { ...entry, role: reassignTo } : entry,
          )
          const roles = current.roles.filter((entry) => entry.id !== roleId)

          if (wouldLoseAdminAccess(users, roles)) {
            error = new Error('That would leave no active user with access to Settings.')
            return current
          }

          const moved = current.users.filter((entry) => entry.role === roleId).length
          return withAudit(
            { ...current, users, roles },
            'Deleted role',
            `${role.name}${moved ? ` · ${moved} user(s) moved to ${reassignTo}` : ''}`,
            'role',
            roleId,
          )
        })
        if (error) throw error
        toast('Role deleted', 'warn')
      },

      /* promo codes */
      savePromoCode(promo) {
        let error = null
        const code = String(promo.code || '').trim().toUpperCase()
        setState((current) => {
          if (!code) {
            error = new Error('Give the code a name, for example STALL10.')
            return current
          }
          if (!(Number(promo.value) > 0)) {
            error = new Error('A promo code has to take something off.')
            return current
          }
          if (promo.type === 'percentage' && Number(promo.value) > 100) {
            error = new Error('A percentage code cannot be more than 100%.')
            return current
          }
          const clash = current.promoCodes.some(
            (entry) => entry.id !== promo.id && String(entry.code).toUpperCase() === code,
          )
          if (clash) {
            error = new Error(`${code} is already in use.`)
            return current
          }

          const exists = current.promoCodes.some((entry) => entry.id === promo.id)
          const record = {
            ...promo,
            code,
            value: Number(promo.value) || 0,
            minSpend: Number(promo.minSpend) || 0,
            usageLimit: Number(promo.usageLimit) || 0,
            usedCount: promo.usedCount || 0,
          }
          const promoCodes = exists
            ? current.promoCodes.map((entry) => (entry.id === promo.id ? record : entry))
            : [{ ...record, createdAt: nowIso() }, ...current.promoCodes]

          const draft = withAudit(
            { ...current, promoCodes },
            exists ? 'Updated promo code' : 'Created promo code',
            `${code} · ${record.type === 'percentage' ? `${record.value}%` : record.value} off${
              record.active ? '' : ' · inactive'
            }`,
            'promo',
            promo.id,
          )
          return withOutbox(draft, 'promo.save', promo.id, record)
        })
        if (error) throw error
        toast(`Promo code ${code} saved`, 'success')
      },

      deletePromoCode(promoId) {
        setState((current) => {
          const promo = current.promoCodes.find((entry) => entry.id === promoId)
          if (!promo) return current
          const draft = withAudit(
            { ...current, promoCodes: current.promoCodes.filter((entry) => entry.id !== promoId) },
            'Deleted promo code',
            `${promo.code}${promo.usedCount ? ` · used ${promo.usedCount} time(s)` : ''}`,
            'promo',
            promoId,
          )
          return withOutbox(draft, 'promo.delete', uid('del'), { promoId })
        })
        toast('Promo code deleted', 'warn')
      },

      /* devices */

      renameDevice(targetId, label) {
        setState((current) => ({
          ...current,
          devices: (current.devices || []).map((entry) =>
            entry.id === targetId ? { ...entry, label: String(label || '').trim() } : entry,
          ),
        }))
      },

      /**
       * Cuts a device off. It cannot sign anyone in, and if it is online it
       * signs itself out the moment it sees this.
       */
      revokeDevice(targetId) {
        let name = ''
        setState((current) => {
          const device = (current.devices || []).find((entry) => entry.id === targetId)
          if (!device || device.revokedAt) return current
          name = device.label || device.code
          const draft = {
            ...current,
            devices: current.devices.map((entry) =>
              entry.id === targetId ? { ...entry, revokedAt: nowIso() } : entry,
            ),
          }
          return withAudit(
            draft,
            'Blocked a device',
            `${name}${device.lastUserName ? ` · last used by ${device.lastUserName}` : ''}`,
            'device',
            targetId,
          )
        })
        if (name) toast(`${name} blocked`, 'warn')
      },

      restoreDevice(targetId) {
        setState((current) => {
          const device = (current.devices || []).find((entry) => entry.id === targetId)
          if (!device) return current
          return withAudit(
            {
              ...current,
              devices: current.devices.map((entry) =>
                entry.id === targetId ? { ...entry, revokedAt: null } : entry,
              ),
            },
            'Restored a device',
            device.label || device.code,
            'device',
            targetId,
          )
        })
        toast('Device restored', 'success')
      },

      /** Drops a device from the list. It re-registers if it is still in use. */
      forgetDevice(targetId) {
        setState((current) => ({
          ...current,
          devices: (current.devices || []).filter((entry) => entry.id !== targetId),
        }))
        toast('Device removed from the list', 'warn')
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
      async resetAllData() {
        const fresh = await buildSeedState()
        setStateRaw(fresh)
        persist(fresh)
        updateSession({ userId: null, exhibitionId: null })
        toast('All data cleared', 'success')
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

    return api
  }, [
    setState,
    withAudit,
    withAuditAs,
    withNotification,
    withOutbox,
    toast,
    user,
    session.exhibitionId,
    deviceId,
    deviceCode,
    updateSession,
    persist,
  ])

  const value = useMemo(
    () => ({
      state,
      session,
      user,
      activeExhibition,
      // Where stock is taken from. With no exhibition chosen the POS sells
      // straight from the main warehouse.
      sellLocationId: activeExhibition?.id || MAIN_LOCATION,
      sellLocationName: activeExhibition?.name || 'Direct sales',
      sellingAtExhibition: Boolean(activeExhibition),
      online,
      syncing,
      deviceId,
      deviceCode,
      currentDevice,
      pendingSync: state?.outbox.filter((entry) => entry.status === 'pending').length || 0,
      toasts,
      actions,
      roles: state?.roles || DEFAULT_ROLES,
      can: (permission) => userCan(user, state?.roles, permission),
    }),
    [state, session, user, activeExhibition, online, syncing, deviceId, deviceCode, currentDevice, toasts, actions],
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
