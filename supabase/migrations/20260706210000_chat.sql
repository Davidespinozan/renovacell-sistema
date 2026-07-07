-- CHAT INTERNO (staff). Grupos por área + DMs. Regla dura: es comunicación
-- INTERNA — los DOCTORES NUNCA participan (ni ven grupos ni pueden abrir DMs).
-- Realtime: los mensajes llegan en vivo (postgres_changes respeta el RLS).

-- ============================== TABLAS ==============================
CREATE TABLE IF NOT EXISTS conversations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  kind text NOT NULL DEFAULT 'dm',          -- 'group' | 'dm'
  title text,
  area text,                                -- grupo por área (role_id) o NULL='Todos'
  member_ids uuid[] NOT NULL DEFAULT '{}',  -- miembros de un DM (los grupos van por área)
  created_at timestamptz DEFAULT now(),
  last_message_at timestamptz
);

CREATE TABLE IF NOT EXISTS messages (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sender_name text,
  body text NOT NULL,
  created_at timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS messages_conv_idx ON messages (conversation_id, created_at);

-- ==================== ACCESO (SECURITY DEFINER) ====================
-- ¿Puede el usuario en sesión ver/usar esta conversación? Un DM: si es miembro.
-- Un grupo: por área (Todos=NULL a todo el staff; 'warehouse' incluye 'packing';
-- 'admin' incluye 'billing'/'comm'). NUNCA un doctor. SECURITY DEFINER: corre como
-- owner y no dispara el RLS de conversations (evita recursión), igual que
-- is_order_driver/order_owner.
CREATE OR REPLACE FUNCTION public.can_access_conversation(cid uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT public.auth_role() <> 'doctor' AND EXISTS (
    SELECT 1 FROM public.conversations c WHERE c.id = cid AND (
      (c.kind = 'dm' AND auth.uid() = ANY (c.member_ids))
      OR (c.kind = 'group' AND (
        c.area IS NULL
        OR public.auth_role() = c.area
        OR (c.area = 'warehouse' AND public.auth_role() = 'packing')
        OR (c.area = 'admin' AND public.auth_role() = ANY (ARRAY['billing','comm']))
      ))
    )
  );
$$;
GRANT EXECUTE ON FUNCTION public.can_access_conversation(uuid) TO authenticated;

-- Al insertar un mensaje, actualiza last_message_at del hilo (sin dar UPDATE a los
-- clientes). SECURITY DEFINER para saltar el RLS de conversations.
CREATE OR REPLACE FUNCTION public.bump_conversation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.conversations SET last_message_at = NEW.created_at WHERE id = NEW.conversation_id;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS bump_conversation_trg ON messages;
CREATE TRIGGER bump_conversation_trg AFTER INSERT ON messages
  FOR EACH ROW EXECUTE FUNCTION public.bump_conversation();

-- =============================== RLS ===============================
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages      ENABLE ROW LEVEL SECURITY;

-- Ver conversaciones a las que tienes acceso (staff; DM propio o grupo de tu área).
DROP POLICY IF EXISTS conversations_access ON conversations;
CREATE POLICY conversations_access ON conversations
  FOR SELECT TO authenticated
  USING (public.can_access_conversation(id));

-- Crear un DM: solo staff y contigo mismo como miembro.
DROP POLICY IF EXISTS conversations_create_dm ON conversations;
CREATE POLICY conversations_create_dm ON conversations
  FOR INSERT TO authenticated
  WITH CHECK (kind = 'dm' AND public.auth_role() <> 'doctor' AND auth.uid() = ANY (member_ids));

-- Leer mensajes de un hilo accesible.
DROP POLICY IF EXISTS messages_read ON messages;
CREATE POLICY messages_read ON messages
  FOR SELECT TO authenticated
  USING (public.can_access_conversation(conversation_id));

-- Enviar mensajes: en un hilo accesible y firmando como uno mismo.
DROP POLICY IF EXISTS messages_send ON messages;
CREATE POLICY messages_send ON messages
  FOR INSERT TO authenticated
  WITH CHECK (public.can_access_conversation(conversation_id) AND sender_id = auth.uid());

-- ============================= REALTIME ============================
-- Publica ambas tablas para postgres_changes (el RLS filtra por usuario).
ALTER PUBLICATION supabase_realtime ADD TABLE messages;
ALTER PUBLICATION supabase_realtime ADD TABLE conversations;

-- ======================= GRUPOS POR ÁREA (seed) ====================
-- Ids fijos para que sean estables entre entornos.
INSERT INTO conversations (id, kind, title, area, member_ids, created_at) VALUES
  ('00000000-0000-4000-a000-000000000001', 'group', 'Todos',              NULL,        '{}', now()),
  ('00000000-0000-4000-a000-000000000002', 'group', 'Almacén y Empaque',  'warehouse', '{}', now()),
  ('00000000-0000-4000-a000-000000000003', 'group', 'Dirección',          'admin',     '{}', now())
ON CONFLICT (id) DO NOTHING;
