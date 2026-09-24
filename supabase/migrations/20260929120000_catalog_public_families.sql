-- ============================================================================
-- Catálogo PÚBLICO (landing) respeta familias + variantes (misma semántica que
-- el portal / catalogEntries): TOP-LEVEL = familias visuales (padres con hijos) +
-- productos standalone vendibles. Las VARIANTES hijas NO salen como tarjetas.
--
-- Antes: catalog_public = products WHERE active AND show_landing → una fila por
-- producto, incluidas las 117 variantes hijas (fuga al grid de la landing).
--
-- Solo redefine la VISTA de presentación pública. NO toca products, precios,
-- product_prices, product_costs ni el modelo. No cambia datos.
-- ============================================================================
CREATE OR REPLACE VIEW public.catalog_public AS
  SELECT p.id, p.name, p.line, p.category, p.description, p.image_url, p.brochure_url, p.metadata
  FROM public.products p
  WHERE p.active = true
    AND p.show_landing = true
    AND p.parent_product_id IS NULL                                   -- excluye variantes hijas
    AND (
      EXISTS (SELECT 1 FROM public.products c WHERE c.parent_product_id = p.id) -- familia (padre visual)
      OR p.sellable = true                                            -- standalone vendible
    );

GRANT SELECT ON public.catalog_public TO anon, authenticated;
