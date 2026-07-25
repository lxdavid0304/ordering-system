-- Admin-only hard deletion for orders cancelled before fulfilment.
-- Related order items, events, and queued LINE notifications cascade from orders.
create or replace function public.admin_delete_order(p_order_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted_id uuid;
begin
  if not public.is_admin_user() then
    raise exception 'ADMIN_REQUIRED' using errcode = '42501';
  end if;

  delete from public.orders
  where id = p_order_id
  returning id into v_deleted_id;

  if v_deleted_id is null then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  return v_deleted_id;
end;
$$;

revoke all on function public.admin_delete_order(uuid) from public;
grant execute on function public.admin_delete_order(uuid) to authenticated;
