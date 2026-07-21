-- Completed orders are shown in history after seven days without changing status.
alter table public.orders
  add column if not exists fulfilled_at timestamptz;

update public.orders o
set fulfilled_at = coalesce(
  (
    select e.created_at
    from public.order_events e
    where e.order_id = o.id
      and e.event_type = 'status_changed'
      and e.details ->> 'to_status' = 'fulfilled'
    order by e.created_at asc
    limit 1
  ),
  o.updated_at,
  o.created_at,
  now()
)
where o.status in ('fulfilled', 'archived')
  and o.fulfilled_at is null;

create index if not exists orders_fulfilled_at_idx
  on public.orders (fulfilled_at desc)
  where status in ('fulfilled', 'archived');

drop function if exists public.admin_list_orders(text, text, text, text, date, date, text, integer, integer, integer);
create function public.admin_list_orders(
  p_search text default null,
  p_status text default null,
  p_payment_status text default null,
  p_location text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_view text default 'status',
  p_history_months integer default null,
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
  v_view text := coalesce(nullif(p_view, ''), 'status');
  v_history_cutoff timestamptz := now() - interval '7 days';
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
        select 1
        from public.order_items oi
        where oi.order_id = o.id
          and oi.product_name ilike '%' || trim(p_search) || '%'
      )
    )
      and (
        (v_view = 'history' and (
          o.status = 'archived'
          or (o.status = 'fulfilled' and o.fulfilled_at <= v_history_cutoff)
        ))
        or (v_view = 'recent_fulfilled' and o.status = 'fulfilled' and o.fulfilled_at > v_history_cutoff)
        or (v_view not in ('history', 'recent_fulfilled')
          and (nullif(p_status, '') is null or p_status = 'all' or o.status = p_status))
      )
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
        p_history_months is null
        or v_view <> 'history'
        or p_history_months not in (1, 3, 6)
        or o.fulfilled_at >= now() - make_interval(months => p_history_months)
      )
      and (
        p_date_from is null
        or case when v_view in ('history', 'recent_fulfilled') then o.fulfilled_at else o.created_at end
          >= (p_date_from::timestamp at time zone 'Asia/Taipei')
      )
      and (
        p_date_to is null
        or case when v_view in ('history', 'recent_fulfilled') then o.fulfilled_at else o.created_at end
          < ((p_date_to + 1)::timestamp at time zone 'Asia/Taipei')
      )
  ), paged as (
    select *
    from filtered
    order by case when v_view in ('history', 'recent_fulfilled') then fulfilled_at else created_at end desc
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
        order by case when v_view in ('history', 'recent_fulfilled') then p.fulfilled_at else p.created_at end desc
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
  v_history_cutoff timestamptz := now() - interval '7 days';
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
    'open', count(*) filter (where status = 'open'),
    'ready_pickup', count(*) filter (where status = 'ready_pickup'),
    'fulfilled_recent', count(*) filter (
      where status = 'fulfilled' and fulfilled_at > v_history_cutoff
    ),
    'history', count(*) filter (
      where status = 'archived'
         or (status = 'fulfilled' and fulfilled_at <= v_history_cutoff)
    ),
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
      admin_note = coalesce(p_admin_note, admin_note),
      fulfilled_at = case
        when p_status = 'fulfilled' and fulfilled_at is null then now()
        when p_status in ('pending_deposit', 'open', 'ready_pickup') then null
        else fulfilled_at
      end
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
  v_next_status text;
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
  v_next_status := case
    when v_order.status = 'pending_deposit' and v_next_deposit + v_next_balance >= v_deposit_due then 'open'
    when v_order.status = 'ready_pickup' and v_next_deposit + v_next_balance >= v_order.total_amount then 'fulfilled'
    else v_order.status
  end;

  perform set_config('app.order_change_reason', 'Payment updated', true);

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
      status = v_next_status,
      fulfilled_at = case
        when v_next_status = 'fulfilled' and fulfilled_at is null then now()
        when v_next_status in ('pending_deposit', 'open', 'ready_pickup') then null
        else fulfilled_at
      end
  where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;

drop function if exists public.admin_export_orders(text, text, text, text, date, date, text, integer);
create function public.admin_export_orders(
  p_search text default null,
  p_status text default null,
  p_payment_status text default null,
  p_location text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_view text default 'status',
  p_history_months integer default null
)
returns table (
  order_id uuid,
  created_at timestamptz,
  fulfilled_at timestamptz,
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
declare
  v_view text := coalesce(nullif(p_view, ''), 'status');
  v_history_cutoff timestamptz := now() - interval '7 days';
begin
  if not public.is_admin_user() then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  return query
  select
    o.id,
    o.created_at,
    o.fulfilled_at,
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
      select 1
      from public.order_items search_item
      where search_item.order_id = o.id
        and search_item.product_name ilike '%' || trim(p_search) || '%'
    )
  )
    and (
      (v_view = 'history' and (
        o.status = 'archived'
        or (o.status = 'fulfilled' and o.fulfilled_at <= v_history_cutoff)
      ))
      or (v_view = 'recent_fulfilled' and o.status = 'fulfilled' and o.fulfilled_at > v_history_cutoff)
      or (v_view not in ('history', 'recent_fulfilled')
        and (nullif(p_status, '') is null or p_status = 'all' or o.status = p_status))
    )
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
      p_history_months is null
      or v_view <> 'history'
      or p_history_months not in (1, 3, 6)
      or o.fulfilled_at >= now() - make_interval(months => p_history_months)
    )
    and (
      p_date_from is null
      or case when v_view in ('history', 'recent_fulfilled') then o.fulfilled_at else o.created_at end
        >= (p_date_from::timestamp at time zone 'Asia/Taipei')
    )
    and (
      p_date_to is null
      or case when v_view in ('history', 'recent_fulfilled') then o.fulfilled_at else o.created_at end
        < ((p_date_to + 1)::timestamp at time zone 'Asia/Taipei')
    )
  order by case when v_view in ('history', 'recent_fulfilled') then o.fulfilled_at else o.created_at end desc, o.id, oi.id;
end;
$$;

grant execute on function public.admin_list_orders(text, text, text, text, date, date, text, integer, integer, integer) to authenticated;
grant execute on function public.admin_order_summary() to authenticated;
grant execute on function public.admin_update_order(uuid, text, text, text) to authenticated;
grant execute on function public.admin_save_order_payment(uuid, text, integer, text, timestamptz, boolean) to authenticated;
grant execute on function public.admin_export_orders(text, text, text, text, date, date, text, integer) to authenticated;
