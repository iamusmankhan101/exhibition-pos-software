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
 *    mutable and carries no per-row version, so the server wins — except for
 *    the rows a queued command is still holding newer data for, which are named
 *    by `unsentCatalogue` and left alone until it drains. Row by row rather
 *    than wholesale: a queue that cannot drain must not mean a device never
 *    sees another till's products again.
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

/** Still waiting to reach the server, whether it is queued or was refused. */
const unsent = (entry) => entry?.status === 'pending' || entry?.status === 'blocked'

/**
 * Which catalogue rows a queued command is holding newer data for.
 *
 * The whole catalogue used to stand still whenever the outbox had anything in
 * it, which is right for the few seconds a queue normally takes to drain and
 * wrong for ever afterwards. A `blocked` entry is unsent by definition and is
 * only ever cleared by somebody pressing retry on the Activity screen — so one
 * refused change meant this device never saw another product, customer,
 * exhibition or promo from any other till again. Sales still arrived, which is
 * what made it look like the catalogue alone had stopped.
 *
 * Only the rows a queued command actually names need protecting, so that is
 * what is protected. Everything else is free to come down.
 *
 * The delete commands are here for completeness rather than need: a delete also
 * writes a tombstone, and `buried` already outranks anything the server says.
 */
const CATALOGUE_IDS = {
  'product.save': (entry) => [entry.payload?.id],
  'product.delete': (entry) => entry.payload?.productIds,
  'customer.save': (entry) => [entry.payload?.id],
  'customer.delete': (entry) => entry.payload?.customerIds,
  'exhibition.save': (entry) => [entry.payload?.id],
  'exhibition.close': (entry) => [entry.clientId],
  'exhibition.delete': (entry) => [entry.payload?.exhibitionId],
  'promo.save': (entry) => [entry.payload?.id],
  'promo.delete': (entry) => [entry.payload?.promoId],
}

/**
 * Commands that are known not to carry catalogue data.
 *
 * Listed rather than assumed. A command this file has never heard of might be
 * holding a product edit, and letting the server win over it would be the one
 * thing the merge must never do — so an unrecognised type falls back to holding
 * the whole catalogue still, exactly as before. Adding a command without
 * touching this list is therefore safe; it only costs the narrower behaviour.
 */
const NON_CATALOGUE = new Set([
  'order.create', 'order.settle', 'order.refund', 'order.delete',
  'stock.transfer', 'stock.adjust',
  'user.signup', 'user.save', 'user.delete', 'role.save', 'role.delete',
  'settings.save',
])

/** Ids whose local copy must survive the pull, or `null` to hold everything. */
function unsentCatalogue(state) {
  const ids = new Set()
  for (const entry of state?.outbox || []) {
    if (!unsent(entry)) continue
    const read = CATALOGUE_IDS[entry.type]
    if (read) {
      for (const id of read(entry) || []) if (id) ids.add(id)
      continue
    }
    // Not a command we can place. Assume the worst and hold the lot.
    if (!NON_CATALOGUE.has(entry.type)) return null
  }
  return ids
}

/**
 * Settings carry no id, so they are all or nothing: a queued `settings.save`
 * means this device holds the newer copy of every field in the row.
 */
const hasUnsentSettings = (state) =>
  (state?.outbox || []).some((entry) => unsent(entry) && entry.type === 'settings.save')

/** Commands that write the staff or roles tables. */
const IDENTITY = new Set(['user.signup', 'user.save', 'user.delete', 'role.save', 'role.delete'])

/**
 * Is there an account or role here the server has not got?
 *
 * `refreshIdentity` replaces the staff list wholesale, so it has to wait for
 * these — and only for these. Anything else in the queue is irrelevant to it,
 * and treating it otherwise meant one refused sale stopped a device ever
 * learning about a new colleague.
 */
export const hasUnsentIdentity = (state) =>
  (state?.outbox || []).some((entry) => unsent(entry) && IDENTITY.has(entry.type))

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
 * Nothing is ever dropped for being *absent* from the server. It is not possible
 * to tell a row deleted on another till from one created here and not yet sent,
 * and a device whose catalogue predates the backend has a queue that says it is
 * fully synced while the server has never seen any of it — so guessing from
 * absence would eventually mean wiping a shop's products off its own till.
 *
 * A row in `buried` is different, and is the only thing that may remove one. It
 * is there because somebody deleted it: either this device, or another till
 * that wrote a gravestone to the `deletions` table. That is a fact rather than
 * an inference, which is what makes acting on it safe.
 *
 * The reverse is not a guess, and `buried` is what makes it safe: a row this
 * device deleted is remembered by id, so the server's copy is skipped rather
 * than welcomed back as something we were missing. Without it a deleted sale
 * reappeared within seconds — the delete command was usually still sitting in
 * the queue, so the server still had the row, and the union dutifully restored
 * it.
 *
 * `order` keeps history newest-first, the way every screen reads it, and leaves
 * the catalogue in the order the device already had it: rows come off the pull
 * with no `createdAt` at all, so sorting them would shuffle the products list
 * under the user for no gain.
 */
function unionById(local, server, { preferServer, sorted, buried, keepLocal = null }) {
  const mine = new Map(local.map((row) => [row?.id, row]))
  const fromServer = new Map()
  for (const row of server) {
    if (!row || fromServer.has(row.id) || buried.has(row.id)) continue
    const held = mine.get(row.id)
    // `keepLocal` names the rows a queued command is holding newer data for.
    // A row the server has and this device does not is still welcome — being
    // behind on one product says nothing about the rest of the catalogue.
    const take = preferServer && !keepLocal?.has(row.id)
    fromServer.set(row.id, !held ? row : take ? { ...held, ...row } : held)
  }

  // Local order first, so a list on screen stays where it was, then whatever
  // the server had that this device has never seen.
  const merged = []
  const seen = new Set()
  for (const row of local) {
    if (!row || seen.has(row.id)) continue
    seen.add(row.id)
    // Dropped, not kept: a buried id is either one this device deleted (in
    // which case the row is already gone and this costs nothing) or one another
    // till deleted, which is how a deletion finally reaches this device at all.
    if (buried.has(row.id)) continue
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
  // What this device deleted, plus what every other till has. A deletion the
  // server is holding is explicit evidence — unlike absence, which is equally
  // consistent with a row this device made and has not sent yet — so it is the
  // one thing a pull is allowed to remove local rows for.
  const deleted = pulled.deletions || {}
  const buried = new Set([...Object.keys(local.tombstones || {}), ...Object.keys(deleted)])
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
    take(key, unionById(local[key] || [], pulled[key] || [], { preferServer: !pending, sorted: true, buried }))
  }

  // `null` means there is queued work this file cannot place, so the whole
  // catalogue stands still. A set — usually an empty one — means only the rows
  // it names are held back and everything else may land.
  const keepLocal = unsentCatalogue(local)
  if (keepLocal) {
    for (const key of CATALOGUE) {
      take(key, unionById(local[key] || [], pulled[key] || [], { preferServer: true, sorted: false, buried, keepLocal }))
    }
    // Absent rather than undefined when the server has never written a settings
    // row — spreading that over the state would blank the local defaults.
    if (pulled.settings && !hasUnsentSettings(local)) {
      take('settings', { ...local.settings, ...pulled.settings })
    }
  }

  take('inventory', mergeInventory(local.inventory || {}, pulled.inventory || {}))

  return { state: changed ? next : local, changed }
}
