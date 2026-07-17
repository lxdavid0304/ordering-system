create table if not exists public.popular_products (
  id uuid primary key default gen_random_uuid(),
  product_name text not null check (length(trim(product_name)) between 1 and 120),
  specification text not null default '' check (length(specification) <= 160),
  category text not null default '其他' check (length(trim(category)) between 1 and 60),
  unit_price integer not null check (unit_price >= 0),
  image_path text not null check (length(trim(image_path)) > 0),
  costco_url text check (
    costco_url is null
    or costco_url = 'https://www.costco.com.tw'
    or costco_url like 'https://www.costco.com.tw/%'
  ),
  is_active boolean not null default false,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists popular_products_name_specification_key
  on public.popular_products (lower(trim(product_name)), lower(trim(specification)));

create index if not exists popular_products_public_order_idx
  on public.popular_products (is_active, sort_order, updated_at desc);

create or replace function public.touch_popular_product_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists touch_popular_product_updated_at on public.popular_products;
create trigger touch_popular_product_updated_at
before update on public.popular_products
for each row execute function public.touch_popular_product_updated_at();

alter table public.popular_products enable row level security;

drop policy if exists "public read active popular products" on public.popular_products;
create policy "public read active popular products"
  on public.popular_products
  for select
  to anon, authenticated
  using (is_active);

drop policy if exists "admin read all popular products" on public.popular_products;
create policy "admin read all popular products"
  on public.popular_products
  for select
  to authenticated
  using (public.is_admin_user());

drop policy if exists "admin insert popular products" on public.popular_products;
create policy "admin insert popular products"
  on public.popular_products
  for insert
  to authenticated
  with check (public.is_admin_user());

drop policy if exists "admin update popular products" on public.popular_products;
create policy "admin update popular products"
  on public.popular_products
  for update
  to authenticated
  using (public.is_admin_user())
  with check (public.is_admin_user());

drop policy if exists "admin delete popular products" on public.popular_products;
create policy "admin delete popular products"
  on public.popular_products
  for delete
  to authenticated
  using (public.is_admin_user());

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'popular-products',
  'popular-products',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "public read popular product images" on storage.objects;
create policy "public read popular product images"
  on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'popular-products');

drop policy if exists "admin insert popular product images" on storage.objects;
create policy "admin insert popular product images"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'popular-products' and public.is_admin_user());

drop policy if exists "admin update popular product images" on storage.objects;
create policy "admin update popular product images"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'popular-products' and public.is_admin_user())
  with check (bucket_id = 'popular-products' and public.is_admin_user());

drop policy if exists "admin delete popular product images" on storage.objects;
create policy "admin delete popular product images"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'popular-products' and public.is_admin_user());

alter table public.order_items
  add column if not exists catalog_product_id uuid
    references public.popular_products(id) on delete set null;

create index if not exists order_items_catalog_product_id_idx
  on public.order_items (catalog_product_id);

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
  v_quantity int;
  v_catalog_product_id uuid;
  v_catalog_product public.popular_products%rowtype;
  v_items_total int := 0;
  v_shipping_total int := 0;
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
      customer_name,
      phone,
      delivery_location,
      note,
      total_amount,
      idempotency_key,
      batch_id,
      user_id
    )
    values (
      v_customer_name,
      v_phone,
      p_delivery_location,
      nullif(p_note, ''),
      0,
      p_idempotency_key,
      p_batch_id,
      p_user_id
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
    end if;

    if v_unit_price < 0 or v_quantity <= 0 then
      raise exception 'Invalid item';
    end if;

    v_items_total := v_items_total + (v_unit_price * v_quantity);
    v_shipping_total := v_shipping_total + (v_quantity * 20);

    insert into public.order_items (
      order_id,
      product_name,
      unit_price,
      quantity,
      line_total,
      catalog_product_id
    )
    values (
      v_order_id,
      v_name,
      v_unit_price,
      v_quantity,
      v_unit_price * v_quantity,
      v_catalog_product_id
    );
  end loop;

  if v_items_total = 0 then
    raise exception 'Items required';
  end if;

  v_total := v_items_total + v_shipping_total;

  update public.orders
    set total_amount = v_total,
        status = case
          when v_total > 300 then 'pending_deposit'
          else 'open'
        end
    where id = v_order_id;

  return v_order_id;
end;
$$;

revoke all on function public.create_order(text, text, jsonb, text, text, uuid) from public;
grant execute on function public.create_order(text, text, jsonb, text, text, uuid) to service_role;
