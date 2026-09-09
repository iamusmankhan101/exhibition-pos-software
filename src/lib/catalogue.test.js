/**
 * Filling a new device with the catalogue.
 *
 * Signing in used to fetch staff and roles and nothing else, so a phone signing
 * in for the first time reached an empty till. The pull that fixes it is a
 * replace rather than a merge, which makes both guards around it load-bearing:
 * one decides whether the device may be overwritten at all, the other decides
 * what the pull is allowed to overwrite. These pin both.
 */

import { describe, expect, it } from 'vitest'
import { catalogueFrom, isEmptyDevice } from './store.jsx'

const device = (over = {}) => ({ products: [], orders: [], outbox: [], ...over })

describe('whether a device may be filled from the server', () => {
  it('accepts one that has never held anything', () => {
    expect(isEmptyDevice(device())).toBe(true)
  })

  it('refuses one that already has the catalogue', () => {
    expect(isEmptyDevice(device({ products: [{ id: 'p1' }] }))).toBe(false)
  })

  it('refuses one holding a sale, however empty the catalogue looks', () => {
    // A till restored from a wipe could have orders and no products; those
    // orders are still the day's takings.
    expect(isEmptyDevice(device({ orders: [{ id: 'o1' }] }))).toBe(false)
  })

  it('refuses one with unsent work in the queue', () => {
    expect(isEmptyDevice(device({ outbox: [{ id: 'x', status: 'pending' }] }))).toBe(false)
    // Already pushed, so there is nothing left to lose.
    expect(isEmptyDevice(device({ outbox: [{ id: 'x', status: 'synced' }] }))).toBe(true)
  })

  it('copes with a state written before the outbox existed', () => {
    expect(isEmptyDevice({ products: [], orders: [] })).toBe(true)
  })
})

describe('what a pull is allowed to overwrite', () => {
  const pulled = {
    settings: { currencySymbol: 'AED' },
    users: [{ id: 'u1', name: 'Ahmed' }],
    roles: [{ id: 'admin' }],
    products: [{ id: 'p1', image: 'data:image/jpeg;base64,xx' }],
    inventory: { 'ex1:v1': { quantity: 4 } },
    orders: [],
  }

  it('brings the catalogue across', () => {
    const catalogue = catalogueFrom(pulled)
    expect(catalogue.products).toEqual(pulled.products)
    expect(catalogue.inventory).toEqual(pulled.inventory)
    expect(catalogue.settings).toEqual(pulled.settings)
  })

  it('never touches the staff list', () => {
    // The pulled staff row has no pin_hash — it is mapped for display, not for
    // authentication — so letting it land would break PIN sign-in on this
    // device. `refreshIdentity` owns that list.
    const catalogue = catalogueFrom(pulled)
    expect(catalogue).not.toHaveProperty('users')
    expect(catalogue).not.toHaveProperty('roles')
  })

  it('leaves the local defaults alone when the server has no settings row', () => {
    const catalogue = catalogueFrom({ ...pulled, settings: undefined })
    // Absent, not undefined — spreading `settings: undefined` over the state
    // would blank the defaults the app needs to render at all.
    expect(catalogue).not.toHaveProperty('settings')
    expect(catalogue.products).toEqual(pulled.products)
  })
})
