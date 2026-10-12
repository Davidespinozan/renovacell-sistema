-- SEC-C4-A (145) · down: retira buscar_clientes_pos, sus tres auxiliares y sus tres tablas (cuota, excesos,
-- exclusiones). No toca customers, políticas ni otras funciones; no restaura ni amplía permisos.
-- ⚠️ Se PIERDEN el uso acumulado, los excesos anotados para Dirección y las exclusiones manuales. Si el frontend ya
-- consume la búsqueda (C4-B), revertir deja a Ventas sin buscador: no revertir después de C4-B sin coordinar.
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
  -- Piezas de las que depende: columnas de customers, auth_role() en su versión auditada y la zona horaria del día comercial.
  if (select count(*) from pg_attribute where attrelid = 'public.customers'::regclass and not attisdropped and attname in ('id', 'full_name', 'phone', 'active')) <> 4
     or md5(pg_get_functiondef('public.auth_role()'::regprocedure)) <> '663618f6d4eedf568db532bca55cddc5' then
    raise exception 'SEC-C4-A down: customers o auth_role() no son los auditados';
  end if;
  if ('2026-10-13 06:59:59+00'::timestamptz at time zone 'America/Mazatlan')::date <> date '2026-10-12'
     or ('2026-10-13 07:00:00+00'::timestamptz at time zone 'America/Mazatlan')::date <> date '2026-10-13' then
    raise exception 'SEC-C4-A down: la zona America/Mazatlan no se comporta como UTC-7 en este servidor';
  end if;
  -- Funciones: una firma cada una y existentes.
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('buscar_clientes_pos', '_c4a_nombre_visible', '_c4a_dia_local', '_c4a_exceso')) <> 4
     or to_regprocedure('public.buscar_clientes_pos(text,integer)') is null or to_regprocedure('public._c4a_nombre_visible(text)') is null
     or to_regprocedure('public._c4a_dia_local(timestamptz)') is null or to_regprocedure('public._c4a_exceso(uuid,date,text)') is null
     or to_regclass('public.c4a_cuota') is null or to_regclass('public.c4a_excesos') is null or to_regclass('public.c4a_exclusiones') is null then
    raise exception 'SEC-C4-A down: los objetos de SEC-C4-A no están en el estado SEC-C4-A esperado; no se revierte sobre un estado desconocido';
  end if;
  -- Su versión, dueño, search_path fijo y permisos mínimos (solo la búsqueda es invocable, y solo por authenticated).
  if md5(pg_get_functiondef('public.buscar_clientes_pos(text,integer)'::regprocedure)) <> '34c32c8b4dcb4bd0db32dc31afaa3b09'
     or md5(pg_get_functiondef('public._c4a_nombre_visible(text)'::regprocedure)) <> 'e50ea1b36459165de2981bc31b2cd53e'
     or md5(pg_get_functiondef('public._c4a_dia_local(timestamptz)'::regprocedure)) <> 'b75573ebe4e6c1df20af0a87e8a23aa3'
     or md5(pg_get_functiondef('public._c4a_exceso(uuid,date,text)'::regprocedure)) <> '12956d39d6b4e2b976966a24a2ce20ea'
     or exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in ('buscar_clientes_pos', '_c4a_nombre_visible', '_c4a_dia_local', '_c4a_exceso')
                 and (p.proowner <> 'postgres'::regrole or p.proconfig is distinct from array['search_path=public']
                      or p.prosecdef is distinct from (p.proname = 'buscar_clientes_pos')
                      or has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('service_role', p.oid, 'execute')
                      or has_function_privilege('authenticated', p.oid, 'execute') is distinct from (p.proname = 'buscar_clientes_pos')
                      or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where a.grantee = 0))) then
    raise exception 'SEC-C4-A down: las funciones de SEC-C4-A no están en el estado SEC-C4-A esperado; no se revierte sobre un estado desconocido';
  end if;
  -- Tablas: dueño, RLS activa, authenticated SOLO lee (y solo Dirección por política); anon y service_role nada.
  if exists (select 1 from pg_class c where c.oid in ('public.c4a_cuota'::regclass, 'public.c4a_excesos'::regclass, 'public.c4a_exclusiones'::regclass)
              and (c.relowner <> 'postgres'::regrole or not c.relrowsecurity
                   or not has_table_privilege('authenticated', c.oid, 'select')
                   or has_table_privilege('authenticated', c.oid, 'insert') or has_table_privilege('authenticated', c.oid, 'update')
                   or has_table_privilege('authenticated', c.oid, 'delete') or has_table_privilege('authenticated', c.oid, 'truncate')
                   or has_table_privilege('anon', c.oid, 'select') or has_table_privilege('service_role', c.oid, 'select')))
     or (select string_agg(tablename || '.' || policyname || ':' || cmd || ':' || roles::text || ':' || md5(coalesce(qual, '') || '#' || coalesce(with_check, '')), ',' order by tablename, policyname)
           from pg_policies where schemaname = 'public' and tablename like 'c4a\_%')
        is distinct from 'c4a_cuota.c4a_cuota_select_direccion:SELECT:{authenticated}:5bcc703ac8a5985e6af92e14b0c56ef7,c4a_excesos.c4a_excesos_select_direccion:SELECT:{authenticated}:5bcc703ac8a5985e6af92e14b0c56ef7,c4a_exclusiones.c4a_exclusiones_select_direccion:SELECT:{authenticated}:5bcc703ac8a5985e6af92e14b0c56ef7' then
    raise exception 'SEC-C4-A down: las tablas de SEC-C4-A no están en el estado SEC-C4-A esperado; no se revierte sobre un estado desconocido';
  end if;
  perform set_config('search_path', v_sp, true);
end $pre$;

drop function public.buscar_clientes_pos(text, integer);
drop function public._c4a_exceso(uuid, date, text);
drop function public._c4a_nombre_visible(text);
drop function public._c4a_dia_local(timestamptz);
drop table public.c4a_cuota;
drop table public.c4a_excesos;
drop table public.c4a_exclusiones;

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
  -- Piezas de las que depende: columnas de customers, auth_role() en su versión auditada y la zona horaria del día comercial.
  if (select count(*) from pg_attribute where attrelid = 'public.customers'::regclass and not attisdropped and attname in ('id', 'full_name', 'phone', 'active')) <> 4
     or md5(pg_get_functiondef('public.auth_role()'::regprocedure)) <> '663618f6d4eedf568db532bca55cddc5' then
    raise exception 'SEC-C4-A down post: customers o auth_role() no son los auditados';
  end if;
  if ('2026-10-13 06:59:59+00'::timestamptz at time zone 'America/Mazatlan')::date <> date '2026-10-12'
     or ('2026-10-13 07:00:00+00'::timestamptz at time zone 'America/Mazatlan')::date <> date '2026-10-13' then
    raise exception 'SEC-C4-A down post: la zona America/Mazatlan no se comporta como UTC-7 en este servidor';
  end if;
  -- Ningún objeto de C4-A debe existir (con ninguna firma).
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('buscar_clientes_pos', '_c4a_nombre_visible', '_c4a_dia_local', '_c4a_exceso'))
     or to_regclass('public.c4a_cuota') is not null or to_regclass('public.c4a_excesos') is not null or to_regclass('public.c4a_exclusiones') is not null then
    raise exception 'SEC-C4-A down post: los objetos de SEC-C4-A siguen existiendo';
  end if;
  perform set_config('search_path', v_sp, true);
end $post$;
