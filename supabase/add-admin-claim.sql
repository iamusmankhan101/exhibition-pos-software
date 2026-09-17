/*
 * Lets the first person sign themselves in as administrator, without SQL.
 *
 * There was a dead end at the very start of a project's life. Row-level
 * security grants `admin.settings` through an active staff row, and creating an
 * active staff row needs `admin.settings` — so the first administrator could
 * only ever be made by hand in the SQL editor. Everything after that is already
 * doable from /admin/staff; it was only ever the first one that was stuck, and
 * it stranded anyone whose provisioning trigger had not run.
 *
 * `claim_admin()` closes it the way the app already behaves offline: the first
 * account to exist owns the system. It is self-limiting by construction — the
 * moment anybody can administer this project it refuses, for good. So it is a
 * bootstrap, not a back door: it cannot be used to escalate against a system
 * that has an owner, which is every system after the first sign-in.
 *
 * `security definer` is what lets it write past the policies that are the whole
 * reason it exists. It is deliberately narrow: no arguments, it only ever
 * touches the caller's own row, and it takes the caller's identity from
 * auth.uid() rather than anything the client passes in.
 *
 * Safe to run more than once, and safe to run while tills are trading.
 */

create or replace function claim_admin() returns staff as $$
declare
  caller auth.users%rowtype;
  claimed staff%rowtype;
begin
  -- Only a signed-in caller. An anonymous one has no row to promote, and
  -- auth.uid() is the only identity here that the client cannot choose.
  if auth.uid() is null then
    raise exception 'You need to be signed in to claim this system.'
      using errcode = 'P0001';
  end if;

  -- The gate. Anybody who can already administer the project owns it, so there
  -- is nothing to claim and this refuses for the rest of the project's life.
  -- Tested on the permission rather than the role id, because roles are
  -- editable and it is `admin.settings` that actually grants staff management.
  if exists (
    select 1
    from staff s
    join roles r on r.id = s.role
    where s.active
      and ('*' = any (r.permissions) or 'admin.settings' = any (r.permissions))
  ) then
    raise exception 'This system already has an administrator. Ask them to approve your account.'
      using errcode = 'P0001';
  end if;

  select * into caller from auth.users where id = auth.uid();

  -- The role has to exist before a staff row can point at it. Seeded by
  -- schema.sql, but a project that has only ever had this script run needs it.
  insert into roles (id, name, description, system, permissions, max_discount_percent)
  values ('admin', 'Admin', 'Full control, including settings, roles and permanent deletion.', true, '{*}', 100)
  on conflict (id) do nothing;

  -- Their row if the trigger made one, otherwise a new one. Matched on auth_id
  -- first and email second, which is the same order the app resolves an
  -- identity in — a row made on a till carries no auth_id to match on.
  update staff
  set role = 'admin', active = true, max_discount_percent = 100, auth_id = caller.id
  where auth_id = caller.id or lower(email) = lower(caller.email)
  returning * into claimed;

  if claimed.id is null then
    insert into staff (id, auth_id, name, email, role, active, max_discount_percent)
    values (
      'usr_' || substr(replace(caller.id::text, '-', ''), 1, 12),
      caller.id,
      coalesce(nullif(caller.raw_user_meta_data ->> 'name', ''), split_part(caller.email, '@', 1)),
      caller.email,
      'admin',
      true,
      100
    )
    returning * into claimed;
  end if;

  return claimed;
end;
$$ language plpgsql security definer;

-- `security definer` runs as the owner, so the search path is pinned rather
-- than taken from the caller: without this, a schema earlier on someone's path
-- could shadow `staff` and the function would write somewhere else entirely.
alter function claim_admin() set search_path = public, auth;

revoke all on function claim_admin() from public, anon;
grant execute on function claim_admin() to authenticated;

-- PostgREST routes rpc calls from a cached copy of the schema, so a function
-- that exists in the database is still a 404 until that cache catches up. This
-- is the nudge that makes the call work the moment this script finishes rather
-- than whenever the cache next turns over.
notify pgrst, 'reload schema';
