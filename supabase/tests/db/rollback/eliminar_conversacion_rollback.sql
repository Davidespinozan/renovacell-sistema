-- ELIMINAR CONVERSACIÓN (20270311) · el down quita la función y su archivo (solo si no hubo eliminaciones); se reaplica idéntica.
begin;
create temp table _ec as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/eliminar_conversacion/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.cc_eliminaciones') is null and to_regprocedure('public.cc_conversacion_eliminar(uuid,text,boolean)') is null, 'ELIMINAR down · como antes');
end $t$;
\ir ../../../migrations/20270311120000_eliminar_conversacion.sql
do $t$ begin
  perform tests.ok((select todas from _ec) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'ELIMINAR · se reaplica idéntica');
end $t$;
rollback;
