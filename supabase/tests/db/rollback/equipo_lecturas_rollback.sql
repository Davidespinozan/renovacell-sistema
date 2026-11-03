-- EQUIPO-LECTURAS (20270328) · el down quita palomitas y "escribiendo" del chat del equipo; se reaplica idéntica.
begin;
create temp table _el as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/equipo_lecturas/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.equipo_lecturas') is null and not exists (select 1 from pg_publication_tables where tablename = 'equipo_lecturas'), 'EQUIPO-LECTURAS down · como antes');
end $t$;
\ir ../../../migrations/20270328120000_equipo_lecturas.sql
do $t$ begin
  perform tests.ok((select todas from _el) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'EQUIPO-LECTURAS · se reaplica idéntica');
end $t$;
rollback;
