-- 快閃熱食開團／取消時，將通知工作寫入獨立 outbox，交由 Edge Function 推送至已綁定的 LINE 會員。

create table if not exists public.flash_food_notification_jobs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.flash_food_campaigns(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('campaign_opened', 'campaign_cancelled')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'skipped', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, user_id, event_type)
);

create index if not exists flash_food_notification_jobs_pending_idx
  on public.flash_food_notification_jobs (status, created_at)
  where status in ('pending', 'failed');

alter table public.flash_food_notification_jobs enable row level security;

create or replace function public.queue_flash_food_campaign_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_type text;
begin
  if tg_op = 'INSERT' and new.status = 'scheduled' then
    v_event_type := 'campaign_opened';
  elsif tg_op = 'UPDATE' and old.status is distinct from new.status and new.status = 'cancelled' then
    v_event_type := 'campaign_cancelled';
  else
    return new;
  end if;

  insert into public.flash_food_notification_jobs (campaign_id, user_id, event_type, payload)
  select
    new.id,
    binding.user_id,
    v_event_type,
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

drop trigger if exists queue_flash_food_campaign_notification_after_insert on public.flash_food_campaigns;
create trigger queue_flash_food_campaign_notification_after_insert
after insert on public.flash_food_campaigns
for each row execute function public.queue_flash_food_campaign_notification();

drop trigger if exists queue_flash_food_campaign_notification_after_status_update on public.flash_food_campaigns;
create trigger queue_flash_food_campaign_notification_after_status_update
after update of status on public.flash_food_campaigns
for each row execute function public.queue_flash_food_campaign_notification();

revoke all on public.flash_food_notification_jobs from anon, authenticated;
