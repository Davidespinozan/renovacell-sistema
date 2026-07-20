-- CIERRE DE ENTREGA ATÓMICO
--
-- El chofer podía marcar el ENVÍO como entregado (RLS se lo permite: es su
-- envío) pero no el PEDIDO: `orders_update_scoped` no lo incluye. Resultado:
-- shipments.status = 'delivered' y orders.status = 'shipped' para siempre.
-- Dirección y Ventas nunca veían el pedido cerrado.
--
-- No se abre la política de `orders` al rol chofer (podría tocar cualquier
-- columna de su pedido). En su lugar, una función SECURITY DEFINER que hace
-- las DOS escrituras en una sola transacción y solo la transición válida
-- shipped → delivered. Así además dejan de poder divergir.
create or replace function public.confirmar_entrega(
  p_shipment_id uuid,
  p_proof_path  text default null,
  p_received_by text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_id uuid;
  v_driver   uuid;
  v_estado   text;
begin
  select s.order_id, s.driver_id, s.status
    into v_order_id, v_driver, v_estado
    from shipments s where s.id = p_shipment_id;

  if v_order_id is null then
    raise exception 'El envío no existe';
  end if;

  -- Solo el chofer asignado, o Almacén/Dirección desde el escritorio.
  if not (v_driver = auth.uid() or public.auth_role() = any (array['admin','warehouse','packing'])) then
    raise exception 'No tienes permiso para cerrar esta entrega';
  end if;

  -- La evidencia es obligatoria: sin quién recibió, no hay entrega comprobable.
  if coalesce(btrim(p_received_by), '') = '' then
    raise exception 'Falta el nombre de quien recibió';
  end if;

  if v_estado = 'delivered' then
    return; -- idempotente: reintento del celular sin señal no rompe nada
  end if;

  -- `orders_guard()` no reconoce al rol chofer y SECURITY DEFINER no cambia el
  -- JWT que el guard consulta. Se abre su compuerta explícita, y solo aquí: el
  -- ámbito es la transacción (tercer argumento `true`) y las dos únicas
  -- escrituras que siguen ya están acotadas arriba.
  perform set_config('app.trusted', 'on', true);

  update shipments
     set status = 'delivered',
         delivered_at = now(),
         proof_image_url = coalesce(p_proof_path, proof_image_url),
         received_by = p_received_by
   where id = p_shipment_id;

  update orders
     set status = 'delivered'
   where id = v_order_id
     and status = 'shipped';   -- solo se entrega lo que salió

  perform set_config('app.trusted', 'off', true);
end;
$$;

revoke all on function public.confirmar_entrega(uuid, text, text) from public;
grant execute on function public.confirmar_entrega(uuid, text, text) to authenticated;