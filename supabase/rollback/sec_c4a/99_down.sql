-- SEC-C4-A (145) · down: retira buscar_clientes_pos y su auxiliar, y los contadores de su limitador. No toca tablas,
-- políticas ni otras funciones; no restaura ni amplía permisos. Si el frontend ya la consume (C4-B), revertir deja a
-- Ventas sin buscador: no revertir después de C4-B sin coordinar el frontend.
do $pre$
declare v_sp text := current_setting('search_path'); v text;
begin
  -- Las huellas de políticas dependen del search_path con que se imprimen: se fija y al final se restaura.
  perform set_config('search_path', 'public', true);
  -- C4-A es ADITIVA: las políticas de customers y doctor_locations quedan exactamente como estaban (se restringen en C4-C).
  select string_agg(tablename || '.' || policyname || '=' || md5(coalesce(qual, '') || '#' || coalesce(with_check, '')), ',' order by tablename, policyname) into v
    from pg_policies where schemaname = 'public' and tablename in ('customers', 'doctor_locations');
  if v is distinct from 'customers.customers_delete=5bcc703ac8a5985e6af92e14b0c56ef7,customers.customers_insert=4f3cf7b295865299df4e698aa42b8255,customers.customers_select=eefaa198c841ec6d509f58c4d56ab570,customers.customers_update=9898385053c09f880f2a67238cd6338b,doctor_locations.doctor_locations_delete=5bcc703ac8a5985e6af92e14b0c56ef7,doctor_locations.doctor_locations_insert=36a706829d40afd0cc675f26f7885778,doctor_locations.doctor_locations_select=125823a0fdd8f485191ab57da954bff7,doctor_locations.doctor_locations_update=88f7e9a1f4717b6e188c67d30e5f1c54' then
    raise exception 'SEC-C4-A down: las políticas de customers / doctor_locations no son las auditadas (%)', v;
  end if;
  -- Piezas de las que depende: columnas de customers, auth_role() y el limitador existente, en su versión auditada.
  if (select count(*) from pg_attribute where attrelid = 'public.customers'::regclass and not attisdropped and attname in ('id', 'full_name', 'phone', 'active')) <> 4
     or md5(pg_get_functiondef('public.auth_role()'::regprocedure)) <> '663618f6d4eedf568db532bca55cddc5'
     or to_regprocedure('public.rate_limit_hit(text,text,integer,integer,integer)') is null
     or md5(pg_get_functiondef('public.rate_limit_hit(text,text,integer,integer,integer)'::regprocedure)) <> 'ee5590f8c5a2e843c0e2ab6b52605274'
     or to_regclass('public.rate_limit_buckets') is null then
    raise exception 'SEC-C4-A down: customers, auth_role() o rate_limit_hit() no son los auditados';
  end if;
  -- Las dos funciones nuevas: una firma cada una, su versión, dueño, search_path fijo y permisos mínimos.
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('buscar_clientes_pos', '_c4a_nombre_visible')) <> 2
     or to_regprocedure('public.buscar_clientes_pos(text,integer)') is null or to_regprocedure('public._c4a_nombre_visible(text)') is null then
    raise exception 'SEC-C4-A down: buscar_clientes_pos / _c4a_nombre_visible no están en el estado SEC-C4-A esperado; no se revierte sobre un estado desconocido';
  end if;
  if md5(pg_get_functiondef('public.buscar_clientes_pos(text,integer)'::regprocedure)) <> '5f428aaf8e8c03147c0d07203ed4a9b4'
     or md5(pg_get_functiondef('public._c4a_nombre_visible(text)'::regprocedure)) <> '2996a5666d351dd2c19a4a505d847c3c'
     or exists (select 1 from pg_proc p where p.oid in ('public.buscar_clientes_pos(text,integer)'::regprocedure, 'public._c4a_nombre_visible(text)'::regprocedure)
                 and (p.proowner <> 'postgres'::regrole or p.proconfig is distinct from array['search_path=public']))
     or not (select prosecdef and provolatile = 'v' from pg_proc where oid = 'public.buscar_clientes_pos(text,integer)'::regprocedure)
     or (select prosecdef or provolatile <> 'i' from pg_proc where oid = 'public._c4a_nombre_visible(text)'::regprocedure)
     or has_function_privilege('anon', 'public.buscar_clientes_pos(text,integer)', 'execute')
     or has_function_privilege('service_role', 'public.buscar_clientes_pos(text,integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.buscar_clientes_pos(text,integer)', 'execute')
     or has_function_privilege('anon', 'public._c4a_nombre_visible(text)', 'execute')
     or has_function_privilege('authenticated', 'public._c4a_nombre_visible(text)', 'execute')
     or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                 where p.oid in ('public.buscar_clientes_pos(text,integer)'::regprocedure, 'public._c4a_nombre_visible(text)'::regprocedure) and a.grantee = 0) then
    raise exception 'SEC-C4-A down: buscar_clientes_pos / _c4a_nombre_visible no están en el estado SEC-C4-A esperado; no se revierte sobre un estado desconocido';
  end if;
  perform set_config('search_path', v_sp, true);
end $pre$;

drop function public.buscar_clientes_pos(text, integer);
drop function public._c4a_nombre_visible(text);
-- Los contadores del limitador son solo de esta función: se retiran con ella.
delete from public.rate_limit_buckets where scope in ('c4a_buscar_clientes_min', 'c4a_buscar_clientes_dia');

do $post$
declare v_sp text := current_setting('search_path'); v text;
begin
  -- Las huellas de políticas dependen del search_path con que se imprimen: se fija y al final se restaura.
  perform set_config('search_path', 'public', true);
  -- C4-A es ADITIVA: las políticas de customers y doctor_locations quedan exactamente como estaban (se restringen en C4-C).
  select string_agg(tablename || '.' || policyname || '=' || md5(coalesce(qual, '') || '#' || coalesce(with_check, '')), ',' order by tablename, policyname) into v
    from pg_policies where schemaname = 'public' and tablename in ('customers', 'doctor_locations');
  if v is distinct from 'customers.customers_delete=5bcc703ac8a5985e6af92e14b0c56ef7,customers.customers_insert=4f3cf7b295865299df4e698aa42b8255,customers.customers_select=eefaa198c841ec6d509f58c4d56ab570,customers.customers_update=9898385053c09f880f2a67238cd6338b,doctor_locations.doctor_locations_delete=5bcc703ac8a5985e6af92e14b0c56ef7,doctor_locations.doctor_locations_insert=36a706829d40afd0cc675f26f7885778,doctor_locations.doctor_locations_select=125823a0fdd8f485191ab57da954bff7,doctor_locations.doctor_locations_update=88f7e9a1f4717b6e188c67d30e5f1c54' then
    raise exception 'SEC-C4-A down post: las políticas de customers / doctor_locations no son las auditadas (%)', v;
  end if;
  -- Piezas de las que depende: columnas de customers, auth_role() y el limitador existente, en su versión auditada.
  if (select count(*) from pg_attribute where attrelid = 'public.customers'::regclass and not attisdropped and attname in ('id', 'full_name', 'phone', 'active')) <> 4
     or md5(pg_get_functiondef('public.auth_role()'::regprocedure)) <> '663618f6d4eedf568db532bca55cddc5'
     or to_regprocedure('public.rate_limit_hit(text,text,integer,integer,integer)') is null
     or md5(pg_get_functiondef('public.rate_limit_hit(text,text,integer,integer,integer)'::regprocedure)) <> 'ee5590f8c5a2e843c0e2ab6b52605274'
     or to_regclass('public.rate_limit_buckets') is null then
    raise exception 'SEC-C4-A down post: customers, auth_role() o rate_limit_hit() no son los auditados';
  end if;
  -- Las dos funciones nuevas no deben existir (con ninguna firma).
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('buscar_clientes_pos', '_c4a_nombre_visible')) then
    raise exception 'SEC-C4-A down post: buscar_clientes_pos / _c4a_nombre_visible siguen existiendo';
  end if;
  perform set_config('search_path', v_sp, true);
end $post$;
