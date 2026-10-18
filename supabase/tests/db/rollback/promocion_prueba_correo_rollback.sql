-- PROMO-7 (178) · el down retira la función; se reaplica igual.
begin;
create temp table _pq as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/promocion_prueba_correo/99_down.sql
do $t$ begin perform tests.ok(to_regprocedure('public.promocion_prueba_correo(uuid,text)') is null, '178 down · sin prueba'); end $t$;
\ir ../../../migrations/20261231120000_promocion_prueba_correo.sql
do $t$ begin
  perform tests.ok((select todas from _pq) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '178 · se reaplica idéntica');
end $t$;
rollback;
