-- Always capture the exact order snapshot at each status transition.
-- This replaces any older trigger definition that only recorded the initial state.
create or replace function public.queue_line_order_status_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status is distinct from new.status and new.user_id is not null then
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

drop trigger if exists queue_line_order_status_notification_after_update on public.orders;
create trigger queue_line_order_status_notification_after_update
after update of status on public.orders
for each row execute function public.queue_line_order_status_notification();
