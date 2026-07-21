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

  perform set_config('app.order_change_reason', 'Payment updated', true);

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
        when status = 'ready_pickup' and v_next_deposit + v_next_balance >= v_order.total_amount then 'fulfilled'
        else status
      end
  where id = p_order_id
  returning * into v_order;

  return v_order;
end;
$$;
