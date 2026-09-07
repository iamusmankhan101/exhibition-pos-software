/**
 * Keeps the Supabase project awake.
 *
 * Supabase pauses a Free-plan project after seven consecutive days with no
 * activity, and this app's usage is exactly the shape that trips it: an
 * exhibition runs for a weekend, then the till sits idle for weeks. The project
 * pauses somewhere in that gap and the failure only surfaces on the morning of
 * the next event — and quietly, because the POS keeps selling from IndexedDB
 * while nothing reaches the server.
 *
 * So a scheduled request runs a real query against Postgres. Row-level security
 * answers an anonymous caller with an empty set, which is fine: the query still
 * reached the database, and that is what resets the clock. Nothing is read and
 * nothing is written.
 *
 * Scheduled from `vercel.json`. Vercel's Hobby plan runs crons roughly once a
 * day, which is well inside the seven-day window.
 */

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
// The anon key, not the service role: this endpoint needs to prove the database
// answers, not to read anything, and a service key on a public function would be
// a liability for no gain.
const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || ''

export default async function handler(request, response) {
  // Vercel sends this header when CRON_SECRET is set on the project. Without the
  // variable the check is skipped, so the endpoint works before it is configured.
  const secret = process.env.CRON_SECRET
  if (secret && request.headers.authorization !== `Bearer ${secret}`) {
    return response.status(401).json({ ok: false, error: 'Unauthorized' })
  }

  if (!url || !key) {
    return response
      .status(500)
      .json({ ok: false, error: 'SUPABASE_URL / SUPABASE_ANON_KEY are not set on this project.' })
  }

  const startedAt = Date.now()
  try {
    const result = await fetch(`${url}/rest/v1/settings?select=id&limit=1`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    })
    return response.status(result.ok ? 200 : 502).json({
      ok: result.ok,
      status: result.status,
      ms: Date.now() - startedAt,
      checkedAt: new Date().toISOString(),
    })
  } catch (error) {
    // A paused or deleted project fails DNS here, which is the one thing this
    // endpoint exists to make visible.
    return response.status(502).json({
      ok: false,
      error: String(error?.message || error),
      checkedAt: new Date().toISOString(),
    })
  }
}
