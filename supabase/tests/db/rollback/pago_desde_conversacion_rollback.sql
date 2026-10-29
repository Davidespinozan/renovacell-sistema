-- PAGO-DESDE-CONVERSACIÓN (20270210) · el down retira comando y lectura; se reaplica idéntica.
begin;
create temp table _pc as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/pago_desde_conversacion/99_down.sql
do $t$ begin
  perform tests.ok(to_regprocedure('public.cc_reportar_pago_cliente(uuid,uuid,text,numeric,text,uuid,text)') is null and to_regprocedure('public.cc_cliente_pedidos(uuid)') is null
               and to_regprocedure('public._cc_pago_adjunto(uuid,uuid)') is null, 'PAGO-CONVERSACIÓN down · sin comando ni lectura');
end $t$;
\ir ../../../migrations/20270210120000_pago_desde_conversacion.sql
do $t$ begin
  perform tests.ok((select todas from _pc) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), 'PAGO-CONVERSACIÓN · se reaplica idéntica');
end $t$;
rollback;
