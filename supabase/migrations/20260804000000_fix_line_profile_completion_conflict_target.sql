-- `user_id` is a RETURNS TABLE output variable inside this PL/pgSQL function.
-- Use the named primary key rather than an ambiguous column reference.
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
