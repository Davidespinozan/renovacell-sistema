-- VISIBILIDAD POR CANAL
--
-- Hasta ahora `active` era un interruptor único: apagaba el producto en todos
-- lados a la vez (landing, portal del doctor, punto de venta, eventos). No
-- servía para el caso real: un producto que sí se vende pero que todavía no
-- debe salir al público — por ejemplo porque no tiene fotografía.
--
-- Se agregan dos banderas independientes. `active` sigue mandando: si está en
-- falso, el producto no se ve en ningún lado.
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS show_landing boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS show_portal  boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.products.show_landing IS
  'Se muestra en el catálogo público de la landing. Ocultarlo no impide venderlo.';
COMMENT ON COLUMN public.products.show_portal IS
  'Se muestra en el catálogo del Portal del Doctor. Ocultarlo no impide venderlo en mostrador.';

-- La vista pública deja de exponer lo que no debe salir al público.
CREATE OR REPLACE VIEW public.catalog_public AS
  SELECT id, name, line, category, description, image_url, brochure_url
  FROM public.products
  WHERE active = true AND show_landing = true;

-- `products_safe` es la vista que consume el sistema (oculta el catálogo a los
-- doctores sin verificar). También necesita las banderas para que las pantallas
-- puedan filtrar por canal.
CREATE OR REPLACE VIEW public.products_safe AS
  SELECT id, sku, name, line, category, description, price, unit, image_url,
         active, show_landing, show_portal
  FROM public.products
  WHERE auth_role() <> 'doctor'::text OR is_verified();
