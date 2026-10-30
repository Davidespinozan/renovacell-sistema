-- INTERÉS PROACTIVO (20270224) · el down retira tarea, trigger, cola y funciones; se reaplica idéntica.
begin;
create temp table _ip as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/interes_proactivo/99_down.sql
do $t$ begin
  perform tests.ok(to_regprocedure('public.cc_interes_despachar()') is null and to_regclass('public.cc_interes_cola') is null
               and not exists (select 1 from cron.job where jobname = 'renovacell-interes') and not exists (select 1 from pg_trigger where tgname = 'cc_interes_senal'), 'INTERES down · sin tarea, trigger, cola ni funciones');
end $t$;
\ir ../../../migrations/20270224120000_interes_proactivo.sql
do $t$ begin
  perform tests.ok((select todas from _ip) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'INTERES · se reaplica idéntica');
end $t$;
rollback;
