-- NOTIFICACIONES DIRIGIDAS A PERSONAS (no solo a roles).
--
-- Motivo: los avisos de mensajes de chat van a los MIEMBROS de la conversación,
-- no a un rol. Con el modelo anterior, una notificación sin `roles` se trataba
-- como difusión a TODO el staff — lo que habría filtrado el aviso (y el adelanto)
-- de un mensaje directo a toda la empresa.
--
-- Regla nueva: si `user_ids` viene lleno, MANDA sobre todo lo demás y solo esas
-- personas ven la notificación. Ni siquiera Dirección la ve si no es destinataria:
-- un mensaje directo es privado entre sus participantes.
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS user_ids uuid[];

COMMENT ON COLUMN public.notifications.user_ids IS
  'Destinatarios explícitos. Si no es NULL, solo estas personas ven la notificación (tiene prioridad sobre `roles`). Se usa para avisos de chat.';

DROP POLICY IF EXISTS notifications_read ON public.notifications;
CREATE POLICY notifications_read ON public.notifications
  FOR SELECT TO authenticated
  USING (
    public.auth_role() <> 'doctor'
    AND CASE
      -- Dirigida a personas: solo ellas (privacidad de mensajes directos).
      WHEN user_ids IS NOT NULL THEN auth.uid() = ANY (user_ids)
      -- Dirigida a roles (comportamiento previo): admin ve todo; NULL = staff.
      ELSE (public.app_role() = 'admin' OR roles IS NULL OR public.app_role() = ANY (roles))
    END
  );