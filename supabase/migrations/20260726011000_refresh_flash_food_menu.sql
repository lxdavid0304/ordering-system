-- 快閃熱食菜單調整：豬肉捲停售後改為牛肉捲／海鮮捲，並新增蒜辣薄皮脆雞桶。
-- 已建立的訂單明細保留原始商品快照；僅停用舊活動中的豬肉捲卡片。

begin;

update public.flash_food_campaign_items
set is_active = false
where product_name = '豬肉捲';

update public.flash_food_campaign_items
set product_name = '牛肉捲／海鮮捲'
where product_name in ('牛肉捲', '豬肉捲');

alter table public.flash_food_campaign_items
  drop constraint if exists flash_food_campaign_items_product_name_check;

alter table public.flash_food_campaign_items
  add constraint flash_food_campaign_items_product_name_check
  check (
    product_name in (
      '熱狗堡＋飲料',
      '牛肉捲／海鮮捲',
      '蒜辣薄皮脆雞桶',
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
    '熱狗堡＋飲料', '牛肉捲／海鮮捲', '蒜辣薄皮脆雞桶', '台式滷肉飯', '日式關東煮',
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

grant execute on function public.admin_create_flash_food_campaign(
  text, timestamptz, timestamptz, timestamptz, text, timestamptz, timestamptz, text, jsonb
) to authenticated;

commit;
