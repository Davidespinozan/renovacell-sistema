-- AUDITORÍA 19 nov 2026 (chofer + almacén) · envíos.
--   1. Un pedido tiene a lo más UN envío vivo (ni doble toque en «Asignar chofer» ni dos personas a la vez): índice único
--      parcial sobre los envíos que no están cancelados ni entregados.
--   2. confirmar_entrega cierra la incidencia del envío (antes quedaba «sin resolver» y Dirección podía «reintentar» una
--      entrega ya hecha, que regresaba a la ruta del chofer).
do $pre$ begin
  if exists (select order_id from public.shipments where status not in ('cancelado', 'delivered') group by order_id having count(*) > 1) then
    raise exception 'AUDITORIA-ENVIOS: hay pedidos con más de un envío vivo; resolverlos antes'; end if;
  if position('received_by = p_received_by' in pg_get_functiondef('public.confirmar_entrega(uuid,text,text)'::regprocedure)) = 0 then
    raise exception 'AUDITORIA-ENVIOS: confirmar_entrega cambió; revisar el parche'; end if;
end $pre$;

create unique index if not exists uq_shipments_un_envio_vivo on public.shipments (order_id) where status not in ('cancelado', 'delivered');

do $patch$
declare d text := pg_get_functiondef('public.confirmar_entrega(uuid,text,text)'::regprocedure);
begin
  execute replace(d, 'received_by = p_received_by',
    'received_by = p_received_by, incident = case when incident is null then null else incident || jsonb_build_object(''resolved'', true, ''resolved_on_delivery'', true) end');
end $patch$;

do $post$ begin
  if position('resolved_on_delivery' in pg_get_functiondef('public.confirmar_entrega(uuid,text,text)'::regprocedure)) = 0 then raise exception 'AUDITORIA-ENVIOS: no quedó aplicada'; end if;
end $post$;
