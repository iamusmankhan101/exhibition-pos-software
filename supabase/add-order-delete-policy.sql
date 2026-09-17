/*
 * Lets a deleted sale actually leave the server.
 *
 * `orders` had a policy for insert and one for update, and none for delete.
 * Row-level security answers that combination in the worst possible way: a
 * DELETE is not refused, it simply matches no rows. Postgres reports success,
 * PostgREST returns 204, the adapter sees no error and marks the command
 * synced, and the sale sits in the table exactly as it was.
 *
 * Nothing in the app could show it. The till that did the delete has its own
 * tombstone, so the sale stays gone on every screen that reads local state —
 * while the row is still there behind them, still in the dashboard's totals,
 * still in anything reading Supabase directly, and restored in full onto any
 * device that is set up fresh afterwards.
 *
 * Gated on `records.delete`, which is the permission the app itself requires
 * before it will offer the button (src/pages/admin/Sales.jsx). Payments and
 * returns carry `on delete cascade`, so they follow the order out without
 * needing policies of their own.
 *
 * Safe to run more than once, and safe to run while tills are trading: it adds
 * one policy and touches no data. Running the whole of schema.sql does the
 * same job.
 *
 * Depends on has_permission(), which schema.sql already created.
 */

-- Postgres has no `create policy if not exists`, so drop first to keep this
-- script re-runnable.
drop policy if exists orders_delete on orders;

create policy orders_delete on orders for delete using (has_permission('records.delete'));
