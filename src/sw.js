/**
 * Service worker for the POS.
 *
 * Written by hand rather than generated, because what a till caches is a
 * correctness question, not a performance one: the shell must survive with no
 * signal, and sale data must never be served stale.
 */

import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching'
import { registerRoute, NavigationRoute } from 'workbox-routing'

// Injected at build time with every file in the bundle. This is what makes the
// app cold-start at a venue with no internet.
precacheAndRoute(self.__WB_MANIFEST)
cleanupOutdatedCaches()

// A receipt link is /r/:id, and every admin screen is a client-side route, so
// navigations fall back to the app shell rather than 404ing offline.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')))

/**
 * Supabase is deliberately never intercepted.
 *
 * The outbox already handles a failed write correctly — it retries, and the
 * sale is safe in IndexedDB meanwhile. A cached response would be worse than
 * no response: it could show a salesperson stock or takings that are not real.
 */

// The page decides when to take an update. A POS must not reload itself while
// somebody is mid-sale, so `skipWaiting` runs only when the app asks.
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting()
})
