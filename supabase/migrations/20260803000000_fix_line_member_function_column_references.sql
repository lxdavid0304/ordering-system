-- Output-column names in PL/pgSQL are variables.  Always qualify table
-- columns so a LINE session can call these functions without ambiguity.
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
    select binding.user_id, binding.line_user_id, binding.notifications_enabled, binding.linked_at, binding.blocked_at
    from public.member_line_bindings binding
    where binding.user_id = auth.uid();
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
    select profile.user_id, profile.full_name, profile.account, profile.email, profile.real_phone
    from public.member_profiles profile
    where profile.user_id = auth.uid();
end;
$$;
