-- Vista pública del catálogo para la landing: nombre, línea, categoría, descripción
-- e imagen — SIN precio ni costo. La landing la lee con la llave anónima para mostrar
-- todos los productos de forma INFORMATIVA (sin venta). Los precios siguen reservados
-- al Portal del Doctor (post-verificación).
create or replace view public.catalog_public as
  select id, name, line, category, description, image_url
  from public.products
  where active = true;

grant select on public.catalog_public to anon, authenticated;