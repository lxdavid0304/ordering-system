-- Flash food court campaigns are intentionally separate from ordinary Costco orders.
-- This prevents an ordinary order workflow or shipping calculation from being applied twice.

create table if not exists public.flash_food_campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 120),
  open_at timestamptz not null,
  deadline_at timestamptz not null,
  purchase_at timestamptz not null,
  pickup_location text not null check (length(trim(pickup_location)) between 1 and 160),
  pickup_start_at timestamptz not null,
  pickup_end_at timestamptz not null,
  note text not null default '' check (length(note) <= 800),
  status text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  shipping_fee_per_unit integer not null default 20 check (shipping_fee_per_unit = 20),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (open_at < deadline_at),
  check (deadline_at <= purchase_at),
  check (pickup_start_at <= pickup_end_at)
);

create index if not exists flash_food_campaigns_schedule_idx
  on public.flash_food_campaigns (status, open_at, deadline_at);

create table if not exists public.flash_food_campaign_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.flash_food_campaigns(id) on delete cascade,
  product_name text not null check (
    product_name in (
      '熱狗堡＋飲料',
      '牛肉捲',
      '豬肉捲',
      '台式滷肉飯',
      '日式關東煮',
      '披薩（單片）',
      '披薩（整盒 18 吋）',
      '蛤蜊巧達湯',
      '凱撒雞肉沙拉',
      '美式咖啡',
      '拿鐵',
      '汽水'
    )
  ),
  item_note text not null default '' check (length(item_note) <= 120),
  unit_price integer not null check (unit_price >= 0),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (campaign_id, product_name)
);

create index if not exists flash_food_campaign_items_campaign_idx
  on public.flash_food_campaign_items (campaign_id, sort_order, created_at);

create table if not exists public.flash_food_orders (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.flash_food_campaigns(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  customer_name text not null,
  phone text not null,
  note text not null default '' check (length(note) <= 500),
  subtotal_amount integer not null default 0 check (subtotal_amount >= 0),
  shipping_amount integer not null default 0 check (shipping_amount >= 0),
  total_amount integer not null default 0 check (total_amount >= 0),
  status text not null default 'submitted' check (status in ('submitted', 'cancelled', 'fulfilled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, user_id),
  check (total_amount = subtotal_amount + shipping_amount)
);

create index if not exists flash_food_orders_campaign_idx
  on public.flash_food_orders (campaign_id, created_at desc);

create index if not exists flash_food_orders_user_idx
  on public.flash_food_orders (user_id, created_at desc);

create table if not exists public.flash_food_order_items (
  id uuid primary key default gen_random_uuid(),
  flash_food_order_id uuid not null references public.flash_food_orders(id) on delete cascade,
  campaign_item_id uuid references public.flash_food_campaign_items(id) on delete set null,
  product_name text not null,
  item_note text not null default '',
  unit_price integer not null check (unit_price >= 0),
  shipping_fee_per_unit integer not null check (shipping_fee_per_unit = 20),
  quantity integer not null check (quantity > 0),
  subtotal_amount integer not null check (subtotal_amount >= 0),
  shipping_amount integer not null check (shipping_amount >= 0),
  total_amount integer not null check (total_amount >= 0),
  created_at timestamptz not null default now(),
  check (subtotal_amount = unit_price * quantity),
  check (shipping_amount = shipping_fee_per_unit * quantity),
  check (total_amount = subtotal_amount + shipping_amount)
);

create index if not exists flash_food_order_items_order_idx
  on public.flash_food_order_items (flash_food_order_id, created_at);

create or replace function public.touch_flash_food_campaign_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_flash_food_campaign_updated_at on public.flash_food_campaigns;
create trigger touch_flash_food_campaign_updated_at
before update on public.flash_food_campaigns
for each row execute function public.touch_flash_food_campaign_updated_at();

create or replace function public.touch_flash_food_order_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_flash_food_order_updated_at on public.flash_food_orders;
create trigger touch_flash_food_order_updated_at
before update on public.flash_food_orders
for each row execute function public.touch_flash_food_order_updated_at();

alter table public.flash_food_campaigns enable row level security;
alter table public.flash_food_campaign_items enable row level security;
alter table public.flash_food_orders enable row level security;
alter table public.flash_food_order_items enable row level security;

drop policy if exists "members read scheduled flash food campaigns" on public.flash_food_campaigns;
create policy "members read scheduled flash food campaigns"
  on public.flash_food_campaigns
  for select
  to authenticated
  using (status = 'scheduled' or public.is_admin_user());

drop policy if exists "admins manage flash food campaigns" on public.flash_food_campaigns;
create policy "admins manage flash food campaigns"
  on public.flash_food_campaigns
  for all
  to authenticated
  using (public.is_admin_user())
  with check (public.is_admin_user());

drop policy if exists "members read flash food campaign items" on public.flash_food_campaign_items;
create policy "members read flash food campaign items"
  on public.flash_food_campaign_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.flash_food_campaigns campaign
      where campaign.id = campaign_id
        and (campaign.status = 'scheduled' or public.is_admin_user())
    )
  );

drop policy if exists "admins manage flash food campaign items" on public.flash_food_campaign_items;
create policy "admins manage flash food campaign items"
  on public.flash_food_campaign_items
  for all
  to authenticated
  using (public.is_admin_user())
  with check (public.is_admin_user());

drop policy if exists "members read own flash food orders" on public.flash_food_orders;
create policy "members read own flash food orders"
  on public.flash_food_orders
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_admin_user());

drop policy if exists "members read own flash food order items" on public.flash_food_order_items;
create policy "members read own flash food order items"
  on public.flash_food_order_items
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.flash_food_orders orders
      where orders.id = flash_food_order_id
        and (orders.user_id = auth.uid() or public.is_admin_user())
    )
  );

create or replace function public.admin_create_flash_food_campaign(
  p_title text,
  p_open_at timestamptz,
  p_deadline_at timestamptz,
  p_purchase_at timestamptz,
  p_pickup_location text,
  p_pickup_start_at timestamptz,
  p_pickup_end_at timestamptz,
  p_note text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign_id uuid;
  v_item jsonb;
  v_name text;
  v_note text;
  v_price integer;
  v_sort_order integer := 0;
  v_allowed_names text[] := array[
    '熱狗堡＋飲料', '牛肉捲', '豬肉捲', '台式滷肉飯', '日式關東煮',
    '披薩（單片）', '披薩（整盒 18 吋）', '蛤蜊巧達湯', '凱撒雞肉沙拉',
    '美式咖啡', '拿鐵', '汽水'
  ];
begin
  if not public.is_admin_user() then
    raise exception 'Admin access required';
  end if;

  if coalesce(trim(p_title), '') = ''
     or coalesce(trim(p_pickup_location), '') = ''
     or p_open_at is null
     or p_deadline_at is null
     or p_purchase_at is null
     or p_pickup_start_at is null
     or p_pickup_end_at is null
     or p_open_at >= p_deadline_at
     or p_deadline_at > p_purchase_at
     or p_pickup_start_at > p_pickup_end_at then
    raise exception 'Invalid campaign schedule';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Campaign items required';
  end if;

  insert into public.flash_food_campaigns (
    title, open_at, deadline_at, purchase_at, pickup_location,
    pickup_start_at, pickup_end_at, note, created_by
  )
  values (
    trim(p_title), p_open_at, p_deadline_at, p_purchase_at, trim(p_pickup_location),
    p_pickup_start_at, p_pickup_end_at, left(coalesce(p_note, ''), 800), auth.uid()
  )
  returning id into v_campaign_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_name := trim(coalesce(v_item->>'product_name', ''));
    v_note := left(trim(coalesce(v_item->>'item_note', '')), 120);
    v_price := coalesce(nullif(v_item->>'unit_price', '')::integer, -1);

    if v_name = '' or not (v_name = any(v_allowed_names)) or v_price < 0 then
      raise exception 'Invalid campaign item';
    end if;

    insert into public.flash_food_campaign_items (
      campaign_id, product_name, item_note, unit_price, sort_order
    )
    values (v_campaign_id, v_name, v_note, v_price, v_sort_order);

    v_sort_order := v_sort_order + 1;
  end loop;

  return v_campaign_id;
end;
$$;

create or replace function public.admin_cancel_flash_food_campaign(
  p_campaign_id uuid,
  p_reason text default null
)
returns public.flash_food_campaigns
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign public.flash_food_campaigns;
begin
  if not public.is_admin_user() then
    raise exception 'Admin access required';
  end if;

  update public.flash_food_campaigns
  set status = 'cancelled',
      note = concat_ws(E'\n', nullif(note, ''), nullif(concat('取消原因：', trim(coalesce(p_reason, ''))), '取消原因：'))
  where id = p_campaign_id
  returning * into v_campaign;

  if not found then
    raise exception 'Campaign not found';
  end if;

  update public.flash_food_orders
  set status = 'cancelled'
  where campaign_id = p_campaign_id
    and status = 'submitted';

  return v_campaign;
end;
$$;

create or replace function public.member_save_flash_food_order(
  p_campaign_id uuid,
  p_note text,
  p_items jsonb
)
returns public.flash_food_orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign public.flash_food_campaigns;
  v_order public.flash_food_orders;
  v_item jsonb;
  v_campaign_item public.flash_food_campaign_items;
  v_campaign_item_id uuid;
  v_quantity integer;
  v_subtotal integer := 0;
  v_shipping integer := 0;
  v_customer_name text;
  v_phone text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  select *
    into v_campaign
    from public.flash_food_campaigns
    where id = p_campaign_id
    for update;

  if not found or v_campaign.status <> 'scheduled' then
    raise exception 'Campaign unavailable';
  end if;

  if now() < v_campaign.open_at then
    raise exception 'Campaign has not opened';
  end if;

  if now() >= v_campaign.deadline_at then
    raise exception 'Campaign is locked';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'Items required';
  end if;

  select full_name, real_phone
    into v_customer_name, v_phone
    from public.member_profiles
    where user_id = auth.uid();

  if coalesce(trim(v_customer_name), '') = '' or coalesce(trim(v_phone), '') = '' then
    raise exception 'Member profile required';
  end if;

  select *
    into v_order
    from public.flash_food_orders
    where campaign_id = p_campaign_id
      and user_id = auth.uid()
    for update;

  if found then
    delete from public.flash_food_order_items where flash_food_order_id = v_order.id;
    update public.flash_food_orders
    set customer_name = v_customer_name,
        phone = v_phone,
        note = left(coalesce(p_note, ''), 500),
        subtotal_amount = 0,
        shipping_amount = 0,
        total_amount = 0,
        status = 'submitted'
    where id = v_order.id
    returning * into v_order;
  else
    insert into public.flash_food_orders (
      campaign_id, user_id, customer_name, phone, note
    )
    values (
      p_campaign_id, auth.uid(), v_customer_name, v_phone, left(coalesce(p_note, ''), 500)
    )
    returning * into v_order;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    begin
      v_campaign_item_id := (v_item->>'campaign_item_id')::uuid;
    exception
      when invalid_text_representation then
        raise exception 'Invalid campaign item';
    end;

    v_quantity := coalesce(nullif(v_item->>'quantity', '')::integer, 0);
    if v_quantity <= 0 then
      raise exception 'Invalid quantity';
    end if;

    select *
      into v_campaign_item
      from public.flash_food_campaign_items
      where id = v_campaign_item_id
        and campaign_id = p_campaign_id
        and is_active = true;

    if not found then
      raise exception 'Campaign item unavailable';
    end if;

    v_subtotal := v_subtotal + (v_campaign_item.unit_price * v_quantity);
    v_shipping := v_shipping + (v_campaign.shipping_fee_per_unit * v_quantity);

    insert into public.flash_food_order_items (
      flash_food_order_id, campaign_item_id, product_name, item_note,
      unit_price, shipping_fee_per_unit, quantity,
      subtotal_amount, shipping_amount, total_amount
    )
    values (
      v_order.id, v_campaign_item.id, v_campaign_item.product_name, v_campaign_item.item_note,
      v_campaign_item.unit_price, v_campaign.shipping_fee_per_unit, v_quantity,
      v_campaign_item.unit_price * v_quantity,
      v_campaign.shipping_fee_per_unit * v_quantity,
      (v_campaign_item.unit_price + v_campaign.shipping_fee_per_unit) * v_quantity
    );
  end loop;

  update public.flash_food_orders
  set subtotal_amount = v_subtotal,
      shipping_amount = v_shipping,
      total_amount = v_subtotal + v_shipping
  where id = v_order.id
  returning * into v_order;

  return v_order;
end;
$$;

grant execute on function public.admin_create_flash_food_campaign(
  text, timestamptz, timestamptz, timestamptz, text, timestamptz, timestamptz, text, jsonb
) to authenticated;
grant execute on function public.admin_cancel_flash_food_campaign(uuid, text) to authenticated;
grant execute on function public.member_save_flash_food_order(uuid, text, jsonb) to authenticated;
