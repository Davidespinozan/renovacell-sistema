-- WHATSAPP · BANDEJA (169) · el down retira solo cc_wa_bandeja; se reaplica igual.
begin;
create temp table _wb as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select count(*) from pg_proc where pronamespace = 'public'::regnamespace) n;
\ir ../../../rollback/whatsapp_bandeja/99_down.sql
do $t$ begin
  perform tests.ok(to_regprocedure('public.cc_wa_bandeja()') is null and (select n from _wb) = (select count(*) + 1 from pg_proc where pronamespace = 'public'::regnamespace)
               and to_regclass('public.cc_wa_config') is not null and to_regprocedure('public.cc_wa_entrante(text,text,text,text,boolean)') is not null, '169 down · solo desaparece la bandeja; la 167 y la 168 siguen');
end $t$;
\ir ../../../migrations/20261222120000_whatsapp_bandeja.sql
do $t$ begin
  perform tests.ok((select todas from _wb) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '169 · se reaplica idéntica');
end $t$;
rollback;
