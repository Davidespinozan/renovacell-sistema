-- CANCELACIÓN · rollback de la migración 162. Se pierden las solicitudes; las cancelaciones hechas siguen hechas.
drop trigger orders_cancelacion_envio on public.orders;
drop trigger shipping_attempts_cancelacion on public.shipping_attempts;
drop trigger order_cancellations_avisos on public.order_cancellations;
drop function public._cancelacion_bloquea_envio();
drop function public._cancelacion_avisos();
drop function public.resolver_solicitud_cancelacion(uuid, boolean, text);
drop function public.solicitar_cancelacion(uuid, text);
drop function public._cancel_req_ve_pedido(uuid);
drop table public.order_cancel_requests;
