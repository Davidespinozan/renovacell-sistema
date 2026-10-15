-- WHATSAPP DE IDA Y VUELTA (168) · el down regresa cc_wa_entrante a la 167 y retira la cola; se reaplica igual.
begin;
create temp table _ws as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/whatsapp_salida/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.cc_wa_salida') is null and not exists (select 1 from cron.job where jobname = 'renovacell-whatsapp') and to_regprocedure('public.cc_wa_entrante(text,text,text,text,boolean)') is not null, '168 down · sin cola ni tarea; la entrada de la 167 sigue');
end $t$;
\ir ../../../migrations/20261221120000_whatsapp_salida.sql
do $t$ begin
  perform tests.ok((select todas from _ws) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '168 · se reaplica idéntica');
end $t$;
rollback;
