-- 開團通知只能在 open_at 到達後發送；建立未來活動時不再把「現在開放點餐」放進通知佇列。

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

create or replace function public.queue_flash_food_campaign_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'UPDATE'
     or old.status is not distinct from new.status
     or new.status <> 'cancelled' then
    return new;
  end if;

  insert into public.flash_food_notification_jobs (campaign_id, user_id, event_type, payload)
  select
    new.id,
    binding.user_id,
    'campaign_cancelled',
    jsonb_build_object(
      'title', new.title,
      'open_at', new.open_at,
      'deadline_at', new.deadline_at,
      'pickup_start_at', new.pickup_start_at,
      'pickup_end_at', new.pickup_end_at,
      'note', new.note
    )
  from public.member_line_bindings binding
  where binding.notifications_enabled = true
    and binding.blocked_at is null
  on conflict (campaign_id, user_id, event_type) do nothing;

  return new;
end;
$$;

-- 曾被舊版程式提早送出的未來開團訊息，改由正式開團排程重新處理。
update public.flash_food_notification_jobs job
set status = 'skipped',
    attempts = 0,
    error_message = 'Requeued for the configured campaign opening time',
    updated_at = now()
from public.flash_food_campaigns campaign
where job.campaign_id = campaign.id
  and job.event_type = 'campaign_opened'
  and campaign.status = 'scheduled'
  and campaign.open_at > now();

create or replace function public.queue_due_flash_food_campaign_open_notifications()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_queued integer := 0;
begin
  insert into public.flash_food_notification_jobs (campaign_id, user_id, event_type, payload)
  select
    campaign.id,
    binding.user_id,
    'campaign_opened',
    jsonb_build_object(
      'title', campaign.title,
      'open_at', campaign.open_at,
      'deadline_at', campaign.deadline_at,
      'pickup_start_at', campaign.pickup_start_at,
      'pickup_end_at', campaign.pickup_end_at,
      'note', campaign.note
    )
  from public.flash_food_campaigns campaign
  join public.member_line_bindings binding
    on binding.notifications_enabled = true
   and binding.blocked_at is null
  where campaign.status = 'scheduled'
    and campaign.open_at <= now()
    and campaign.deadline_at > now()
  on conflict (campaign_id, user_id, event_type) do update
  set status = 'pending',
      attempts = 0,
      error_message = null,
      sent_at = null,
      updated_at = now()
  where public.flash_food_notification_jobs.status = 'skipped';

  get diagnostics v_queued = row_count;
  return v_queued;
end;
$$;

revoke all on function public.queue_due_flash_food_campaign_open_notifications() from public, anon, authenticated;

create or replace function public.dispatch_due_flash_food_open_notifications()
returns void
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
begin
  perform public.queue_due_flash_food_campaign_open_notifications();

  perform net.http_post(
    url := 'https://izuipqvscpcufcelbqmu.supabase.co/functions/v1/flash-food-notify',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'X-Flash-Food-Cron-Secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'flash_food_cron_secret'
        limit 1
      )
    ),
    body := '{"dispatch_due_campaign_opened":true}'::jsonb,
    timeout_milliseconds := 5000
  );
end;
$$;

revoke all on function public.dispatch_due_flash_food_open_notifications() from public, anon, authenticated;

select cron.unschedule(jobid)
from cron.job
where jobname = 'flash-food-open-notifications';

select cron.schedule(
  'flash-food-open-notifications',
  '* * * * *',
  $$select public.dispatch_due_flash_food_open_notifications();$$
);
