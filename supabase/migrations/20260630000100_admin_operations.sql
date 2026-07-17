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
