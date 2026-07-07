-- NOTIFICACIONES internas (Regla 2). Los stores emiten un aviso en cada transición
-- (pedido nuevo, surtido, en camino, pago, prospecto, doctor…) dirigido a un rol de
-- APP. Se persiste y llega EN VIVO por Realtime; el "leído" es POR USUARIO. Los
-- DOCTORES no reciben notificaciones internas (ninguna los tiene como audiencia).

-- Rol de APP (5) a partir del role_id de la base (8): así `roles` (RoleKey del
-- cliente) casa con lo que ve cada usuario, igual que el filtro del TopBar.
CREATE OR REPLACE FUNCTION public.app_role()
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT CASE public.auth_role()
    WHEN 'packing' THEN 'warehouse'
    WHEN 'billing' THEN 'admin'
    WHEN 'comm'    THEN 'admin'
    ELSE public.auth_role()
  END;
$$;
GRANT EXECUTE ON FUNCTION public.app_role() TO authenticated;

CREATE TABLE IF NOT EXISTS notifications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  body text NOT NULL,
  roles text[],              -- audiencia (RoleKeys de app); NULL = broadcast a staff
  screen text,               -- a dónde ir a resolver el pendiente
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_created_idx ON notifications (created_at DESC);

-- "Leído" por usuario (una notificación de rol la ven varios; cada quien la marca).
CREATE TABLE IF NOT EXISTS notification_reads (
  notification_id uuid NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at timestamptz DEFAULT now(),
  PRIMARY KEY (notification_id, user_id)
);

ALTER TABLE notifications      ENABLE ROW LEVEL SECURITY;
ALTER TABLE notification_reads ENABLE ROW LEVEL SECURITY;

-- Ver: staff cuya audiencia incluye su rol de app (admin ve todo; NULL = broadcast
-- staff). Los doctores NO ven notificaciones internas.
DROP POLICY IF EXISTS notifications_read ON notifications;
CREATE POLICY notifications_read ON notifications
  FOR SELECT TO authenticated
  USING (
    public.auth_role() <> 'doctor'
    AND (public.app_role() = 'admin' OR roles IS NULL OR public.app_role() = ANY (roles))
  );

-- Emitir: cualquier usuario autenticado (la notificación es efecto de su acción;
-- p. ej. un doctor crea un pedido → avisa a Almacén). NOTA: el endurecimiento fino
-- (emitir solo desde triggers server-side) es de la fase de integración.
DROP POLICY IF EXISTS notifications_insert ON notifications;
CREATE POLICY notifications_insert ON notifications
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- Cada usuario gestiona SUS marcas de leído.
DROP POLICY IF EXISTS notification_reads_own ON notification_reads;
CREATE POLICY notification_reads_own ON notification_reads
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Realtime: entrega los INSERT de notificaciones (el RLS filtra por rol de cada uno).
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;

-- Seed alineado con el estado inicial (hay un doctor sin verificar): no inventa.
INSERT INTO notifications (id, body, roles, screen, created_at) VALUES
  ('00000000-0000-4000-b000-000000000001', 'Doctores esperando verificación', ARRAY['admin'], 'av_doc', now())
ON CONFLICT (id) DO NOTHING;
