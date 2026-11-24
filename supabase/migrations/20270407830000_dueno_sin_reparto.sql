-- DUEÑO: VENDEDOR QUE VE TODO, SIN REPARTO (23 nov 2026). Corrige 0782 con dos decisiones del dueño:
--   · «él debe tener acceso a todas las carteras desde su vendedor» → auth_role() vuelve a su versión anterior: en
--     «Ventas» Toño sigue viendo y pudiendo todo como Dirección.
--   · Lo que SÍ hace «Ventas»: _actua_como_vendedor() (Dirección + «dueno» + cabecera x-actuar-como: pos) hace que lo
--     que él da de alta, verifica, liga desde el chat o cotiza quede en SU cartera (y por la cartera, sus ventas a su
--     nombre: _cx0c_atribucion), y tiene su propio enlace de vendedor.
--   · «no quiero recibir clientes nuevos del reparto para el vendedor Toño» → el turno (por donde pasan todos los
--     repartos automáticos) y sus conteos vuelven a tomar solo vendedoras reales.
create or replace function public.auth_role()
 returns text
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(
    (select case when p.active then p.role_id else public._cuenta_suspendida() end
       from public.profiles p where p.id = auth.uid()),
    '');
$function$;

create or replace function public._actua_como_vendedor()
returns boolean language sql stable security definer set search_path to 'public' as $f$
  select coalesce((select p.active and p.role_id = 'admin' and coalesce(p.meta -> 'capabilities', '[]'::jsonb) ? 'dueno'
                     from public.profiles p where p.id = auth.uid()), false)
     and coalesce(nullif(current_setting('request.headers', true), '')::json ->> 'x-actuar-como', '') = 'pos'
$f$;
revoke all on function public._actua_como_vendedor() from public, anon;
grant execute on function public._actua_como_vendedor() to authenticated;

do $a$
declare r record; v text; nuevo text;
begin
  for r in select * from (values
    ('cliente_prospecto_crear', $q$if v_dueno is null and v_rol = 'pos' then$q$, $q$if v_dueno is null and (v_rol = 'pos' or public._actua_como_vendedor()) then$q$),
    ('cliente_prospecto_crear', $q$    if v_rol = 'pos' then$q$, $q$    if v_rol = 'pos' or public._actua_como_vendedor() then$q$),
    ('cc_alta_cliente_conversacion', $q$s := case when v_rol = 'pos' then auth.uid()$q$, $q$s := case when v_rol = 'pos' or public._actua_como_vendedor() then auth.uid()$q$),
    ('cc_vincular_cliente', $q$if s is null and v_rol = 'pos' and public._cc_vendedor_elegible(auth.uid(), false) then$q$, $q$if s is null and (v_rol = 'pos' or public._actua_como_vendedor()) and public._cc_vendedor_elegible(auth.uid(), false) then$q$),
    ('doctor_verificar', $q$if v_rol = 'pos' and not exists (select 1 from public.cc_cartera where profile_id = p_profile) then$q$, $q$if (v_rol = 'pos' or public._actua_como_vendedor()) and not exists (select 1 from public.cc_cartera where profile_id = p_profile) then$q$),
    ('cc_cotizacion_crear', $q$case when public.auth_role() = 'pos' then auth.uid() end$q$, $q$case when public.auth_role() = 'pos' or public._actua_como_vendedor() then auth.uid() end$q$),
    ('cc_mi_enlace', $q$if v_role = 'pos' then$q$, $q$if v_role = 'pos' or public._actua_como_vendedor() then$q$)
  ) as t(f, viejo, nuevo) loop
    select pg_get_functiondef(p.oid) into v from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = r.f;
    if v is null or position(r.viejo in v) = 0 then raise exception 'DUENO: % no es la esperada (%)', r.f, left(r.viejo, 40); end if;
    if (length(v) - length(replace(v, r.viejo, ''))) / length(r.viejo) <> 1 then raise exception 'DUENO: % ambigua (%)', r.f, left(r.viejo, 40); end if;
    execute replace(v, r.viejo, r.nuevo);
  end loop;
end $a$;

do $m$
declare f text; v text; nuevo text;
begin
  foreach f in array array['_cc_vendedor_turno', 'cc_atencion_config_ver', 'cc_ruteo_resumen'] loop
    select pg_get_functiondef(p.oid) into v from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = f;
    nuevo := replace(v, 'public._es_vendedor_rol(p.role_id, p.meta)', 'p.role_id = ''pos''');
    if v is null or nuevo = v then raise exception 'DUENO-SIN-REPARTO: % no es la esperada', f; end if;
    execute nuevo;
  end loop;
end $m$;
