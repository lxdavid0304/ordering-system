-- Customer rule: popular-product prices include shipping. Only manually entered
-- items add NT$20 per unit. Popular-product shipping remains an internal snapshot.
create or replace function public.create_order(
  p_delivery_location text,
  p_note text,
  p_items jsonb,
  p_idempotency_key text,
  p_batch_id text,
  p_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_item jsonb;
  v_name text;
  v_unit_price int;
  v_cost_price int;
  v_shipping_fee_per_unit int := 20;
  v_customer_shipping_fee_per_unit int := 20;
  v_quantity int;
  v_catalog_product_id uuid;
  v_catalog_product public.popular_products%rowtype;
  v_items_total int := 0;
  v_shipping_total int := 0;
  v_profit_total int := 0;
  v_total int := 0;
  v_customer_name text;
  v_phone text;
begin
  if p_user_id is null
     or p_delivery_location is null or length(trim(p_delivery_location)) = 0
     or p_idempotency_key is null or length(trim(p_idempotency_key)) < 8
     or p_batch_id is null or length(trim(p_batch_id)) = 0 then
    raise exception 'Missing required fields';
  end if;

  if p_items is null
     or jsonb_typeof(p_items) <> 'array'
     or jsonb_array_length(p_items) = 0 then
    raise exception 'Items required';
  end if;

  select full_name, real_phone
    into v_customer_name, v_phone
    from public.member_profiles
    where user_id = p_user_id;

  if v_customer_name is null or v_phone is null then
    raise exception 'Member profile required';
  end if;

  begin
    insert into public.orders (
      customer_name, phone, delivery_location, note, total_amount,
      idempotency_key, batch_id, user_id
    )
    values (
      v_customer_name, v_phone, p_delivery_location, nullif(p_note, ''), 0,
      p_idempotency_key, p_batch_id, p_user_id
    )
    returning id into v_order_id;
  exception
    when unique_violation then
      select id into v_order_id
        from public.orders
        where idempotency_key = p_idempotency_key;
      return v_order_id;
  end;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_name := trim(coalesce(v_item->>'product_name', ''));
    if v_name = '' then
      continue;
    end if;

    v_unit_price := (v_item->>'unit_price')::int;
    v_quantity := (v_item->>'quantity')::int;
    v_catalog_product_id := null;
    v_cost_price := v_unit_price;
    v_shipping_fee_per_unit := 20;
    v_customer_shipping_fee_per_unit := 20;

    if nullif(trim(coalesce(v_item->>'catalog_product_id', '')), '') is not null then
      begin
        v_catalog_product_id := (v_item->>'catalog_product_id')::uuid;
      exception
        when invalid_text_representation then
          raise exception 'CATALOG_UNAVAILABLE:%', v_item->>'catalog_product_id';
      end;

      select *
        into v_catalog_product
        from public.popular_products
        where id = v_catalog_product_id
          and is_active = true;

      if not found then
        raise exception 'CATALOG_UNAVAILABLE:%', v_catalog_product_id;
      end if;

      if v_unit_price <> v_catalog_product.unit_price then
        raise exception 'CATALOG_PRICE_CHANGED:%', v_catalog_product_id;
      end if;

      v_name := concat_ws(
        ' ',
        trim(v_catalog_product.product_name),
        nullif(trim(v_catalog_product.specification), '')
      );
      v_unit_price := v_catalog_product.unit_price;
      v_cost_price := v_catalog_product.cost_price;
      v_shipping_fee_per_unit := v_catalog_product.shipping_fee_per_unit;
      v_customer_shipping_fee_per_unit := 0;
    end if;

    if v_unit_price < 0 or v_cost_price < 0 or v_shipping_fee_per_unit < 0 or v_quantity <= 0 then
      raise exception 'Invalid item';
    end if;

    v_items_total := v_items_total + (v_unit_price * v_quantity);
    v_shipping_total := v_shipping_total + (v_quantity * v_customer_shipping_fee_per_unit);
    v_profit_total := v_profit_total + (v_quantity * v_shipping_fee_per_unit);

    insert into public.order_items (
      order_id, product_name, unit_price, quantity, line_total,
      catalog_product_id, cost_price, shipping_fee_per_unit
    )
    values (
      v_order_id, v_name, v_unit_price, v_quantity, v_unit_price * v_quantity,
      v_catalog_product_id, v_cost_price, v_shipping_fee_per_unit
    );
  end loop;

  if v_items_total = 0 then
    raise exception 'Items required';
  end if;

  v_total := v_items_total + v_shipping_total;

  update public.orders
    set total_amount = v_total,
        shipping_amount = v_shipping_total,
        profit_amount = v_profit_total,
        status = case when v_total > 300 then 'pending_deposit' else 'open' end
    where id = v_order_id;

  return v_order_id;
end;
$$;

revoke all on function public.create_order(text, text, jsonb, text, text, uuid) from public;
grant execute on function public.create_order(text, text, jsonb, text, text, uuid) to service_role;
