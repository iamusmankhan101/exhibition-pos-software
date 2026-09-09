/**
 * The wedge reader is all timing, and timing is where it goes wrong: too strict
 * and a slow bluetooth scanner is ignored, too loose and a salesperson typing
 * with no field focused rings up a product. These drive it with synthetic
 * events and an explicit clock rather than a real keyboard.
 */

import { describe, expect, it, vi } from 'vitest'
import { createWedgeReader, MAX_GAP_MS, MIN_LENGTH } from './wedge.js'

const key = (value, overrides = {}) => ({
  key: value,
  target: { tagName: 'BODY' },
  preventDefault: vi.fn(),
  ...overrides,
})

/** Types `text` at `gap` ms per character, then the terminator. */
function scan(reader, text, { gap = 8, terminator = 'Enter', start = 1000 } = {}) {
  let now = start
  for (const character of text) {
    reader.handle(key(character), now)
    now += gap
  }
  if (terminator) reader.handle(key(terminator), now)
  return now
}

describe('keyboard wedge reader', () => {
  it('reads a burst that arrives faster than anyone can type', () => {
    const onScan = vi.fn()
    scan(createWedgeReader({ onScan }), '2001234567895')
    expect(onScan).toHaveBeenCalledWith('2001234567895')
  })

  it('accepts Tab as the suffix, because scanners are configured either way', () => {
    const onScan = vi.fn()
    scan(createWedgeReader({ onScan }), '2001234567895', { terminator: 'Tab' })
    expect(onScan).toHaveBeenCalledWith('2001234567895')
  })

  it('ignores a human typing the same digits slowly', () => {
    const onScan = vi.fn()
    scan(createWedgeReader({ onScan }), '2001234567895', { gap: MAX_GAP_MS + 40 })
    // Every gap restarted the buffer, so only the last character survived and
    // it is under the length floor.
    expect(onScan).not.toHaveBeenCalled()
  })

  it('starts a fresh burst after a pause rather than splicing two together', () => {
    const onScan = vi.fn()
    const reader = createWedgeReader({ onScan })

    let now = 1000
    for (const character of '999') {
      reader.handle(key(character), now)
      now += 8
    }
    // The operator wandered off and the scanner fired much later.
    now += 5000
    scan(reader, '2001234567895', { start: now })

    expect(onScan).toHaveBeenCalledTimes(1)
    expect(onScan).toHaveBeenCalledWith('2001234567895')
  })

  it('leaves a real input alone, so manual entry still works', () => {
    const onScan = vi.fn()
    const reader = createWedgeReader({ onScan })
    let now = 1000
    for (const character of '2001234567895') {
      reader.handle(key(character, { target: { tagName: 'INPUT' } }), now)
      now += 8
    }
    reader.handle(key('Enter', { target: { tagName: 'INPUT' } }), now)
    expect(onScan).not.toHaveBeenCalled()
  })

  it('leaves keyboard shortcuts alone', () => {
    const onScan = vi.fn()
    const reader = createWedgeReader({ onScan })
    const event = key('p', { ctrlKey: true })
    reader.handle(event, 1000)
    expect(reader.buffer).toBe('')
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('does not swallow a bare Enter or Tab that was not a scan', () => {
    const onScan = vi.fn()
    const reader = createWedgeReader({ onScan })
    const tab = key('Tab')
    // Tab still has to move focus for anyone driving the till by keyboard.
    expect(reader.handle(tab, 1000)).toBe(false)
    expect(tab.preventDefault).not.toHaveBeenCalled()
    expect(onScan).not.toHaveBeenCalled()
  })

  it('ignores a burst too short to be a product code', () => {
    const onScan = vi.fn()
    scan(createWedgeReader({ onScan }), '7'.repeat(MIN_LENGTH - 1))
    expect(onScan).not.toHaveBeenCalled()
  })

  it('suppresses the browser default only once it knows it was a scan', () => {
    const onScan = vi.fn()
    const reader = createWedgeReader({ onScan })
    let now = 1000
    for (const character of '2001234567895') {
      reader.handle(key(character), now)
      now += 8
    }
    const enter = key('Enter')
    reader.handle(enter, now)
    expect(enter.preventDefault).toHaveBeenCalled()
  })

  it('ignores non-printable keys inside a burst', () => {
    const onScan = vi.fn()
    const reader = createWedgeReader({ onScan })
    let now = 1000
    for (const character of '2001') {
      reader.handle(key(character), now)
      now += 8
    }
    reader.handle(key('Shift'), (now += 8))
    for (const character of '234567895') {
      reader.handle(key(character), now)
      now += 8
    }
    reader.handle(key('Enter'), now)
    expect(onScan).toHaveBeenCalledWith('2001234567895')
  })
})
