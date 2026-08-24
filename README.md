# Tareez POS

A mobile-first point-of-sale and inventory system for selling at exhibitions, pop-ups, stalls and
trade shows.

The salesperson flow is the whole product: **scan → customer → pay → receipt**, in 30–60 seconds.
Everything else — stock deduction, invoice numbering, customer records, salesperson performance,
exhibition reporting — happens as a side effect of taking the payment.

## Quick start

Requires **Node 20+**. There is an `.nvmrc`, so:

```bash
nvm use
npm install
npm run dev
```

On Node 18 the build refuses to start. It used to get most of the way through and then die inside
`@rollup/plugin-terser` (which needs a `crypto` global Node 18 does not expose to CommonJS), leaving
a `dist/` that looked complete but had no service worker — which then failed in the browser as a
service worker stuck on "trying to install". `scripts/check-node.mjs` now stops it up front.

Open http://localhost:5173. The app seeds itself with demo data on first run: 14 products with
variants, 3 exhibitions, 18 customers and around 90 historical sales.

### Demo sign-ins

Sign in with an email and the password `tareez2026`, or use the Staff PIN tab for fast switching on
a shared device.

| User | Email | Role | PIN |
| --- | --- | --- | --- |
| Ali Rahman | ali@tareez.com | Admin | `1111` |
| Sarah Bennett | sarah@tareez.com | Manager | `2222` |
| Ahmed Khan | ahmed@tareez.com | Salesperson | `3333` |
| Layla Hassan | layla@tareez.com | Salesperson | `4444` |

On a completely empty database the login screen asks you to create the owner account instead, and
that first account gets full admin access.

Other scripts:

```bash
npm run build     # production build
npm run preview   # serve the build on the local network
npm test          # run the rule tests
npm run test:watch
```

## Tests

`npm test` runs the business rules headlessly — no browser, no React — because
`domain.js` keeps them as pure `state → state` functions.

- `src/lib/domain.test.js` covers the rules one at a time: stall pricing, cart maths, promo
  validation and stacking, split and part payments, stock limits and the oversell override, refunds,
  deletion and offline replay.
- `src/lib/acceptance.test.js` is the run the brief asks for — 26 sales through one exhibition
  covering discounts, every payment method, split and part payments and promo codes, then a
  settlement, a return, a cancellation and an offline replay. It asserts the things that must never
  drift: stock matches what was sold, the payment ledger matches what the orders say was received,
  every invoice number is unique, and a receipt survives the round trip to the customer's phone.

## What it does

**Point of sale** — camera barcode/QR scanning (EAN, UPC, Code 128/39, ITF, QR), product search,
category filters, variant picker, and a cart with quantity steppers and per-item discounts. Checkout
runs customer → discount → payment, with cash-tendered change calculation. Discount limits are
enforced per salesperson across item and order discounts combined, so one cannot be used to dodge
the other.

**Promo codes** — created by an admin in Settings → Promo codes as a percentage or a fixed amount,
with an optional minimum spend, usage limit, date window and a single exhibition it works at. Staff
type the code in at the discount step. A code stacks on top of any manual discount but comes off
what is still payable, so the two can never exceed the order; and because an admin authorised it
when they created it, it deliberately does not count against the salesperson's own discount ceiling.

**Split payments** — a sale can be settled across several methods, each row becoming its own payment
record so every till reconciles on its own. An over-tendered final row is trimmed to what was owed
rather than inflating the takings, and anything still unallocated is held as a balance due.

**Part payments** — a sale can be taken with only some of the money received. The order is saved as
Pending with a balance due, stock still leaves with the customer, and the remainder is settled later
from the Sales page. Returns against an unpaid order clear the outstanding balance first and only
refund cash for what was actually handed over.

**Exhibition pricing** — a variant can carry a stall price alongside its list price. It applies only
when selling at an exhibition; a direct sale from the warehouse always charges the list price. The
POS shows the stall price with the list price struck through, and reporting values stock at whatever
the location actually charges.

**Inventory** — stock is held per location. The main warehouse and each exhibition have separate
balances, so stall sales never touch warehouse stock. Transfers move stock between them and every
change writes a stock movement with a running balance.

**Selling past the stock count** — the shelf count at a busy stall is often simply wrong, so an
out-of-stock line is not a dead end. Anyone holding the "authorise selling past available stock"
permission can approve the sale outright; anyone else is prompted for a manager's PIN. Whoever
authorised it is named on the order, in the audit log and in an alert raised to the owner, and the
sale is flagged for review until the count is corrected. Overselling with no authorisation at all
remains blocked unless the business turns it on globally.

**Exhibitions are optional.** Choosing one scopes the POS to that stand's stock and reporting. With
none selected the POS sells directly from the main warehouse, and those sales are grouped as
"Direct sales" everywhere they appear — useful for shop-floor trading, studio visits or a quick sale
between events.

**Customers** — searchable database, created at checkout or in admin, with purchase history and
lifetime spend. Marketing consent is stored separately from transactional contact, and the
"opted in only" export exists so campaigns cannot accidentally include people who never agreed.

**Receipts and invoices** — branded digital receipts delivered by WhatsApp, SMS, email or an
on-screen QR code. Receipt links carry a compact payload in the URL fragment, so a customer scanning
the QR sees a fully rendered receipt on their own phone with no server involved. A proper PDF
invoice is generated on device and can be handed to the OS share sheet, which is what lets a phone
attach it to an email or WhatsApp message.

**Invoice design** — accent colour, paper size and which fields appear (logo, customer contact,
exhibition, salesperson, VAT breakdown, QR, terms), with a live preview and a downloadable sample.

**Reporting** — dashboard with sales trend, sales by hour, sales by category, payment split and
staff ranking; sales, product, category, inventory, payment, discount, returns, staff and customer
reports, each exportable to CSV,
Excel or PDF; and an exhibition closing report that freezes the final numbers — including the
category split, the busiest trading hours and everything that came back — and returns unsold stock
to the warehouse.

**Returns and refunds** — partial or full returns against the original invoice. Refunds honour the
order's discount ratio, promo code and tax treatment, restore exhibition stock and post a negative
payment row per method for reconciliation. Returns and cancellations are both written to a returns
ledger that keeps the reason and who authorised it, which is what the returns report reads.

**Devices and sessions** — every phone, tablet and laptop that signs in registers itself with a
heartbeat, so Settings → Data & devices shows which are live, who last used each one and when. A
device can be named, and one that has been lost or should no longer be trading can be blocked: it
cannot sign anyone in, and it signs itself out the moment it next sees the change. Sales it already
took stay on the record.

**Accounts and roles** — email/password sign-in with PBKDF2-hashed passwords, self-service sign-up
with optional admin approval, and a PIN keypad for switching staff mid-shift. Roles are editable in
Settings → Roles & access: tick permissions per role, create custom roles, set each role's discount
ceiling. A guard refuses any change that would leave nobody able to reach Settings.

## Backend (optional)

The app runs entirely on local data with no backend at all. Connecting Supabase adds a durable copy,
reporting off-device and the groundwork for a second till — **without** becoming a dependency: with
no credentials configured the local adapter stays in place, so an unreachable backend can never stop
a sale being taken at the stall.

```bash
cp .env.example .env.local     # fill in from Supabase → Settings → API
```

Then run `supabase/schema.sql` once in the SQL editor. It creates the tables, indexes, row-level
security policies mirroring `permissions.js`, and adds `orders`, `payments` and `inventory` to the
realtime publication for the live owner dashboard.

The Supabase SDK is ~180KB, so it is loaded dynamically — an unconfigured build never downloads it,
and a configured one fetches it after the POS is already interactive.

### How the sync works

`sync.js` drains the outbox through a pluggable adapter. `supabaseAdapter.js` implements it, and the
important detail is that it does not simply post the payload: a queued command like `order.create`
carries the order, but the rows it *produced* — payment rows, stock movements, the new inventory
balance, the customer's updated totals — live in the state the domain function returned. So the
adapter reads those out of local state and mirrors the real rows.

Everything is an upsert keyed by the id the device minted offline, which is what makes a replayed
queue harmless. `orders.client_id` is `unique`, so a duplicate sale collides at the database rather
than being caught by application logic.

### Setting it up

1. SQL Editor → run `supabase/schema.sql`
2. Sign up in the app, or add yourself under Authentication → Users

That is the whole setup. There is no separate seed step: the schema installs a trigger on
`auth.users` that gives every new sign-in a staff record automatically, and backfills anyone who
signed up before it existed.

**The first account to exist becomes the admin**, active immediately — the same rule the app already
follows on an empty local database. Everyone after it arrives as a salesperson awaiting approval, so
a public sign-up page cannot mint itself access. Staff are then managed in the app under Staff and
Settings → Roles & access, and those changes sync like anything else.

The trigger runs `security definer`, which is what lets it write past row-level security. Without it
there is a dead end: RLS needs an active staff row, but creating one needs an account that already
has one.

### How sign-in works

Password sign-in goes through Supabase and needs a connection — it is what mints the session the RLS
policies check. It also refreshes the cached staff list, and **PIN sign-in then works entirely
offline against that cache**. Set a device up before the show and the show itself needs nothing.

A device that has never been online cannot sign in at all; that is the deliberate trade.

PINs are hashed with a per-user salt, the same as passwords. Four digits will never survive a
determined offline attack — the point is that a PIN which syncs to a server is not sitting there in
the clear. Accounts that predate the change still carry a plaintext PIN and are still accepted, but
the hash wins whenever both are present.

### Protecting the login screen

The login screen is the only place an untrusted person is invited to submit whatever they like, over
and over, so `throttle.js` sits in front of every credential check.

- **Escalating lockouts.** A few attempts pass untouched — people mistype, and a salesperson at a
  busy stall should not be punished for it — after which each further failure takes the next rung of
  a ladder. Passwords get four free tries and a ladder up to fifteen minutes; PINs get three and a
  ladder up to ten. That caps a scripted attack on a four-digit PIN at well under two hundred
  guesses a day against a ten-thousand-wide space.
- **A device-wide counter.** Failures also accumulate against the device, so working down the staff
  list one account at a time is no cheaper than hammering a single one. A successful sign-in clears
  it: somebody who can actually authenticate is not the attacker it was there for.
- **Counters that survive a reload.** They live in `localStorage`, because a counter held in React
  state is cleared by refreshing the page — the first thing anybody trying PINs by hand would do.
  Winding the device clock backwards does not release a running lock either.
- **A floor under every failure.** A failed attempt is held open for a fixed minimum. This flattens
  the gap between "no such account" (instant) and "wrong password" (a PBKDF2 derivation), which
  otherwise tells an attacker which addresses are real, and caps attempts per second before the
  ladder has even engaged.
- **Bounded input.** Passwords cap at 128 characters and addresses at 254, so a megabyte pasted into
  the box cannot stall the till on the login screen.
- **Lockouts are logged, individual failures are not.** The audit log holds 800 rows; writing one
  per failure would let a script wash the day's real history out of it. One row and one admin
  notification per lockout keeps the signal without the flood.
- **Account creation is rate limited** separately, so open sign-up plus an approval queue cannot be
  used to bury an admin under pending accounts.

The honest limit: with Supabase unconfigured this all runs on the attacker's machine, and a
determined one can clear `localStorage` or read the hashes out of IndexedDB directly. It stops the
realistic attack — somebody left alone with the tablet, or a script driving the form. Real
enforcement needs the server, which is why `signIn` prefers Supabase whenever it is configured: its
own limiter sits behind this one and cannot be reset from the browser.

### What is not done yet

Phase 1 treats the device as authoritative and Supabase as the durable copy. Before a second till
sells at the same stand, three things need to move server-side:

- **Stock decrements** must be atomic. Two devices selling the last item offline will both succeed
  locally and both sync. The right resolution is not to reject the second — the customer already
  walked away with it — but to apply decrements in a transaction and flag a negative result the same
  way the existing oversell override does.
- **Invoice numbers** should come from the `invoice_seq` sequence rather than a client counter.
- **`balanceAfter` on stock movements** is currently computed from the device's local view, so
  interleaved writes from two devices will record misleading running balances.

`pullEverything()` exists for a cold bootstrap but deliberately does not merge into a device that
already holds unsynced sales — guessing there is how a day's takings goes missing.

## Installable app (PWA)

The build emits a web app manifest and a service worker, so the POS installs to a phone or tablet
home screen and **cold-starts with no internet**. That is the difference between a salesperson
reopening a closed tab at a venue and being locked out of a till whose data is sitting intact in
IndexedDB, unreachable.

`src/sw.js` is written by hand rather than generated, for two reasons. The generator writes its
template with single-quoted absolute paths, and this project lives under a directory containing an
apostrophe, which breaks the file it produces. And what a till caches is a correctness question
worth being explicit about:

- **The whole shell is precached**, including the lazy jsPDF and scanner chunks — otherwise the
  first offline invoice or barcode scan fails.
- **Navigations fall back to `index.html`**, so a receipt link (`/r/:id`) still resolves offline.
- **Supabase is never intercepted.** A failed write already lands in the outbox and retries; a
  cached response would be worse than none, because it could show a salesperson stock or takings
  that are not real.

Updates are **offered, not applied**. A till that reloaded itself mid-sale, cart on screen and a
customer waiting, would be a bug rather than a feature — so a new version waits behind a prompt
until somebody taps Update.

## Offline behaviour

Exhibition venues have unreliable internet, so the POS is offline-first.

State lives in IndexedDB and the app runs entirely from local data. Every mutation is appended to an
outbox with a client-generated idempotency key. While offline the queue grows; when the connection
returns it drains in order, and a replayed sale cannot create a duplicate order because the key is
already known. Invoice numbers embed a per-device code (`TRZ-260816-A1077`), so two tablets selling
at the same stall cannot collide even while both are offline.

Tabs on the same machine stay in sync live over `BroadcastChannel`.

## Architecture

```
src/
  lib/
    domain.js      pure business rules — stock, totals, orders, refunds
    analytics.js   reporting maths shared by dashboard, reports and closing
    store.jsx      React state, persistence, audit log, notifications, outbox
    sync.js        offline queue with a pluggable transport adapter
    receipt.js     receipt encoding, QR, WhatsApp/SMS/email delivery
    idb.js         IndexedDB wrapper
    seed.js        demo dataset
    supabase.js    optional Supabase client, loaded on demand
    supabaseAdapter.js  outbox → Supabase, and the cold bootstrap pull
    *.test.js      rule tests and the acceptance run
supabase/
  schema.sql       tables, indexes, RLS policies, realtime
  components/      layout, icons, chart, shared UI
  pages/           login, POS, receipt, admin screens
```

`domain.js` holds every rule as a pure `state → state` function, which is why the same code can be
exercised by the UI, the seeder and tests without a browser.

## Current limitations

This is a complete front end with a local persistence layer, not a deployed multi-device system.

- **No backend.** Data is per browser. `sync.js` implements the full at-least-once + idempotency
  contract against a local adapter; pointing it at a real API is a single `setSyncAdapter` call.
  Until then, two physical devices hold separate datasets.
- **Camera needs a secure context.** `getUserMedia` requires HTTPS or `localhost`. Over a plain LAN
  IP the scanner falls back to manual code entry.
- **Email attachment depends on the device.** The PDF is real and generated locally, but a browser
  cannot attach a file to a `mailto:` link. On phones the share sheet attaches it properly; on
  desktop it downloads for the user to attach. Automatic send needs a server-side mailer.
- **Failed-payment notifications** are the one alert type from the spec that is not implemented —
  with no payment gateway there is nothing that can fail.
- **Authentication runs on the device.** Passwords are hashed with PBKDF2-SHA256 and a per-user salt,
  never stored in the clear, and `verifyPassword` is the single place to swap for a server call. But
  with no server, the check itself happens client-side, so this is credential hygiene rather than
  access control — anyone holding the device can read IndexedDB directly. The same applies to the
  login throttling described above: it is enforced by the browser it is trying to slow down. Roles
  and permissions are the right shape for server enforcement; today they gate the UI.

## Licence

Private project.
