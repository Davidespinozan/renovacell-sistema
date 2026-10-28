-- CUENTAS INTERNAS · el down devuelve funciones, políticas y la tabla profiles a como estaban; se reaplica idéntica.
begin;
\ir ../../../rollback/comisiones_jefe/99_down.sql   -- COMISIONES-JEFE depende de _es_interna: se baja antes de tomar la foto
create temp table _ci as select
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     and p.proname not in ('_cc_reparto_elegir', 'cc_vendedores', 'cc_atencion_config_ver', 'cc_ruteo_resumen', '_es_interna', '_profiles_interna_guard')) resto,
  (select string_agg(policyname || ':' || coalesce(qual, ''), ' | ' order by policyname) from pg_policies where tablename = 'profiles') politicas;
\ir ../../../rollback/cuentas_internas/99_down.sql
do $t$ begin
  perform tests.ok(not exists (select 1 from information_schema.columns where table_name = 'profiles' and column_name = 'interna')
               and to_regprocedure('public._es_interna()') is null and to_regprocedure('public._profiles_interna_guard()') is null
               and not exists (select 1 from pg_policies where tablename = 'profiles' and qual like '%interna%'), 'INTERNAS down · sin columna, sin funciones nuevas, políticas sin la marca');
  perform tests.ok((select resto from _ci) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     and p.proname not in ('_cc_reparto_elegir', 'cc_vendedores', 'cc_atencion_config_ver', 'cc_ruteo_resumen', '_es_interna', '_profiles_interna_guard')), 'INTERNAS down · ninguna otra función cambió');
end $t$;
\ir ../../../migrations/20270129120000_cuentas_internas.sql
do $t$ begin
  perform tests.ok((select todas from _ci) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f')
               and (select politicas from _ci) = (select string_agg(policyname || ':' || coalesce(qual, ''), ' | ' order by policyname) from pg_policies where tablename = 'profiles'), 'INTERNAS · se reaplica idéntica (funciones y políticas)');
end $t$;
rollback;
