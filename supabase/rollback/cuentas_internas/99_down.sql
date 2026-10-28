-- CUENTAS INTERNAS · rollback: las 4 cuentas vuelven a ser visibles, vuelven las funciones y políticas anteriores.
CREATE OR REPLACE FUNCTION public._cc_reparto_elegir(p_conv uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select p.id from public.profiles p
   where p.role_id = 'pos' and public._cc_vendedor_elegible(p.id, true)
     and not (p.id = any (coalesce((select c.reparto_probados from public.cc_conversations c where c.id = p_conv), '{}')))
   order by random() limit 1
$function$;
CREATE OR REPLACE FUNCTION public.cc_vendedores()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public._cc7_direccion();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'nombre', coalesce(p.meta ->> 'name', p.full_name, p.email), 'activo', p.active,
      'conversaciones', coalesce(p.meta -> 'capabilities', '[]'::jsonb) ? 'conversaciones',
      'nuevos_clientes', coalesce(p.meta -> 'capabilities', '[]'::jsonb) ? 'nuevos_clientes',
      'elegible', public._cc_vendedor_elegible(p.id, false), 'elegible_nuevos', public._cc_vendedor_elegible(p.id, true),
      'clientes', (select count(*) from public.cc_cartera k where k.seller_profile_id = p.id) + (select count(*) from public.cc_cartera_clientes kk where kk.seller_profile_id = p.id)) order by coalesce(p.meta ->> 'name', p.full_name, p.email))
    from public.profiles p where p.role_id = 'pos'), '[]'::jsonb);
end;
$function$;
CREATE OR REPLACE FUNCTION public.cc_atencion_config_ver()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare cfg record;
begin
  perform public._cc7_direccion();
  select * into cfg from public.cc_atencion_config where id = 1;
  return jsonb_build_object('aviso_min', cfg.aviso_min, 'escalamiento_min', cfg.escalamiento_min, 'pausar_fuera_horario', cfg.pausar_fuera_horario, 'updated_at', cfg.updated_at,
                            'horario', public._cc_horario_estado(now()),
                            -- Chat V2-C2 · ciclo de vida de sesiones (NULL = desactivado; tiempo de reloj)
                            'sesiones', jsonb_build_object('ia_min', cfg.sesion_ia_min, 'humana_min', cfg.sesion_humana_min, 'aviso_previo_min', cfg.sesion_aviso_previo_min, 'solicitud_min', cfg.solicitud_expira_min),
                            -- REPARTO (181)
                            'reparto', jsonb_build_object('activo', cfg.reparto_activo, 'min', cfg.reparto_min, 'fija_cartera', cfg.reparto_fija_cartera,
                                                          'vendedores_elegibles', (select count(*) from public.profiles p where p.role_id = 'pos' and public._cc_vendedor_elegible(p.id, true))));
end;
$function$;
CREATE OR REPLACE FUNCTION public.cc_ruteo_resumen()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public._cc7_direccion();
  return jsonb_build_object(
    'horario', public._cc_horario_estado(now()),
    'sin_vendedor', (select count(*) from public.profiles p where p.role_id = 'doctor' and p.active and not exists (select 1 from public.cc_cartera k where k.profile_id = p.id)),
    'reasignacion', (select count(*) from public.cc_cartera k where not public._cc_vendedor_elegible(k.seller_profile_id, false)),
    'handoffs_sin_asignar', (select count(*) from public.cc_conversations c where c.estado = 'abierta' and c.modo = 'human_requested' and c.seller_profile_id is null),
    'handoffs_pendientes', (select count(*) from public.cc_carts k where k.estado = 'active' and k.handoff_estado = 'pendiente'),
    'vendedores_elegibles', (select count(*) from public.profiles p where p.role_id = 'pos' and public._cc_vendedor_elegible(p.id, false)),
    -- REPARTO (181)
    'reparto_activo', (select reparto_activo from public.cc_atencion_config where id = 1),
    'reparto_en_curso', (select count(*) from public.cc_conversations c where c.estado = 'abierta' and c.modo = 'human_assigned' and c.ruteo_motivo = 'reparto'),
    'vendedores_elegibles_nuevos', (select count(*) from public.profiles p where p.role_id = 'pos' and public._cc_vendedor_elegible(p.id, true)));
end;
$function$;
alter policy profiles_select_self_or_admin on public.profiles
  using ((id = auth.uid()) or (auth_role() = 'admin'::text) or ((role_id = 'driver'::text) and (auth_role() = any (array['warehouse'::text, 'packing'::text, 'pos'::text, 'billing'::text, 'comm'::text, 'driver'::text]))));
alter policy profiles_update_self_or_admin on public.profiles using ((id = auth.uid()) or (auth_role() = 'admin'::text));
alter policy profiles_delete_admin on public.profiles using (auth_role() = 'admin'::text);
drop trigger if exists profiles_interna_guard on public.profiles;
drop function if exists public._profiles_interna_guard();
drop function if exists public._es_interna();
alter table public.profiles drop column if exists interna;
