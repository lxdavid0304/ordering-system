-- Pure LINE membership: LINE OAuth identity is the only source for member bindings.
alter table public.member_profiles
  alter column email drop not null;

drop index if exists public.member_profiles_email_key;
create unique index if not exists member_profiles_email_key
  on public.member_profiles (email)
  where email is not null;

drop function if exists public.issue_line_link_code();
drop function if exists public.consume_line_link_code(text, text);
drop table if exists public.member_line_link_codes;

create or replace function public.bind_current_line_member()
returns table (
  user_id uuid,
  line_user_id text,
  notifications_enabled boolean,
  linked_at timestamptz,
  blocked_at timestamptz
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_line_user_id text;
begin
  if auth.uid() is null then
    raise exception 'AUTHENTICATION_REQUIRED' using errcode = '42501';
  end if;

  select coalesce(identity.identity_data->>'sub', identity.identity_data->>'userId')
    into v_line_user_id
  from auth.identities identity
  where identity.user_id = auth.uid()
    and identity.provider in ('custom:line', 'line')
  order by identity.last_sign_in_at desc nulls last
  limit 1;

  if coalesce(v_line_user_id, '') !~ '^U[0-9a-f]{32}$' then
    raise exception 'LINE_IDENTITY_REQUIRED' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.member_line_bindings binding
    where binding.line_user_id = v_line_user_id
      and binding.user_id <> auth.uid()
  ) then
    raise exception 'LINE_IDENTITY_ALREADY_LINKED' using errcode = '23505';
  end if;

  insert into public.member_line_bindings (
    user_id, line_user_id, notifications_enabled, linked_at, updated_at, blocked_at
  ) values (
    auth.uid(), v_line_user_id, true, now(), now(), null
  )
  on conflict on constraint member_line_bindings_pkey do update
    set line_user_id = excluded.line_user_id,
        notifications_enabled = true,
        updated_at = now(),
        blocked_at = null;

  return query
    select b.user_id, b.line_user_id, b.notifications_enabled, b.linked_at, b.blocked_at
    from public.member_line_bindings b
    where b.user_id = auth.uid();
end;
$$;

create or replace function public.complete_current_line_member_profile(
  p_full_name text,
  p_real_phone text
)
returns table (
  user_id uuid,
  full_name text,
  account text,
  email text,
  real_phone text
)
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_full_name text := trim(coalesce(p_full_name, ''));
  v_phone text := regexp_replace(coalesce(p_real_phone, ''), '[^\d+]', '', 'g');
  v_account text;
  v_email text;
begin
  perform public.bind_current_line_member();

  if v_full_name = '' then
    raise exception 'FULL_NAME_REQUIRED' using errcode = '22023';
  end if;
  if char_length(v_phone) < 8 or char_length(v_phone) > 20 then
    raise exception 'VALID_PHONE_REQUIRED' using errcode = '22023';
  end if;

  select profile.account, profile.email into v_account, v_email
  from public.member_profiles profile
  where profile.user_id = auth.uid();

  v_account := coalesce(nullif(v_account, ''), 'line' || substr(replace(auth.uid()::text, '-', ''), 1, 20));

  insert into public.member_profiles (
    user_id, full_name, account, email, real_phone, created_at, updated_at
  ) values (
    auth.uid(), v_full_name, v_account, v_email, v_phone, now(), now()
  )
  on conflict on constraint member_profiles_pkey do update
    set full_name = excluded.full_name,
        real_phone = excluded.real_phone,
        updated_at = now();

  return query
    select p.user_id, p.full_name, p.account, p.email, p.real_phone
    from public.member_profiles p
    where p.user_id = auth.uid();
end;
$$;

create or replace function public.admin_list_members_for_line_transfer()
returns table (
  user_id uuid,
  full_name text,
  account text,
  email text,
  real_phone text,
  has_line_identity boolean
)
language sql
security definer
set search_path = public, auth
as $$
  select
    p.user_id,
    p.full_name,
    p.account,
    p.email,
    p.real_phone,
    exists (
      select 1 from auth.identities i
      where i.user_id = p.user_id
        and i.provider in ('custom:line', 'line')
        and coalesce(i.identity_data->>'sub', i.identity_data->>'userId') ~ '^U[0-9a-f]{32}$'
    ) as has_line_identity
  from public.member_profiles p
  where public.is_admin_user()
  order by p.created_at desc;
$$;

create or replace function public.admin_transfer_member_to_line(
  p_legacy_user_id uuid,
  p_line_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_target_line_id text;
  v_source_profile public.member_profiles%rowtype;
begin
  if not public.is_admin_user() then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;
  if p_legacy_user_id is null or p_line_user_id is null or p_legacy_user_id = p_line_user_id then
    raise exception 'INVALID_MEMBER_TRANSFER' using errcode = '22023';
  end if;

  select * into v_source_profile
  from public.member_profiles
  where user_id = p_legacy_user_id
  for update;
  if not found then
    raise exception 'LEGACY_MEMBER_NOT_FOUND' using errcode = 'P0002';
  end if;

  select coalesce(identity_data->>'sub', identity_data->>'userId')
    into v_target_line_id
  from auth.identities
  where user_id = p_line_user_id
    and provider in ('custom:line', 'line')
  order by last_sign_in_at desc nulls last
  limit 1;
  if coalesce(v_target_line_id, '') !~ '^U[0-9a-f]{32}$' then
    raise exception 'TARGET_MUST_USE_LINE_LOGIN' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.member_line_bindings
    where line_user_id = v_target_line_id
      and user_id not in (p_legacy_user_id, p_line_user_id)
  ) then
    raise exception 'LINE_IDENTITY_ALREADY_LINKED' using errcode = '23505';
  end if;

  if exists (select 1 from public.orders where user_id = p_line_user_id)
    or exists (select 1 from public.favorite_items where user_id = p_line_user_id)
    or exists (select 1 from public.flash_food_orders where user_id = p_line_user_id)
    or exists (select 1 from public.line_notification_jobs where user_id = p_line_user_id)
    or exists (select 1 from public.flash_food_notification_jobs where user_id = p_line_user_id) then
    raise exception 'LINE_TARGET_MUST_NOT_HAVE_MEMBER_RECORDS' using errcode = '22023';
  end if;

  delete from public.member_profiles where user_id = p_line_user_id;
  update public.member_profiles set user_id = p_line_user_id, updated_at = now()
    where user_id = p_legacy_user_id;
  update public.orders set user_id = p_line_user_id where user_id = p_legacy_user_id;
  update public.favorite_items set user_id = p_line_user_id where user_id = p_legacy_user_id;
  update public.flash_food_orders set user_id = p_line_user_id where user_id = p_legacy_user_id;
  update public.line_notification_jobs set user_id = p_line_user_id where user_id = p_legacy_user_id;
  update public.flash_food_notification_jobs set user_id = p_line_user_id where user_id = p_legacy_user_id;
  update public.order_events set actor_user_id = p_line_user_id where actor_user_id = p_legacy_user_id;
  update public.orders set price_adjusted_by = p_line_user_id where price_adjusted_by = p_legacy_user_id;

  delete from public.member_line_bindings where user_id in (p_legacy_user_id, p_line_user_id);
  insert into public.member_line_bindings (
    user_id, line_user_id, notifications_enabled, linked_at, updated_at, blocked_at
  ) values (
    p_line_user_id, v_target_line_id, true, now(), now(), null
  );

  if exists (select 1 from public.admin_users where user_id = p_legacy_user_id) then
    delete from public.admin_users where user_id = p_line_user_id;
    update public.admin_users set user_id = p_line_user_id where user_id = p_legacy_user_id;
  end if;

  delete from auth.users where id = p_legacy_user_id;
  return p_line_user_id;
end;
$$;

revoke all on function public.bind_current_line_member() from public;
revoke all on function public.complete_current_line_member_profile(text, text) from public;
revoke all on function public.admin_list_members_for_line_transfer() from public;
revoke all on function public.admin_transfer_member_to_line(uuid, uuid) from public;
grant execute on function public.bind_current_line_member() to authenticated;
grant execute on function public.complete_current_line_member_profile(text, text) to authenticated;
grant execute on function public.admin_list_members_for_line_transfer() to authenticated;
grant execute on function public.admin_transfer_member_to_line(uuid, uuid) to authenticated;
