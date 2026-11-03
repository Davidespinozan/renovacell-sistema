-- EVENTOS CON EQUIPO (20270313) · el down regresa permisos y políticas de producción; se reaplica idéntica.
begin;
create temp table _ee as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/eventos_equipo/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.custody_members') is null and pg_get_functiondef('public.cerrar_custodia(uuid,uuid,text)'::regprocedure) like '%solo Dirección cierra%', 'EVENTOS down · como antes');
end $t$;
\ir ../../../migrations/20270313120000_eventos_equipo.sql
do $t$ begin
  perform tests.ok((select todas from _ee) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'EVENTOS · se reaplica idéntica');
end $t$;
rollback;
