-- Disponibilidad agregada por producto para el catálogo (doctor/POS): expone
-- SOLO la cantidad disponible (lotes vigentes), nunca lotes, ubicaciones ni costos.
-- La vista corre como owner (bypassa RLS de lots) pero solo devuelve el agregado.
CREATE OR REPLACE VIEW public.product_stock AS
  SELECT product_id, COALESCE(SUM(quantity), 0)::int AS available
  FROM public.lots
  WHERE product_id IS NOT NULL
    AND (expiry_date IS NULL OR expiry_date >= current_date)
  GROUP BY product_id;
REVOKE ALL ON public.product_stock FROM anon, public;
GRANT SELECT ON public.product_stock TO authenticated;
