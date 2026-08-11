-- A submitted ordinary order emits exactly one member-facing snapshot.
-- This is deliberately separate from mutable internal status transitions.

alter table public.line_notification_jobs
  drop constraint if exists line_notification_jobs_event_type_check;

alter table public.line_notification_jobs
  add constraint line_notification_jobs_event_type_check
  check (event_type in (
    'order_status_changed',
    'order_created',
    'delivery_location_ready',
    'deposit_confirmed',
    'price_adjusted'
  ));

create unique index if not exists line_notification_jobs_order_created_once_key
  on public.line_notification_jobs (order_id)
  where event_type = 'order_created';
