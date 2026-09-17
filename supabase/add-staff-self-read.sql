/*
 * Lets somebody see their own staff row before they have been approved.
 *
 * `staff_read` is gated on is_active_staff(), which needs an *active* row — so
 * an account awaiting approval cannot read the very record that says it is
 * awaiting approval. The table comes back empty, and the app, having nothing to
 * go on, tells them no staff record is linked to their email at all.
 *
 * That is the wrong message twice over: it reads as "you do not exist here",
 * when the truth is "you are in the queue", and it sends an admin looking for a
 * missing row that is sitting there inactive. It also made the app's own
 * "awaiting approval" error unreachable on any project with a backend — RLS
 * removed the row before the check could run.
 *
 * Policies are OR'd, so this widens the read by exactly one row: your own. It
 * carries `pin_hash`, which is the same hash the owner of the PIN already holds
 * on their device, and nobody else's row becomes visible.
 *
 * Safe to run more than once, and safe to run while tills are trading.
 */

-- Postgres has no `create policy if not exists`, so drop first to keep this
-- script re-runnable.
drop policy if exists staff_read_self on staff;

create policy staff_read_self on staff for select using (auth_id = auth.uid());
