-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- CUENTAS INTERNAS (OCULTAS) · pedido del dueño (28 oct 2026): "no quiero que Renovacell tenga acceso a ver que existen
--   las cuentas genéricas; esas son únicamente para mí para editar y ver cómo van mis ediciones".
--   · profiles.interna            marca de cuenta interna (solo se cambia por SQL de servidor; un trigger lo impide desde la app).
--   · _es_interna()               ¿la sesión es una cuenta interna? (las internas se ven entre sí y ven todo, como antes).
--   · RLS de profiles             una cuenta interna NO existe para nadie más: no se lista, no se lee, no se edita ni se borra.
--   · _cc_reparto_elegir          el reparto al azar NUNCA manda un cliente real a una cuenta interna.
--   · cc_vendedores               la lista de vendedores de Dirección no las muestra.
--   · cc_atencion_config_ver / cc_ruteo_resumen   los conteos de vendedores no las cuentan.
--   Lo que NO cambia: lo que una cuenta interna puede hacer (permisos por rol), la cartera que ya tenga asignada (sus
--   doctores de prueba siguen yendo a ella), _cc_vendedor_elegible, _cc_puede_atender y el resto de funciones.
--   Las 4 cuentas: direccion@, ventas1@, almacen@, chofer@renovacell.mx.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'interna') then raise exception 'INTERNAS: ya aplicada'; end if;
  if md5(pg_get_functiondef('public._cc_reparto_elegir(uuid)'::regprocedure)) <> '7c0e20c6456641fa86cf02ec62aabdeb'
     or md5(pg_get_functiondef('public.cc_vendedores()'::regprocedure)) <> '19707b8e217d3f33e737ccefa2d45c8e'
     or md5(pg_get_functiondef('public.cc_atencion_config_ver()'::regprocedure)) <> '615b630eef0cbc14fbf3e20fa8186641'
     or md5(pg_get_functiondef('public.cc_ruteo_resumen()'::regprocedure)) <> '948189f80ac69f94afa1a2c33b0acded' then
    raise exception 'INTERNAS: alguna función cambió desde que se escribió esta migración';
  end if;
  if (select count(*) from pg_policies where schemaname = 'public' and tablename = 'profiles' and policyname in ('profiles_select_self_or_admin', 'profiles_update_self_or_admin', 'profiles_delete_admin')) <> 3 then
    raise exception 'INTERNAS: las políticas de profiles no son las esperadas';
  end if;
end $pre$;

-- 1) La marca, y solo el servidor la cambia.
alter table public.profiles add column interna boolean not null default false;
comment on column public.profiles.interna is 'Cuenta interna del desarrollador/dueño: invisible para el resto (RLS) y fuera del reparto y los conteos. Solo se cambia por SQL de servidor.';

create function public._profiles_interna_guard() returns trigger
  language plpgsql set search_path = public as
$$
begin
  if new.interna is distinct from (case when tg_op = 'INSERT' then false else old.interna end)
     and coalesce(current_setting('role', true), '') in ('authenticated', 'anon') then
    raise exception 'INTERNA_SOLO_SERVIDOR' using errcode = 'insufficient_privilege';
  end if;
  return new;
end;
$$;
create trigger profiles_interna_guard before insert or update of interna on public.profiles for each row execute function public._profiles_interna_guard();

create function public._es_interna() returns boolean
  language sql stable security definer set search_path = public as
$$ select coalesce((select p.interna from public.profiles p where p.id = auth.uid()), false) $$;

-- 2) RLS: una cuenta interna no existe para los demás (sí para sí misma y para las otras internas).
alter policy profiles_select_self_or_admin on public.profiles
  using ((id = auth.uid()) or ((not interna or public._es_interna()) and ((auth_role() = 'admin'::text) or ((role_id = 'driver'::text) and (auth_role() = any (array['warehouse'::text, 'packing'::text, 'pos'::text, 'billing'::text, 'comm'::text, 'driver'::text]))))));
alter policy profiles_update_self_or_admin on public.profiles
  using ((id = auth.uid()) or ((not interna or public._es_interna()) and (auth_role() = 'admin'::text)));
alter policy profiles_delete_admin on public.profiles
  using ((not interna or public._es_interna()) and (auth_role() = 'admin'::text));

-- 3) Reparto, lista de vendedores y conteos.
CREATE OR REPLACE FUNCTION public._cc_reparto_elegir(p_conv uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select p.id from public.profiles p
   where p.role_id = 'pos' and not p.interna and public._cc_vendedor_elegible(p.id, true)
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
    from public.profiles p where p.role_id = 'pos' and (not p.interna or public._es_interna())), '[]'::jsonb);
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
                                                          'vendedores_elegibles', (select count(*) from public.profiles p where p.role_id = 'pos' and not p.interna and public._cc_vendedor_elegible(p.id, true))));
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
    'reasignacion', (select count(*) from public.cc_cartera k where not public._cc_vendedor_elegible(k.seller_profile_id, false) and not exists (select 1 from public.profiles s where s.id = k.seller_profile_id and s.interna)),
    'handoffs_sin_asignar', (select count(*) from public.cc_conversations c where c.estado = 'abierta' and c.modo = 'human_requested' and c.seller_profile_id is null),
    'handoffs_pendientes', (select count(*) from public.cc_carts k where k.estado = 'active' and k.handoff_estado = 'pendiente'),
    'vendedores_elegibles', (select count(*) from public.profiles p where p.role_id = 'pos' and not p.interna and public._cc_vendedor_elegible(p.id, false)),
    -- REPARTO (181)
    'reparto_activo', (select reparto_activo from public.cc_atencion_config where id = 1),
    'reparto_en_curso', (select count(*) from public.cc_conversations c where c.estado = 'abierta' and c.modo = 'human_assigned' and c.ruteo_motivo = 'reparto'),
    'vendedores_elegibles_nuevos', (select count(*) from public.profiles p where p.role_id = 'pos' and not p.interna and public._cc_vendedor_elegible(p.id, true)));
end;
$function$;

-- 4) Las cuatro cuentas genéricas.
update public.profiles set interna = true where id in ('368ec33f-1eac-4cba-9326-408e6eec677b','759a4823-4736-49de-aeb6-84e04b1527df','c7d28ff2-9e5f-46ba-ab2d-1b46e51fdccc','cdd6b7f8-5f9f-492c-8d72-07a49076d231');

alter function public._profiles_interna_guard() owner to postgres;
alter function public._es_interna() owner to postgres;
revoke all on function public._profiles_interna_guard() from public, anon, authenticated, service_role;
revoke all on function public._es_interna() from public, anon;
grant execute on function public._es_interna() to authenticated, service_role;

do $post$ begin
  -- en producción existen las 4; en una base de pruebas vacía no hay ninguna
  if (select count(*) from public.profiles where interna) <> (select count(*) from public.profiles where id in ('368ec33f-1eac-4cba-9326-408e6eec677b','759a4823-4736-49de-aeb6-84e04b1527df','c7d28ff2-9e5f-46ba-ab2d-1b46e51fdccc','cdd6b7f8-5f9f-492c-8d72-07a49076d231')) then
    raise exception 'INTERNAS: no quedaron marcadas las cuentas esperadas';
  end if;
  if has_function_privilege('authenticated', 'public._profiles_interna_guard()', 'execute') then raise exception 'INTERNAS: permisos inesperados'; end if;
end $post$;
