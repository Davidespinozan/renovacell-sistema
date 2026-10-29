-- ALTA-DESDE-CONVERSACIÓN (20270208) · el down retira los dos comandos; la migración se reaplica idéntica.
begin;
create temp table _al as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/alta_desde_conversacion/99_down.sql
do $t$ begin
  perform tests.ok(to_regprocedure('public.cc_alta_cliente_conversacion(uuid,text,text,text,text,uuid,uuid)') is null and to_regprocedure('public.cc_adjunto_registrar_wa(uuid,text,text,integer)') is null, 'ALTA down · sin los comandos');
end $t$;
\ir ../../../migrations/20270208120000_alta_desde_conversacion.sql
do $t$ begin
  perform tests.ok((select todas from _al) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'ALTA · se reaplica idéntica');
end $t$;
rollback;
