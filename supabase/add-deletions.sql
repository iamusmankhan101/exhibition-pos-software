/*
 * Adds the `deletions` table to a project whose schema is already deployed.
 *
 * This is the part of supabase/schema.sql that makes a delete stick. Without
 * it, deleting a sale removes it from the till that did it and from the server
 * — and then the *other* till, which still has the sale, pushes it back up and
 * every device pulls it down again. The sale returns within the minute.
 *
 * A row here is a gravestone: an id, the device that buried it, and when. That
 * is the difference between a fact and an inference — a row simply missing from
 * a pull is equally consistent with "somebody deleted it" and "this device made
 * it and has not sent it yet", and acting on the second would wipe a shop's own
 * data. A gravestone says which, so it is the one thing a pull is allowed to
 * remove a local row for.
 *
 * Safe to run more than once, and safe to run while tills are trading: it adds
 * a table and its policies and touches nothing that already exists. Running the
 * whole of schema.sql instead does the same job.
 *
 * Depends on is_active_staff(), which schema.sql already created.
 */

create table if not exists deletions (
  id         text primary key,
  device_id  text default '',
  deleted_at timestamptz not null default now()
);

create index if not exists deletions_at_idx on deletions (deleted_at desc);

alter table deletions enable row level security;

-- Postgres has no `create policy if not exists`, so drop first to keep this
-- script re-runnable.
drop policy if exists deletions_read on deletions;
drop policy if exists deletions_write on deletions;
drop policy if exists deletions_update on deletions;

-- Read: every active member of staff, the same as every other table. A device
-- that cannot read this cannot learn what the others have deleted.
create policy deletions_read on deletions for select using (is_active_staff());

-- Write: anyone signed in may record that something was deleted. What they are
-- allowed to delete in the first place is enforced on the table that holds it,
-- so there is nothing extra to gate here.
create policy deletions_write on deletions for insert with check (is_active_staff());

-- The sync queue retries, and every write is an upsert so a replay is harmless.
-- An insert-only policy would work on the first attempt and return 403 on every
-- retry after it, wedging the queue permanently — the same trap the append-only
-- tables in schema.sql document.
create policy deletions_update on deletions for update using (is_active_staff());
