-- CALENDARIO DE DISEÑO: entregas y compromisos de producción (requerimiento del
-- área de Diseño). Lo gestiona quien tiene la capability 'diseno' (o admin); el
-- resto del staff puede consultarlo. Los doctores no lo ven.
CREATE TABLE IF NOT EXISTS design_calendar (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  date date NOT NULL,
  kind text NOT NULL DEFAULT 'entrega',   -- 'entrega' | 'produccion' | 'campana'
  notes text,
  status text NOT NULL DEFAULT 'planeado', -- 'planeado' | 'listo'
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS design_calendar_date_idx ON design_calendar (date);

ALTER TABLE design_calendar ENABLE ROW LEVEL SECURITY;

-- Consulta: todo el staff (nunca doctores).
DROP POLICY IF EXISTS design_calendar_staff_read ON design_calendar;
CREATE POLICY design_calendar_staff_read ON design_calendar
  FOR SELECT TO authenticated
  USING (public.auth_role() <> 'doctor');

-- Gestión (crear/editar/borrar): admin o quien tenga la capability 'diseno'.
DROP POLICY IF EXISTS design_calendar_manage ON design_calendar;
CREATE POLICY design_calendar_manage ON design_calendar
  FOR ALL TO authenticated
  USING (public.auth_role() = 'admin' OR public.has_cap('diseno'))
  WITH CHECK (public.auth_role() = 'admin' OR public.has_cap('diseno'));
