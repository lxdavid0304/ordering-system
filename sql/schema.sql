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
