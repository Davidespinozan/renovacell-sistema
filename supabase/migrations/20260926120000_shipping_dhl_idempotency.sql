-- ============================================================================
-- Modelo logístico MULTIPROVEEDOR (DHL ahora, T1 después) + idempotencia +
-- almacenamiento privado de etiquetas. ADITIVO y NEUTRAL AL PROVEEDOR (nada de
-- nombres dhl_*). No borra ni cambia comportamiento existente.
-- NO aplicar hasta validar en sandbox y re-auditar.
-- ============================================================================

-- 1) SNAPSHOT LOGÍSTICO + metadata neutral en shipments (todo nullable, aditivo).
--    Los snapshots hacen al envío autocontenido y reutilizable por DHL y T1.
ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS provider text,             -- 'dhl' | 't1' | 'envia' | 'chofer' | null
  ADD COLUMN IF NOT EXISTS service_code text,         -- código de servicio del proveedor (neutro)
  ADD COLUMN IF NOT EXISTS pickup_confirmation text,  -- confirmación de recolección (si aplica)
  ADD COLUMN IF NOT EXISTS label_path text,           -- ruta en Storage privado (no URL pública)
  ADD COLUMN IF NOT EXISTS package jsonb,             -- {weight_kg,length_cm,width_cm,height_cm,pieces}
  ADD COLUMN IF NOT EXISTS ship_from jsonb,           -- snapshot neutral del remitente (shipper)
  ADD COLUMN IF NOT EXISTS ship_to jsonb,             -- snapshot neutral del destinatario (receiver)
  ADD COLUMN IF NOT EXISTS provider_meta jsonb;       -- respuesta cruda mínima del proveedor (auditoría)

-- 2) IDEMPOTENCIA: como máximo UNA guía (tracking) por pedido. El envío por chofer
--    usa tracking_number NULL → índice PARCIAL, no le afecta (permite varios sin
--    tracking, uno solo con tracking por order_id).
CREATE UNIQUE INDEX IF NOT EXISTS uq_shipments_order_tracking
  ON public.shipments (order_id)
  WHERE tracking_number IS NOT NULL;

-- 3) CONFIG DE ORIGEN OPERATIVO (shipper) reutilizable por DHL y T1. company_settings
--    ya tiene razon_social/rfc/cp/direccion/telefono/email; faltan ciudad/estado/país
--    ESTRUCTURADOS para el remitente de paquetería. Aditivo; David los captura (no
--    se hardcodean valores).
ALTER TABLE public.company_settings
  ADD COLUMN IF NOT EXISTS ciudad text,
  ADD COLUMN IF NOT EXISTS estado text,
  ADD COLUMN IF NOT EXISTS pais   text DEFAULT 'MX';  -- país operativo por defecto (config, no por-envío)

-- 4) Bucket PRIVADO para etiquetas (contienen PII: direcciones). Acceso solo por URL
--    firmada que genera la Edge Function con service_role. Mismo patrón que `proofs`.
INSERT INTO storage.buckets (id, name, public)
VALUES ('shipping-labels', 'shipping-labels', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS shipping_labels_write ON storage.objects;
CREATE POLICY shipping_labels_write ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'shipping-labels'
    AND public.auth_role() = ANY (ARRAY['admin','warehouse','packing']));

DROP POLICY IF EXISTS shipping_labels_read ON storage.objects;
CREATE POLICY shipping_labels_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'shipping-labels'
    AND public.auth_role() = ANY (ARRAY['admin','warehouse','packing']));
