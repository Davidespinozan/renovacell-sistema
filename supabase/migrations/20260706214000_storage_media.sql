-- SUPABASE STORAGE: bucket `media` para imágenes (biblioteca, prueba de entrega,
-- recursos de diseño, avatares, catálogo). Hasta hoy iban como data-URI incrustado
-- en columnas de texto (inflaba la BD). Bucket PÚBLICO de lectura (contenido no
-- sensible: material interno/operativo); subida solo para autenticados.
INSERT INTO storage.buckets (id, name, public)
VALUES ('media', 'media', true)
ON CONFLICT (id) DO NOTHING;

-- Lectura pública de los objetos del bucket (además, un bucket público ya sirve por
-- URL directa).
DROP POLICY IF EXISTS media_public_read ON storage.objects;
CREATE POLICY media_public_read ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'media');

-- Subir: cualquier usuario autenticado (staff sube evidencias/recursos; el doctor
-- podría subir su comprobante). El objeto queda con owner = quien lo sube.
DROP POLICY IF EXISTS media_auth_insert ON storage.objects;
CREATE POLICY media_auth_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'media');

-- Actualizar/borrar: solo el dueño del objeto (o admin, para curar la biblioteca).
DROP POLICY IF EXISTS media_owner_write ON storage.objects;
CREATE POLICY media_owner_write ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'media' AND (owner = auth.uid() OR public.auth_role() = 'admin'));

DROP POLICY IF EXISTS media_owner_delete ON storage.objects;
CREATE POLICY media_owner_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'media' AND (owner = auth.uid() OR public.auth_role() = 'admin'));
