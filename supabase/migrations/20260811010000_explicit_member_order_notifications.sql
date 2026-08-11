-- Member-facing order notifications are explicit business events:
-- deposit confirmation, an optional price-correction notice, and delivery.
-- Internal status changes must not enqueue their own messages.

do $$
declare
  trigger_row record;
begin
  for trigger_row in
    select n.nspname as schema_name, c.relname as table_name, t.tgname as trigger_name
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    join pg_proc p on p.oid = t.tgfoid
    join pg_namespace pn on pn.oid = p.pronamespace
    where n.nspname = 'public'
      and c.relname = 'orders'
      and pn.nspname = 'public'
      and p.proname = 'queue_line_order_status_notification'
      and not t.tgisinternal
  loop
    execute format('drop trigger if exists %I on %I.%I', trigger_row.trigger_name, trigger_row.schema_name, trigger_row.table_name);
  end loop;
end;
$$;

-- Never allow a legacy automatic status job to send after the explicit-flow
-- deployment. Sent history remains intact for auditability.
update public.line_notification_jobs
set status = 'skipped',
    error_message = 'Replaced by explicit member notification flow',
    claim_token = null,
    processing_started_at = null,
    next_attempt_at = now(),
    updated_at = now()
where event_type = 'order_status_changed'
  and status in ('pending', 'failed', 'processing');
