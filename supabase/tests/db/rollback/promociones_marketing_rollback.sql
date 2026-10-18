-- PROMO-6 (177) · el down devuelve _promo_texto/difundir/previa a la 175 y retira promo_tarjeta; se reaplica igual.
begin;
create temp table _pm as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/flyers/99_down.sql   -- FLYERS (180) se baja primero
\ir ../../../rollback/promocion_avisos/99_down.sql   -- PROMO-AVISOS (179) se baja primero
\ir ../../../rollback/promocion_prueba_correo/99_down.sql   -- PROMO-PRUEBA (178) se baja primero
\ir ../../../rollback/promociones_marketing/99_down.sql
do $t$ begin perform tests.ok(to_regprocedure('public.promo_tarjeta(uuid)') is null and md5(pg_get_functiondef('public._promo_texto(uuid)'::regprocedure)) = 'f6314e093c23a1131c65a5f9b8789cb1', '177 down · como en la 175'); end $t$;
\ir ../../../migrations/20261230120000_promociones_marketing.sql
\ir ../../../migrations/20261231120000_promocion_prueba_correo.sql
\ir ../../../migrations/20270101120000_promocion_avisos.sql
\ir ../../../migrations/20270102120000_flyers.sql
do $t$ begin
  perform tests.ok((select todas from _pm) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '177 · se reaplica idéntica');
end $t$;
rollback;
