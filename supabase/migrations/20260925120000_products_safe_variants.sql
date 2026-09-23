-- Expone family/parent_product_id/sellable en products_safe para que la UI agrupe
-- producto→variantes. Solo exposición de columnas ya existentes; NO cambia datos ni RLS.
create or replace view public.products_safe as
  select id, sku, name, line, category, description, price, unit, image_url,
         active, show_landing, show_portal, family, parent_product_id, sellable
  from public.products
  where auth_role() <> 'doctor'::text or is_verified();
revoke all on public.products_safe from anon, public;
grant select on public.products_safe to authenticated;
