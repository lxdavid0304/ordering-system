-- A campaign keeps an estimated pickup time while ordering, then the admin
-- records the actual ready time and notifies only members who placed an order.
alter table public.flash_food_campaigns
  add column if not exists pickup_ready_at timestamptz;

alter table public.flash_food_notification_jobs
  drop constraint if exists flash_food_notification_jobs_event_type_check;

alter table public.flash_food_notification_jobs
  add constraint flash_food_notification_jobs_event_type_check
  check (event_type in ('campaign_opened', 'campaign_cancelled', 'campaign_ready', 'order_submitted', 'order_updated'));

create or replace function public.admin_mark_flash_food_campaign_ready(
  p_campaign_id uuid,
  p_pickup_ready_at timestamptz
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

  if p_pickup_ready_at is null then
    raise exception 'Pickup ready time required';
  end if;

  update public.flash_food_campaigns
  set pickup_ready_at = p_pickup_ready_at
  where id = p_campaign_id
    and status = 'scheduled'
  returning * into v_campaign;

  if not found then
    raise exception 'Campaign not found or cancelled';
  end if;

  insert into public.flash_food_notification_jobs (campaign_id, user_id, event_type, payload, status, attempts, error_message, sent_at, updated_at)
  select
    v_campaign.id,
    orders.user_id,
    'campaign_ready',
    jsonb_build_object('pickup_ready_at', v_campaign.pickup_ready_at),
    'pending',
    0,
    null,
    null,
    now()
  from public.flash_food_orders orders
  where orders.campaign_id = v_campaign.id
    and orders.status = 'submitted'
  on conflict (campaign_id, user_id, event_type) do update
  set status = 'pending',
      attempts = 0,
      error_message = null,
      sent_at = null,
      payload = excluded.payload,
      updated_at = now();

  return v_campaign;
end;
$$;

create or replace function public.admin_requeue_flash_food_ready_notification(
  p_campaign_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campaign public.flash_food_campaigns;
  v_count integer := 0;
begin
  if not public.is_admin_user() then
    raise exception 'Admin access required';
  end if;

  select * into v_campaign
  from public.flash_food_campaigns
  where id = p_campaign_id
    and status = 'scheduled'
    and pickup_ready_at is not null;

  if not found then
    raise exception 'Campaign is not ready for pickup';
  end if;

  insert into public.flash_food_notification_jobs (campaign_id, user_id, event_type, payload, status, attempts, error_message, sent_at, updated_at)
  select
    v_campaign.id,
    orders.user_id,
    'campaign_ready',
    jsonb_build_object('pickup_ready_at', v_campaign.pickup_ready_at),
    'pending',
    0,
    null,
    null,
    now()
  from public.flash_food_orders orders
  where orders.campaign_id = v_campaign.id
    and orders.status = 'submitted'
  on conflict (campaign_id, user_id, event_type) do update
  set status = 'pending',
      attempts = 0,
      error_message = null,
      sent_at = null,
      payload = excluded.payload,
      updated_at = now();

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.admin_mark_flash_food_campaign_ready(uuid, timestamptz) to authenticated;
grant execute on function public.admin_requeue_flash_food_ready_notification(uuid) to authenticated;
