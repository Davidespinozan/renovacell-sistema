-- PROMO-8 (179) · el down retira avisos y _promo_json vuelve a la 175; se reaplica igual.
begin;
create temp table _pa as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/promocion_avisos/99_down.sql
do $t$ begin perform tests.ok(to_regprocedure('public.promocion_avisos_pendientes(uuid)') is null and not exists (select 1 from information_schema.columns where table_name = 'promocion_envios' and column_name = 'avisado_at'), '179 down · sin avisos'); end $t$;
\ir ../../../migrations/20270101120000_promocion_avisos.sql
do $t$ begin
  perform tests.ok((select todas from _pa) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '179 · se reaplica idéntica');
end $t$;
rollback;
