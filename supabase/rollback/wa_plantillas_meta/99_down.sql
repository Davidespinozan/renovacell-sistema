-- Reversa de 20270404120000_wa_plantillas_meta.sql: vuelve a WA-PLANTILLAS (20270403) tal cual. Las plantillas creadas
-- desde el sistema que nunca se usaron se borran; las que ya se usaron se conservan (el historial de envíos las referencia).
drop function if exists public.cc_wa_plantilla_guardar(text, text, text, text, text[], text[]), public.cc_wa_plantilla_borrar(text), public.cc_wa_plantillas_lista();
create function public.cc_wa_plantillas_lista() returns jsonb language plpgsql stable security definer set search_path = public as
$$
begin
  if auth.uid() is null or not public._cc_puede_atender(auth.uid()) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('nombre', p.nombre, 'etiqueta', p.etiqueta, 'categoria', p.categoria, 'cuerpo', p.cuerpo, 'variables', p.variables, 'botones', p.botones, 'activa', p.activa) order by p.etiqueta)
                     from public.cc_wa_plantillas p where p.activa or public._cc_es_admin()), '[]'::jsonb);
end;
$$;
revoke all on function public.cc_wa_plantillas_lista() from public, anon;
grant execute on function public.cc_wa_plantillas_lista() to authenticated;
delete from public.cc_wa_plantillas p where p.nombre not in ('seguimiento_vendedor', 'acceso_portal', 'promocion_vigente')
  and not exists (select 1 from public.cc_wa_plantilla_envios e where e.plantilla = p.nombre);
alter table public.cc_wa_plantillas drop constraint if exists ck_cc_wa_plantillas_botones, drop constraint if exists ck_cc_wa_plantillas_cuerpo,
  drop column if exists estado_meta, drop column if exists meta_id, drop column if exists motivo_meta, drop column if exists enviada_at,
  drop column if exists revisada_at, drop column if exists creada_por;
