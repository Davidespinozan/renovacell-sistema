-- CRM-EMBUDO (20270321) · el down quita tablas, reglas y comandos; se reaplica idéntica.
begin;
create temp table _crm as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/crm_embudo/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.crm_oportunidades') is null and to_regprocedure('public.crm_embudo(uuid,int)') is null, 'CRM-EMBUDO down · como antes');
end $t$;
\ir ../../../migrations/20270321120000_crm_embudo.sql
do $t$ begin
  perform tests.ok((select todas from _crm) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'CRM-EMBUDO · se reaplica idéntica');
end $t$;
rollback;
