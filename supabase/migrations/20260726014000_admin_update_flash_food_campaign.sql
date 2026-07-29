-- Allow administrators to correct an existing flash-food campaign schedule
-- without touching the submitted member orders.
create or replace function public.admin_update_flash_food_campaign(
  p_campaign_id uuid,
  p_title text,
  p_open_at timestamptz,
  p_deadline_at timestamptz,
  p_purchase_at timestamptz,
  p_pickup_start_at timestamptz,
  p_pickup_end_at timestamptz,
  p_note text default ''
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

  if coalesce(trim(p_title), '') = ''
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

  update public.flash_food_campaigns
  set title = left(trim(p_title), 120),
      open_at = p_open_at,
      deadline_at = p_deadline_at,
      purchase_at = p_purchase_at,
      pickup_start_at = p_pickup_start_at,
      pickup_end_at = p_pickup_end_at,
      note = left(coalesce(p_note, ''), 800)
  where id = p_campaign_id
    and status <> 'cancelled'
  returning * into v_campaign;

  if not found then
    raise exception 'Campaign not found or cancelled';
  end if;

  return v_campaign;
end;
$$;

grant execute on function public.admin_update_flash_food_campaign(
  uuid, text, timestamptz, timestamptz, timestamptz, timestamptz, timestamptz, text
) to authenticated;
