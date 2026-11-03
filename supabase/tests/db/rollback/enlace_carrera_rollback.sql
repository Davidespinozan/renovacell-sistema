-- ENLACE-CARRERA (20270315) · el down quita la serialización; se reaplica idéntica.
begin;
create temp table _ec as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/enlace_carrera/99_down.sql
do $t$ begin
  perform tests.ok(pg_get_functiondef('public._cc_enlace_de_vendedor(uuid)'::regprocedure) not like '%advisory%' and pg_get_functiondef('public._cc_enlace_de_cliente(uuid)'::regprocedure) not like '%advisory%', 'ENLACE-CARRERA down · como antes');
end $t$;
\ir ../../../migrations/20270315120000_enlace_carrera.sql
do $t$ begin
  perform tests.ok((select todas from _ec) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'ENLACE-CARRERA · se reaplica idéntica');
end $t$;
rollback;
