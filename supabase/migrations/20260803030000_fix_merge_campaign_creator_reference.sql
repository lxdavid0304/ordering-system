-- The preceding merge function must also move ownership of campaigns created
-- by the legacy administrator before deleting that Auth user.
do $$
declare
  v_definition text;
begin
  select pg_get_functiondef('public.admin_merge_member_into_existing_line(uuid, uuid)'::regprocedure)
    into v_definition;

  if position('update public.flash_food_campaigns set created_by = p_line_user_id' in v_definition) = 0 then
    v_definition := replace(
      v_definition,
      '  update public.flash_food_notification_jobs set user_id = p_line_user_id where user_id = p_legacy_user_id;
  update public.order_events set actor_user_id = p_line_user_id where actor_user_id = p_legacy_user_id;',
      '  update public.flash_food_notification_jobs set user_id = p_line_user_id where user_id = p_legacy_user_id;
  update public.flash_food_campaigns set created_by = p_line_user_id where created_by = p_legacy_user_id;
  update public.order_events set actor_user_id = p_line_user_id where actor_user_id = p_legacy_user_id;'
    );

    if position('update public.flash_food_campaigns set created_by = p_line_user_id' in v_definition) = 0 then
      raise exception 'MERGE_FUNCTION_PATCH_FAILED';
    end if;

    execute v_definition;
  end if;
end;
$$;
