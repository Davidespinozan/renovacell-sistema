-- CX-ENLACE (150) · el down retira el prerregistro y devuelve el ruteo, el nombre y la cola exactamente a su versión
-- anterior; todo lo demás queda igual, y la migración se puede volver a aplicar.
begin;
create temp table _cx as select
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     and p.proname not in ('_cc_rutear', '_cc_nombre_dueno', 'cc_cola_asesorias', '_cc_prerregistro_coincidencia', 'cc_visitante_prerregistrar', 'cc_puerta_chat', 'cc_contacto_de')) resto,
  (select count(*) from public.prospects) n_p, (select count(*) from public.cc_visitors) n_v;
\ir ../../../rollback/cx_enlace/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.cc_prerregistros') is null and not exists (select 1 from pg_proc where proname in ('cc_visitante_prerregistrar', 'cc_puerta_chat', 'cc_contacto_de', '_cc_prerregistro_coincidencia')), '150 down · sin tabla ni comandos del prerregistro');
  perform tests.ok(md5(pg_get_functiondef('public._cc_rutear(uuid)'::regprocedure)) = '4f79575dced5024a14cee0eec3d3d109' and md5(pg_get_functiondef('public._cc_nombre_dueno(uuid)'::regprocedure)) = 'd031a799c72205e532381a3f4a1ec200'
    and md5(pg_get_functiondef('public.cc_cola_asesorias()'::regprocedure)) = '1a761f28d2137357498534b0524e2039', '150 down · ruteo, nombre y cola idénticos a producción');
  perform tests.ok((select resto from _cx) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     and p.proname not in ('_cc_rutear', '_cc_nombre_dueno', 'cc_cola_asesorias')), '150 down · ninguna otra función cambió');
  perform tests.ok((select n_p = (select count(*) from public.prospects) and n_v = (select count(*) from public.cc_visitors) from _cx), '150 down · sin cambios de datos');
  perform tests.ok((select proacl::text from pg_proc where oid = 'public._cc_rutear(uuid)'::regprocedure) = '{postgres=X/postgres,service_role=X/postgres}'
    and has_function_privilege('authenticated', 'public.cc_cola_asesorias()', 'execute') and not has_function_privilege('anon', 'public.cc_cola_asesorias()', 'execute'), '150 down · permisos de las funciones restauradas intactos');
end $t$;
\ir ../../../migrations/20261203120000_cx_enlace_prerregistro.sql
do $t$ begin
  perform tests.ok((select todas from _cx) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '150 · se vuelve a aplicar y queda idéntica');
end $t$;
rollback;
