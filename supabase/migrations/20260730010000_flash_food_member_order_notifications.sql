-- Send a member a LINE confirmation whenever their flash-food order is first
-- submitted or later updated.  The payload is an order snapshot so a delayed
-- worker never describes a newer or older set of items by mistake.

alter table public.flash_food_notification_jobs
  drop constraint if exists flash_food_notification_jobs_event_type_check;

alter table public.flash_food_notification_jobs
  add constraint flash_food_notification_jobs_event_type_check
  check (event_type in (
    'campaign_opened',
    'campaign_cancelled',
    'campaign_ready',
    'order_submitted',
    'order_updated'
  ));

create or replace function public.member_save_flash_food_order(
  p_campaign_id uuid,
  p_pickup_location text,
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
  v_pickup_location text := trim(coalesce(p_pickup_location, ''));
  v_allowed_pickup_locations text[] := array['明德樓', '據德樓', '蘊德樓', '機車停車場'];
  v_is_update boolean := false;
  v_notification_items jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required';
  end if;

  if v_pickup_location = '' or not (v_pickup_location = any(v_allowed_pickup_locations)) then
    raise exception 'Invalid pickup location';
  end if;

  select * into v_campaign from public.flash_food_campaigns where id = p_campaign_id for update;

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

  select full_name, real_phone into v_customer_name, v_phone
    from public.member_profiles where user_id = auth.uid();

  if coalesce(trim(v_customer_name), '') = '' or coalesce(trim(v_phone), '') = '' then
    raise exception 'Member profile required';
  end if;

  select * into v_order from public.flash_food_orders
    where campaign_id = p_campaign_id and user_id = auth.uid() for update;

  if found then
    v_is_update := true;
    delete from public.flash_food_order_items where flash_food_order_id = v_order.id;
    update public.flash_food_orders
    set customer_name = v_customer_name,
        phone = v_phone,
        pickup_location = v_pickup_location,
        note = left(coalesce(p_note, ''), 500),
        subtotal_amount = 0,
        shipping_amount = 0,
        total_amount = 0,
        status = 'submitted'
    where id = v_order.id
    returning * into v_order;
  else
    insert into public.flash_food_orders (
      campaign_id, user_id, customer_name, phone, pickup_location, note
    ) values (
      p_campaign_id, auth.uid(), v_customer_name, v_phone, v_pickup_location, left(coalesce(p_note, ''), 500)
    ) returning * into v_order;
  end if;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    begin
      v_campaign_item_id := (v_item->>'campaign_item_id')::uuid;
    exception when invalid_text_representation then
      raise exception 'Invalid campaign item';
    end;

    v_quantity := coalesce(nullif(v_item->>'quantity', '')::integer, 0);
    if v_quantity <= 0 then
      raise exception 'Invalid quantity';
    end if;

    select * into v_campaign_item from public.flash_food_campaign_items
      where id = v_campaign_item_id and campaign_id = p_campaign_id and is_active = true;

    if not found then
      raise exception 'Campaign item unavailable';
    end if;

    v_subtotal := v_subtotal + (v_campaign_item.unit_price * v_quantity);
    v_shipping := v_shipping + (v_campaign.shipping_fee_per_unit * v_quantity);

    insert into public.flash_food_order_items (
      flash_food_order_id, campaign_item_id, product_name, item_note,
      unit_price, shipping_fee_per_unit, quantity, subtotal_amount, shipping_amount, total_amount
    ) values (
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

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'product_name', product_name,
      'item_note', item_note,
      'quantity', quantity
    ) order by product_name),
    '[]'::jsonb
  ) into v_notification_items
  from public.flash_food_order_items
  where flash_food_order_id = v_order.id;

  -- A member may update before their first pending message is sent.  Suppress
  -- that stale confirmation, retaining only the final item snapshot.
  if v_is_update then
    update public.flash_food_notification_jobs
    set status = 'skipped',
        error_message = 'Superseded by a newer flash-food order update',
        updated_at = now()
    where campaign_id = v_campaign.id
      and user_id = auth.uid()
      and event_type in ('order_submitted', 'order_updated')
      and status in ('pending', 'failed');
  end if;

  insert into public.flash_food_notification_jobs (
    campaign_id, user_id, event_type, payload, status, attempts, error_message, sent_at, updated_at
  ) values (
    v_campaign.id,
    auth.uid(),
    case when v_is_update then 'order_updated' else 'order_submitted' end,
    jsonb_build_object(
      'items', v_notification_items,
      'pickup_location', v_order.pickup_location,
      'total_amount', v_order.total_amount
    ),
    'pending', 0, null, null, now()
  ) on conflict (campaign_id, user_id, event_type) do update
  set payload = excluded.payload,
      status = 'pending',
      attempts = 0,
      error_message = null,
      sent_at = null,
      updated_at = now();

  return v_order;
end;
$$;

grant execute on function public.member_save_flash_food_order(uuid, text, text, jsonb) to authenticated;
