-- Record the quoted amount separately when an administrator confirms the final purchase amount.
alter table public.orders
  add column if not exists quoted_total_amount integer,
  add column if not exists price_adjusted_at timestamptz,
  add column if not exists price_adjusted_by uuid references auth.users(id) on delete set null;

create or replace function public.admin_mark_order_ready_for_pickup(
  p_order_id uuid,
  p_final_total_amount integer,
  p_reason text default null
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders;
  v_delta integer;
  v_paid_amount integer;
  v_reason text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if not public.is_admin_user() then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  if coalesce(p_final_total_amount, 0) <= 0 then
    raise exception 'FINAL_TOTAL_REQUIRED';
  end if;

  select * into v_order
  from public.orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  if v_order.status <> 'open' then
    raise exception 'FINAL_TOTAL_ADJUSTMENT_NOT_ALLOWED';
  end if;

  v_paid_amount := coalesce(v_order.deposit_paid_amount, 0) + coalesce(v_order.balance_paid_amount, 0);
  if p_final_total_amount < v_paid_amount then
    raise exception 'FINAL_TOTAL_BELOW_PAID';
  end if;
  if p_final_total_amount <> v_order.total_amount and v_reason is null then
    raise exception 'PRICE_ADJUSTMENT_REASON_REQUIRED';
  end if;

  v_delta := p_final_total_amount - v_order.total_amount;
  perform set_config('app.order_change_reason', coalesce(v_reason, '商品已採買完成'), true);

  update public.orders
  set quoted_total_amount = case
        when p_final_total_amount <> v_order.total_amount then coalesce(quoted_total_amount, v_order.total_amount)
        else quoted_total_amount
      end,
      total_amount = p_final_total_amount,
      profit_amount = profit_amount + v_delta,
      price_adjusted_at = case when p_final_total_amount <> v_order.total_amount then now() else price_adjusted_at end,
      price_adjusted_by = case when p_final_total_amount <> v_order.total_amount then auth.uid() else price_adjusted_by end,
      status = 'ready_pickup'
  where id = p_order_id
  returning * into v_order;

  if v_delta <> 0 then
    insert into public.order_events (order_id, actor_user_id, actor_email, event_type, details)
    values (
      v_order.id,
      auth.uid(),
      auth.jwt()->>'email',
      'price_adjusted',
      jsonb_build_object(
        'reason', v_reason,
        'from_total_amount', v_order.quoted_total_amount,
        'to_total_amount', v_order.total_amount,
        'amount_delta', v_delta,
        'profit_amount', v_order.profit_amount
      )
    );
  end if;

  return v_order;
end;
$$;

revoke all on function public.admin_mark_order_ready_for_pickup(uuid, integer, text) from public;
grant execute on function public.admin_mark_order_ready_for_pickup(uuid, integer, text) to authenticated;
