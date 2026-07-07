-- H4: la PRUEBA DE ENTREGA (foto de quien recibe) es evidencia sensible. Antes iba
-- al bucket público `media` → legible por cualquiera con la URL. Ahora va a un bucket
-- PRIVADO `proofs`: solo staff (no doctores) puede subir y generar URL firmada; no hay
-- lectura pública. Los avatares/biblioteca/catálogo siguen en `media` (público, OK).
INSERT INTO storage.buckets (id, name, public)
VALUES ('proofs', 'proofs', false)
ON CONFLICT (id) DO NOTHING;

-- Subir: staff (nunca doctores).
DROP POLICY IF EXISTS proofs_insert ON storage.objects;
CREATE POLICY proofs_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'proofs' AND public.auth_role() <> 'doctor');

-- Leer (para generar URL firmada): staff. Los doctores NO ven evidencias internas.
DROP POLICY IF EXISTS proofs_read ON storage.objects;
CREATE POLICY proofs_read ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'proofs' AND public.auth_role() <> 'doctor');

-- Borrar/actualizar: dueño o admin.
DROP POLICY IF EXISTS proofs_owner_write ON storage.objects;
CREATE POLICY proofs_owner_write ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'proofs' AND (owner = auth.uid() OR public.auth_role() = 'admin'));
DROP POLICY IF EXISTS proofs_owner_delete ON storage.objects;
CREATE POLICY proofs_owner_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'proofs' AND (owner = auth.uid() OR public.auth_role() = 'admin'));
