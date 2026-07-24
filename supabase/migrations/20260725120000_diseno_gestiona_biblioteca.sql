-- Diseño (capability 'diseno') gestiona la Biblioteca y las solicitudes.
--
-- La Vista Común permite: (a) pasar una solicitud de recurso ya entregada a la
-- Biblioteca (crea un asset) y (b) eliminar tanto assets como solicitudes. Esas
-- acciones las hace quien tiene la capability 'diseno' (o admin). Antes las RLS
-- solo permitían admin/comm/anuncios en assets y admin en el delete de
-- resource_requests, así que un usuario de Diseño no-admin no podía. Se amplían.

alter policy assets_manage_admin_comm on public.assets
  using ((auth_role() = any (array['admin','comm'])) or has_cap('anuncios') or has_cap('diseno'))
  with check ((auth_role() = any (array['admin','comm'])) or has_cap('anuncios') or has_cap('diseno'));

alter policy resource_requests_admin_delete on public.resource_requests
  using (auth_role() = 'admin' or has_cap('diseno'));