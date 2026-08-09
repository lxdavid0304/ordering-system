-- In a PL/pgSQL function, the RETURNS TABLE output name `user_id` is a
-- variable.  Name the primary-key constraint explicitly in ON CONFLICT.
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
    select binding.user_id, binding.line_user_id, binding.notifications_enabled,
           binding.linked_at, binding.blocked_at
    from public.member_line_bindings binding
    where binding.user_id = auth.uid();
end;
$$;
