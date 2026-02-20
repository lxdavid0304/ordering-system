-- Edge Function setup (member-only order creation via backend service role)

drop table if exists public.rate_limits;

create table public.rate_limits (
  key text primary key,
  ip text,
  device_id text,
  phone text,
  user_id uuid,
  last_request timestamptz not null
);

alter table public.rate_limits enable row level security;

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

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  note text
);

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

alter table public.orders
  add column if not exists user_id uuid references auth.users(id);

create index if not exists orders_batch_id_idx
  on public.orders (batch_id);

create index if not exists orders_status_idx
  on public.orders (status);

create index if not exists orders_user_id_idx
  on public.orders (user_id);

alter table public.member_profiles enable row level security;

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

    if v_unit_price < 0 or v_quantity <= 0 then
      raise exception 'Invalid item';
    end if;

    v_total := v_total + (v_unit_price * v_quantity);

    insert into public.order_items (
      order_id,
      product_name,
      unit_price,
      quantity,
      line_total
    )
    values (
      v_order_id,
      v_name,
      v_unit_price,
      v_quantity,
      v_unit_price * v_quantity
    );
  end loop;

  if v_total = 0 then
    raise exception 'Items required';
  end if;

  update public.orders
    set total_amount = v_total
    where id = v_order_id;

  return v_order_id;
end;
$$;

revoke all on function public.create_order(text, text, jsonb, text, text, uuid) from public;
grant execute on function public.create_order(text, text, jsonb, text, text, uuid) to service_role;
