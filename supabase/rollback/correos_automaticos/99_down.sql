-- CORREOS AUTOMÁTICOS · rollback de la migración 165. Los correos de cuenta ya encolados se quedan en el buzón
-- (evidencia); el buzón vuelve a aceptar solo las plantillas de pedido para filas NUEVAS (NOT VALID).
select cron.unschedule('renovacell-correos');
drop function public._correos_despachar();
drop trigger trg_comm_cuenta on public.profiles;
drop function public._comm_tr_cuenta();
drop function public._comm_encolar_cuenta(text, text, uuid, jsonb);
CREATE OR REPLACE FUNCTION public._comm_tr_payment_entries()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  -- Una reversa corrige el libro; no es un hecho que se le anuncie al cliente.
  if new.reversal_of is not null or new.order_id is null then return new; end if;
  if new.direction = 'in' then
    perform public._comm_encolar('pago_recibido:' || new.id, 'pago_recibido', new.order_id,
      jsonb_build_object('monto', new.amount, 'metodo', new.method));
  elsif new.direction = 'out' then
    perform public._comm_encolar('reembolso_realizado:' || new.id, 'reembolso_realizado', new.order_id,
      jsonb_build_object('monto', new.amount, 'metodo', new.method));
  end if;
  return new;
end;
$function$;
alter table public.comm_outbox drop constraint ck_comm_plantilla;
alter table public.comm_outbox add constraint ck_comm_plantilla check (plantilla in (
  'pedido_recibido','pago_recibido','pedido_enviado','pedido_entregado','pedido_cancelado','reembolso_realizado')) not valid;
