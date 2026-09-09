/**
 * Keyboard-wedge barcode scanners.
 *
 * A handheld or bluetooth scanner is not a camera and not a device the page can
 * open — to the browser it is a USB keyboard. It types the digits it read as
 * fast as the driver will emit them and finishes with Enter, and that is the
 * whole protocol. There is no event to subscribe to and nothing identifies the
 * keystrokes as coming from a scanner rather than a person.
 *
 * Which is the problem this file exists to solve. Keystrokes go to whatever has
 * focus, so a search box only catches a scan while the cursor happens to be
 * sitting in it. On a till that is almost never true: the operator taps a
 * product tile, opens the cart, closes a modal — and from then on every scan is
 * delivered to `document.body`, where it does nothing at all. The scanner looks
 * broken, beeps happily, and nothing reaches the sale.
 *
 * So the burst is recognised by its timing instead of by its destination. A
 * scanner emits characters single-digit milliseconds apart; a person cannot. Any
 * gap longer than `maxGap` is taken as human typing and starts the buffer over,
 * so by the time a terminator arrives the buffer holds only characters that
 * arrived too quickly to have been typed.
 */

/** Gaps longer than this mean a person is typing, not a scanner firing. */
export const MAX_GAP_MS = 100

/**
 * The shortest burst worth treating as a scan.
 *
 * An EAN-13 is thirteen characters and a SKU is rarely under four. The floor is
 * what stops a stray fast keypress before Enter being read as a product code.
 */
export const MIN_LENGTH = 4

/** Scanners are configured with one or the other as the suffix. */
const TERMINATORS = new Set(['Enter', 'Tab'])

/**
 * True when the keystroke belongs to something the operator is typing into.
 *
 * A scan aimed at a real field is already handled by that field — and stealing
 * it would break the manual-entry box on the scanner modal, which exists
 * precisely for labels too damaged to read.
 */
function isTyping(target) {
  if (!target) return false
  const tag = String(target.tagName || '').toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || Boolean(target.isContentEditable)
}

/**
 * A stateful reader fed raw keydown events.
 *
 * Kept free of React and of the DOM so the timing rules — the part that is
 * actually easy to get wrong — can be tested directly.
 */
export function createWedgeReader({ onScan, minLength = MIN_LENGTH, maxGap = MAX_GAP_MS } = {}) {
  let buffer = ''
  let lastAt = 0

  const reset = () => {
    buffer = ''
    lastAt = 0
  }

  return {
    reset,
    /** The current burst, for tests and debugging. */
    get buffer() {
      return buffer
    },
    handle(event, now = Date.now()) {
      // Let every shortcut through untouched; a scanner never holds a modifier.
      if (event.ctrlKey || event.metaKey || event.altKey) return false
      if (isTyping(event.target)) return false

      if (TERMINATORS.has(event.key)) {
        const code = buffer
        reset()
        if (code.length < minLength) return false
        // Only now is it certain this was a scan, so this is the first point at
        // which suppressing the browser's own handling is safe — Tab must keep
        // moving focus for anyone navigating the till by keyboard.
        event.preventDefault?.()
        onScan?.(code)
        return true
      }

      // Printable characters only: a scanner sends the code and its suffix,
      // nothing else. `key` is a single character exactly when it is printable.
      if (event.key?.length !== 1) return false

      if (lastAt && now - lastAt > maxGap) buffer = ''
      buffer += event.key
      lastAt = now
      return false
    },
  }
}
