-- HERRAMIENTAS DEL VENDEDOR · bloque D (20270217) · el down retira listas, difusiones y baja; se reaplica idéntica.
begin;
create temp table _df as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/difusiones/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.cc_difusiones') is null and to_regprocedure('public.correo_baja(uuid)') is null
               and not exists (select 1 from information_schema.columns where table_name = 'customers' and column_name = 'correo_baja_token'), 'BLOQUE-D down · sin listas, difusiones ni baja');
end $t$;
\ir ../../../migrations/20270217120000_difusiones.sql
do $t$ begin
  perform tests.ok((select todas from _df) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'BLOQUE-D · se reaplica idéntica');
end $t$;
rollback;
