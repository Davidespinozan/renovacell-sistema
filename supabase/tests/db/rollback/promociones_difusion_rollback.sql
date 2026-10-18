-- DIFUSIÓN DE PROMOCIONES (175) · el down retira envíos, funciones y la plantilla 'promocion'; _promo_json vuelve a la 174; se reaplica igual.
begin;
create temp table _pd as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') n_tablas;
\ir ../../../rollback/promocion_eliminar/99_down.sql   -- PROMO-ELIMINAR (176) se baja primero
\ir ../../../rollback/promociones_difusion/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.promocion_envios') is null and to_regprocedure('public.promocion_difundir(uuid,text[],uuid)') is null
               and (select n_tablas from _pd) = (select count(*) + 1 from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'), '175 down · sin difusión');
  perform tests.ok(pg_get_constraintdef((select oid from pg_constraint where conname = 'ck_comm_plantilla')) not like '%promocion%', '175 down · la plantilla promocion ya no se acepta');
end $t$;
\ir ../../../migrations/20261228120000_promociones_difusion.sql
\ir ../../../migrations/20261229120000_promocion_eliminar.sql
do $t$ begin
  perform tests.ok((select todas from _pd) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '175 · se reaplica idéntica');
end $t$;
rollback;
