-- Vista pública del catálogo para la landing: nombre, línea, categoría, descripción,
-- imagen y folleto oficial (PDF) — SIN precio ni costo. La landing la lee con la llave
-- anónima para mostrar todos los productos de forma INFORMATIVA (sin venta). Los precios
-- siguen reservados al Portal del Doctor (post-verificación).

-- Folleto/ficha técnica oficial por producto (PDF externo). Editable; se muestra dentro
-- del popup del producto en la landing cuando existe.
alter table public.products add column if not exists brochure_url text;

create or replace view public.catalog_public as
  select id, name, line, category, description, image_url, brochure_url
  from public.products
  where active = true;

grant select on public.catalog_public to anon, authenticated;