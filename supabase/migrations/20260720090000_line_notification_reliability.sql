-- Make notification delivery recoverable and keep order totals inclusive of customer shipping.
alter table public.line_notification_jobs
  add column if not exists next_attempt_at timestamptz not null default now(),
  add column if not exists processing_started_at timestamptz,
  add column if not exists claim_token uuid;

update public.line_notification_jobs
set next_attempt_at = coalesce(next_attempt_at, now())
where next_attempt_at is null;

create index if not exists line_notification_jobs_retry_idx
  on public.line_notification_jobs (next_attempt_at, created_at)
  where status in ('pending', 'failed');

create or replace function public.update_order_total()
returns trigger
language plpgsql
as $$
declare
  target_id uuid;
  v_items_total integer;
  v_shipping_total integer;
  v_profit_total integer;
begin
  target_id := coalesce(new.order_id, old.order_id);

  select
    coalesce(sum(line_total), 0)::integer,
    coalesce(sum(case when catalog_product_id is null then quantity * 20 else 0 end), 0)::integer,
    coalesce(sum(quantity * shipping_fee_per_unit), 0)::integer
  into v_items_total, v_shipping_total, v_profit_total
  from public.order_items
  where order_id = target_id;

  update public.orders
  set shipping_amount = v_shipping_total,
      profit_amount = v_profit_total,
      total_amount = v_items_total + v_shipping_total
  where id = target_id;
  return coalesce(new, old);
end;
$$;
