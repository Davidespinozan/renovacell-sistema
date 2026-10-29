-- PAGOS EN LÍNEA · el down retira el interruptor sin tocar nada más; se reaplica idéntica.
begin;
create temp table _pl as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') n_tablas;
\ir ../../../rollback/pagos_en_linea/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.pagos_config') is null and to_regprocedure('public.pagos_config_ver()') is null and (select n_tablas - 2 from _pl) = (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'), 'PAGOS down · sin tablas ni funciones');
end $t$;
\ir ../../../migrations/20270202120000_pagos_en_linea.sql
do $t$ begin
  perform tests.ok((select todas from _pl) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'PAGOS · se reaplica idéntica');
end $t$;
rollback;
