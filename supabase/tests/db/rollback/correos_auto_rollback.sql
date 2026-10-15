-- CORREOS AUTOMÁTICOS (165) · el down regresa el disparador de pagos a su versión W4 y retira lo nuevo; se reaplica igual.
begin;
create temp table _ca as select (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f') todas;
\ir ../../../rollback/correos_automaticos/99_down.sql
do $t$ begin
  perform tests.ok(md5(pg_get_functiondef('public._comm_tr_payment_entries()'::regprocedure)) = 'fa1fda3f3721f65f41686c76edfdcd3f'
    and to_regprocedure('public._correos_despachar()') is null and not exists (select 1 from cron.job where jobname = 'renovacell-correos'), '165 down · pagos como en W4, sin tarea ni correos de cuenta');
end $t$;
alter table public.comm_outbox drop constraint ck_comm_plantilla;
alter table public.comm_outbox add constraint ck_comm_plantilla check (plantilla in ('pedido_recibido','pago_recibido','pedido_enviado','pedido_entregado','pedido_cancelado','reembolso_realizado'));
\ir ../../../migrations/20261218120000_correos_automaticos.sql
do $t$ begin
  perform tests.ok((select todas from _ca) = (select md5(string_agg(p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)), ',' order by p.oid::regprocedure::text)) from pg_proc p where p.pronamespace = 'public'::regnamespace and p.prokind = 'f'), '165 · se reaplica idéntica');
end $t$;
rollback;
