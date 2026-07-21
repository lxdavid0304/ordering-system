-- Keep customer-facing shipping, procurement cost, and order profit as separate snapshots.
alter table public.popular_products
  add column if not exists cost_price integer not null default 0,
  add column if not exists shipping_fee_per_unit integer not null default 20;

alter table public.order_items
  add column if not exists cost_price integer not null default 0,
  add column if not exists shipping_fee_per_unit integer not null default 20;

alter table public.orders
  add column if not exists profit_amount integer not null default 0;

alter table public.orders
  drop constraint if exists orders_profit_amount_valid;

update public.popular_products
set cost_price = unit_price
where cost_price = 0;

update public.orders o
set shipping_amount = coalesce((
  select sum(oi.quantity * 20)
  from public.order_items oi
  where oi.order_id = o.id
), 0),
profit_amount = coalesce((
  select sum(oi.quantity * oi.shipping_fee_per_unit)
  from public.order_items oi
  where oi.order_id = o.id
), 0);

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
  v_cost_price int;
  v_shipping_fee_per_unit int := 20;
  v_customer_shipping_fee_per_unit int := 20;
  v_quantity int;
  v_catalog_product_id uuid;
  v_catalog_product public.popular_products%rowtype;
  v_items_total int := 0;
  v_shipping_total int := 0;
  v_profit_total int := 0;
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
    v_cost_price := v_unit_price;
    v_shipping_fee_per_unit := 20;
    v_customer_shipping_fee_per_unit := 20;

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
      v_cost_price := v_catalog_product.cost_price;
      v_shipping_fee_per_unit := v_catalog_product.shipping_fee_per_unit;
      v_customer_shipping_fee_per_unit := 0;
    end if;

    if v_unit_price < 0 or v_cost_price < 0 or v_shipping_fee_per_unit < 0 or v_quantity <= 0 then
      raise exception 'Invalid item';
    end if;

    v_items_total := v_items_total + (v_unit_price * v_quantity);
    v_shipping_total := v_shipping_total + (v_quantity * v_customer_shipping_fee_per_unit);
    v_profit_total := v_profit_total + (v_quantity * v_shipping_fee_per_unit);

    insert into public.order_items (
      order_id,
      product_name,
      unit_price,
      quantity,
      line_total,
      catalog_product_id,
      cost_price,
      shipping_fee_per_unit
    )
    values (
      v_order_id,
      v_name,
      v_unit_price,
      v_quantity,
      v_unit_price * v_quantity,
      v_catalog_product_id,
      v_cost_price,
      v_shipping_fee_per_unit
    );
  end loop;

  if v_items_total = 0 then
    raise exception 'Items required';
  end if;

  v_total := v_items_total + v_shipping_total;

  update public.orders
    set total_amount = v_total,
        shipping_amount = v_shipping_total,
        profit_amount = v_profit_total,
        status = case
          when v_total > 300 then 'pending_deposit'
          else 'open'
        end
    where id = v_order_id;

  return v_order_id;
end;
$$;

revoke all on function public.create_order(text, text, jsonb, text, text, uuid) from public;
grant execute on function public.create_order(text, text, jsonb, text, text, uuid) to service_role;

create or replace function public.admin_operating_report(p_period text default 'month')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period text := coalesce(nullif(trim(p_period), ''), 'month');
  v_local_now timestamp := now() at time zone 'Asia/Taipei';
  v_today_start timestamptz := date_trunc('day', now() at time zone 'Asia/Taipei') at time zone 'Asia/Taipei';
  v_period_start timestamptz;
  v_period_end timestamptz := now();
  v_recent_fulfilled_cutoff timestamptz := now() - interval '7 days';
  v_collected_amount integer := 0;
  v_trend jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if not public.is_admin_user() then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  if v_period not in ('today', 'week', 'month', 'all') then
    raise exception 'INVALID_REPORT_PERIOD';
  end if;

  v_period_start := case v_period
    when 'today' then v_today_start
    when 'week' then v_today_start - interval '6 days'
    when 'month' then date_trunc('month', v_local_now) at time zone 'Asia/Taipei'
    else '-infinity'::timestamptz
  end;

  select coalesce(sum(payment.amount), 0)::integer
    into v_collected_amount
  from (
    select deposit_paid_amount as amount, deposit_paid_at as paid_at from public.orders
    union all
    select balance_paid_amount as amount, balance_paid_at as paid_at from public.orders
  ) payment
  where payment.amount > 0
    and payment.paid_at is not null
    and payment.paid_at >= v_period_start
    and payment.paid_at <= v_period_end;

  select coalesce(jsonb_agg(day_row.payload order by day_row.day_start), '[]'::jsonb)
    into v_trend
  from (
    select
      day_slot.day_start,
      jsonb_build_object(
        'date', to_char(day_slot.day_start at time zone 'Asia/Taipei', 'MM/DD'),
        'amount', coalesce(sum(o.profit_amount), 0),
        'orders', count(o.id)
      ) as payload
    from generate_series(
      v_today_start - interval '6 days',
      v_today_start,
      interval '1 day'
    ) as day_slot(day_start)
    left join public.orders o
      on o.status = 'fulfilled'
      and o.fulfilled_at >= day_slot.day_start
      and o.fulfilled_at < day_slot.day_start + interval '1 day'
    group by day_slot.day_start
  ) day_row;

  select jsonb_build_object(
    'period', v_period,
    'period_start', v_period_start,
    'period_end', v_period_end,
    'earned_shipping_amount', coalesce(sum(o.profit_amount) filter (
      where o.status = 'fulfilled'
        and o.fulfilled_at > v_recent_fulfilled_cutoff
    ), 0),
    'earned_orders', count(*) filter (
      where o.status = 'fulfilled'
        and o.fulfilled_at > v_recent_fulfilled_cutoff
    ),
    'estimated_shipping_amount', coalesce(sum(o.profit_amount) filter (
      where o.status in ('pending_deposit', 'open', 'ready_pickup')
    ), 0),
    'estimated_orders', count(*) filter (
      where o.status in ('pending_deposit', 'open', 'ready_pickup')
    ),
    'collected_amount', v_collected_amount,
    'outstanding_amount', coalesce(sum(
      greatest(o.total_amount - o.deposit_paid_amount - o.balance_paid_amount, 0)
    ) filter (
      where o.status in ('pending_deposit', 'open', 'ready_pickup')
    ), 0),
    'outstanding_orders', count(*) filter (
      where o.status in ('pending_deposit', 'open', 'ready_pickup')
        and o.total_amount - o.deposit_paid_amount - o.balance_paid_amount > 0
    ),
    'daily_shipping', v_trend
  ) into v_result
  from public.orders o;

  return v_result;
end;
$$;

revoke all on function public.admin_operating_report(text) from public;
grant execute on function public.admin_operating_report(text) to authenticated;
