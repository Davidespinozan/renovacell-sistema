-- Staff operativo (ventas/almacén/empaque/facturación/chofer/comm) puede leer los
-- perfiles de DOCTORES (son clientes: necesitan contacto, dirección de envío,
-- verificación). Sigue SIN poder leer PII de otro STAFF (solo el suyo). Admin todo.
DROP POLICY IF EXISTS profiles_select_self_or_admin ON profiles;
CREATE POLICY profiles_select_self_or_admin ON profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR public.auth_role() = 'admin'
    OR (role_id = 'doctor' AND public.auth_role() = ANY (ARRAY['warehouse','packing','pos','billing','comm','driver']))
  );
