begin;

create index if not exists flash_food_campaigns_open_at_idx
  on public.flash_food_campaigns (open_at desc);

create or replace function public.admin_flash_food_operating_report(p_period text default 'month')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period text := coalesce(nullif(trim(p_period), ''), 'month');
  v_local_now timestamp := now() at time zone 'Asia/Taipei';
  v_period_start timestamptz;
  v_period_end timestamptz := now();
  v_result jsonb;
begin
  if not public.is_admin_user() then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  if v_period not in ('week', 'month', 'all') then
    raise exception 'INVALID_REPORT_PERIOD';
  end if;

  v_period_start := case v_period
    when 'week' then date_trunc('week', v_local_now) at time zone 'Asia/Taipei'
    when 'month' then date_trunc('month', v_local_now) at time zone 'Asia/Taipei'
    else '-infinity'::timestamptz
  end;

  with filtered_campaigns as (
    select c.id, c.title, c.open_at, c.deadline_at
    from public.flash_food_campaigns c
    where c.open_at >= v_period_start
      and c.open_at <= v_period_end
      and c.status <> 'cancelled'
  ),
  campaign_orders as (
    select o.campaign_id, count(*)::integer as order_count, count(distinct o.user_id)::integer as customer_count
    from public.flash_food_orders o
    join filtered_campaigns c on c.id = o.campaign_id
    where o.status in ('submitted', 'fulfilled')
    group by o.campaign_id
  ),
  campaign_items as (
    select o.campaign_id, coalesce(sum(i.subtotal_amount), 0)::integer as product_amount, coalesce(sum(i.quantity), 0)::integer as item_count
    from public.flash_food_orders o
    join filtered_campaigns c on c.id = o.campaign_id
    join public.flash_food_order_items i on i.flash_food_order_id = o.id
    where o.status in ('submitted', 'fulfilled')
    group by o.campaign_id
  )
  select jsonb_build_object(
    'period', v_period,
    'period_start', v_period_start,
    'period_end', v_period_end,
    'campaigns', coalesce((
      select jsonb_agg(jsonb_build_object(
        'campaign_id', campaign.id,
        'title', campaign.title,
        'open_at', campaign.open_at,
        'deadline_at', campaign.deadline_at,
        'order_count', coalesce(campaign_orders.order_count, 0),
        'customer_count', coalesce(campaign_orders.customer_count, 0),
        'product_amount', coalesce(campaign_items.product_amount, 0),
        'shipping_amount', coalesce(campaign_items.item_count, 0) * 20
      ) order by campaign.open_at desc, campaign.title)
      from filtered_campaigns campaign
      left join campaign_orders on campaign_orders.campaign_id = campaign.id
      left join campaign_items on campaign_items.campaign_id = campaign.id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_flash_food_operating_report(text) from public;
grant execute on function public.admin_flash_food_operating_report(text) to authenticated;

commit;
