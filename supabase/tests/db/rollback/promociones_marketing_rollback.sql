-- PROMO-6 (177) · el down devuelve _promo_texto/difundir/previa a la 175 y retira promo_tarjeta; se reaplica igual.
begin;
create temp table _pm as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/promociones_marketing/99_down.sql
do $t$ begin perform tests.ok(to_regprocedure('public.promo_tarjeta(uuid)') is null and md5(pg_get_functiondef('public._promo_texto(uuid)'::regprocedure)) = 'f6314e093c23a1131c65a5f9b8789cb1', '177 down · como en la 175'); end $t$;
\ir ../../../migrations/20261230120000_promociones_marketing.sql
do $t$ begin
  perform tests.ok((select todas from _pm) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '177 · se reaplica idéntica');
end $t$;
rollback;
