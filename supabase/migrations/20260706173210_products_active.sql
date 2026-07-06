-- Catálogo administrable: columna 'active' (visible/oculto) que usa la app.
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;

-- products_safe expone columnas seguras (sin costo) + 'active'. Se cierra a anon
-- (precios solo a médicos verificados/autenticados; la landing es estática).
DROP VIEW IF EXISTS public.products_safe;
CREATE VIEW public.products_safe AS
  SELECT id, sku, name, line, category, description, price, unit, image_url, active
  FROM public.products;
REVOKE ALL ON public.products_safe FROM anon, public;
GRANT SELECT ON public.products_safe TO authenticated;
