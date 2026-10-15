-- CANCELACIÓN (162) · el down retira tabla, comandos y triggers sin tocar nada más; se reaplica igual.
begin;
create temp table _cs as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas,
  (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'
     and p.proname not in ('_cancel_req_ve_pedido', 'solicitar_cancelacion', 'resolver_solicitud_cancelacion', '_cancelacion_avisos', '_cancelacion_bloquea_envio')) resto;
\ir ../../../rollback/cancelacion_solicitudes/99_down.sql
do $t$ begin
  perform tests.ok(to_regclass('public.order_cancel_requests') is null and not exists (select 1 from pg_trigger where tgname in ('orders_cancelacion_envio', 'shipping_attempts_cancelacion', 'order_cancellations_avisos'))
    and (select resto from _cs) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '162 down · sin tabla, comandos ni triggers; nada más cambió');
end $t$;
\ir ../../../migrations/20261215120000_cancelacion_solicitudes.sql
do $t$ begin
  perform tests.ok((select todas from _cs) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '162 · se reaplica idéntica');
end $t$;
rollback;
