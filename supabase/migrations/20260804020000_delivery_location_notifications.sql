-- Delivery-location grouping and one-time pickup notices for active orders.

create table if not exists public.delivery_location_notification_batches (
  id uuid primary key default gen_random_uuid(),
  delivery_location text not null check (delivery_location in ('明德樓', '據德樓', '蘊德樓', '機車停車場')),
  pickup_at timestamptz not null,
  recipient_count integer not null default 0 check (recipient_count >= 0),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create unique index if not exists delivery_location_notification_batches_request_key
  on public.delivery_location_notification_batches (delivery_location, pickup_at, created_by);

alter table public.delivery_location_notification_batches enable row level security;

alter table public.line_notification_jobs
  add column if not exists delivery_notification_batch_id uuid
    references public.delivery_location_notification_batches(id) on delete cascade;

alter table public.line_notification_jobs
  drop constraint if exists line_notification_jobs_event_type_check;

alter table public.line_notification_jobs
  add constraint line_notification_jobs_event_type_check
  check (event_type in ('order_status_changed', 'delivery_location_ready'));

create unique index if not exists line_notification_jobs_delivery_batch_user_key
  on public.line_notification_jobs (delivery_notification_batch_id, user_id)
  where delivery_notification_batch_id is not null;

create index if not exists line_notification_jobs_delivery_batch_idx
  on public.line_notification_jobs (delivery_notification_batch_id, status, created_at)
  where delivery_notification_batch_id is not null;

create or replace function public.admin_delivery_location_summary()
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

  with delivery_locations(delivery_location, sort_order) as (
    values
      ('明德樓'::text, 1),
      ('據德樓'::text, 2),
      ('蘊德樓'::text, 3),
      ('機車停車場'::text, 4)
  ), active_orders as (
    select delivery_location, user_id
    from public.orders
    where status in ('pending_deposit', 'open', 'ready_pickup')
  ), grouped as (
    select
      delivery_location,
      count(*)::integer as order_count,
      count(distinct user_id)::integer as member_count
    from active_orders
    group by delivery_location
  )
  select jsonb_agg(
    jsonb_build_object(
      'delivery_location', locations.delivery_location,
      'order_count', coalesce(grouped.order_count, 0),
      'member_count', coalesce(grouped.member_count, 0)
    )
    order by locations.sort_order
  ) into v_result
  from delivery_locations locations
  left join grouped on grouped.delivery_location = locations.delivery_location;

  return coalesce(v_result, '[]'::jsonb);
end;
$$;

revoke all on public.delivery_location_notification_batches from anon, authenticated;
grant execute on function public.admin_delivery_location_summary() to authenticated;
