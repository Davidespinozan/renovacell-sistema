-- CARTERA-PLAZO (20270327) · el down deja la cartera sin plazos; se reaplica idéntica.
begin;
create temp table _cp2 as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/cartera_plazo/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.cc_cartera_prospectos') is null and not exists (select 1 from information_schema.columns where table_name = 'cc_cartera' and column_name = 'plazo_desde')
                   and not exists (select 1 from cron.job where jobname = 'renovacell-cartera-plazos'), 'CARTERA-PLAZO down · como antes');
end $t$;
\ir ../../../migrations/20270327120000_cartera_plazo.sql
do $t$ begin
  perform tests.ok((select todas from _cp2) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'CARTERA-PLAZO · se reaplica idéntica');
end $t$;
rollback;
