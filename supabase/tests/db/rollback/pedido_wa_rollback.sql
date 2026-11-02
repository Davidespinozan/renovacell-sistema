-- PEDIDO POR WHATSAPP (20270307) · el down retira lo nuevo; se reaplica idéntica.
begin;
create temp table _pw as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/pedido_wa/99_down.sql
do $t$ begin
  perform tests.ok(to_regprocedure('public.cc_ia_pedido_confirmar(uuid,uuid)') is null and not exists (select 1 from pg_trigger where tgname = 'cc_comprobante_wa'), 'PEDIDO-WA down · sin lo nuevo');
end $t$;
\ir ../../../migrations/20270307120000_pedido_wa.sql
do $t$ begin
  perform tests.ok((select todas from _pw) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'PEDIDO-WA · se reaplica idéntica');
end $t$;
rollback;
