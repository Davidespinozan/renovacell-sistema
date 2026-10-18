-- PROMOCIONES PRO (174) · el down devuelve cc_ia_precio, promos_vigentes y _promo_json a su versión anterior; se reaplica igual.
begin;
create temp table _pp as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/promocion_prueba_correo/99_down.sql   -- PROMO-PRUEBA (178) se baja primero
\ir ../../../rollback/promociones_marketing/99_down.sql   -- PROMO-MARKETING (177) se baja primero
\ir ../../../rollback/promocion_eliminar/99_down.sql   -- PROMO-ELIMINAR (176) se baja primero
\ir ../../../rollback/promociones_difusion/99_down.sql   -- PROMO-DIFUSION (175) se baja primero
\ir ../../../rollback/promociones_pro/99_down.sql
do $t$ begin
  perform tests.ok(to_regprocedure('public._promo_info(uuid,uuid)') is null and to_regprocedure('public._promo_ventas(uuid)') is null
               and md5(pg_get_functiondef('public.cc_ia_precio(uuid,uuid,integer)'::regprocedure)) = '55d2416f8167b7b7b20ee6bbdb49eba6', '174 down · IA y promos como en la 173/CC-4');
end $t$;
\ir ../../../migrations/20261227120000_promociones_pro.sql
\ir ../../../migrations/20261228120000_promociones_difusion.sql
\ir ../../../migrations/20261229120000_promocion_eliminar.sql
\ir ../../../migrations/20261230120000_promociones_marketing.sql
\ir ../../../migrations/20261231120000_promocion_prueba_correo.sql
do $t$ begin
  perform tests.ok((select todas from _pp) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '174 · se reaplica idéntica');
end $t$;
rollback;
