-- VERIFICARME (159) · el down retira el comando sin tocar nada más; se reaplica igual.
begin;
create temp table _vm as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname <> 'cc_prerregistro_datos') resto;
\ir ../../../rollback/verificarme_en_chat/99_down.sql
do $t$ begin
  perform tests.ok(to_regprocedure('public.cc_prerregistro_datos(text)') is null and (select resto from _vm) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '159 down · sin el comando y nada más cambió');
end $t$;
\ir ../../../migrations/20261212120000_verificarme_en_chat.sql
do $t$ begin
  perform tests.ok((select todas from _vm) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '159 · se reaplica idéntica');
end $t$;
rollback;
