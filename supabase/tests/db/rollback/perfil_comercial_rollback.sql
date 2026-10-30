-- HERRAMIENTAS DEL VENDEDOR · bloque B (20270215) · el down retira clasificación y catálogo; se reaplica idéntica.
begin;
create temp table _pcm as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/perfil_comercial/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.especialidades') is null and not exists (select 1 from information_schema.columns where table_name = 'customers' and column_name in ('tipo_cliente', 'especialidad')), 'BLOQUE-B down · sin catálogo ni columnas');
end $t$;
\ir ../../../migrations/20270215120000_perfil_comercial.sql
do $t$ begin
  perform tests.ok((select todas from _pcm) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'BLOQUE-B · se reaplica idéntica');
end $t$;
rollback;
