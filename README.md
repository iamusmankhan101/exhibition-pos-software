# Tareez Exhibition POS & Inventory

A mobile-first point-of-sale and inventory system for selling at exhibitions, pop-ups, stalls and
trade shows.

The salesperson flow is the whole product: **scan → customer → pay → receipt**, in 30–60 seconds.
Everything else — stock deduction, invoice numbering, customer records, salesperson performance,
exhibition reporting — happens as a side effect of taking the payment.

## Quick start

Requires **Node 20+** (Vite 5 does not run on Node 18).

```bash
npm install
npm run dev
```

Open http://localhost:5173. The app seeds itself with demo data on first run: 14 products with
variants, 3 exhibitions, 18 customers and around 90 historical sales.

### Demo sign-ins

| User | Role | PIN |
| --- | --- | --- |
| Ali Rahman | Admin | `1111` |
| Sarah Bennett | Manager | `2222` |
| Ahmed Khan | Salesperson | `3333` |
| Layla Hassan | Salesperson | `4444` |

Other scripts:

```bash
npm run build     # production build
npm run preview   # serve the build on the local network
```

## What it does

**Point of sale** — camera barcode/QR scanning (EAN, UPC, Code 128/39, ITF, QR), product search,
category filters, variant picker, cart with quantity steppers, and a three-step checkout
(customer → discount → payment) with cash-tendered change calculation.

**Inventory** — stock is held per location. The main warehouse and each exhibition have separate
balances, so stall sales never touch warehouse stock. Transfers move stock between them and every
change writes a stock movement with a running balance. Overselling is blocked by default and can be
enabled per business, in which case negative stock is flagged for review.

**Customers** — searchable database, created at checkout or in admin, with purchase history and
lifetime spend. Marketing consent is stored separately from transactional contact, and the
"opted in only" export exists so campaigns cannot accidentally include people who never agreed.

**Receipts** — branded digital invoices delivered by WhatsApp, SMS, email or an on-screen QR code.
Receipt links carry a compact payload in the URL fragment, so a customer scanning the QR sees a
fully rendered receipt on their own phone with no server involved.

**Reporting** — dashboard with sales trend, payment split and staff ranking; sales, inventory,
payment, staff and customer reports, each exportable to CSV, Excel or PDF; and an exhibition
closing report that freezes the final numbers and returns unsold stock to the warehouse.

**Returns and refunds** — partial or full returns against the original invoice. Refunds honour the
order's discount ratio and tax treatment, restore exhibition stock and post a negative payment row
for reconciliation.

**Roles** — admin, manager and salesperson, enforced on every route. Salespeople never see cost
prices, other people's performance, or system settings.

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
- **PDF export goes through the browser print dialog** ("Save as PDF") rather than generating a file
  server-side.
- **PIN authentication** suits shared stall devices; it is not a substitute for real accounts once a
  server exists.

## Licence

Private project.
