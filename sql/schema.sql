create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  customer_name text not null,
  phone text not null,
  delivery_location text not null,
  note text,
  total_amount integer not null default 0
);

alter table public.orders
  add column if not exists user_id uuid references auth.users(id);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  product_name text not null,
  unit_price integer not null check (unit_price >= 0),
  quantity integer not null check (quantity > 0),
  line_total integer not null
);

create table if not exists public.favorite_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  product_name text not null,
  unit_price integer not null default 0 check (unit_price >= 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists favorite_items_user_product_key
  on public.favorite_items (user_id, product_name);

create table if not exists public.popular_products (
  id uuid primary key default gen_random_uuid(),
  product_name text not null check (length(trim(product_name)) between 1 and 120),
  specification text not null default '' check (length(specification) <= 160),
  category text not null default '其他' check (length(trim(category)) between 1 and 60),
  unit_price_min integer,
  unit_price integer not null check (unit_price >= 0),
  image_path text not null check (length(trim(image_path)) > 0),
  costco_url text check (
    costco_url is null
    or costco_url = 'https://www.costco.com.tw'
    or costco_url like 'https://www.costco.com.tw/%'
  ),
  is_active boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.popular_products
  add column if not exists unit_price_min integer;

alter table public.popular_products
  drop constraint if exists popular_products_price_range_check;

alter table public.popular_products
  add constraint popular_products_price_range_check
  check (
    unit_price_min is null
    or (unit_price_min >= 0 and unit_price_min <= unit_price)
  );

create unique index if not exists popular_products_name_specification_key
  on public.popular_products (lower(trim(product_name)), lower(trim(specification)));

create index if not exists popular_products_public_order_idx
  on public.popular_products (is_active, sort_order, updated_at desc);

alter table public.order_items
  add column if not exists catalog_product_id uuid
    references public.popular_products(id) on delete set null;

create index if not exists order_items_catalog_product_id_idx
  on public.order_items (catalog_product_id);

create table if not exists public.member_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  account text not null check (account ~ '^[a-z0-9]{6,30}$'),
  email text not null,
  real_phone text not null check (char_length(real_phone) between 8 and 20),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists member_profiles_account_key
  on public.member_profiles (account);

create unique index if not exists member_profiles_email_key
  on public.member_profiles (email);

create unique index if not exists member_profiles_real_phone_key
  on public.member_profiles (real_phone);

create table if not exists public.ordering_schedule (
  id integer primary key default 1 check (id = 1),
  open_day smallint not null check (open_day between 0 and 6),
  open_hour smallint not null check (open_hour between 0 and 23),
  close_day smallint not null check (close_day between 0 and 6),
  close_hour smallint not null check (close_hour between 0 and 23),
  is_always_open boolean not null default true,
  timezone text not null default 'Asia/Taipei',
  updated_at timestamptz not null default now()
);

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  note text
);

alter table public.ordering_schedule
  add column if not exists is_always_open boolean not null default true;

insert into public.ordering_schedule (id, open_day, open_hour, close_day, close_hour, is_always_open)
values (1, 0, 0, 6, 23, true)
on conflict (id) do nothing;

create or replace function public.sync_member_profile_from_auth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full_name text;
  v_account text;
  v_email text;
  v_phone text;
begin
  v_full_name := trim(coalesce(new.raw_user_meta_data->>'full_name', ''));
  v_account := lower(trim(coalesce(new.raw_user_meta_data->>'account', '')));
  v_email := lower(trim(coalesce(new.email, '')));
  v_phone := regexp_replace(coalesce(new.raw_user_meta_data->>'real_phone', ''), '[^\d+]', '', 'g');

  if v_full_name = '' or v_account = '' or v_email = '' or v_phone = '' then
    return new;
  end if;

  insert into public.member_profiles (
    user_id,
    full_name,
    account,
    email,
    real_phone,
    created_at,
    updated_at
  )
  values (
    new.id,
    v_full_name,
    v_account,
    v_email,
    v_phone,
    now(),
    now()
  )
  on conflict (user_id) do update
    set full_name = excluded.full_name,
        account = excluded.account,
        email = excluded.email,
        real_phone = excluded.real_phone,
        updated_at = now();

  return new;
end;
$$;

drop trigger if exists sync_member_profile_from_auth on auth.users;
create trigger sync_member_profile_from_auth
after insert or update of email, raw_user_meta_data on auth.users
for each row execute function public.sync_member_profile_from_auth();

create or replace function public.set_line_total()
returns trigger
language plpgsql
as $$
begin
  new.line_total := new.unit_price * new.quantity;
  return new;
end;
$$;

drop trigger if exists set_line_total_before_change on public.order_items;
create trigger set_line_total_before_change
before insert or update on public.order_items
for each row execute function public.set_line_total();

create or replace function public.touch_popular_product_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_popular_product_updated_at on public.popular_products;
create trigger touch_popular_product_updated_at
before update on public.popular_products
for each row execute function public.touch_popular_product_updated_at();

create or replace function public.update_order_total()
returns trigger
language plpgsql
as $$
declare
  target_id uuid;
begin
  target_id := coalesce(new.order_id, old.order_id);
  update public.orders
    set total_amount = coalesce((select sum(line_total) from public.order_items where order_id = target_id), 0)
    where id = target_id;
  return coalesce(new, old);
end;
$$;

drop trigger if exists update_order_total_after_change on public.order_items;
create trigger update_order_total_after_change
after insert or update or delete on public.order_items
for each row execute function public.update_order_total();

create or replace function public.ordering_open_now()
returns boolean
language plpgsql
stable
as $$
declare
  always_open boolean;
  open_d int;
  open_h int;
  close_d int;
  close_h int;
  tz text;
  now_local timestamp;
  now_min int;
  open_min int;
  close_min int;
begin
  select is_always_open, open_day, open_hour, close_day, close_hour, timezone
    into always_open, open_d, open_h, close_d, close_h, tz
    from public.ordering_schedule
    where id = 1;

  if always_open is true then
    return true;
  end if;

  if open_d is null then
    return true;
  end if;

  now_local := now() at time zone tz;
  now_min := (extract(dow from now_local) * 1440)
             + (extract(hour from now_local) * 60)
             + extract(minute from now_local);
  open_min := (open_d * 1440) + (open_h * 60);
  close_min := (close_d * 1440) + (close_h * 60) + 59;

  if open_min <= close_min then
    return now_min between open_min and close_min;
  end if;

  return now_min >= open_min or now_min <= close_min;
end;
$$;

alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.favorite_items enable row level security;
alter table public.popular_products enable row level security;
alter table public.member_profiles enable row level security;
alter table public.ordering_schedule enable row level security;
alter table public.admin_users enable row level security;

create or replace function public.is_admin_user()
returns boolean
language sql
stable
as $$
  select exists (
    select 1
      from public.admin_users
      where user_id = auth.uid()
  );
$$;

drop policy if exists "admin self read" on public.admin_users;
create policy "admin self read"
  on public.admin_users
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "admin read profiles" on public.member_profiles;
create policy "admin read profiles"
  on public.member_profiles
  for select
  to authenticated
  using (public.is_admin_user());

drop policy if exists "member read own profile" on public.member_profiles;
create policy "member read own profile"
  on public.member_profiles
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "member insert own profile" on public.member_profiles;
create policy "member insert own profile"
  on public.member_profiles
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists "member update own profile" on public.member_profiles;
create policy "member update own profile"
  on public.member_profiles
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "public insert orders when open" on public.orders;
drop policy if exists "public insert orders always open" on public.orders;
drop policy if exists "public insert items when open" on public.order_items;
drop policy if exists "public insert items always open" on public.order_items;

drop policy if exists "admin read orders" on public.orders;
create policy "admin read orders"
  on public.orders
  for select
  to authenticated
  using (public.is_admin_user());

drop policy if exists "member read own orders" on public.orders;
create policy "member read own orders"
  on public.orders
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "admin update orders" on public.orders;
create policy "admin update orders"
  on public.orders
  for update
  to authenticated
  using (public.is_admin_user())
  with check (public.is_admin_user());

drop policy if exists "admin read items" on public.order_items;
create policy "admin read items"
  on public.order_items
  for select
  to authenticated
  using (public.is_admin_user());

drop policy if exists "member read own items" on public.order_items;
create policy "member read own items"
  on public.order_items
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.orders o
        where o.id = order_id
          and o.user_id = auth.uid()
    )
  );

drop policy if exists "member manage favorites" on public.favorite_items;
create policy "member manage favorites"
  on public.favorite_items
  for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "public read active popular products" on public.popular_products;
create policy "public read active popular products"
  on public.popular_products
  for select
  to anon, authenticated
  using (is_active);

drop policy if exists "admin read all popular products" on public.popular_products;
create policy "admin read all popular products"
  on public.popular_products
  for select
  to authenticated
  using (public.is_admin_user());

drop policy if exists "admin insert popular products" on public.popular_products;
create policy "admin insert popular products"
  on public.popular_products
  for insert
  to authenticated
  with check (public.is_admin_user());

drop policy if exists "admin update popular products" on public.popular_products;
create policy "admin update popular products"
  on public.popular_products
  for update
  to authenticated
  using (public.is_admin_user())
  with check (public.is_admin_user());

drop policy if exists "admin delete popular products" on public.popular_products;
create policy "admin delete popular products"
  on public.popular_products
  for delete
  to authenticated
  using (public.is_admin_user());

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'popular-products',
  'popular-products',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public read popular product images" on storage.objects;
create policy "public read popular product images"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'popular-products');

drop policy if exists "admin insert popular product images" on storage.objects;
create policy "admin insert popular product images"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'popular-products' and public.is_admin_user());

drop policy if exists "admin update popular product images" on storage.objects;
create policy "admin update popular product images"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'popular-products' and public.is_admin_user())
  with check (bucket_id = 'popular-products' and public.is_admin_user());

drop policy if exists "admin delete popular product images" on storage.objects;
create policy "admin delete popular product images"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'popular-products' and public.is_admin_user());

drop policy if exists "public read schedule" on public.ordering_schedule;
create policy "public read schedule"
  on public.ordering_schedule
  for select
  to anon, authenticated
  using (true);

drop policy if exists "admin update schedule" on public.ordering_schedule;
create policy "admin update schedule"
  on public.ordering_schedule
  for update
  to authenticated
  using (public.is_admin_user())
  with check (public.is_admin_user());

alter table public.orders
  add column if not exists idempotency_key text;

create unique index if not exists orders_idempotency_key_key
  on public.orders (idempotency_key);

alter table public.orders
  add column if not exists status text not null default 'open';

alter table public.orders
  add column if not exists batch_id text;

alter table public.orders
  add column if not exists admin_note text;

create index if not exists orders_user_id_idx
  on public.orders (user_id);

create index if not exists orders_batch_id_idx
  on public.orders (batch_id);

create index if not exists orders_status_idx
  on public.orders (status);

drop function if exists public.create_order(
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text,
  uuid
);
drop function if exists public.create_order(
  text,
  text,
  text,
  text,
  jsonb,
  text
);
drop function if exists public.create_order(
  text,
  text,
  text,
  text,
  jsonb,
  text,
  text
);

create or replace function public.create_order(
  p_delivery_location text,
  p_note text,
  p_items jsonb,
  p_idempotency_key text,
  p_batch_id text,
  p_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_item jsonb;
  v_name text;
  v_unit_price int;
  v_quantity int;
  v_catalog_product_id uuid;
  v_catalog_product public.popular_products%rowtype;
  v_items_total int := 0;
  v_shipping_total int := 0;
  v_total int := 0;
  v_customer_name text;
  v_phone text;
begin
  if p_user_id is null
     or p_delivery_location is null or length(trim(p_delivery_location)) = 0
     or p_idempotency_key is null or length(trim(p_idempotency_key)) < 8
     or p_batch_id is null or length(trim(p_batch_id)) = 0 then
    raise exception 'Missing required fields';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'Items required';
  end if;

  select full_name, real_phone
    into v_customer_name, v_phone
    from public.member_profiles
    where user_id = p_user_id;

  if v_customer_name is null or v_phone is null then
    raise exception 'Member profile required';
  end if;

  begin
    insert into public.orders (
      customer_name,
      phone,
      delivery_location,
      note,
      total_amount,
      idempotency_key,
      batch_id,
      user_id
    )
    values (
      v_customer_name,
      v_phone,
      p_delivery_location,
      nullif(p_note, ''),
      0,
      p_idempotency_key,
      p_batch_id,
      p_user_id
    )
    returning id into v_order_id;
  exception
    when unique_violation then
      select id into v_order_id
        from public.orders
        where idempotency_key = p_idempotency_key;
      return v_order_id;
  end;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_name := trim(coalesce(v_item->>'product_name', ''));
    if v_name = '' then
      continue;
    end if;

    v_unit_price := (v_item->>'unit_price')::int;
    v_quantity := (v_item->>'quantity')::int;
    v_catalog_product_id := null;

    if nullif(trim(coalesce(v_item->>'catalog_product_id', '')), '') is not null then
      begin
        v_catalog_product_id := (v_item->>'catalog_product_id')::uuid;
      exception
        when invalid_text_representation then
          raise exception 'CATALOG_UNAVAILABLE:%', v_item->>'catalog_product_id';
      end;

      select *
        into v_catalog_product
        from public.popular_products
        where id = v_catalog_product_id
          and is_active = true;

      if not found then
        raise exception 'CATALOG_UNAVAILABLE:%', v_catalog_product_id;
      end if;

      if v_unit_price <> v_catalog_product.unit_price then
        raise exception 'CATALOG_PRICE_CHANGED:%', v_catalog_product_id;
      end if;

      v_name := concat_ws(
        ' ',
        trim(v_catalog_product.product_name),
        nullif(trim(v_catalog_product.specification), '')
      );
      v_unit_price := v_catalog_product.unit_price;
    end if;

    if v_unit_price < 0 or v_quantity <= 0 then
      raise exception 'Invalid item';
    end if;

    v_items_total := v_items_total + (v_unit_price * v_quantity);
    v_shipping_total := v_shipping_total + (v_quantity * 20);

    insert into public.order_items (
      order_id,
      product_name,
      unit_price,
      quantity,
      line_total,
      catalog_product_id
    )
    values (
      v_order_id,
      v_name,
      v_unit_price,
      v_quantity,
      v_unit_price * v_quantity,
      v_catalog_product_id
    );
  end loop;

  if v_items_total = 0 then
    raise exception 'Items required';
  end if;

  v_total := v_items_total + v_shipping_total;

  update public.orders
    set total_amount = v_total
      , status = case
          when v_total > 300 then 'pending_deposit'
          else 'open'
        end
    where id = v_order_id;

  return v_order_id;
end;
$$;

revoke all on function public.create_order(text, text, jsonb, text, text, uuid) from public;
grant execute on function public.create_order(text, text, jsonb, text, text, uuid) to service_role;

-- Admin operations, payments, audit history, and reporting.
alter table public.orders
  add column if not exists selected_payment_method text,
  add column if not exists payment_selected_at timestamptz,
  add column if not exists deposit_paid_amount integer not null default 0,
  add column if not exists deposit_payment_method text,
  add column if not exists deposit_paid_at timestamptz,
  add column if not exists balance_paid_amount integer not null default 0,
  add column if not exists balance_payment_method text,
  add column if not exists balance_paid_at timestamptz,
  add column if not exists payment_review_required boolean not null default true,
  add column if not exists updated_at timestamptz;

update public.orders
set updated_at = coalesce(updated_at, created_at, now());

alter table public.orders
  alter column updated_at set default now(),
  alter column updated_at set not null,
  alter column payment_review_required set default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'orders_status_valid'
  ) then
    alter table public.orders
      add constraint orders_status_valid
      check (status in ('pending_deposit', 'open', 'ready_pickup', 'fulfilled', 'archived'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'orders_payment_methods_valid'
  ) then
    alter table public.orders
      add constraint orders_payment_methods_valid
      check (
        (selected_payment_method is null or selected_payment_method in ('cash', 'transfer'))
        and (deposit_payment_method is null or deposit_payment_method in ('cash', 'transfer'))
        and (balance_payment_method is null or balance_payment_method in ('cash', 'transfer'))
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'orders_payment_amounts_valid'
  ) then
    alter table public.orders
      add constraint orders_payment_amounts_valid
      check (
        deposit_paid_amount >= 0
        and balance_paid_amount >= 0
        and deposit_paid_amount + balance_paid_amount <= total_amount
      );
  end if;
end
$$;

create table if not exists public.order_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_email text,
  event_type text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists order_events_order_created_idx
  on public.order_events (order_id, created_at desc);

alter table public.order_events enable row level security;

drop policy if exists "admin read order events" on public.order_events;
create policy "admin read order events"
  on public.order_events
  for select
  to authenticated
  using (public.is_admin_user());

create or replace function public.order_payment_status(
  p_total integer,
  p_deposit integer,
  p_balance integer,
  p_review_required boolean
)
returns text
language sql
immutable
as $$
  select case
    when coalesce(p_review_required, false) then 'needs_review'
    when coalesce(p_deposit, 0) + coalesce(p_balance, 0) >= greatest(coalesce(p_total, 0), 0) then 'paid'
    when coalesce(p_deposit, 0) + coalesce(p_balance, 0) > 0 then 'deposit_paid'
    else 'unpaid'
  end;
$$;

create or replace function public.touch_order_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_order_updated_at_before_change on public.orders;
create trigger touch_order_updated_at_before_change
before update on public.orders
for each row execute function public.touch_order_updated_at();

create or replace function public.log_order_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text := 'order_updated';
  v_reason text := nullif(current_setting('app.order_change_reason', true), '');
begin
  if old.status is distinct from new.status then
    v_type := 'status_changed';
  elsif old.deposit_paid_amount is distinct from new.deposit_paid_amount
     or old.deposit_payment_method is distinct from new.deposit_payment_method
     or old.deposit_paid_at is distinct from new.deposit_paid_at
     or old.balance_paid_amount is distinct from new.balance_paid_amount
     or old.balance_payment_method is distinct from new.balance_payment_method
     or old.balance_paid_at is distinct from new.balance_paid_at
     or old.payment_review_required is distinct from new.payment_review_required
     or old.selected_payment_method is distinct from new.selected_payment_method then
    v_type := 'payment_updated';
  elsif old.admin_note is distinct from new.admin_note then
    v_type := 'note_updated';
  end if;

  if old.status is distinct from new.status
     or old.admin_note is distinct from new.admin_note
     or old.deposit_paid_amount is distinct from new.deposit_paid_amount
     or old.deposit_payment_method is distinct from new.deposit_payment_method
     or old.deposit_paid_at is distinct from new.deposit_paid_at
     or old.balance_paid_amount is distinct from new.balance_paid_amount
     or old.balance_payment_method is distinct from new.balance_payment_method
     or old.balance_paid_at is distinct from new.balance_paid_at
     or old.payment_review_required is distinct from new.payment_review_required
     or old.selected_payment_method is distinct from new.selected_payment_method then
    insert into public.order_events (order_id, actor_user_id, actor_email, event_type, details)
    values (
      new.id,
      auth.uid(),
      auth.jwt()->>'email',
      v_type,
      jsonb_strip_nulls(jsonb_build_object(
        'reason', v_reason,
        'from_status', old.status,
        'to_status', new.status,
        'from_admin_note', old.admin_note,
        'to_admin_note', new.admin_note,
        'from_deposit_amount', old.deposit_paid_amount,
        'to_deposit_amount', new.deposit_paid_amount,
        'from_balance_amount', old.balance_paid_amount,
        'to_balance_amount', new.balance_paid_amount,
        'selected_payment_method', new.selected_payment_method,
        'deposit_payment_method', new.deposit_payment_method,
        'balance_payment_method', new.balance_payment_method,
        'payment_review_required', new.payment_review_required
      ))
    );
  end if;

  return new;
end;
$$;

drop trigger if exists log_order_change_after_update on public.orders;
create trigger log_order_change_after_update
after update on public.orders
for each row execute function public.log_order_change();

create or replace function public.admin_list_orders(
  p_search text default null,
  p_status text default null,
  p_payment_status text default null,
  p_location text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_limit integer default 12,
  p_offset integer default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.is_admin_user() then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  with filtered as (
    select o.*
    from public.orders o
    where (
      nullif(trim(p_search), '') is null
      or o.id::text ilike '%' || trim(p_search) || '%'
      or o.customer_name ilike '%' || trim(p_search) || '%'
      or o.phone ilike '%' || trim(p_search) || '%'
      or exists (
        select 1 from public.order_items oi
        where oi.order_id = o.id
          and oi.product_name ilike '%' || trim(p_search) || '%'
      )
    )
      and (nullif(p_status, '') is null or p_status = 'all' or o.status = p_status)
      and (nullif(p_location, '') is null or p_location = 'all' or o.delivery_location = p_location)
      and (
        nullif(p_payment_status, '') is null
        or p_payment_status = 'all'
        or public.order_payment_status(
          o.total_amount,
          o.deposit_paid_amount,
          o.balance_paid_amount,
          o.payment_review_required
        ) = p_payment_status
      )
      and (
        p_date_from is null
        or o.created_at >= (p_date_from::timestamp at time zone 'Asia/Taipei')
      )
      and (
        p_date_to is null
        or o.created_at < ((p_date_to + 1)::timestamp at time zone 'Asia/Taipei')
      )
  ), paged as (
    select *
    from filtered
    order by created_at desc
    limit greatest(1, least(coalesce(p_limit, 12), 100))
    offset greatest(coalesce(p_offset, 0), 0)
  )
  select jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(
        to_jsonb(p)
        || jsonb_build_object(
          'payment_status', public.order_payment_status(
            p.total_amount,
            p.deposit_paid_amount,
            p.balance_paid_amount,
            p.payment_review_required
          ),
          'outstanding_amount', greatest(
            p.total_amount - p.deposit_paid_amount - p.balance_paid_amount,
            0
          ),
          'order_items', coalesce((
            select jsonb_agg(to_jsonb(oi) order by oi.id)
            from public.order_items oi
            where oi.order_id = p.id
          ), '[]'::jsonb)
        )
        order by p.created_at desc
      )
      from paged p
    ), '[]'::jsonb),
    'total', (select count(*) from filtered)
  ) into v_result;

  return v_result;
end;
$$;

create or replace function public.admin_order_summary()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today_start timestamptz;
  v_tomorrow_start timestamptz;
  v_result jsonb;
begin
  if not public.is_admin_user() then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  v_today_start := date_trunc('day', now() at time zone 'Asia/Taipei') at time zone 'Asia/Taipei';
  v_tomorrow_start := v_today_start + interval '1 day';

  select jsonb_build_object(
    'today_orders', count(*) filter (
      where created_at >= v_today_start and created_at < v_tomorrow_start
    ),
    'pending_deposit', count(*) filter (where status = 'pending_deposit'),
    'ready_pickup', count(*) filter (where status = 'ready_pickup'),
    'outstanding_amount', coalesce(sum(
      greatest(total_amount - deposit_paid_amount - balance_paid_amount, 0)
    ) filter (where status in ('pending_deposit', 'open', 'ready_pickup')), 0)
  )
  into v_result
  from public.orders;

  return v_result;
end;
$$;

create or replace function public.admin_update_order(
  p_order_id uuid,
  p_status text,
  p_admin_note text default null,
  p_reason text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_old_rank integer;
  v_new_rank integer;
  v_deposit_due integer;
begin
  if not public.is_admin_user() then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if p_status not in ('pending_deposit', 'open', 'ready_pickup', 'fulfilled', 'archived') then
    raise exception 'INVALID_STATUS';
  end if;

  v_old_rank := case v_order.status
    when 'pending_deposit' then 1 when 'open' then 2 when 'ready_pickup' then 3
    when 'fulfilled' then 4 when 'archived' then 5 else 0 end;
  v_new_rank := case p_status
    when 'pending_deposit' then 1 when 'open' then 2 when 'ready_pickup' then 3
    when 'fulfilled' then 4 when 'archived' then 5 else 0 end;

  if v_new_rank > v_old_rank + 1 then
    raise exception 'STATUS_STEP_REQUIRED';
  end if;

  if (v_new_rank < v_old_rank or p_status = 'archived')
     and nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'STATUS_REASON_REQUIRED';
  end if;

  if p_status = 'archived' and v_order.status <> 'fulfilled' then
    raise exception 'FULFILLED_REQUIRED';
  end if;

  v_deposit_due := case
    when v_order.total_amount > 300 then ceil(v_order.total_amount * 0.5)::integer
    else 0
  end;

  if v_order.status = 'pending_deposit' and p_status = 'open'
     and v_order.deposit_paid_amount + v_order.balance_paid_amount < v_deposit_due then
    raise exception 'DEPOSIT_REQUIRED';
  end if;

  if p_status = 'fulfilled'
     and v_order.deposit_paid_amount + v_order.balance_paid_amount < v_order.total_amount then
    raise exception 'PAYMENT_REQUIRED';
  end if;

  perform set_config('app.order_change_reason', coalesce(p_reason, ''), true);

  update public.orders
  set status = p_status,
      admin_note = coalesce(p_admin_note, admin_note)
  where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

create or replace function public.admin_save_order_payment(
  p_order_id uuid,
  p_phase text,
  p_amount integer,
  p_method text,
  p_paid_at timestamptz default null,
  p_review_complete boolean default true
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_next_deposit integer;
  v_next_balance integer;
  v_deposit_due integer;
begin
  if not public.is_admin_user() then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  if p_phase not in ('deposit', 'balance') then
    raise exception 'INVALID_PAYMENT_PHASE';
  end if;
  if coalesce(p_amount, 0) < 0 then
    raise exception 'INVALID_PAYMENT_AMOUNT';
  end if;
  if p_amount > 0 and p_method not in ('cash', 'transfer') then
    raise exception 'PAYMENT_METHOD_REQUIRED';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  v_next_deposit := case when p_phase = 'deposit' then p_amount else v_order.deposit_paid_amount end;
  v_next_balance := case when p_phase = 'balance' then p_amount else v_order.balance_paid_amount end;

  if v_next_deposit + v_next_balance > v_order.total_amount then
    raise exception 'PAYMENT_EXCEEDS_TOTAL';
  end if;

  v_deposit_due := case
    when v_order.total_amount > 300 then ceil(v_order.total_amount * 0.5)::integer
    else 0
  end;

  perform set_config('app.order_change_reason', '付款資料更新', true);

  update public.orders
  set deposit_paid_amount = v_next_deposit,
      deposit_payment_method = case
        when p_phase = 'deposit' and p_amount > 0 then p_method
        when p_phase = 'deposit' then null
        else deposit_payment_method
      end,
      deposit_paid_at = case
        when p_phase = 'deposit' and p_amount > 0 then coalesce(p_paid_at, now())
        when p_phase = 'deposit' then null
        else deposit_paid_at
      end,
      balance_paid_amount = v_next_balance,
      balance_payment_method = case
        when p_phase = 'balance' and p_amount > 0 then p_method
        when p_phase = 'balance' then null
        else balance_payment_method
      end,
      balance_paid_at = case
        when p_phase = 'balance' and p_amount > 0 then coalesce(p_paid_at, now())
        when p_phase = 'balance' then null
        else balance_paid_at
      end,
      payment_review_required = not p_review_complete,
      status = case
        when status = 'pending_deposit' and v_next_deposit + v_next_balance >= v_deposit_due then 'open'
        else status
      end
  where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

create or replace function public.member_set_order_payment_method(
  p_order_id uuid,
  p_method text
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = '42501';
  end if;
  if p_method not in ('cash', 'transfer') then
    raise exception 'INVALID_PAYMENT_METHOD';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id and user_id = auth.uid()
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if v_order.total_amount > 300 and p_method <> 'transfer' then
    raise exception 'TRANSFER_REQUIRED';
  end if;
  if v_order.deposit_paid_amount + v_order.balance_paid_amount > 0 then
    raise exception 'PAYMENT_ALREADY_RECORDED';
  end if;

  update public.orders
  set selected_payment_method = p_method,
      payment_selected_at = now()
  where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

create or replace function public.admin_export_orders(
  p_search text default null,
  p_status text default null,
  p_payment_status text default null,
  p_location text default null,
  p_date_from date default null,
  p_date_to date default null
)
returns table (
  order_id uuid,
  created_at timestamptz,
  customer_name text,
  phone text,
  delivery_location text,
  order_status text,
  payment_status text,
  total_amount integer,
  deposit_paid_amount integer,
  balance_paid_amount integer,
  outstanding_amount integer,
  product_name text,
  unit_price integer,
  quantity integer,
  line_total integer,
  customer_note text,
  admin_note text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin_user() then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  return query
  select
    o.id,
    o.created_at,
    o.customer_name,
    o.phone,
    o.delivery_location,
    o.status,
    public.order_payment_status(
      o.total_amount,
      o.deposit_paid_amount,
      o.balance_paid_amount,
      o.payment_review_required
    ),
    o.total_amount,
    o.deposit_paid_amount,
    o.balance_paid_amount,
    greatest(o.total_amount - o.deposit_paid_amount - o.balance_paid_amount, 0),
    oi.product_name,
    oi.unit_price,
    oi.quantity,
    oi.line_total,
    o.note,
    o.admin_note
  from public.orders o
  join public.order_items oi on oi.order_id = o.id
  where (
    nullif(trim(p_search), '') is null
    or o.id::text ilike '%' || trim(p_search) || '%'
    or o.customer_name ilike '%' || trim(p_search) || '%'
    or o.phone ilike '%' || trim(p_search) || '%'
    or exists (
      select 1 from public.order_items search_item
      where search_item.order_id = o.id
        and search_item.product_name ilike '%' || trim(p_search) || '%'
    )
  )
    and (nullif(p_status, '') is null or p_status = 'all' or o.status = p_status)
    and (nullif(p_location, '') is null or p_location = 'all' or o.delivery_location = p_location)
    and (
      nullif(p_payment_status, '') is null
      or p_payment_status = 'all'
      or public.order_payment_status(
        o.total_amount,
        o.deposit_paid_amount,
        o.balance_paid_amount,
        o.payment_review_required
      ) = p_payment_status
    )
    and (p_date_from is null or o.created_at >= (p_date_from::timestamp at time zone 'Asia/Taipei'))
    and (p_date_to is null or o.created_at < ((p_date_to + 1)::timestamp at time zone 'Asia/Taipei'))
  order by o.created_at desc, o.id, oi.id;
end;
$$;

grant select on public.order_events to authenticated;
grant execute on function public.admin_list_orders(text, text, text, text, date, date, integer, integer) to authenticated;
grant execute on function public.admin_order_summary() to authenticated;
grant execute on function public.admin_update_order(uuid, text, text, text) to authenticated;
grant execute on function public.admin_save_order_payment(uuid, text, integer, text, timestamptz, boolean) to authenticated;
grant execute on function public.member_set_order_payment_method(uuid, text) to authenticated;
grant execute on function public.admin_export_orders(text, text, text, text, date, date) to authenticated;
