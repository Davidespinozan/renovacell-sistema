-- ============================================================================
-- MODIFICAR UN PEDIDO MIENTRAS NO SALE DE ALMACÉN (27 nov 2026, dueño: «hay que poder hacer modificaciones, agregar
-- productos, etc., cuando el producto aún no ha salido a almacén»). Hasta hoy un pedido creado no se podía tocar:
-- corregir = cancelar y crear otro (otro folio, otro aviso al cliente, otra solicitud de pago).
--
-- `pedido_modificar(pedido, renglones, motivo)` reemplaza los productos y cantidades del pedido con las MISMAS reglas
-- con que se crea uno (precio autorizado `precio_de`, mayoreo por cantidad, productos activos), y recalcula total,
-- envío y estado de pago. Todo en una sola transacción; si algo no cuadra, no cambia nada.
--
-- Cuándo se puede: el pedido no está cancelado, no se ha preparado (ni empacado, ni enviado, ni entregado), Almacén no
-- ha sacado nada de inventario para él, no tiene guía ni envío, no tiene un link de pago con tarjeta abierto y su
-- factura no se está timbrando ni está timbrada. Tampoco ventas de mostrador (ya se entregaron).
-- Quién: Dirección y Ventas sobre los pedidos que ya puede ver (misma regla que pedir su factura). El doctor no.
-- Precio: cada producto al precio autorizado HOY; si ese producto ya estaba en el pedido, nunca sube: se respeta el
--   precio con que se vendió si era menor (p. ej. una promoción que ya terminó).
-- Envío: si se había aplicado el costo de la regla (sin ajuste manual ni cotización de paquetería), se recalcula con
--   el nuevo importe (así un pedido que pasa del mínimo queda con envío gratis, y al revés); si no, se respeta.
-- Pago: el estado de pago se recalcula con el libro de dinero (si sube el total puede quedar con saldo pendiente y
--   Almacén no lo prepara hasta cubrirse; si baja, queda saldo a favor del cliente).
-- Rastro: la bitácora guarda los renglones de antes y de después, el total de antes y de después, quién y por qué.
-- Solo crea una función (sin tablas ni índices). Rollback: drop function public.pedido_modificar(uuid, jsonb, text);
-- ============================================================================
do $pre$ begin
  if to_regprocedure('public.pedido_modificar(uuid, jsonb, text)') is not null then raise exception 'PEDIDO-MODIFICAR: ya aplicada'; end if;
  if to_regprocedure('public.precio_de(uuid, uuid, integer, integer)') is null or to_regprocedure('public._qty_volumen(jsonb)') is null
     or to_regprocedure('public._w2_recalc_payment_status(uuid)') is null or to_regprocedure('public._sec_c1_pos_ve_pedido(uuid)') is null
     or to_regprocedure('public._sobre_pedido_marcar(uuid)') is null or to_regprocedure('public.entrega_opciones(text, numeric, text, timestamptz)') is null then
    raise exception 'PEDIDO-MODIFICAR: faltan piezas previas (precios, mayoreo, dinero, visibilidad, sobre pedido o entrega)';
  end if;
end $pre$;

create function public.pedido_modificar(p_order uuid, p_lines jsonb, p_motivo text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare
  v_rol text := public.auth_role(); o public.orders; v_list uuid; v_vq jsonb; ln jsonb; pid uuid; q int; up numeric; v_prev numeric;
  v_sub numeric := 0; v_items jsonb := '[]'::jsonb; v_antes jsonb; v_ent jsonb; v_flete numeric; v_extras numeric; v_nuevo_flete numeric;
  v_cp text; o2 jsonb; v_total numeric; v_motivo text := nullif(btrim(coalesce(p_motivo, '')), ''); v_estado text; v_vistos uuid[] := '{}';
begin
  if auth.uid() is null or v_rol is null then raise exception 'NO_AUTORIZADO: inicia sesión'; end if;
  select * into o from public.orders where id = p_order for update;
  if not found then raise exception 'PEDIDO_INEXISTENTE: ese pedido no existe'; end if;
  if not (v_rol = 'admin' or (v_rol = 'pos' and public._sec_c1_pos_ve_pedido(p_order))) then
    raise exception 'NO_AUTORIZADO: solo Dirección o la vendedora del pedido lo pueden modificar';
  end if;
  if v_motivo is null or length(v_motivo) < 3 then raise exception 'MOTIVO_REQUERIDO: escribe por qué se modifica el pedido'; end if;
  if length(v_motivo) > 300 then raise exception 'MOTIVO_REQUERIDO: el motivo es demasiado largo'; end if;

  -- Cuándo se puede (nada ha salido de Almacén ni está en un proceso que dependa del contenido).
  if o.status in ('cancelled', 'draft') then raise exception 'PEDIDO_NO_MODIFICABLE: el pedido está cancelado'; end if;
  if o.status in ('packed', 'shipped', 'delivered', 'fulfilled') then raise exception 'PEDIDO_NO_MODIFICABLE: el pedido ya se preparó o ya salió de Almacén'; end if;
  if coalesce(o.shipping_meta ->> 'channel', '') = 'pos' then raise exception 'PEDIDO_NO_MODIFICABLE: una venta de mostrador ya se entregó; usa Devolver / Corregir'; end if;
  if exists (select 1 from public.inventory_movements m where m.order_id = p_order) or exists (select 1 from public.order_items i where i.order_id = p_order and i.lot_id is not null) then
    raise exception 'PEDIDO_NO_MODIFICABLE: Almacén ya sacó producto de inventario para este pedido';
  end if;
  if exists (select 1 from public.shipments s where s.order_id = p_order and coalesce(s.status, '') <> 'cancelado') then
    raise exception 'PEDIDO_NO_MODIFICABLE: el pedido ya tiene guía o envío';
  end if;
  if exists (select 1 from public.pago_links l where l.order_id = p_order and l.estado = 'solicitado') then
    raise exception 'PEDIDO_NO_MODIFICABLE: tiene un link de pago con tarjeta abierto; cancélalo primero (el monto cambiaría)';
  end if;
  if exists (select 1 from public.fiscal_documents f where f.order_id = p_order and f.status in ('en_proceso', 'incierto', 'timbrado')) then
    raise exception 'PEDIDO_NO_MODIFICABLE: la factura de este pedido ya se timbró o se está timbrando';
  end if;

  -- Renglones nuevos: mismas reglas que crear_pedido.
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'PEDIDO_SIN_RENGLONES: el pedido debe tener al menos un producto'; end if;
  if jsonb_array_length(p_lines) > 100 then raise exception 'PEDIDO_INVALIDO: demasiados renglones'; end if;
  if o.doctor_id is not null then select price_list_id into v_list from public.profiles where id = o.doctor_id; end if;
  v_vq := public._qty_volumen(p_lines);
  select coalesce(jsonb_agg(jsonb_build_object('product_id', i.product_id, 'qty', i.qty, 'unit_price', i.unit_price) order by i.created_at, i.id), '[]'::jsonb), coalesce(sum(i.qty * i.unit_price), 0)
    into v_antes, v_prev from public.order_items i where i.order_id = p_order;
  for ln in select * from jsonb_array_elements(p_lines) loop
    pid := nullif(ln ->> 'product_id', '')::uuid;
    q := (ln ->> 'qty')::int;
    if pid is null then raise exception 'PEDIDO_INVALIDO: producto inválido'; end if;
    if pid = any (v_vistos) then raise exception 'PEDIDO_INVALIDO: un producto aparece dos veces; junta sus cantidades'; end if;
    v_vistos := v_vistos || pid;
    if q is null or q <= 0 or q > 100000 then raise exception 'PEDIDO_INVALIDO: cantidad inválida'; end if;
    if not exists (select 1 from public.products where id = pid and active) then raise exception 'PRODUCTO_INACTIVO: un producto no existe o ya no está activo'; end if;
    up := public.precio_de(pid, v_list, q, coalesce((v_vq ->> pid::text)::int, q));
    if up is null then raise exception 'PRODUCTO_SIN_PRECIO: un producto no tiene precio autorizado'; end if;
    -- Lo que ya estaba en el pedido nunca sube de precio.
    select least(up, min(i.unit_price)) into up from public.order_items i where i.order_id = p_order and i.product_id = pid and i.unit_price is not null having count(*) > 0;
    if up is null then up := public.precio_de(pid, v_list, q, coalesce((v_vq ->> pid::text)::int, q)); end if;
    v_sub := v_sub + up * q;
    v_items := v_items || jsonb_build_array(jsonb_build_object('product_id', pid, 'qty', q, 'unit_price', up));
  end loop;

  -- Envío: el de la regla se recalcula con el nuevo importe; un ajuste manual o una cotización de paquetería se respetan.
  v_ent := o.shipping_meta -> 'entrega';
  v_flete := coalesce(o.shipping_cost, 0);
  v_extras := coalesce((v_ent ->> 'extras_flete')::numeric, 0);
  v_nuevo_flete := v_flete;
  if v_ent is not null and v_ent ? 'opcion' and not (v_ent ? 'servicio') and not (v_ent ? 'motivo')
     and (v_ent ->> 'flete') is not null and (v_ent ->> 'flete_regla') is not null and (v_ent ->> 'flete')::numeric = (v_ent ->> 'flete_regla')::numeric then
    v_cp := nullif(btrim(coalesce(o.shipping_meta -> 'address' ->> 'cp', v_ent ->> 'cp', '')), '');
    begin
      select x into o2 from jsonb_array_elements(public.entrega_opciones('staff', v_sub, v_cp, now()) -> 'opciones') x where x ->> 'id' = v_ent ->> 'opcion';
    exception when others then o2 := null;
    end;
    if o2 is not null and (o2 ->> 'flete') is not null then
      v_nuevo_flete := (o2 ->> 'flete')::numeric + v_extras;
      v_ent := v_ent || jsonb_build_object('flete', (o2 ->> 'flete')::numeric, 'flete_regla', (o2 ->> 'flete')::numeric, 'subtotal', v_sub);
    end if;
  end if;
  v_total := v_sub + v_nuevo_flete;

  -- Escribir: renglones, total, envío y «sobre pedido» recalculado.
  perform set_config('app.trusted', 'on', true);
  delete from public.order_items where order_id = p_order;
  insert into public.order_items (order_id, product_id, qty, unit_price)
  select p_order, (x ->> 'product_id')::uuid, (x ->> 'qty')::int, (x ->> 'unit_price')::numeric from jsonb_array_elements(v_items) x;
  update public.orders
     set total = v_total, shipping_cost = v_nuevo_flete,
         shipping_meta = (coalesce(shipping_meta, '{}'::jsonb) - 'sobre_pedido') || case when v_ent is not null then jsonb_build_object('entrega', v_ent) else '{}'::jsonb end
   where id = p_order;
  perform set_config('app.trusted', '', true);
  perform public._sobre_pedido_marcar(p_order);
  v_estado := public._w2_recalc_payment_status(p_order);

  perform public.log_audit('Pedido modificado', coalesce(o.external_ref, p_order::text),
    jsonb_build_object('motivo', v_motivo, 'antes', jsonb_build_object('renglones', v_antes, 'subtotal', v_prev, 'envio', v_flete, 'total', o.total),
                       'despues', jsonb_build_object('renglones', v_items, 'subtotal', v_sub, 'envio', v_nuevo_flete, 'total', v_total), 'estado_pago', v_estado)::text, null);
  return jsonb_build_object('order_id', p_order, 'folio', o.external_ref, 'total_antes', o.total, 'total', v_total, 'subtotal', v_sub, 'envio', v_nuevo_flete,
                            'envio_antes', v_flete, 'estado_pago', v_estado);
end;
$function$;

revoke all on function public.pedido_modificar(uuid, jsonb, text) from public, anon;
grant execute on function public.pedido_modificar(uuid, jsonb, text) to authenticated, service_role;
comment on function public.pedido_modificar(uuid, jsonb, text) is 'Reemplaza productos y cantidades de un pedido que aún no sale de Almacén; recalcula precios, envío, total y estado de pago. Dirección y la vendedora del pedido.';
