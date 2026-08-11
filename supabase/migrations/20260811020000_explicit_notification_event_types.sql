-- Explicit member notifications use their own durable queue event types.
-- Initial order creation and internal status transitions are never messages.

alter table public.line_notification_jobs
  drop constraint if exists line_notification_jobs_event_type_check;

alter table public.line_notification_jobs
  add constraint line_notification_jobs_event_type_check
  check (event_type in (
    'order_status_changed',
    'delivery_location_ready',
    'deposit_confirmed',
    'price_adjusted'
  ));

-- This also clears jobs created by the pre-explicit create-order function.
update public.line_notification_jobs
set status = 'skipped',
    error_message = 'Replaced by explicit member notification flow',
    claim_token = null,
    processing_started_at = null,
    next_attempt_at = now(),
    updated_at = now()
where event_type = 'order_status_changed'
  and status in ('pending', 'failed', 'processing');
