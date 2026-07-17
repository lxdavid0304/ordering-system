alter table public.popular_products
  add column if not exists costco_url text;

alter table public.popular_products
  drop constraint if exists popular_products_costco_url_check;

alter table public.popular_products
  add constraint popular_products_costco_url_check
  check (
    costco_url is null
    or costco_url = 'https://www.costco.com.tw'
    or costco_url like 'https://www.costco.com.tw/%'
  );
