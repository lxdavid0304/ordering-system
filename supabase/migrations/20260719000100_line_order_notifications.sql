-- LINE member linking and order status notification outbox.
create table if not exists public.member_line_bindings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  line_user_id text not null unique check (line_user_id ~ '^U[0-9a-f]{32}$'),
  notifications_enabled boolean not null default true,
  linked_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  blocked_at timestamptz
);

create table if not exists public.member_line_link_codes (
  code text primary key check (code ~ '^[A-F0-9]{12}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists member_line_link_codes_active_user_key
  on public.member_line_link_codes (user_id) where consumed_at is null;
create index if not exists member_line_link_codes_expiry_idx
  on public.member_line_link_codes (expires_at) where consumed_at is null;

create table if not exists public.line_notification_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('order_status_changed')),
  status text not null default 'pending' check (status in ('pending', 'processing', 'sent', 'skipped', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  payload jsonb not null default '{}'::jsonb,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists line_notification_jobs_pending_idx
  on public.line_notification_jobs (status, created_at) where status = 'pending';

alter table public.member_line_bindings enable row level security;
alter table public.member_line_link_codes enable row level security;
alter table public.line_notification_jobs enable row level security;

drop policy if exists "member read own line binding" on public.member_line_bindings;
create policy "member read own line binding" on public.member_line_bindings
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "admin read line bindings" on public.member_line_bindings;
create policy "admin read line bindings" on public.member_line_bindings
  for select to authenticated using (public.is_admin_user());
drop policy if exists "member update own line preference" on public.member_line_bindings;
create policy "member update own line preference" on public.member_line_bindings
  for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

revoke all on public.member_line_bindings from anon, authenticated;
grant select on public.member_line_bindings to authenticated;
grant update (notifications_enabled) on public.member_line_bindings to authenticated;

create or replace function public.issue_line_link_code()
returns table (code text, expires_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_expiry timestamptz := now() + interval '15 minutes';
begin
  if auth.uid() is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;
  delete from public.member_line_link_codes where user_id = auth.uid() and consumed_at is null;
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
  insert into public.member_line_link_codes (code, user_id, expires_at)
  values (v_code, auth.uid(), v_expiry);
  return query select v_code, v_expiry;
end;
$$;

create or replace function public.consume_line_link_code(p_code text, p_line_user_id text)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_code public.member_line_link_codes%rowtype;
begin
  if p_code !~ '^[A-F0-9]{12}$' or p_line_user_id !~ '^U[0-9a-f]{32}$' then
    return 'INVALID';
  end if;
  select * into v_code from public.member_line_link_codes where code = p_code for update;
  if not found or v_code.consumed_at is not null or v_code.expires_at <= now() then
    return 'EXPIRED';
  end if;
  if exists (
    select 1 from public.member_line_bindings
    where line_user_id = p_line_user_id and user_id <> v_code.user_id
  ) then
    return 'ALREADY_LINKED';
  end if;
  insert into public.member_line_bindings (user_id, line_user_id, notifications_enabled, linked_at, updated_at, blocked_at)
  values (v_code.user_id, p_line_user_id, true, now(), now(), null)
  on conflict (user_id) do update
    set line_user_id = excluded.line_user_id,
        notifications_enabled = true,
        updated_at = now(),
        blocked_at = null;
  update public.member_line_link_codes set consumed_at = now() where code = v_code.code;
  return 'LINKED';
end;
$$;

create or replace function public.mark_line_account_unfollowed(p_line_user_id text)
returns void language sql security definer set search_path = public as $$
  update public.member_line_bindings
  set blocked_at = now(), updated_at = now()
  where line_user_id = p_line_user_id;
$$;

create or replace function public.queue_line_order_status_notification()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.status is distinct from new.status and new.user_id is not null then
    insert into public.line_notification_jobs (order_id, user_id, event_type, payload)
    values (
      new.id,
      new.user_id,
      'order_status_changed',
      jsonb_build_object('from_status', old.status, 'to_status', new.status)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists queue_line_order_status_notification_after_update on public.orders;
create trigger queue_line_order_status_notification_after_update
after update of status on public.orders
for each row execute function public.queue_line_order_status_notification();

revoke all on public.member_line_link_codes from anon, authenticated;
revoke all on public.line_notification_jobs from anon, authenticated;
revoke all on function public.issue_line_link_code() from public;
revoke all on function public.consume_line_link_code(text, text) from public;
revoke all on function public.mark_line_account_unfollowed(text) from public;
grant execute on function public.issue_line_link_code() to authenticated;
grant execute on function public.consume_line_link_code(text, text) to service_role;
grant execute on function public.mark_line_account_unfollowed(text) to service_role;
