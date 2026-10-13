-- PAQ-B (149) · down: elimina anular_guia y restaura _comm_tr_orders EXACTAMENTE como antes de la 149.
-- No toca datos: las guías ya anuladas quedan anuladas (envío cancelado, pedido empacado o con su guía nueva).
do $pre$ begin
  if to_regprocedure('public.anular_guia(uuid,uuid,text)') is null then raise exception 'PAQ-B down: no está aplicada'; end if;
  if md5(pg_get_functiondef('public._comm_tr_orders()'::regprocedure)) <> 'f6cad9db69196400c9c69685ab7f5580' then
    raise exception 'PAQ-B down: _comm_tr_orders no está en el estado de la 149';
  end if;
end $pre$;

drop function public.anular_guia(uuid, uuid, text);

CREATE OR REPLACE FUNCTION public._comm_tr_orders()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'INSERT' then
    -- Solo el pedido que queda esperando pago. La venta de mostrador nace pagada y
    -- entregada: su comprobante es el recibo, no un correo de "recibimos tu pedido".
    if new.status = 'pending_payment' then
      perform public._comm_encolar('pedido_recibido:' || new.id, 'pedido_recibido', new.id,
        jsonb_build_object('total', new.total));
    end if;
    return new;
  end if;
  if new.status is distinct from old.status then
    if new.status = 'shipped' then
      perform public._comm_encolar('pedido_enviado:' || new.id, 'pedido_enviado', new.id,
        jsonb_build_object(
          'paqueteria', new.shipping_meta ->> 'carrier',
          'rastreo',    new.shipping_meta ->> 'tracking',
          'metodo',     new.shipping_meta ->> 'method'));
    elsif new.status = 'delivered' and old.status = 'shipped' then
      perform public._comm_encolar('pedido_entregado:' || new.id, 'pedido_entregado', new.id, '{}'::jsonb);
    elsif new.status = 'cancelled' then
      perform public._comm_encolar('pedido_cancelado:' || new.id, 'pedido_cancelado', new.id, '{}'::jsonb);
    end if;
  end if;
  return new;
end;
$function$;

do $post$ begin
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname = 'anular_guia')
     or md5(pg_get_functiondef('public._comm_tr_orders()'::regprocedure)) <> '6cd538f276621d538be34a2da15c4290' then
    raise exception 'PAQ-B down: no quedó como antes de la 149';
  end if;
end $post$;
