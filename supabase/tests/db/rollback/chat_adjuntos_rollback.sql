-- FOTOS EN EL CHAT (157) · el down retira tabla, comandos y bucket sin tocar ninguna otra función; se reaplica igual.
begin;
\ir ../../../rollback/alta_desde_conversacion/99_down.sql   -- ALTA (20270208) usa cc_adjuntos: se baja primero
create temp table _ca as select
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname not like 'cc_adjunto_%') resto;
\ir ../../../rollback/chat_adjuntos/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.cc_adjuntos') is null and not exists (select 1 from storage.buckets where id = 'chat') and not exists (select 1 from pg_proc where proname like 'cc_adjunto_%'), '157 down · sin tabla, comandos ni bucket');
  perform tests.ok((select resto from _ca) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '157 down · ninguna otra función cambió');
end $t$;
\ir ../../../migrations/20261210120000_chat_adjuntos.sql
do $t$ begin
  perform tests.ok((select todas from _ca) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '157 · se reaplica idéntica');
end $t$;
rollback;
