-- Conecta dos módulos que estaban en mock:
--   · resource_requests  → Solicitudes de recurso (Vista Común / Diseño)
--   · landing_content    → contenido editable de la landing pública (una fila)
-- Equipo/usuarios NO necesita tabla: vive en profiles + profiles.meta.capabilities
-- (el login ya lee las capabilities de ahí vía has_cap / supabaseAuth).

-- ============================ RESOURCE_REQUESTS ============================
-- El equipo (Vista Común) pide artes/recursos; quien tiene la capability 'diseno'
-- los atiende (solicitado → en_proceso → entregado) y adjunta el asset entregado.
CREATE TABLE IF NOT EXISTS resource_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  description text,
  requested_by text,                       -- etiqueta legible de quién pidió
  origin text NOT NULL DEFAULT 'equipo',   -- 'equipo' | 'propio' (iniciativa de Diseño)
  status text NOT NULL DEFAULT 'solicitado', -- 'solicitado' | 'en_proceso' | 'entregado'
  asset_url text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE resource_requests ENABLE ROW LEVEL SECURITY;

-- Lectura/creación: todo el staff (nunca doctores). Es colaboración interna.
DROP POLICY IF EXISTS resource_requests_staff_read ON resource_requests;
CREATE POLICY resource_requests_staff_read ON resource_requests
  FOR SELECT TO authenticated
  USING (public.auth_role() <> 'doctor');

DROP POLICY IF EXISTS resource_requests_staff_insert ON resource_requests;
CREATE POLICY resource_requests_staff_insert ON resource_requests
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_role() <> 'doctor');

-- Avanzar estatus / entregar: solo admin o quien tenga la capability 'diseno'.
DROP POLICY IF EXISTS resource_requests_design_update ON resource_requests;
CREATE POLICY resource_requests_design_update ON resource_requests
  FOR UPDATE TO authenticated
  USING (public.auth_role() = 'admin' OR public.has_cap('diseno'))
  WITH CHECK (public.auth_role() = 'admin' OR public.has_cap('diseno'));

DROP POLICY IF EXISTS resource_requests_admin_delete ON resource_requests;
CREATE POLICY resource_requests_admin_delete ON resource_requests
  FOR DELETE TO authenticated
  USING (public.auth_role() = 'admin');

-- ============================= LANDING_CONTENT =============================
-- Contenido de la landing pública (una sola fila, id='main'). El ERP (admin) lo
-- edita; la landing es contenido público, así que la lectura es abierta (anon).
CREATE TABLE IF NOT EXISTS landing_content (
  id text PRIMARY KEY DEFAULT 'main',
  content jsonb NOT NULL,
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE landing_content ENABLE ROW LEVEL SECURITY;

-- Lectura pública: la página es pública (sin datos sensibles).
DROP POLICY IF EXISTS landing_content_public_read ON landing_content;
CREATE POLICY landing_content_public_read ON landing_content
  FOR SELECT TO anon, authenticated
  USING (true);

-- Escritura: solo admin (Dirección edita el sitio desde el ERP).
DROP POLICY IF EXISTS landing_content_admin_write ON landing_content;
CREATE POLICY landing_content_admin_write ON landing_content
  FOR ALL TO authenticated
  USING (public.auth_role() = 'admin')
  WITH CHECK (public.auth_role() = 'admin');
