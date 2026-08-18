-- Tareez Exhibition POS — Supabase schema
--
-- Run this once in the Supabase SQL editor (or `supabase db push`).
--
-- Design notes
--
--  * Ids are `text`, not `uuid`. The client mints them offline (`uid('ord')`)
--    and a sale must keep the same id from the moment it is taken at the stall
--    to the moment it syncs, so the device is the source of ids.
--
--  * `orders.client_id` is unique. That single constraint is what makes a
--    replayed offline queue safe: the outbox already carries an idempotency key
--    per mutation, so a duplicate insert collides instead of double-selling.
--
--  * Nested arrays that are only ever read as a whole (order items, payment
--    parts, closing reports) stay `jsonb`. Anything reported on across rows
--    gets real columns.

/* ----------------------------------------------------------- reference */

create table if not exists settings (
  id          text primary key default 'settings',
  data        jsonb not null,
  updated_at  timestamptz not null default now()
);

create table if not exists roles (
  id                   text primary key,
  name                 text not null,
  description          text default '',
  system               boolean not null default false,
  permissions          text[] not null default '{}',
  max_discount_percent numeric not null default 0
);

-- Application-level staff record. Passwords live in auth.users; this holds what
-- the POS needs (role, PIN, discount ceiling) and links the two.
--
-- The PIN is hashed with a per-user salt, the same way passwords are. Four
-- digits will never survive a determined offline attack, but a PIN that syncs
-- to a server must not sit here in the clear.
create table if not exists staff (
  id                   text primary key,
  auth_id              uuid references auth.users (id) on delete set null,
  name                 text not null,
  email                text unique,
  role                 text references roles (id),
  pin_hash             text,
  pin_salt             text,
  active               boolean not null default false,
  max_discount_percent numeric,
  created_at           timestamptz not null default now()
);

-- For projects created before PINs were hashed.
alter table staff add column if not exists pin_salt text;

/* ------------------------------------------------------------ catalogue */

create table if not exists products (
  id          text primary key,
  name        text not null,
  category    text default '',
  collection  text default '',
  description text default '',
  status      text not null default 'Active',
  image_url   text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists variants (
  id               text primary key,
  product_id       text not null references products (id) on delete cascade,
  sku              text not null unique,
  barcode          text,
  size             text default '',
  color            text default '',
  price            numeric not null default 0,
  -- null means "charge the list price at the stall too"
  exhibition_price numeric,
  cost             numeric not null default 0,
  min_stock        integer not null default 0
);

create index if not exists variants_product_idx on variants (product_id);
create index if not exists variants_barcode_idx on variants (barcode);

/* ---------------------------------------------------------- exhibitions */

create table if not exists exhibitions (
  id             text primary key,
  name           text not null,
  location       text default '',
  start_date     date,
  end_date       date,
  status         text not null default 'Upcoming',
  staff_ids      text[] not null default '{}',
  notes          text default '',
  closed_at      timestamptz,
  closing_report jsonb
);

/* ------------------------------------------------------------ customers */

create table if not exists customers (
  id                text primary key,
  name              text not null,
  whatsapp          text default '',
  phone             text default '',
  email             text default '',
  -- Consent is deliberately separate from contact details: it must never be a
  -- side effect of taking someone's number to send a receipt.
  marketing_consent boolean not null default false,
  consent_at        timestamptz,
  total_orders      integer not null default 0,
  total_spend       numeric not null default 0,
  last_purchase_at  timestamptz,
  exhibition_ids    text[] not null default '{}',
  created_at        timestamptz not null default now()
);

create index if not exists customers_consent_idx on customers (marketing_consent);

/* ---------------------------------------------------------- promo codes */

create table if not exists promo_codes (
  id            text primary key,
  code          text not null unique,
  description   text default '',
  type          text not null default 'percentage',
  value         numeric not null default 0,
  min_spend     numeric not null default 0,
  usage_limit   integer not null default 0,
  used_count    integer not null default 0,
  starts_at     date,
  expires_at    date,
  exhibition_id text default 'all',
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);

/* ---------------------------------------------------------------- sales */

create table if not exists orders (
  id               text primary key,
  -- The offline idempotency key. Unique, so a replayed queue cannot duplicate.
  client_id        text not null unique,
  invoice_no       text not null unique,
  exhibition_id    text,
  customer_id      text references customers (id) on delete set null,
  customer_name    text default '',
  salesperson_id   text,
  salesperson_name text default '',
  items            jsonb not null default '[]',
  subtotal         numeric not null default 0,
  discount_type    text default 'percentage',
  discount_value   numeric not null default 0,
  discount_amount  numeric not null default 0,
  line_discounts   numeric not null default 0,
  promo_code       text default '',
  promo_amount     numeric not null default 0,
  tax              numeric not null default 0,
  total            numeric not null default 0,
  payment_method   text default '',
  payment_parts    jsonb not null default '[]',
  payment_reference text default '',
  status           text not null default 'Completed',
  amount_paid      numeric not null default 0,
  balance_due      numeric not null default 0,
  note             text default '',
  offline_created  boolean not null default false,
  -- Set when the sale went past the recorded stock level, with who authorised it.
  oversell         jsonb,
  refunded_amount  numeric not null default 0,
  created_at       timestamptz not null default now()
);

create index if not exists orders_exhibition_idx on orders (exhibition_id);
create index if not exists orders_customer_idx on orders (customer_id);
create index if not exists orders_created_idx on orders (created_at desc);
create index if not exists orders_status_idx on orders (status);

create table if not exists payments (
  id            text primary key,
  order_id      text references orders (id) on delete cascade,
  invoice_no    text,
  method        text not null,
  amount        numeric not null,
  status        text not null default 'Captured',
  reference     text default '',
  -- 'payment' or 'refund'; refunds carry a negative amount.
  kind          text not null default 'payment',
  exhibition_id text,
  created_at    timestamptz not null default now()
);

create index if not exists payments_order_idx on payments (order_id);
create index if not exists payments_exhibition_idx on payments (exhibition_id);

-- Returns and cancellations share one ledger: both are ways a completed sale
-- gets reversed, and the reason and authoriser matter for both.
create table if not exists returns (
  id               text primary key,
  kind             text not null default 'return',
  order_id         text references orders (id) on delete cascade,
  invoice_no       text,
  exhibition_id    text,
  customer_id      text,
  customer_name    text default '',
  salesperson_name text default '',
  lines            jsonb not null default '[]',
  quantity         integer not null default 0,
  refund_amount    numeric not null default 0,
  balance_cleared  numeric not null default 0,
  method           text default '',
  reason           text default '',
  user_id          text default '',
  user_name        text default '',
  created_at       timestamptz not null default now()
);

create index if not exists returns_exhibition_idx on returns (exhibition_id);

/* ------------------------------------------------------------ inventory */

-- Stock is per location. 'MAIN' is the warehouse; every other id is an
-- exhibition, which is why stall sales never touch warehouse stock.
create table if not exists inventory (
  location_id text not null,
  variant_id  text not null references variants (id) on delete cascade,
  quantity    numeric not null default 0,
  updated_at  timestamptz not null default now(),
  primary key (location_id, variant_id)
);

create table if not exists stock_movements (
  id            text primary key,
  variant_id    text references variants (id) on delete cascade,
  location_id   text not null,
  type          text not null,
  quantity      numeric not null,
  balance_after numeric,
  reference     text default '',
  user_id       text default '',
  note          text default '',
  created_at    timestamptz not null default now()
);

create index if not exists movements_variant_idx on stock_movements (variant_id);
create index if not exists movements_location_idx on stock_movements (location_id);
create index if not exists movements_created_idx on stock_movements (created_at desc);

/* -------------------------------------------------------------- devices */

create table if not exists devices (
  id             text primary key,
  code           text not null,
  label          text default '',
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  last_user_id   text,
  last_user_name text default '',
  -- Set to block the device. Enforced in policy, not just in the client.
  revoked_at     timestamptz,
  user_agent     text default ''
);

/* ---------------------------------------------------------------- audit */

create table if not exists audit_logs (
  id         text primary key,
  user_id    text default '',
  user_name  text default '',
  action     text not null,
  entity     text default '',
  entity_id  text default '',
  detail     text default '',
  device_id  text default '',
  created_at timestamptz not null default now()
);

create index if not exists audit_created_idx on audit_logs (created_at desc);

-- Every mutation the client queued, kept as an append-only log. This is what
-- makes the sync at-least-once safe: a replayed entry collides on client_id.
create table if not exists sync_commands (
  id         text primary key,
  client_id  text not null unique,
  type       text not null,
  payload    jsonb not null,
  device_id  text default '',
  created_at timestamptz not null default now(),
  applied_at timestamptz not null default now()
);

create index if not exists sync_type_idx on sync_commands (type);

/* -------------------------------------------------- invoice numbering */

-- Phase 2: with more than one device, invoice numbers should come from here
-- rather than from a client-side counter. The device code stays in the format
-- so a number still says which till produced it.
create sequence if not exists invoice_seq start 1;

/* -------------------------------------------------------------- security */

alter table settings        enable row level security;
alter table roles           enable row level security;
alter table staff           enable row level security;
alter table products        enable row level security;
alter table variants        enable row level security;
alter table exhibitions     enable row level security;
alter table customers       enable row level security;
alter table promo_codes     enable row level security;
alter table orders          enable row level security;
alter table payments        enable row level security;
alter table returns         enable row level security;
alter table inventory       enable row level security;
alter table stock_movements enable row level security;
alter table devices         enable row level security;
alter table audit_logs      enable row level security;
alter table sync_commands   enable row level security;

-- Is the caller a signed-in, active member of staff on a device that has not
-- been blocked? Everything else builds on this.
create or replace function is_active_staff() returns boolean as $$
  select exists (
    select 1 from staff
    where auth_id = auth.uid()
      and active = true
  );
$$ language sql stable security definer;

-- Does the caller's role carry a permission? '*' means full access.
create or replace function has_permission(needed text) returns boolean as $$
  select exists (
    select 1
    from staff s
    join roles r on r.id = s.role
    where s.auth_id = auth.uid()
      and s.active = true
      and ('*' = any (r.permissions) or needed = any (r.permissions))
  );
$$ language sql stable security definer;

-- Read: any active member of staff. Cost prices are filtered in the client by
-- the `view.cost` permission; tighten to a column-level policy if that matters.
-- Postgres has no `create policy if not exists`, so drop first to keep this
-- script safe to re-run.
do $$
declare t text;
begin
  foreach t in array array[
    'settings','roles','staff','products','variants','exhibitions','customers',
    'promo_codes','orders','payments','returns','inventory','stock_movements',
    'devices','audit_logs','sync_commands'
  ] loop
    execute format('drop policy if exists %I on %I', t || '_read', t);
    execute format(
      'create policy %I on %I for select using (is_active_staff())',
      t || '_read', t
    );
  end loop;
end $$;

-- Write: selling is the common case, so anyone with `pos` may create sales and
-- move stock. Everything else is gated on the matching admin permission.
create policy orders_write          on orders          for insert with check (has_permission('pos'));
create policy orders_update         on orders          for update using (has_permission('pos'));
create policy payments_write        on payments        for insert with check (has_permission('pos'));
create policy returns_write         on returns         for insert with check (has_permission('refund'));
create policy inventory_write       on inventory       for all    using (has_permission('pos'));
create policy movements_write       on stock_movements for insert with check (has_permission('pos'));
create policy customers_write       on customers       for all    using (has_permission('pos'));
create policy sync_write            on sync_commands   for insert with check (is_active_staff());
create policy audit_write           on audit_logs      for insert with check (is_active_staff());
create policy devices_write         on devices         for all    using (is_active_staff());

create policy products_write    on products    for all using (has_permission('admin.products'));
create policy variants_write    on variants    for all using (has_permission('admin.products'));
create policy exhibitions_write on exhibitions for all using (has_permission('admin.exhibitions'));
create policy promos_write      on promo_codes for all using (has_permission('promo.manage'));
create policy settings_write    on settings    for all using (has_permission('admin.settings'));

-- Roles and staff are the keys to the kingdom, so both are gated on
-- `admin.settings` — not on `admin.staff`, which only grants sight of the
-- staff *performance* report. A salesperson holding that must not be able to
-- edit their own role and grant themselves everything else.
create policy roles_write       on roles       for all using (has_permission('admin.settings'));
create policy staff_write       on staff       for all using (has_permission('admin.settings'));

/* ------------------------------------------------------------- realtime */

-- The live owner dashboard subscribes to these.
alter publication supabase_realtime add table orders;
alter publication supabase_realtime add table payments;
alter publication supabase_realtime add table inventory;

/* ------------------------------------------------- default roles */

-- Roles are system constants, not user data: they mirror DEFAULT_ROLES in
-- src/lib/permissions.js and every staff row has a foreign key to one. Seeding
-- them here means a fresh project is never in a state where an account cannot
-- be created because there is no role to give it.
insert into roles (id, name, description, system, permissions, max_discount_percent)
values
  ('admin', 'Admin', 'Full control, including settings, roles and permanent deletion.', true,
   '{*}', 100),
  ('manager', 'Manager', 'Runs the floor: sales, stock, customers and reporting — but not system settings.', true,
   '{pos,sales.own,refund,admin.dashboard,admin.sales,admin.products,admin.inventory,admin.exhibitions,admin.customers,admin.staff,admin.reports,view.cost,stock.adjust,stock.oversell,promo.manage}', 30),
  ('salesperson', 'Salesperson', 'Sells at the stall and manages customers. No cost prices or reports.', true,
   '{pos,sales.own,admin.customers}', 10)
on conflict (id) do update set
  name                 = excluded.name,
  description          = excluded.description,
  permissions          = excluded.permissions,
  max_discount_percent = excluded.max_discount_percent;

/* --------------------------------------------- account provisioning */

-- Give every new sign-in a staff record automatically.
--
-- Without this there is a dead end: RLS needs an active staff row, but creating
-- one needs an account that already has one, so a fresh project can never be
-- opened without hand-written SQL. This closes it the same way the app already
-- behaves offline — the first account to exist owns the system, and everyone
-- after it arrives inactive and waits for an admin to approve them.
--
-- `security definer` is what lets the trigger write past RLS.
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

-- Anyone who signed up before the trigger existed still needs a record, and the
-- earliest of them takes the system.
insert into staff (id, auth_id, name, email, role, active, max_discount_percent)
select
  'usr_' || substr(replace(u.id::text, '-', ''), 1, 12),
  u.id,
  coalesce(nullif(u.raw_user_meta_data ->> 'name', ''), split_part(u.email, '@', 1)),
  u.email,
  case when u.created_at = (select min(created_at) from auth.users) then 'admin' else 'salesperson' end,
  u.created_at = (select min(created_at) from auth.users),
  case when u.created_at = (select min(created_at) from auth.users) then 100 else 10 end
from auth.users u
where not exists (select 1 from staff s where s.auth_id = u.id or lower(s.email) = lower(u.email))
on conflict (email) do nothing;
