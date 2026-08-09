-- Merge a legacy administrator into an already-used LINE member without
-- discarding either account's orders.  Duplicate completed notification jobs
-- are represented once because their unique key is (campaign_id, user_id,
-- event_type) after the merge.
create or replace function public.admin_merge_member_into_existing_line(
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
begin
  if not public.is_admin_user() then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  if p_legacy_user_id is null
     or p_line_user_id is null
     or p_legacy_user_id = p_line_user_id then
    raise exception 'INVALID_MEMBER_TRANSFER' using errcode = '22023';
  end if;

  perform 1
  from public.member_profiles profile
  where profile.user_id = p_legacy_user_id
  for update;
  if not found then
    raise exception 'LEGACY_MEMBER_NOT_FOUND' using errcode = 'P0002';
  end if;

  perform 1
  from public.member_profiles profile
  where profile.user_id = p_line_user_id
  for update;
  if not found then
    raise exception 'LINE_MEMBER_NOT_FOUND' using errcode = 'P0002';
  end if;

  select coalesce(identity.identity_data->>'sub', identity.identity_data->>'userId')
    into v_target_line_id
  from auth.identities identity
  where identity.user_id = p_line_user_id
    and identity.provider in ('custom:line', 'line')
  order by identity.last_sign_in_at desc nulls last
  limit 1;

  if coalesce(v_target_line_id, '') !~ '^U[0-9a-f]{32}$' then
    raise exception 'TARGET_MUST_USE_LINE_LOGIN' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.member_line_bindings binding
    where binding.line_user_id = v_target_line_id
      and binding.user_id not in (p_legacy_user_id, p_line_user_id)
  ) then
    raise exception 'LINE_IDENTITY_ALREADY_LINKED' using errcode = '23505';
  end if;

  -- These tables have no safe row-level conflict resolution in this merge.
  if exists (select 1 from public.orders where user_id = p_line_user_id)
     or exists (select 1 from public.favorite_items where user_id = p_line_user_id)
     or exists (select 1 from public.line_notification_jobs where user_id = p_line_user_id) then
    raise exception 'LINE_TARGET_HAS_UNSUPPORTED_MEMBER_RECORDS' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.flash_food_orders legacy_order
    join public.flash_food_orders line_order using (campaign_id)
    where legacy_order.user_id = p_legacy_user_id
      and line_order.user_id = p_line_user_id
  ) then
    raise exception 'FLASH_FOOD_ORDER_CAMPAIGN_CONFLICT' using errcode = '22023';
  end if;

  -- Both identities already received the same completed notification.  Keep
  -- the LINE member's row so the merged user has one canonical job per key.
  delete from public.flash_food_notification_jobs legacy_job
  using public.flash_food_notification_jobs line_job
  where legacy_job.user_id = p_legacy_user_id
    and line_job.user_id = p_line_user_id
    and line_job.campaign_id = legacy_job.campaign_id
    and line_job.event_type = legacy_job.event_type
    and legacy_job.status in ('sent', 'skipped')
    and line_job.status in ('sent', 'skipped');

  if exists (
    select 1
    from public.flash_food_notification_jobs legacy_job
    join public.flash_food_notification_jobs line_job
      on line_job.campaign_id = legacy_job.campaign_id
     and line_job.event_type = legacy_job.event_type
    where legacy_job.user_id = p_legacy_user_id
      and line_job.user_id = p_line_user_id
  ) then
    raise exception 'FLASH_FOOD_NOTIFICATION_CONFLICT' using errcode = '22023';
  end if;

  delete from public.member_profiles where user_id = p_line_user_id;
  update public.member_profiles
  set user_id = p_line_user_id,
      updated_at = now()
  where user_id = p_legacy_user_id;

  update public.orders set user_id = p_line_user_id where user_id = p_legacy_user_id;
  update public.favorite_items set user_id = p_line_user_id where user_id = p_legacy_user_id;
  update public.flash_food_orders set user_id = p_line_user_id where user_id = p_legacy_user_id;
  update public.line_notification_jobs set user_id = p_line_user_id where user_id = p_legacy_user_id;
  update public.flash_food_notification_jobs set user_id = p_line_user_id where user_id = p_legacy_user_id;
  update public.flash_food_campaigns set created_by = p_line_user_id where created_by = p_legacy_user_id;
  update public.order_events set actor_user_id = p_line_user_id where actor_user_id = p_legacy_user_id;
  update public.orders set price_adjusted_by = p_line_user_id where price_adjusted_by = p_legacy_user_id;

  delete from public.member_line_bindings
  where user_id in (p_legacy_user_id, p_line_user_id);
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

revoke all on function public.admin_merge_member_into_existing_line(uuid, uuid) from public;
grant execute on function public.admin_merge_member_into_existing_line(uuid, uuid) to authenticated;
