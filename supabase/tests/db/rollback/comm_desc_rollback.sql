-- AVISOS DESCARTADOS (164) · el down retira el trigger sin tocar nada más; se reaplica igual.
begin;
create temp table _cd as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f' and p.proname <> '_comm_no_revivir') resto;
\ir ../../../rollback/comm_descartados/99_down.sql
do $t$ begin
  perform tests.ok(not exists (select 1 from pg_trigger where tgname = 'comm_outbox_no_revivir') and (select resto from _cd) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '164 down · sin el trigger; nada más cambió');
end $t$;
\ir ../../../migrations/20261217120000_comm_descartados.sql
do $t$ begin
  perform tests.ok((select todas from _cd) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '164 · se reaplica idéntica');
end $t$;
rollback;
