-- EVENTOS de venta (expos/congresos). Inventario del evento (items) y miembros
-- (correos) embebidos en jsonb. RLS: admin y los MIEMBROS del evento (por email
-- del JWT). El descuento/reingreso de lotes vive en inventory_movements.
CREATE TABLE IF NOT EXISTS public.events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  venue text,
  date text,
  status text NOT NULL DEFAULT 'activo',
  members jsonb NOT NULL DEFAULT '[]'::jsonb,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS events_all ON public.events;
CREATE POLICY events_all ON public.events FOR ALL TO authenticated
  USING (public.auth_role() = 'admin' OR (members ? (auth.jwt() ->> 'email')))
  WITH CHECK (public.auth_role() = 'admin' OR (members ? (auth.jwt() ->> 'email')));
