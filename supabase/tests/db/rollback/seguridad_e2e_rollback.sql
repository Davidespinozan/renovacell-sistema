-- SEGURIDAD-E2E (20270318) · el down regresa las 6 piezas; se reaplica idéntica.
begin;
create temp table _se as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/seguridad_e2e/99_down.sql
do $t$ begin
  perform tests.ok(to_regprocedure('public._lp_autorizado(uuid)') is null and pg_get_functiondef('public.orders_guard()'::regprocedure) not like '%SEG-E2E%' and pg_get_functiondef('public.solicitar_cfdi'::regproc) not like '%FISCAL-1%', 'SEGURIDAD-E2E down · como antes');
end $t$;
\ir ../../../migrations/20270318120000_seguridad_e2e.sql
do $t$ begin
  perform tests.ok((select todas from _se) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'SEGURIDAD-E2E · se reaplica idéntica');
end $t$;
rollback;
