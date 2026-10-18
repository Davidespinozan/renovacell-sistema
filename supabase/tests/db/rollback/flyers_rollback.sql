-- FLYERS (180) · el down retira los flyers y _promo_texto vuelve a la 177; se reaplica igual.
begin;
create temp table _fl as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/flyers/99_down.sql
do $t$ begin perform tests.ok(to_regclass('public.flyers') is null and to_regprocedure('public.flyers_vigentes()') is null and md5(pg_get_functiondef('public._promo_texto(uuid)'::regprocedure)) = '37095dd78da20caefeece12995cd4973', '180 down · sin flyers; _promo_texto como en la 177'); end $t$;
\ir ../../../migrations/20270102120000_flyers.sql
do $t$ begin
  perform tests.ok((select todas from _fl) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '180 · se reaplica idéntica');
end $t$;
rollback;
