/**
 * The stale-chunk recovery path. These matter because the failure they handle
 * only happens in production, minutes after a deploy, on somebody else's tab —
 * which is exactly the kind of code that is never exercised by hand.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const store = new Map()

beforeEach(() => {
  store.clear()
  vi.useFakeTimers()
  globalThis.sessionStorage = {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  }
  globalThis.window = { location: { reload: vi.fn() } }
})

afterEach(() => {
  vi.useRealTimers()
  delete globalThis.sessionStorage
  delete globalThis.window
})

const { loadChunk } = await import('./chunk.js')

/** The message Chrome produces when a hashed chunk is answered with index.html. */
const staleError = () =>
  new TypeError(
    'Failed to fetch dynamically imported module: https://pos.tareeztech.com/assets/pdf-BPJBPrb8.js',
  )

describe('loadChunk', () => {
  it('returns the module untouched when the import works', async () => {
    const onStale = vi.fn()
    const module = await loadChunk(async () => ({ downloadInvoicePdf: 'fn' }), onStale)

    expect(module).toEqual({ downloadInvoicePdf: 'fn' })
    expect(onStale).not.toHaveBeenCalled()
    expect(window.location.reload).not.toHaveBeenCalled()
  })

  it('reloads onto the new build when the chunk is gone', async () => {
    const onStale = vi.fn()
    let settled = false
    loadChunk(async () => {
      throw staleError()
    }, onStale).then(() => {
      settled = true
    })

    await Promise.resolve()
    // The caller is told what is about to happen before the page goes.
    expect(onStale).toHaveBeenCalledTimes(1)

    vi.runAllTimers()
    expect(window.location.reload).toHaveBeenCalledTimes(1)

    // The promise must never settle: resolving it would let the caller carry on
    // and report a PDF failure over the top of the reload notice.
    await Promise.resolve()
    expect(settled).toBe(false)
  })

  it('rethrows a real failure instead of reloading', async () => {
    const onStale = vi.fn()
    await expect(
      loadChunk(async () => {
        throw new Error('jsPDF blew up on a bad font')
      }, onStale),
    ).rejects.toThrow('jsPDF blew up')

    expect(onStale).not.toHaveBeenCalled()
    expect(window.location.reload).not.toHaveBeenCalled()
  })

  it('reloads once, then gives up rather than looping', async () => {
    loadChunk(async () => {
      throw staleError()
    })
    await Promise.resolve()
    vi.runAllTimers()
    expect(window.location.reload).toHaveBeenCalledTimes(1)

    // Second attempt in the same session: the page has already been reloaded, so
    // the chunk really is missing and another reload would just spin.
    await expect(
      loadChunk(async () => {
        throw staleError()
      }),
    ).rejects.toThrow(/dynamically imported module/)
    expect(window.location.reload).toHaveBeenCalledTimes(1)
  })

  it('clears the guard after a good load, so a later deploy can reload again', async () => {
    loadChunk(async () => {
      throw staleError()
    })
    await Promise.resolve()
    vi.runAllTimers()

    await loadChunk(async () => ({ ok: true }))

    loadChunk(async () => {
      throw staleError()
    })
    await Promise.resolve()
    vi.runAllTimers()
    expect(window.location.reload).toHaveBeenCalledTimes(2)
  })
})
