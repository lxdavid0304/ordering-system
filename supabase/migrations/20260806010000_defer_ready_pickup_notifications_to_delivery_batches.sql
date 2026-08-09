-- The pickup-ready state is an internal packing milestone. Members are notified
-- only when their delivery location has a confirmed pickup time.

create or replace function public.queue_line_order_status_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status
     and new.user_id is not null
     and new.status <> 'ready_pickup' then
    insert into public.line_notification_jobs (order_id, user_id, event_type, payload)
    values (
      new.id,
      new.user_id,
      'order_status_changed',
      jsonb_build_object(
        'from_status', old.status,
        'to_status', new.status,
        'delivery_location', new.delivery_location,
        'total_amount', new.total_amount,
        'quoted_total_amount', new.quoted_total_amount,
        'deposit_paid_amount', new.deposit_paid_amount,
        'balance_paid_amount', new.balance_paid_amount,
        'price_adjusted', old.total_amount is distinct from new.total_amount
      )
    );
  end if;
  return new;
end;
$$;

-- Do not let previously queued, unsent ready-pickup messages bypass the new
-- location-and-time notification flow. Sent and in-flight messages are kept.
update public.line_notification_jobs
set status = 'skipped',
    error_message = 'Deferred to delivery location notification',
    claim_token = null,
    processing_started_at = null,
    next_attempt_at = now(),
    updated_at = now()
where event_type = 'order_status_changed'
  and payload ->> 'to_status' = 'ready_pickup'
  and status in ('pending', 'failed');

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
  ), ready_orders as (
    select delivery_location, user_id
    from public.orders
    where status = 'ready_pickup'
  ), grouped as (
    select
      delivery_location,
      count(*)::integer as order_count,
      count(distinct user_id)::integer as member_count
    from ready_orders
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
