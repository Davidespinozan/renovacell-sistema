-- has_cap(cap): ¿el usuario en sesión tiene la capacidad (responsabilidad extra)
-- que Dirección le asignó? Las capacidades viven en profiles.meta.capabilities.
CREATE OR REPLACE FUNCTION public.has_cap(cap text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT COALESCE(
    (SELECT (meta -> 'capabilities') ? cap FROM public.profiles WHERE id = auth.uid()),
    false
  );
$$;
GRANT EXECUTE ON FUNCTION public.has_cap(text) TO authenticated;

-- Publicar anuncios / subir a la biblioteca: admin/comm O quien tenga la
-- capacidad 'anuncios' (p. ej. Almacén con esa responsabilidad).
DROP POLICY IF EXISTS announcements_manage_admin_comm ON announcements;
CREATE POLICY announcements_manage_admin_comm ON announcements FOR ALL TO authenticated
  USING (public.auth_role() = ANY (ARRAY['admin','comm']) OR public.has_cap('anuncios'))
  WITH CHECK (public.auth_role() = ANY (ARRAY['admin','comm']) OR public.has_cap('anuncios'));

DROP POLICY IF EXISTS assets_manage_admin_comm ON assets;
CREATE POLICY assets_manage_admin_comm ON assets FOR ALL TO authenticated
  USING (public.auth_role() = ANY (ARRAY['admin','comm']) OR public.has_cap('anuncios'))
  WITH CHECK (public.auth_role() = ANY (ARRAY['admin','comm']) OR public.has_cap('anuncios'));
