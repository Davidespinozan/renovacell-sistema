-- ============================================================================
-- ORIGEN DE ENVÍOS separado del domicilio FISCAL. Campos NEUTRALES al proveedor
-- (DHL/T1) para el remitente de paquetería. El shipping los usa EXCLUSIVAMENTE
-- (sin fallback al fiscal): el domicilio fiscal y el de despacho pueden diferir.
-- ADITIVO. No borra datos. Las columnas ciudad/estado/pais (20260926) quedan como
-- LEGACY (no se usan ni se borran, para no perder lo capturado).
-- ============================================================================
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS shipping_name    text,
  ADD COLUMN IF NOT EXISTS shipping_address text,
  ADD COLUMN IF NOT EXISTS shipping_cp      text,
  ADD COLUMN IF NOT EXISTS shipping_city    text,
  ADD COLUMN IF NOT EXISTS shipping_state   text,
  ADD COLUMN IF NOT EXISTS shipping_country text DEFAULT 'MX',
  ADD COLUMN IF NOT EXISTS shipping_phone   text,
  ADD COLUMN IF NOT EXISTS shipping_email   text;

-- NOTA: NO se copian ciudad/estado/pais ni el domicilio fiscal hacia shipping_*.
-- El origen de envíos queda VACÍO hasta que Dirección capture el domicilio operativo
-- real (evita asumir que fiscal == despacho).
