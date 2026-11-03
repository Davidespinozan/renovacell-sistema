-- CHAT-ARCHIVOS (20270324) · el down deja Conversaciones solo con fotos; se reaplica idéntica.
begin;
create temp table _ca as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/chat_archivos/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.cc_archivos') is null and not exists (select 1 from storage.buckets where id = 'chat_archivos'), 'CHAT-ARCHIVOS down · como antes');
end $t$;
\ir ../../../migrations/20270324120000_chat_archivos.sql
do $t$ begin
  perform tests.ok((select todas from _ca) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'CHAT-ARCHIVOS · se reaplica idéntica');
end $t$;
rollback;
