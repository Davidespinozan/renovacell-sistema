-- Poder ELIMINAR en el chat: un usuario borra SUS propios mensajes (y admin
-- cualquiera); un DM lo puede borrar cualquiera de sus miembros (o admin). Los
-- grupos por área solo los borra admin. Al borrar una conversación, sus mensajes
-- caen por el ON DELETE CASCADE.
DROP POLICY IF EXISTS messages_delete ON messages;
CREATE POLICY messages_delete ON messages
  FOR DELETE TO authenticated
  USING (sender_id = auth.uid() OR public.auth_role() = 'admin');

DROP POLICY IF EXISTS conversations_delete ON conversations;
CREATE POLICY conversations_delete ON conversations
  FOR DELETE TO authenticated
  USING (
    public.auth_role() = 'admin'
    OR (kind = 'dm' AND auth.uid() = ANY (member_ids))
  );
