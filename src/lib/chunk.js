/**
 * Loading a lazily-imported chunk across a deployment.
 *
 * Chunk filenames carry a content hash, so every chunk this tab knows about
 * disappears the moment a new build ships. A lazy `import()` fired afterwards
 * asks for a file that is no longer there — and because a single-page host
 * answers an unknown path with `index.html`, it fails as a MIME-type error
 * rather than an honest 404.
 *
 * No retry can fix that: the running page belongs to the old build. Only
 * reloading onto the new one can, so that is what this does — once, and only
 * for a failure that actually looks like a stale chunk, because reloading a
 * till for any other reason would be its own kind of bug.
 */

const RELOADED = 'tareez:stale-reload'

const readFlag = () => {
  try {
    return sessionStorage.getItem(RELOADED) === '1'
  } catch {
    return false
  }
}

const writeFlag = (value) => {
  try {
    if (value) sessionStorage.setItem(RELOADED, '1')
    else sessionStorage.removeItem(RELOADED)
  } catch {
    /* private mode; the guard is a nicety, not a requirement */
  }
}

/** Browsers word this differently, and none of them use an error code. */
function isStaleChunk(error) {
  const text = String(error?.message || error || '')
  return (
    /failed to fetch dynamically imported module/i.test(text) ||
    /error loading dynamically imported module/i.test(text) ||
    /importing a module script failed/i.test(text) ||
    /expected a javascript(-or-wasm)? module script/i.test(text) ||
    /module script failed/i.test(text)
  )
}

/**
 * Runs `load` — always `() => import('…')`. On a stale-chunk failure it calls
 * `onStale` (to say what is about to happen) and reloads; the returned promise
 * never settles, because the page is on its way out. Anything else rethrows so
 * the caller's own error handling still applies.
 */
export async function loadChunk(load, onStale) {
  try {
    const module = await load()
    // A good load means this tab is current again.
    writeFlag(false)
    return module
  } catch (error) {
    if (!isStaleChunk(error) || readFlag()) throw error
    writeFlag(true)
    onStale?.()
    // Long enough for the message to be read, short enough to feel like a retry.
    setTimeout(() => window.location.reload(), 1400)
    return new Promise(() => {})
  }
}
