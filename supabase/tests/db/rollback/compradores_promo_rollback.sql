-- COMPRADORES-PROMO (20270322) · el down regresa los comandos del bloque A; se reaplica idéntica.
begin;
create temp table _cp as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/compradores_promo/99_down.sql
do $t$ begin
  perform tests.ok(to_regprocedure('public.cc_oportunidades_promo()') is null and pg_get_functiondef('public.cc_compradores_producto(uuid)'::regprocedure) not like '%_cc_promo_familia%', 'COMPRADORES-PROMO down · como antes');
end $t$;
\ir ../../../migrations/20270322120000_compradores_promo.sql
do $t$ begin
  perform tests.ok((select todas from _cp) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'COMPRADORES-PROMO · se reaplica idéntica');
end $t$;
rollback;
