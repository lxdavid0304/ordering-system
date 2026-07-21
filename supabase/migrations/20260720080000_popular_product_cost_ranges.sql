alter table public.popular_products
  add column if not exists cost_price_min integer;

alter table public.popular_products
  drop constraint if exists popular_products_cost_price_range_check;

alter table public.popular_products
  add constraint popular_products_cost_price_range_check
  check (
    cost_price_min is null
    or (cost_price_min >= 0 and cost_price_min <= cost_price)
  );
