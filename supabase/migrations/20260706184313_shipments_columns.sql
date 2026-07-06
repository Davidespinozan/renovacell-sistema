-- Columnas del flujo de despacho (faltaban en la tabla base).
ALTER TABLE public.shipments
  ADD COLUMN IF NOT EXISTS label_url text,
  ADD COLUMN IF NOT EXISTS dispatched_by text,
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz,
  ADD COLUMN IF NOT EXISTS load_confirmed_at timestamptz;

-- Staff operativo puede leer perfiles de CHOFERES (para asignarles envíos),
-- además de doctores. Sigue sin ver PII de otro staff no-operativo.
DROP POLICY IF EXISTS profiles_select_self_or_admin ON profiles;
CREATE POLICY profiles_select_self_or_admin ON profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR public.auth_role() = 'admin'
    OR (role_id = ANY (ARRAY['doctor','driver']) AND public.auth_role() = ANY (ARRAY['warehouse','packing','pos','billing','comm','driver']))
  );
