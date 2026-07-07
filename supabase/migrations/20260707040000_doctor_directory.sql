-- H3: cerrar la fuga de PII de DOCTORES (correo, cédula) a roles operativos.
-- Antes, la política de `profiles` dejaba que ventas/almacén/empaque/chofer leyeran
-- la fila COMPLETA de cada doctor (email + meta con cédula/teléfono). Ahora:
--   · Los operativos ven a los doctores SOLO por la vista segura `doctor_directory`
--     (nombre, organización, verificado, y contacto de ENVÍO — sin correo ni cédula).
--   · La tabla base `profiles` de doctores queda para admin (y el propio doctor).
-- La visibilidad de CHOFERES (que empaque/despacho necesitan) NO cambia.

CREATE OR REPLACE VIEW public.doctor_directory AS
SELECT
  p.id,
  COALESCE(NULLIF(p.meta ->> 'name', ''), NULLIF(p.full_name, ''), 'Doctor') AS name,
  p.organization,
  p.verified,
  -- Solo lo necesario para levantar pedido / enviar: teléfono, dirección, ciudad,
  -- especialidad. SIN correo, SIN cédula.
  jsonb_build_object(
    'phone',   p.meta ->> 'phone',
    'address', p.meta ->> 'address',
    'city',    p.meta ->> 'city',
    'specialty', p.meta ->> 'specialty'
  ) AS meta
FROM public.profiles p
WHERE p.role_id = 'doctor'
  AND public.auth_role() <> 'doctor';   -- un doctor no ve a otros doctores

REVOKE ALL ON public.doctor_directory FROM anon;
GRANT SELECT ON public.doctor_directory TO authenticated;

-- Restringe la lectura de `profiles`: quita a los DOCTORES del alcance de operativos
-- (deja intacta la de choferes, que despacho/empaque sí necesitan).
DROP POLICY IF EXISTS profiles_select_self_or_admin ON profiles;
CREATE POLICY profiles_select_self_or_admin ON profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR public.auth_role() = 'admin'
    OR (role_id = 'driver' AND public.auth_role() = ANY (ARRAY['warehouse','packing','pos','billing','comm','driver']))
  );
