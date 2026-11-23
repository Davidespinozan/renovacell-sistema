-- DUEÑO COMO VENDEDOR LITERAL (23 nov 2026, dueño: «se supone que si le picaba ahí [Ver como › Ventas] era como entrar
-- como vendedor literal»). Toño (Dirección + permiso «dueno») al tocar «Ventas» ES un vendedor:
--   1. IDENTIDAD · cuenta como vendedor en todo lo que define «quién es vendedor» (lista de vendedores, asignar clientes,
--      reparto y turno —si tiene «Atender conversaciones» y «Recibir clientes nuevos»—, comisiones, ranking, enlaces,
--      atribución del pedido, referidos). Antes todo eso exigía role_id = 'pos'.
--   2. ACTUAR · mientras está en «Ventas», la app manda la cabecera x-actuar-como: pos (solo a /rest/v1) y auth_role()
--      devuelve 'pos': el servidor lo trata EXACTAMENTE como a un vendedor (su cartera, lo que da de alta queda suyo, sus
--      cobros, su enlace) y también le aplica sus límites. Solo sirve para BAJAR de Dirección a Ventas, nunca para subir:
--      exige ser Dirección y tener «dueno». Fuera de ese modo, sigue siendo Dirección.

create or replace function public._es_vendedor_rol(p_role text, p_meta jsonb)
returns boolean language sql immutable as $f$
  select p_role = 'pos' or (p_role = 'admin' and coalesce(p_meta -> 'capabilities', '[]'::jsonb) ? 'dueno')
$f$;
grant execute on function public._es_vendedor_rol(text, jsonb) to authenticated, service_role;

create or replace function public.auth_role()
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(
    (select case when not p.active then public._cuenta_suspendida()
                 -- DUEÑO · «Ver como › Ventas»: el dueño actúa como vendedor (solo hacia abajo; ver 0782)
                 when p.role_id = 'admin' and coalesce(p.meta -> 'capabilities', '[]'::jsonb) ? 'dueno'
                      and (nullif(current_setting('request.headers', true), '')::json ->> 'x-actuar-como') = 'pos' then 'pos'
                 else p.role_id end
       from public.profiles p where p.id = auth.uid()),
    '');
$function$;

-- Identidad de vendedor: cada «<alias>.role_id = 'pos'» (o sin alias) sobre profiles pasa a _es_vendedor_rol.
do $m$
declare f text; v text; nuevo text;
begin
  foreach f in array array['_cc_cartera_al_atender', '_cc_vendedor_elegible', '_cc_vendedor_turno', '_cx0c_atribucion',
    'admin_approve_doctor', 'cc_atencion_config_ver', 'cc_cartera_ranking', 'cc_codigo_referido_crear', 'cc_enlaces_equipo',
    'cc_equivalencia_historica_guardar', 'cc_ruteo_resumen', 'cc_vendedores', 'cc_vendedores_traspaso', 'cc_visitante_abrir',
    'comisiones_equipo', 'crm_editar'] loop
    select pg_get_functiondef(p.oid) into v from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f;
    if v is null then raise exception 'DUENO-VENDEDOR: falta %', f; end if;
    nuevo := regexp_replace(v, '([a-z]+)\.role_id\s*=\s*''pos''', 'public._es_vendedor_rol(\1.role_id, \1.meta)', 'g');
    nuevo := regexp_replace(nuevo, '([^.a-z_])role_id\s*=\s*''pos''', '\1public._es_vendedor_rol(role_id, meta)', 'g');
    if nuevo = v then raise exception 'DUENO-VENDEDOR: % no cambió', f; end if;
    execute nuevo;
  end loop;
end $m$;
