/**
 * Sign-in throttling.
 *
 * The login screen is the one place an untrusted person is invited to submit
 * whatever they like, over and over. Nothing else in the app has that shape, so
 * the countermeasures live here rather than being sprinkled through the store.
 *
 * Three things are being defended against:
 *
 *  - Password guessing. Slow, because PBKDF2 already costs the attacker real
 *    work, but a weak password falls to a wordlist given enough tries.
 *  - PIN guessing. Four digits is ten thousand combinations, which a script
 *    walks in seconds. This is the serious one, and it gets the tightest rules.
 *  - Address cycling. An attacker who is locked out of one account simply moves
 *    to the next, so failures also accumulate against the device itself.
 *
 * Honest limit, stated plainly: with no server of our own, this runs on the
 * attacker's machine and a determined one can clear `localStorage` or read the
 * hashes out of IndexedDB directly. It stops the realistic attack — somebody
 * left alone with the tablet, or a script driving the form — and it makes the
 * attempts visible in the audit log. Real enforcement needs the server, which
 * is why `signIn` prefers Supabase whenever it is configured; its own limiter
 * sits behind this one and cannot be reset from the browser.
 */

const STORAGE_KEY = 'tareez.attempts'

/** Failures older than a bucket's window are forgiven. */
const HOUR = 60 * 60 * 1000

/**
 * Per-kind rules. `free` attempts pass without delay — people mistype, and a
 * salesperson at a busy stall should not be punished for it — after which each
 * further failure takes the next rung of the ladder, holding at the last one.
 */
export const RULES = {
  /** Passwords are long and hashed; a handful of typos is normal. */
  password: {
    free: 4,
    ladder: [15_000, 30_000, 60_000, 5 * 60_000, 15 * 60_000],
    window: 15 * 60_000,
  },
  /**
   * Four digits, so the ladder starts biting almost immediately. Even the
   * gentlest rung here caps a script at a few hundred guesses a day against a
   * ten-thousand-wide space.
   */
  pin: {
    free: 3,
    ladder: [10_000, 30_000, 2 * 60_000, 10 * 60_000],
    window: 10 * 60_000,
  },
  /**
   * Sign-up is not a guessing target, so this counts successes rather than
   * failures: it caps how many accounts one device can create in an hour.
   * `isolated` keeps it out of the shared device counter — creating accounts is
   * not evidence that somebody is trying to break into one.
   */
  signup: {
    free: 3,
    ladder: [60_000, 5 * 60_000, 30 * 60_000],
    window: HOUR,
    isolated: true,
  },
  /**
   * Every failure of any kind also lands here, so working down a staff list one
   * account at a time is no cheaper than hammering a single one. The allowance
   * is wider because a shared stall device legitimately sees several people
   * fumble their PIN in a morning.
   */
  device: {
    free: 10,
    ladder: [30_000, 2 * 60_000, 10 * 60_000, 30 * 60_000],
    window: 30 * 60_000,
  },
}

/* --------------------------------------------------------------- storage */

/**
 * `localStorage` when there is one, an in-memory map otherwise.
 *
 * Persisting matters: a counter held in React state is cleared by a page
 * reload, which is the first thing anybody trying PINs by hand would do.
 */
const memory = new Map()

function readAll() {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    if (raw != null) return JSON.parse(raw) || {}
  } catch {
    // Private mode, disabled storage, or a corrupt blob — fall through to
    // memory rather than letting the login screen fail to render.
  }
  return Object.fromEntries(memory)
}

function writeAll(buckets) {
  memory.clear()
  for (const [key, value] of Object.entries(buckets)) memory.set(key, value)
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(buckets))
  } catch {
    // Memory copy above is still authoritative for this page load.
  }
}

const keyFor = (kind, id) => `${kind}:${String(id ?? '').toLowerCase()}`

/* ----------------------------------------------------------------- rules */

function lockFor(rule, failures) {
  const over = failures - rule.free
  if (over <= 0) return 0
  return rule.ladder[Math.min(over, rule.ladder.length) - 1]
}

/**
 * Milliseconds still to wait on a bucket.
 *
 * Clamped to the length of the lock that was actually imposed, so winding the
 * device clock backwards cannot turn a thirty-second wait into a permanent one,
 * and — the direction that matters — a bucket whose `lockedUntil` has been left
 * behind by a backwards jump still holds for its remaining time.
 */
function remaining(bucket, now) {
  if (!bucket?.lockedUntil) return 0
  return Math.max(0, Math.min(bucket.lockedUntil - now, bucket.lockMs || 0))
}

function live(bucket, rule, now) {
  if (!bucket) return null
  // A bucket under an active lock survives regardless of age; the window only
  // forgives quiet periods.
  if (remaining(bucket, now) > 0) return bucket
  if (now - (bucket.lastFailureAt || 0) > rule.window) return null
  return bucket
}

/* ------------------------------------------------------------------- api */

/**
 * Current standing of one bucket, without changing anything.
 *
 * `retryAfterMs` is what the caller shows and counts down; `failures` is there
 * for the audit trail.
 */
export function attemptStatus(kind, id, now = Date.now()) {
  const rule = RULES[kind]
  if (!rule) return { blocked: false, retryAfterMs: 0, failures: 0 }
  const bucket = live(readAll()[keyFor(kind, id)], rule, now)
  const retryAfterMs = remaining(bucket, now)
  return {
    blocked: retryAfterMs > 0,
    retryAfterMs,
    failures: bucket?.failures || 0,
  }
}

/**
 * The check a sign-in makes before spending any effort on the credential.
 *
 * Returns the blocking bucket — the account's own or the device's, whichever
 * has longer to run — or null when the attempt may proceed.
 */
export function blockedBy(kind, id, now = Date.now()) {
  const own = attemptStatus(kind, id, now)
  if (RULES[kind]?.isolated) return own.blocked ? { ...own, scope: kind } : null
  const device = attemptStatus('device', 'this-device', now)
  const worst = device.retryAfterMs > own.retryAfterMs ? { ...device, scope: 'device' } : { ...own, scope: kind }
  return worst.blocked ? worst : null
}

/**
 * Records a failed attempt against both the account and the device.
 *
 * Returns the account bucket's new standing, which is what the message on the
 * form is written from.
 */
export function recordFailure(kind, id, now = Date.now()) {
  const buckets = prune(readAll(), now)
  const bump = (bucketKind, bucketId) => {
    const rule = RULES[bucketKind]
    const key = keyFor(bucketKind, bucketId)
    const previous = live(buckets[key], rule, now)
    const failures = (previous?.failures || 0) + 1
    const lockMs = lockFor(rule, failures)
    buckets[key] = {
      failures,
      lastFailureAt: now,
      // An existing lock is never shortened by a fresh failure.
      lockedUntil: Math.max(now + lockMs, previous?.lockedUntil || 0),
      lockMs: Math.max(lockMs, remaining(previous, now)),
    }
    return { blocked: lockMs > 0, retryAfterMs: remaining(buckets[key], now), failures }
  }

  const own = bump(kind, id)
  const device =
    kind === 'device' || RULES[kind]?.isolated ? own : bump('device', 'this-device')
  writeAll(buckets)
  return device.retryAfterMs > own.retryAfterMs ? { ...device, scope: 'device', failures: own.failures } : { ...own, scope: kind }
}

/**
 * Wipes a bucket after a successful sign-in.
 *
 * The device bucket is cleared too: somebody who can actually authenticate has
 * demonstrated they are not the attacker the counter was there for, and leaving
 * it standing would let one person's bad morning lock out the whole stall.
 */
export function clearAttempts(kind, id) {
  const buckets = readAll()
  delete buckets[keyFor(kind, id)]
  delete buckets[keyFor('device', 'this-device')]
  writeAll(buckets)
}

/** Drops buckets that are neither locked nor recent, so the blob stays small. */
function prune(buckets, now) {
  const kept = {}
  for (const [key, bucket] of Object.entries(buckets)) {
    const rule = RULES[key.split(':')[0]]
    if (rule && live(bucket, rule, now)) kept[key] = bucket
  }
  return kept
}

/** "45 seconds" / "3 minutes" — a wait nobody has to decode. */
export function describeWait(ms) {
  const seconds = Math.ceil(ms / 1000)
  if (seconds < 60) return `${seconds} second${seconds === 1 ? '' : 's'}`
  const minutes = Math.ceil(seconds / 60)
  return `${minutes} minute${minutes === 1 ? '' : 's'}`
}

/** The message the form shows while a lock is running. */
export function lockMessage(status) {
  const wait = describeWait(status.retryAfterMs)
  return status.scope === 'device'
    ? `Too many failed sign-ins on this device. Try again in ${wait}.`
    : `Too many failed attempts. Try again in ${wait}.`
}

/**
 * Holds a failed attempt open for a fixed floor.
 *
 * Two reasons. It flattens the difference between "no such account" (instant)
 * and "wrong password" (a PBKDF2 derivation), which otherwise tells an attacker
 * which addresses are real. And it puts a hard ceiling on attempts per second
 * before the ladder above has even engaged.
 */
export async function settleFailure(startedAt, floorMs = 600) {
  const elapsed = Date.now() - startedAt
  if (elapsed < floorMs) {
    await new Promise((resolve) => setTimeout(resolve, floorMs - elapsed))
  }
}
