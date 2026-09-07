/**
 * Barcode generation and encoding.
 *
 * A wrong check digit or a flipped parity table produces a label that looks
 * perfect and scans as nothing — or worse, as a different product. So these are
 * checked against published EAN-13 numbers rather than against themselves.
 */

import { describe, expect, it } from 'vitest'
import { ean13Modules, ean13Svg, eanCheckDigit, generateBarcode, isValidEan13, usedBarcodes } from './barcode.js'

describe('check digits', () => {
  it('matches known retail barcodes', () => {
    // Real published EAN-13s; the last digit is the one being derived.
    expect(eanCheckDigit('400638133393')).toBe('1') // 4006381333931
    expect(eanCheckDigit('501234567890')).toBe('0') // 5012345678900
    expect(eanCheckDigit('978020137962')).toBe('4') // 9780201379624
  })

  it('rejects anything that is not twelve digits', () => {
    expect(eanCheckDigit('12345')).toBeNull()
    expect(eanCheckDigit('')).toBeNull()
  })

  it('validates a whole code', () => {
    expect(isValidEan13('4006381333931')).toBe(true)
    expect(isValidEan13('9780201379624')).toBe(true)
    // One digit transposed — the check digit no longer agrees.
    expect(isValidEan13('4006381333941')).toBe(false)
    expect(isValidEan13('400638133393')).toBe(false)
  })
})

describe('generateBarcode', () => {
  it('produces a valid, in-store-prefixed code', () => {
    const code = generateBarcode()
    expect(code).toHaveLength(13)
    expect(code.startsWith('20')).toBe(true)
    expect(isValidEan13(code)).toBe(true)
  })

  it('never repeats a code already in use', () => {
    const taken = new Set()
    for (let i = 0; i < 300; i += 1) {
      const code = generateBarcode(taken)
      expect(taken.has(code)).toBe(false)
      expect(isValidEan13(code)).toBe(true)
      taken.add(code)
    }
    expect(taken.size).toBe(300)
  })
})

describe('usedBarcodes', () => {
  const products = [
    { id: 'p1', variants: [{ barcode: '111' }, { barcode: '222' }] },
    { id: 'p2', variants: [{ barcode: '333' }, { barcode: '' }] },
  ]

  it('collects every barcode in the catalogue', () => {
    expect(usedBarcodes(products)).toEqual(new Set(['111', '222', '333']))
  })

  it('can exclude the product being edited, so its own codes are not clashes', () => {
    expect(usedBarcodes(products, 'p1')).toEqual(new Set(['333']))
  })
})

describe('ean13Modules', () => {
  it('encodes a known barcode exactly', () => {
    const bits = ean13Modules('5901234123457')
    // 95 modules: 3 guard + 42 left + 5 centre + 42 right + 3 guard.
    expect(bits).toHaveLength(95)
    expect(bits.startsWith('101')).toBe(true)
    expect(bits.endsWith('101')).toBe(true)
    expect(bits.slice(45, 50)).toBe('01010')
    // The published module pattern for 5901234123457.
    // Derived independently from the EAN-13 tables for 5 901234 123457.
    expect(bits).toBe(
      '101000101101001110110011001001101111010011101' +
        '01010' +
        '110011011011001000010101110010011101000100101',
    )
  })

  it('refuses a code whose check digit is wrong', () => {
    expect(ean13Modules('5901234123458')).toBeNull()
  })
})

describe('ean13Svg', () => {
  it('draws bars and prints the digits underneath', () => {
    const svg = ean13Svg('5901234123457')
    expect(svg).toContain('<svg')
    expect(svg).toContain('mm"')
    expect(svg).toContain('<rect')
    // Split the way a retail label prints it: 5 | 901234 | 123457.
    expect(svg).toContain('>5<')
    expect(svg).toContain('>901234<')
    expect(svg).toContain('>123457<')
  })

  it('returns nothing for an invalid code rather than a misleading picture', () => {
    expect(ean13Svg('not-a-barcode')).toBe('')
  })
})
