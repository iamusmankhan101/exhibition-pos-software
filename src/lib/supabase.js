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
