-- DIRECTORIO DE STAFF (seguro): vista que expone SOLO lo público de cada miembro
-- del equipo — id, nombre, foto y rol — SIN PII (correo, cédula, meta interna). La
-- usa el chat (para listar a quién escribir y pintar avatares) y los anuncios.
-- El RLS de `profiles` (correcto) impide que un no-admin lea perfiles ajenos; esta
-- vista resuelve el caso legítimo (ver nombre+foto para chatear) sin abrir el perfil.
-- Corre como owner (bypassa el RLS de profiles) pero el WHERE excluye a los DOCTORES
-- como llamadores (un doctor no ve al staff) y a los doctores como filas.
CREATE OR REPLACE VIEW public.staff_directory AS
SELECT
  p.id,
  COALESCE(p.meta ->> 'name', p.full_name, p.email) AS name,
  p.meta ->> 'avatar_url' AS avatar_url,
  p.role_id
FROM public.profiles p
WHERE p.role_id <> 'doctor'
  AND public.auth_role() <> 'doctor';

REVOKE ALL ON public.staff_directory FROM anon;
GRANT SELECT ON public.staff_directory TO authenticated;
