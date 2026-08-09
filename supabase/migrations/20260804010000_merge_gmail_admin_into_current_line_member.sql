-- Move the verified legacy Gmail administrator into the currently signed-in
-- LINE identity.  The target already has one sent campaign notification for
-- the same campaign, so retain that target-side notification exactly once.
do $$
declare
  v_legacy_user_id constant uuid := '3ee62a1c-6904-4078-9bda-7045cd91a78e';
  v_line_user_id constant uuid := '88abfa77-d11d-4b7a-adde-556fdf508700';
  v_line_identity text;
begin
  perform 1 from public.member_profiles where user_id = v_legacy_user_id for update;
  if not found then
    raise exception 'LEGACY_MEMBER_NOT_FOUND';
  end if;

  select coalesce(identity_data->>'sub', identity_data->>'userId')
    into v_line_identity
  from auth.identities
  where user_id = v_line_user_id
    and provider in ('custom:line', 'line')
  order by last_sign_in_at desc nulls last
  limit 1;
  if coalesce(v_line_identity, '') !~ '^U[0-9a-f]{32}$' then
    raise exception 'TARGET_MUST_USE_LINE_LOGIN';
  end if;

  if exists (select 1 from public.orders where user_id = v_line_user_id)
     or exists (select 1 from public.favorite_items where user_id = v_line_user_id)
     or exists (select 1 from public.flash_food_orders where user_id = v_line_user_id)
     or exists (select 1 from public.line_notification_jobs where user_id = v_line_user_id)
     or exists (
       select 1 from public.flash_food_notification_jobs target_job
       where target_job.user_id = v_line_user_id
         and not exists (
           select 1 from public.flash_food_notification_jobs legacy_job
           where legacy_job.user_id = v_legacy_user_id
             and legacy_job.campaign_id = target_job.campaign_id
             and legacy_job.event_type = target_job.event_type
             and legacy_job.status in ('sent', 'skipped')
             and target_job.status in ('sent', 'skipped')
         )
     ) then
    raise exception 'TARGET_HAS_UNEXPECTED_MEMBER_RECORDS';
  end if;

  delete from public.flash_food_notification_jobs legacy_job
  using public.flash_food_notification_jobs target_job
  where legacy_job.user_id = v_legacy_user_id
    and target_job.user_id = v_line_user_id
    and target_job.campaign_id = legacy_job.campaign_id
    and target_job.event_type = legacy_job.event_type
    and legacy_job.status in ('sent', 'skipped')
    and target_job.status in ('sent', 'skipped');

  update public.flash_food_campaigns set created_by = v_line_user_id where created_by = v_legacy_user_id;
  update public.orders set user_id = v_line_user_id where user_id = v_legacy_user_id;
  update public.favorite_items set user_id = v_line_user_id where user_id = v_legacy_user_id;
  update public.flash_food_orders set user_id = v_line_user_id where user_id = v_legacy_user_id;
  update public.line_notification_jobs set user_id = v_line_user_id where user_id = v_legacy_user_id;
  update public.flash_food_notification_jobs set user_id = v_line_user_id where user_id = v_legacy_user_id;
  update public.order_events set actor_user_id = v_line_user_id where actor_user_id = v_legacy_user_id;
  update public.orders set price_adjusted_by = v_line_user_id where price_adjusted_by = v_legacy_user_id;

  delete from public.member_line_bindings where user_id in (v_legacy_user_id, v_line_user_id);
  update public.member_profiles
  set user_id = v_line_user_id,
      updated_at = now()
  where user_id = v_legacy_user_id;
  insert into public.member_line_bindings (
    user_id, line_user_id, notifications_enabled, linked_at, updated_at, blocked_at
  ) values (
    v_line_user_id, v_line_identity, true, now(), now(), null
  );

  delete from public.admin_users where user_id = v_line_user_id;
  update public.admin_users set user_id = v_line_user_id where user_id = v_legacy_user_id;
  delete from auth.users where id = v_legacy_user_id;
end;
$$;
