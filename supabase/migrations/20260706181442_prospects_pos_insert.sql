-- El vendedor (pos) captura sus propios prospectos (puerta a puerta / WhatsApp),
-- asignados a sí mismo. Admin/comm pueden dar de alta cualquiera.
DROP POLICY IF EXISTS prospects_insert_staff ON prospects;
CREATE POLICY prospects_insert_staff ON prospects
  FOR INSERT TO authenticated
  WITH CHECK (
    public.auth_role() = ANY (ARRAY['admin','comm'])
    OR (public.auth_role() = 'pos' AND assigned_to = auth.uid())
  );
