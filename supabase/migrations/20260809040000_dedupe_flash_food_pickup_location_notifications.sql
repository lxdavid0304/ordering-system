-- One member may place more than one order at the same pickup location.
-- Queue exactly one location notification for that member.
create or replace function public.admin_queue_flash_food_pickup_location_notification(
  p_campaign_id uuid,
  p_pickup_location text,
  p_pickup_at timestamptz
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign public.flash_food_campaigns;
  v_pickup_location text := trim(coalesce(p_pickup_location, ''));
  v_count integer := 0;
begin
  if not public.is_admin_user() then
    raise exception 'Admin access required';
  end if;

  if v_pickup_location not in ('明德樓', '據德樓', '蘊德樓', '機車停車場') then
    raise exception 'Invalid pickup location';
  end if;

  if p_pickup_at is null then
    raise exception 'Pickup time required';
  end if;

  select * into v_campaign
  from public.flash_food_campaigns
  where id = p_campaign_id
    and status = 'scheduled'
  for update;

  if not found then
    raise exception 'Campaign not found or cancelled';
  end if;

  if now() < v_campaign.deadline_at then
    raise exception 'Campaign is still open for ordering';
  end if;

  insert into public.flash_food_pickup_notices (
    campaign_id, pickup_location, pickup_at, notified_at, notified_by, updated_at
  ) values (
    v_campaign.id, v_pickup_location, p_pickup_at, now(), auth.uid(), now()
  ) on conflict (campaign_id, pickup_location) do update
  set pickup_at = excluded.pickup_at,
      notified_at = excluded.notified_at,
      notified_by = excluded.notified_by,
      updated_at = now();

  insert into public.flash_food_notification_jobs (
    campaign_id, user_id, event_type, payload, status, attempts, error_message, sent_at, updated_at
  )
  select
    v_campaign.id,
    location_orders.user_id,
    'pickup_location_ready',
    jsonb_build_object(
      'pickup_location', v_pickup_location,
      'pickup_ready_at', p_pickup_at
    ),
    'pending',
    0,
    null,
    null,
    now()
  from (
    select distinct on (orders.user_id) orders.user_id
    from public.flash_food_orders orders
    where orders.campaign_id = v_campaign.id
      and orders.status = 'submitted'
      and orders.pickup_location = v_pickup_location
    order by orders.user_id, orders.created_at desc, orders.id desc
  ) as location_orders
  on conflict (campaign_id, user_id, event_type) do update
  set payload = excluded.payload,
      status = 'pending',
      attempts = 0,
      error_message = null,
      sent_at = null,
      updated_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.admin_queue_flash_food_pickup_location_notification(uuid, text, timestamptz) to authenticated;
