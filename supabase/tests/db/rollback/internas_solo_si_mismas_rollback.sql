-- CUENTAS INTERNAS · SOLO SE VEN A SÍ MISMAS · el down devuelve políticas y funciones a la versión anterior; se reaplica idéntica.
begin;
create temp table _i2 as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select string_agg(policyname || ':' || coalesce(qual, ''), ' | ' order by policyname) from pg_policies where tablename = 'profiles') politicas;
\ir ../../../rollback/internas_solo_si_mismas/99_down.sql
do $t$ begin
  perform tests.ok((select count(*) from pg_policies where tablename = 'profiles' and qual like '%_es_interna()%') = 3, 'INTERNAS-2 down · las políticas vuelven a permitir que las internas se vean entre sí');
end $t$;
\ir ../../../migrations/20270131120000_internas_solo_si_mismas.sql
do $t$ begin
  perform tests.ok((select todas from _i2) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f')
               and (select politicas from _i2) = (select string_agg(policyname || ':' || coalesce(qual, ''), ' | ' order by policyname) from pg_policies where tablename = 'profiles'), 'INTERNAS-2 · se reaplica idéntica');
end $t$;
rollback;
