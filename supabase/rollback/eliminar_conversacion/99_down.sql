-- Reversa de 20270311120000_eliminar_conversacion.sql. Se niega si ya hubo eliminaciones (su archivo es la única copia).
do $g$ begin
  if to_regclass('public.cc_eliminaciones') is not null and exists (select 1 from public.cc_eliminaciones) then
    raise exception 'ELIMINAR_CONVERSACION_DOWN: ya hay eliminaciones con archivo; no se baja sin respaldarlas';
  end if;
end $g$;
drop function if exists public.cc_conversacion_eliminar(uuid, text, boolean);
drop function if exists public._cc_purgar_rama(uuid, regclass, text, regclass[]);
drop table if exists public.cc_purga_archivo;
drop table if exists public.cc_eliminaciones;
