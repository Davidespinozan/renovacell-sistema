-- TERMINAR-SOLICITUD (20270205) · el down devuelve cc_terminar_asesoria a su definición exacta anterior; la migración
-- se reaplica idéntica.
begin;
create temp table _ts as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/terminar_solicitud/99_down.sql
do $t$ begin
  perform tests.ok(md5(pg_get_functiondef('public.cc_terminar_asesoria(uuid,uuid)'::regprocedure)) = '64d8cc8b8edc2457ec622d79734825db', 'TERMINAR-SOLICITUD down · función exacta de antes');
end $t$;
\ir ../../../migrations/20270205120000_terminar_solicitud.sql
do $t$ begin
  perform tests.ok((select todas from _ts) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'TERMINAR-SOLICITUD · se reaplica idéntica');
end $t$;
rollback;
