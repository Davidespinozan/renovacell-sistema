-- PROMO-5 (176) · el down retira la función; se reaplica igual.
begin;
create temp table _pe as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/promocion_eliminar/99_down.sql
do $t$ begin perform tests.ok(to_regprocedure('public.promocion_eliminar(uuid)') is null, '176 down · sin eliminar'); end $t$;
\ir ../../../migrations/20261229120000_promocion_eliminar.sql
do $t$ begin
  perform tests.ok((select todas from _pe) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '176 · se reaplica idéntica');
end $t$;
rollback;
