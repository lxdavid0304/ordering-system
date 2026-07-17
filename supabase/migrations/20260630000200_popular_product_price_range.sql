alter table public.popular_products
  add column if not exists unit_price_min integer;

alter table public.popular_products
  drop constraint if exists popular_products_price_range_check;

alter table public.popular_products
  add constraint popular_products_price_range_check
  check (
    unit_price_min is null
    or (unit_price_min >= 0 and unit_price_min <= unit_price)
  );

comment on column public.popular_products.unit_price_min is
  'Optional minimum estimated price. unit_price remains the maximum price used for order estimates.';
