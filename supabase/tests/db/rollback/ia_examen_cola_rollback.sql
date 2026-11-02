-- IA EXAMEN COLA (20270303) · el down quita cola y cron y regresa las funciones de la 20270228; se reaplica idéntica.
begin;
create temp table _iq as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/ia_examen_cola/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.cc_ia_examen_cola') is null and not exists (select 1 from cron.job where jobname = 'renovacell-ia-examen')
               and pg_get_functiondef('public.ia_examen_crear(text,uuid,text,text[],text)'::regprocedure) not like '%cc_ia_examen_cola%', 'IA-EXAMEN-COLA down · como la 20270228');
end $t$;
\ir ../../../migrations/20270303120000_ia_examen_cola.sql
do $t$ begin
  perform tests.ok((select todas from _iq) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'IA-EXAMEN-COLA · se reaplica idéntica');
end $t$;
rollback;
