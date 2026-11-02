-- TIMBRADO REAL (20270310) · el down quita el envío fiscal y cfdi_preparar sin tocar lo demás; se reaplica idéntica.
begin;
create temp table _ct as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/cfdi_timbrado/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.fiscal_concepto_envio') is null and to_regprocedure('public.cfdi_preparar(uuid)') is null, 'TIMBRADO down · como antes');
end $t$;
\ir ../../../migrations/20270310120000_cfdi_timbrado.sql
do $t$ begin
  perform tests.ok((select todas from _ct) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'TIMBRADO · se reaplica idéntica');
end $t$;
rollback;
