/**
 * Sign-in throttling. These are the rules that decide how many guesses an
 * attacker gets at a four-digit PIN, so they are worth pinning down exactly.
 */

import { beforeEach, describe, expect, it } from 'vitest'
import {
  RULES,
  attemptStatus,
  blockedBy,
  clearAttempts,
  describeWait,
  recordFailure,
} from './throttle.js'

/** Fresh buckets between tests; the module falls back to memory under Node. */
beforeEach(() => {
  clearAttempts('password', 'a@b.com')
  clearAttempts('password', 'c@d.com')
  clearAttempts('pin', 'usr_1')
  clearAttempts('pin', 'usr_2')
  clearAttempts('signup', 'this-device')
})

const fail = (kind, id, times, now) => {
  let last
  for (let i = 0; i < times; i += 1) last = recordFailure(kind, id, now)
  return last
}

describe('lockouts', () => {
  it('lets an honest typo through untouched', () => {
    const now = Date.now()
    fail('pin', 'usr_1', RULES.pin.free, now)
    expect(blockedBy('pin', 'usr_1', now)).toBe(null)
  })

  it('locks the moment the free attempts run out', () => {
    const now = Date.now()
    const status = fail('pin', 'usr_1', RULES.pin.free + 1, now)
    expect(status.blocked).toBe(true)
    expect(blockedBy('pin', 'usr_1', now).retryAfterMs).toBe(RULES.pin.ladder[0])
  })

  it('escalates, so each further guess costs more than the last', () => {
    const now = Date.now()
    const waits = RULES.pin.ladder.map((_, index) => {
      clearAttempts('pin', 'usr_1')
      return fail('pin', 'usr_1', RULES.pin.free + index + 1, now).retryAfterMs
    })
    expect(waits).toEqual(RULES.pin.ladder)
  })

  it('holds at the last rung rather than running away forever', () => {
    const now = Date.now()
    fail('pin', 'usr_1', RULES.pin.free + RULES.pin.ladder.length + 20, now)
    // Read the account's own bucket: by this point the device-wide one is also
    // locked, and `recordFailure` reports whichever wait is longer.
    expect(attemptStatus('pin', 'usr_1', now).retryAfterMs).toBe(
      RULES.pin.ladder[RULES.pin.ladder.length - 1],
    )
  })

  it('expires the lock once the wait has actually passed', () => {
    const now = Date.now()
    fail('pin', 'usr_1', RULES.pin.free + 1, now)
    expect(blockedBy('pin', 'usr_1', now + RULES.pin.ladder[0] + 1)).toBe(null)
  })

  it('forgives a quiet spell, so yesterday is not still held against anyone', () => {
    const now = Date.now()
    fail('pin', 'usr_1', RULES.pin.free, now)
    const later = now + RULES.pin.window + 1
    expect(attemptStatus('pin', 'usr_1', later).failures).toBe(0)
  })

  it('caps a rate-limited PIN well under the ten thousand combinations', () => {
    const now = Date.now()
    const slowest = RULES.pin.ladder[RULES.pin.ladder.length - 1]
    const guessesPerDay = RULES.pin.free + (24 * 60 * 60 * 1000) / slowest
    expect(guessesPerDay).toBeLessThan(200)
  })
})

describe('scope', () => {
  it('does not lock a colleague out because one person forgot their PIN', () => {
    const now = Date.now()
    fail('pin', 'usr_1', RULES.pin.free + 1, now)
    expect(blockedBy('pin', 'usr_2', now)).toBe(null)
  })

  it('still catches an attacker working down the staff list', () => {
    const now = Date.now()
    // Spread across enough accounts that no single one ever locks.
    for (let account = 0; account < 6; account += 1) {
      fail('pin', `usr_spread_${account}`, RULES.pin.free, now)
    }
    const blocked = blockedBy('pin', 'usr_untouched', now)
    expect(blocked?.scope).toBe('device')
    for (let account = 0; account < 6; account += 1) clearAttempts('pin', `usr_spread_${account}`)
  })

  it('clears the device counter for anyone who can actually sign in', () => {
    const now = Date.now()
    fail('password', 'a@b.com', RULES.password.free + 1, now)
    clearAttempts('password', 'a@b.com')
    expect(blockedBy('password', 'a@b.com', now)).toBe(null)
    expect(blockedBy('password', 'c@d.com', now)).toBe(null)
  })

  it('keeps sign-up spam out of the sign-in counter', () => {
    const now = Date.now()
    fail('signup', 'this-device', RULES.signup.free + 1, now)
    expect(blockedBy('signup', 'this-device', now).blocked).toBe(true)
    expect(blockedBy('password', 'a@b.com', now)).toBe(null)
  })
})

describe('clock tampering', () => {
  it('does not release a lock when the device clock is wound backwards', () => {
    const now = Date.now()
    fail('pin', 'usr_1', RULES.pin.free + 1, now)
    const rewound = now - 10 * 365 * 24 * 60 * 60 * 1000
    const blocked = blockedBy('pin', 'usr_1', rewound)
    expect(blocked.blocked).toBe(true)
    // Clamped to the lock that was imposed, not a decade of it.
    expect(blocked.retryAfterMs).toBe(RULES.pin.ladder[0])
  })

  it('never shortens a running lock with a fresh failure', () => {
    const now = Date.now()
    fail('pin', 'usr_1', RULES.pin.free + RULES.pin.ladder.length, now)
    const long = attemptStatus('pin', 'usr_1', now).retryAfterMs
    const after = recordFailure('pin', 'usr_1', now)
    expect(after.retryAfterMs).toBeGreaterThanOrEqual(long)
  })
})

describe('describeWait', () => {
  it('rounds up, so the form never invites a retry that will be refused', () => {
    expect(describeWait(14_400)).toBe('15 seconds')
    expect(describeWait(1_000)).toBe('1 second')
    expect(describeWait(61_000)).toBe('2 minutes')
  })
})
