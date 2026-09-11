/**
 * Supabase client, loaded on demand.
 *
 * Deliberately optional. With no credentials configured the app behaves exactly
 * as it always has — local IndexedDB, the local sync adapter, no network — so a
 * misconfigured or unreachable backend can never stop a sale being taken.
 *
 * The SDK is ~180KB, so it is dynamically imported rather than bundled into the
 * first paint: an unconfigured build never downloads it at all, and a configured
 * one fetches it after the POS is already interactive. At a venue on bad wifi
 * the till coming up quickly matters more than the backend being ready early.
 */

const url = import.meta.env?.VITE_SUPABASE_URL || ''
const anonKey = import.meta.env?.VITE_SUPABASE_ANON_KEY || ''

export const isConfigured = Boolean(url && anonKey)

let clientPromise = null

/** Resolves the shared client, or `null` when the app is running locally. */
export function getSupabase() {
  if (!isConfigured) return Promise.resolve(null)
  clientPromise ||= import('@supabase/supabase-js')
    .then(({ createClient }) =>
      createClient(url, anonKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          // The POS lives on one long-lived tab at a stall, so a shift should
          // never be interrupted by a token quietly expiring.
          detectSessionInUrl: false,
        },
      }),
    )
    .catch((error) => {
      // Let the next attempt retry rather than caching a rejected promise.
      clientPromise = null
      throw error
    })
  return clientPromise
}

/** Human-readable state for the settings screen. */
export function connectionStatus() {
  if (!isConfigured) return { connected: false, detail: 'Not configured — running on local data only.' }
  return { connected: true, detail: url.replace(/^https?:\/\//, '') }
}

/**
 * The current Supabase auth session, or `null` when there is not a usable one.
 *
 * Worth asking before every sync rather than finding out from the wire. A till
 * signs in with a password once and then runs for days on PIN sign-ins, which
 * never touch Supabase auth — so the access token can expire, or the refresh
 * token can be invalidated underneath it (a free-plan project pausing and being
 * restored will do it), while the app carries on believing it is connected.
 *
 * PostgREST answers a stale token with 401, which is a different thing from the
 * 403 or the empty result row-level security gives an anonymous caller: it
 * means the request never authenticated at all. Nothing retried it into
 * succeeding, so the outbox pushed the same sale every few seconds for as long
 * as the tab stayed open and no one was told why the phone had stopped seeing
 * the laptop.
 *
 * `getSession` refreshes a token that is merely expired, so a `null` here is
 * the real thing: this device needs a password before it can sync again.
 */
export async function getCloudSession() {
  const client = await getSupabase()
  if (!client) return null
  const { data, error } = await client.auth.getSession()
  if (error) return null
  return data?.session || null
}

/** Subscribes to sign-in, sign-out and token refresh. Returns an unsubscribe. */
export async function onCloudAuthChange(listener) {
  const client = await getSupabase()
  if (!client) return () => {}
  const { data } = client.auth.onAuthStateChange((event, session) => listener(session || null))
  return () => data?.subscription?.unsubscribe()
}
