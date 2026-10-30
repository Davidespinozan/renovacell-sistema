-- HERRAMIENTAS DEL VENDEDOR · bloque C (20270216) · el down retira seguimientos y cron; se reaplica idéntica.
begin;
create temp table _sg as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/seguimientos/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.cc_seguimientos') is null and not exists (select 1 from cron.job where jobname = 'renovacell-seguimientos'), 'BLOQUE-C down · sin tabla ni cron');
end $t$;
\ir ../../../migrations/20270216120000_seguimientos.sql
do $t$ begin
  perform tests.ok((select todas from _sg) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'BLOQUE-C · se reaplica idéntica');
end $t$;
rollback;
