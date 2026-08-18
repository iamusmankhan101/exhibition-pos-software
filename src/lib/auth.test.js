/**
 * Credential handling. These are the rules that decide whether somebody gets
 * into the till, so they are worth pinning down.
 */

import { describe, expect, it } from 'vitest'
import {
  createCredential,
  createPinCredential,
  emailProblem,
  normaliseEmail,
  passwordProblem,
  verifyPassword,
  verifyPin,
} from './auth.js'

describe('passwords', () => {
  it('accepts the right password', async () => {
    const account = await createCredential('tareez2026')
    expect(await verifyPassword('tareez2026', account)).toBe(true)
  })

  it('rejects the wrong one', async () => {
    const account = await createCredential('tareez2026')
    expect(await verifyPassword('tareez2025', account)).toBe(false)
  })

  it('never stores the password itself', async () => {
    const account = await createCredential('tareez2026')
    expect(JSON.stringify(account)).not.toContain('tareez2026')
  })

  it('salts, so the same password hashes differently for two people', async () => {
    const a = await createCredential('tareez2026')
    const b = await createCredential('tareez2026')
    expect(a.passwordHash).not.toBe(b.passwordHash)
  })

  it('refuses an account with no credential rather than letting anyone in', async () => {
    expect(await verifyPassword('anything', {})).toBe(false)
    expect(await verifyPassword('anything', null)).toBe(false)
  })
})

describe('PINs', () => {
  it('accepts the right PIN', async () => {
    const account = await createPinCredential('1234')
    expect(await verifyPin('1234', account)).toBe(true)
  })

  it('rejects the wrong one', async () => {
    const account = await createPinCredential('1234')
    expect(await verifyPin('4321', account)).toBe(false)
  })

  it('never stores the PIN itself', async () => {
    const account = await createPinCredential('1234')
    expect(JSON.stringify(account)).not.toContain('1234')
  })

  it('still accepts a plaintext PIN from an account that has not re-synced', async () => {
    expect(await verifyPin('1111', { pin: '1111' })).toBe(true)
    expect(await verifyPin('2222', { pin: '1111' })).toBe(false)
  })

  it('prefers the hash when an account carries both', async () => {
    const hashed = await createPinCredential('9999')
    const account = { ...hashed, pin: '1111' }
    expect(await verifyPin('9999', account)).toBe(true)
    // The stale plaintext must not still open the till.
    expect(await verifyPin('1111', account)).toBe(false)
  })

  it('refuses an empty PIN against an account with no PIN set', async () => {
    expect(await verifyPin('', {})).toBe(false)
    expect(await verifyPin('1234', {})).toBe(false)
  })
})

describe('input rules', () => {
  it('requires a usable password', () => {
    expect(passwordProblem('short1')).toBeTruthy()
    expect(passwordProblem('nodigitshere')).toBeTruthy()
    expect(passwordProblem('12345678')).toBeTruthy()
    expect(passwordProblem('tareez2026')).toBeNull()
  })

  it('checks the shape of an email', () => {
    expect(emailProblem('')).toBeTruthy()
    expect(emailProblem('not-an-email')).toBeTruthy()
    expect(emailProblem('ali@tareez.com')).toBeNull()
  })

  it('normalises case and spacing so one person cannot hold two accounts', () => {
    expect(normaliseEmail('  Ali@Tareez.COM ')).toBe('ali@tareez.com')
  })
})
