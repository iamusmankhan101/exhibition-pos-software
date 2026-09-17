/*
 * Repairs the link between an auth user and its staff row.
 *
 * Symptom this fixes: a correct password is accepted, and the app then says
 * "No staff record is linked to <email>. An admin needs to finish setting it
 * up." Supabase authenticated you; the staff read that follows came back empty.
 *
 * There are four ways to arrive there, and they look identical from the login
 * screen because RLS hides the evidence either way:
 *
 *   1. No staff row at all — the provisioning trigger was not installed when
 *      the account signed up, so nothing was created for it.
 *   2. A staff row with auth_id NULL — the app created it offline. The adapter
 *      omits auth_id rather than nulling a live link (see `staffRow`), so a row
 *      that has only ever existed on a till has nothing tying it to a login.
 *   3. A staff row that is inactive — it exists and is waiting for approval.
 *   4. A staff row linked to a different auth user than the one signing in.
 *
 * Steps 1 to 3 below are safe and idempotent. Step 4 is deliberately left to a
 * human: repointing a link is how somebody ends up with another person's
 * account, so it is not something a repair script should decide.
 *
 * Run the whole file. The select at the end prints what you are left with.
 */

/* -- 1. Make sure the trigger exists for every future signup ------------- */

-- Identical to schema.sql. Re-running the whole of schema.sql does this too.
create or replace function handle_new_auth_user() returns trigger as $$
declare
  is_first boolean;
begin
  select not exists (select 1 from public.staff) into is_first;

  insert into public.staff (id, auth_id, name, email, role, active, max_discount_percent)
  values (
    'usr_' || substr(replace(new.id::text, '-', ''), 1, 12),
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'name', ''), split_part(new.email, '@', 1)),
    new.email,
    case when is_first then 'admin' else 'salesperson' end,
    is_first,
    case when is_first then 100 else 10 end
  )
  on conflict (email) do update set auth_id = excluded.auth_id;

  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_auth_user();

/* -- 2. Link rows that were made on a till and never tied to a login ----- */

-- Only ever fills a blank. A row already pointing at somebody is left exactly
-- as it is: silently moving a link is how one person inherits another's
-- account, and if that is what happened it needs a person looking at it.
update staff s
set auth_id = u.id
from auth.users u
where lower(s.email) = lower(u.email)
  and s.auth_id is null;

/* -- 3. Give any auth user with no staff row at all one ------------------ */

-- Inactive and least-privileged, the same as any ordinary signup. Approving it
-- is a separate, deliberate act — see the note under the select below.
insert into staff (id, auth_id, name, email, role, active, max_discount_percent)
select
  'usr_' || substr(replace(u.id::text, '-', ''), 1, 12),
  u.id,
  coalesce(nullif(u.raw_user_meta_data ->> 'name', ''), split_part(u.email, '@', 1)),
  u.email,
  'salesperson',
  false,
  10
from auth.users u
where not exists (
  select 1 from staff s where s.auth_id = u.id or lower(s.email) = lower(u.email)
)
on conflict (email) do update set auth_id = excluded.auth_id;

/* -- 4. What you are left with ------------------------------------------- */

select
  u.email                                   as auth_email,
  u.created_at                              as auth_created,
  u.confirmed_at,
  s.id                                      as staff_id,
  s.email                                   as staff_email,
  s.role,
  s.active,
  (s.auth_id = u.id)                        as linked
from auth.users u
full outer join staff s on s.auth_id = u.id
order by u.created_at nulls last;
