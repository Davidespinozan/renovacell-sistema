-- AVISOS DIRIGIDOS AL DOCTOR (por user_ids).
--
-- Hasta ahora el RLS de lectura de notificaciones excluía a los doctores por completo
-- (`auth_role() <> 'doctor'` al inicio), así que un doctor NUNCA recibía nada —ni
-- "pago confirmado", ni "cuenta aprobada"— aunque el aviso viniera dirigido a él.
--
-- Regla nueva: si el aviso va DIRIGIDO a personas (`user_ids`), lo ven ESAS personas,
-- incluidos los doctores (solo si están en la lista). Los avisos por ROL siguen siendo
-- solo del staff (el doctor no ve difusiones internas). Privacidad intacta: un doctor
-- solo ve lo que lleva su propio id.
DROP POLICY IF EXISTS notifications_read ON public.notifications;
CREATE POLICY notifications_read ON public.notifications
  FOR SELECT TO authenticated
  USING (
    CASE
      -- Dirigido a personas: solo sus destinatarios (incluye doctores).
      WHEN user_ids IS NOT NULL THEN auth.uid() = ANY (user_ids)
      -- Por rol (comportamiento previo): staff only; admin ve todo; NULL = staff.
      ELSE (public.auth_role() <> 'doctor'
            AND (public.app_role() = 'admin' OR roles IS NULL OR public.app_role() = ANY (roles)))
    END
  );