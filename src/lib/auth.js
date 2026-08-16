/**
 * Password hashing.
 *
 * PBKDF2-SHA256 via Web Crypto, with a random per-user salt. Passwords are
 * never stored or compared in plain text.
 *
 * Note the honest limit of a build with no server: everything here runs on the
 * device, so hashing protects the password itself (people reuse them) but it is
 * not access control — anyone with the device can read IndexedDB directly. The
 * shape is deliberately the one a real backend expects, so moving verification
 * server-side later is a swap of `verifyPassword`, not a redesign.
 */

const ITERATIONS = 150000
const KEY_BITS = 256

const toHex = (buffer) =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('')

const fromHex = (hex) =>
  new Uint8Array((hex.match(/.{1,2}/g) || []).map((byte) => parseInt(byte, 16)))

export function randomSalt() {
  return toHex(crypto.getRandomValues(new Uint8Array(16)))
}

export async function hashPassword(password, saltHex) {
  const salt = fromHex(saltHex)
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: ITERATIONS, hash: 'SHA-256' },
    key,
    KEY_BITS,
  )
  return toHex(bits)
}

/** Creates the stored credential pair for a new password. */
export async function createCredential(password) {
  const salt = randomSalt()
  return { passwordSalt: salt, passwordHash: await hashPassword(password, salt) }
}

/** Constant-time-ish comparison; lengths match so this walks the whole string. */
function safeEqual(a = '', b = '') {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export async function verifyPassword(password, user) {
  if (!user?.passwordHash || !user?.passwordSalt) return false
  const candidate = await hashPassword(password, user.passwordSalt)
  return safeEqual(candidate, user.passwordHash)
}

/** Shared rules so sign-up and password changes agree on what is acceptable. */
export function passwordProblem(password) {
  if (!password || password.length < 8) return 'Use at least 8 characters.'
  if (!/[a-zA-Z]/.test(password)) return 'Include at least one letter.'
  if (!/[0-9]/.test(password)) return 'Include at least one number.'
  return null
}

export function emailProblem(email) {
  if (!email?.trim()) return 'An email address is required.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'That does not look like an email address.'
  return null
}

export function normaliseEmail(email) {
  return String(email || '').trim().toLowerCase()
}
