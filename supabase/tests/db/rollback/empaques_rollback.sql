-- EMPAQUES (172) · el down retira el catálogo; se reaplica igual.
begin;
create temp table _emp as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r') n_tablas;
\ir ../../../rollback/empaques/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.empaques') is null and to_regprocedure('public.empaques_lista(boolean)') is null
               and (select n_tablas from _emp) = (select count(*) + 1 from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'), '172 down · sin catálogo de empaques');
end $t$;
\ir ../../../migrations/20261225120000_empaques.sql
do $t$ begin
  perform tests.ok((select todas from _emp) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '172 · se reaplica idéntica');
end $t$;
rollback;
