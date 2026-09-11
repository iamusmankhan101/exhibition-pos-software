/**
 * Merging a cloud pull into local state.
 *
 * Sync was push-only. Every mutation went up through the outbox, and the only
 * thing that ever came back down was the one-shot catalogue pull a brand-new
 * device runs at first sign-in (`adoptCatalogue`, which refuses to run on a
 * device that already holds anything). So two tills that had both been set up
 * never saw each other's work — the laptop's new products never reached the
 * phone, the phone's sales never reached the laptop's reports — which is
 * exactly the "not syncing across devices" this fixes.
 *
 * The one rule everything here follows: a device may never lose work it has
 * not sent yet.
 *
 *  - History (orders, payments, returns, stock movements, audit) is append-only,
 *    so it unions by id. A row on the server this device has not seen is added;
 *    a row on this device the server has not got is kept, because that is a sale
 *    still sitting in the queue.
 *  - The catalogue (products, customers, exhibitions, promos, devices) is
 *    mutable and carries no per-row version, so the server wins — but only
 *    while the outbox is empty. With anything pending, this device's copy is by
 *    definition newer than the server's, so the catalogue is left alone until
 *    the queue drains, which normally takes a few seconds.
 *  - Inventory is a running balance rather than a record, and both sides stamp
 *    `updatedAt` whenever they move one, so the newer stamp wins cell by cell.
 *
 * Staff and roles are deliberately absent: the pulled staff row is mapped for
 * display and carries no `pin_hash`, so letting it land here would break PIN
 * sign-in on the device. `refreshIdentity` owns that list and reads the column.
 *
 * Everything else in state belongs to this device alone — the session, its
 * notifications, the invoice counter, the outbox itself — and is never touched.
 */

/** Append-only: a row is never edited in place, so a union can never lose one. */
const HISTORY = ['orders', 'payments', 'returns', 'movements', 'auditLogs']

/** Mutable, and with no per-row version to compare, so the server wins. */
const CATALOGUE = ['products', 'customers', 'exhibitions', 'promoCodes', 'devices']

/**
 * Is there anything on this device the server has not got?
 *
 * `blocked` counts. An entry the server refused is every bit as unsent as one
 * still waiting its turn, and it is the local record that is ahead — so letting
 * a pull overwrite the catalogue while one is outstanding would quietly undo
 * the change somebody made.
 */
export const hasPendingWork = (state) =>
  (state?.outbox || []).some((entry) => entry.status === 'pending' || entry.status === 'blocked')

/**
 * Deep equality, used only to decide whether the merge changed anything.
 *
 * Worth the walk: without it every refresh would write the whole state blob —
 * product images included — back to IndexedDB and re-render the app, on a
 * timer, forever. `Object.is` short-circuits the expensive case, because a
 * product whose image the pull did not re-fetch keeps the very string the
 * device already held.
 */
function same(a, b) {
  if (Object.is(a, b)) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((row, i) => same(row, b[i]))
  }
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => same(a[key], b[key]))
}

/** Newest first — the order every screen reads these collections in. */
const byNewest = (a, b) => String(b?.createdAt || '').localeCompare(String(a?.createdAt || ''))

/**
 * Server rows and local rows, keyed by id.
 *
 * A row on both sides is merged as `{ ...local, ...server }` rather than
 * replaced outright, so a column the pull chose not to fetch keeps the value
 * this device already has. That is what lets the refresh skip re-downloading a
 * product image it has already got: the key is absent from the server row, so
 * the local one survives the spread.
 *
 * Nothing is ever dropped for being absent from the server. It is not possible
 * to tell a row deleted on another till from one created here and not yet sent,
 * and a device whose catalogue predates the backend has a queue that says it is
 * fully synced while the server has never seen any of it — so guessing here
 * would eventually mean wiping a shop's products off its own till. A delete
 * made elsewhere therefore has to be repeated on each device for now.
 *
 * `order` keeps history newest-first, the way every screen reads it, and leaves
 * the catalogue in the order the device already had it: rows come off the pull
 * with no `createdAt` at all, so sorting them would shuffle the products list
 * under the user for no gain.
 */
function unionById(local, server, { preferServer, sorted }) {
  const mine = new Map(local.map((row) => [row?.id, row]))
  const fromServer = new Map()
  for (const row of server) {
    if (!row || fromServer.has(row.id)) continue
    const held = mine.get(row.id)
    fromServer.set(row.id, !held ? row : preferServer ? { ...held, ...row } : held)
  }

  // Local order first, so a list on screen stays where it was, then whatever
  // the server had that this device has never seen.
  const merged = []
  const seen = new Set()
  for (const row of local) {
    if (!row || seen.has(row.id)) continue
    seen.add(row.id)
    merged.push(fromServer.get(row.id) || row)
  }
  for (const [id, row] of fromServer) {
    if (seen.has(id)) continue
    seen.add(id)
    merged.push(row)
  }
  return sorted ? merged.sort(byNewest) : merged
}

/**
 * Stock balances, newest stamp per cell.
 *
 * Phase 1 treats each till as authoritative for its own stock, so this is
 * last-writer-wins by design: it converges two devices that sold from the same
 * shelf without either one's count vanishing, and it is the local cell that
 * wins whenever this device has an unpushed sale, because that sale stamped it
 * a moment ago.
 */
function mergeInventory(local, server) {
  const merged = {}
  for (const key of new Set([...Object.keys(local), ...Object.keys(server)])) {
    const mine = local[key]
    const theirs = server[key]
    if (!mine || !theirs) merged[key] = mine || theirs
    else merged[key] = String(theirs.updatedAt || '') > String(mine.updatedAt || '') ? theirs : mine
  }
  return merged
}

/**
 * Folds a pull into local state.
 *
 * Returns the state unchanged — the same object, not a copy — when the server
 * had nothing this device did not already know, so the caller can skip the
 * persist and the re-render entirely.
 */
export function mergeCloud(local, pulled) {
  const pending = hasPendingWork(local)
  const next = { ...local }
  let changed = false

  const take = (key, value) => {
    if (same(local[key], value)) return
    next[key] = value
    changed = true
  }

  // Safe with a full queue: a union only ever adds rows this device is missing,
  // and with work pending the local copy of a row it already has stays put.
  for (const key of HISTORY) {
    take(key, unionById(local[key] || [], pulled[key] || [], { preferServer: !pending, sorted: true }))
  }

  if (!pending) {
    for (const key of CATALOGUE) {
      take(key, unionById(local[key] || [], pulled[key] || [], { preferServer: true, sorted: false }))
    }
    // Absent rather than undefined when the server has never written a settings
    // row — spreading that over the state would blank the local defaults.
    if (pulled.settings) take('settings', { ...local.settings, ...pulled.settings })
  }

  take('inventory', mergeInventory(local.inventory || {}, pulled.inventory || {}))

  return { state: changed ? next : local, changed }
}
