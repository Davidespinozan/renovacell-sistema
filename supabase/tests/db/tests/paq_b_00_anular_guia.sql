-- PAQ-B (149) · anular_guia: anula la guía de paquetería de un pedido que NO ha salido del local y lo regresa a
-- "empacado" para generar otra. Logística. Exige motivo, sin recolección agendada y sin movimiento de la paquetería.
-- No toca inventario ni dinero; el aviso al cliente con el número anulado ya no sale y la guía nueva genera el suyo.
begin;
create function pg_temp.enviado(p_doc uuid, p_prod uuid, p_guia text, p_quien uuid) returns uuid language plpgsql as $f$
declare o uuid;
begin
  perform tests.act_as_owner();
  o := tests.packed_order(p_doc, jsonb_build_array(jsonb_build_object('product_id', p_prod, 'qty', 1)));
  insert into public.shipping_attempts (order_id, provider, idempotency_key, service_code, request_fingerprint, status, tracking_number)
  values (o, 'dhl', o::text || ':N', 'N', md5(o::text), 'succeeded', p_guia);
  insert into public.shipments (order_id, carrier, tracking_number, status, provider, service_code, label_path) values (o, 'DHL', p_guia, 'in_transit', 'dhl', 'N', o::text || '/' || p_guia || '.pdf');
  perform tests.act_as(p_quien);
  update public.orders set status = 'shipped', shipping_meta = coalesce(shipping_meta, '{}'::jsonb) || jsonb_build_object('method', 'paqueteria', 'carrier', 'DHL', 'tracking', p_guia, 'label_url', 'https://x/y.pdf') where id = o;
  perform tests.act_as_owner();
  return o;
end $f$;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); v_wh uuid := tests.user('warehouse'); v_pk uuid := tests.user('packing'); v_pos uuid := tests.user('pos'); v_bill uuid := tests.user('billing');
  v_drv uuid := tests.user('driver'); dA uuid := tests.user('doctor', 'paqb-doc@t.local'); p uuid := tests.product(100); lot uuid;
  o uuid; o2 uuid; o3 uuid; o4 uuid; s uuid; op uuid; r jsonb; r2 jsonb; n int; meta0 jsonb; q0 int; m0 text; h0 text;
  f text := 'select public.anular_guia(%L::uuid, %L::uuid, %L)';
begin
  perform tests.act_as_owner(); lot := tests.stock(p, 'PAQB-LOT', 40);
  perform tests.act_as_service(); insert into public.customers (full_name, email, source, profile_id) values ('Cliente PAQ-B', 'paqb-doc@t.local', 'portal', dA);
  perform tests.act_as_owner();

  -- ══ 0 · FORMA ══
  perform tests.ok(md5(pg_get_functiondef('public.anular_guia(uuid,uuid,text)'::regprocedure)) = '35015b5940b8848f001e18ce8d6e1356'
               and md5(pg_get_functiondef('public._comm_tr_orders()'::regprocedure)) = 'f6cad9db69196400c9c69685ab7f5580', '0.1 · funciones de la 149');
  perform tests.ok(md5(pg_get_functiondef('public.orders_guard()'::regprocedure)) = 'e88f1bb21a69f79a1d31585cbc75bf7d' and md5(pg_get_functiondef('public.shipments_guard()'::regprocedure)) = 'b1e791b99ca8043cb1e2913e0b294600'
               and md5(pg_get_functiondef('public.finalize_shipment(uuid,jsonb)'::regprocedure)) = 'a1cf5c01877e87f41ee0e9635b478e34' and md5(pg_get_functiondef('public.cancelar_pedido(uuid,uuid,text)'::regprocedure)) = '3da69c03241d6805a274f3acb602e399'
               and md5(pg_get_functiondef('public.anular_guia_manual(uuid,uuid,text,text)'::regprocedure)) = '68f0824cb3572d7ad394886afacdd78e', '0.2 · candados y comandos existentes NO cambiaron');

  o := pg_temp.enviado(dA, p, '1111111111', v_wh);
  s := (select id from public.shipments where order_id = o);
  meta0 := (select shipping_meta from public.orders where id = o);
  perform tests.ok((select status = 'shipped' from public.orders where id = o) and (select count(*) = 1 and bool_and(status = 'pendiente' and payload ->> 'rastreo' = '1111111111') from public.comm_outbox where order_id = o and plantilla = 'pedido_enviado'),
    'escenario · pedido enviado con guía y su aviso "va en camino" en cola');
  q0 := tests.qty(lot); m0 := (select md5(coalesce(string_agg(e.id::text || e.amount, ',' order by e.id), '')) from public.payment_entries e);

  -- ══ A · QUIÉN ══
  perform tests.act_as(v_pos);  perform tests.throws(format(f, gen_random_uuid(), o, 'dirección equivocada'), 'NO_AUTORIZADO', 'A1 · Ventas no anula guías');
  perform tests.act_as(v_bill); perform tests.throws(format(f, gen_random_uuid(), o, 'dirección equivocada'), 'NO_AUTORIZADO', 'A2 · Facturación tampoco');
  perform tests.act_as(v_drv);  perform tests.throws(format(f, gen_random_uuid(), o, 'dirección equivocada'), 'NO_AUTORIZADO', 'A3 · ni el chofer');
  perform tests.act_as(dA);     perform tests.throws(format(f, gen_random_uuid(), o, 'dirección equivocada'), 'NO_AUTORIZADO', 'A4 · ni el cliente dueño del pedido');
  perform tests.act_as_anon();  perform tests.throws(format(f, gen_random_uuid(), o, 'dirección equivocada'), 'permission denied', 'A5 · anónimo: sin EXECUTE');

  -- ══ B · CUÁNDO NO ══
  perform tests.act_as(v_wh);
  perform tests.throws(format(f, gen_random_uuid(), o, ''), 'MOTIVO_REQUERIDO', 'B1 · sin motivo');
  perform tests.throws(format(f, gen_random_uuid(), o, 'x'), 'MOTIVO_REQUERIDO', 'B2 · motivo de un carácter');
  perform tests.throws(format(f, gen_random_uuid(), gen_random_uuid(), 'dirección equivocada'), 'PEDIDO_INEXISTENTE', 'B3 · pedido inexistente');
  perform tests.throws(format(f, null, o, 'dirección equivocada'), 'OP_ID_REQUERIDO', 'B4 · sin identificador de operación');
  -- recolección agendada
  perform tests.act_as(v_admin); update public.shipments set pickup_confirmation = 'AME1' where id = s;
  perform tests.act_as(v_wh); perform tests.throws(format(f, gen_random_uuid(), o, 'dirección equivocada'), 'RECOLECCION_AGENDADA', 'B5 · con recolección agendada: primero se cancela');
  perform tests.act_as(v_admin); update public.shipments set pickup_confirmation = null where id = s;
  -- la paquetería ya reporta movimiento
  for r in select to_jsonb(x) from (values ('recolectado'), ('en_transito'), ('en_reparto'), ('incidencia')) x(estado) loop
    perform tests.act_as_service(); delete from public.shipment_tracking where shipment_id = s; perform public.registrar_rastreo(s, 'dhl', r ->> 'estado');
    perform tests.act_as(v_wh); perform tests.throws(format(f, gen_random_uuid(), o, 'dirección equivocada'), 'PAQUETE_EN_PAQUETERIA', 'B6 · la paquetería reporta "' || (r ->> 'estado') || '": no se anula (procede devolución)');
  end loop;
  perform tests.act_as_service(); delete from public.shipment_tracking where shipment_id = s; perform public.registrar_rastreo(s, 'dhl', 'sin_eventos');
  perform tests.act_as_owner();
  perform tests.ok((select status = 'shipped' and shipping_meta = meta0 from public.orders where id = o) and (select status = 'in_transit' and tracking_number = '1111111111' from public.shipments where id = s)
               and (select status = 'succeeded' from public.shipping_attempts where order_id = o), 'B7 · ninguno de los rechazos cambió nada');

  -- ══ C · ANULACIÓN ══
  op := gen_random_uuid(); perform tests.act_as(v_wh);
  execute format(f, op, o, '  dirección equivocada  ') into r;
  perform tests.act_as_owner();
  perform tests.ok(r ->> 'status' = 'applied' and r ->> 'guia_anulada' = '1111111111' and r ->> 'order_status' = 'packed', 'C1 · Almacén anula: respuesta con la guía anulada');
  perform tests.ok((select status = 'packed' from public.orders where id = o), 'C2 · el pedido vuelve a "empacado"');
  perform tests.ok((select not (shipping_meta ?| array['carrier', 'tracking', 'label_url', 'method']) and (shipping_meta - 'carrier' - 'tracking' - 'label_url' - 'method') = (meta0 - 'carrier' - 'tracking' - 'label_url' - 'method')
                      and (shipping_meta -> 'customer') is not distinct from (meta0 -> 'customer') and (shipping_meta ->> 'seller_origen') is not distinct from (meta0 ->> 'seller_origen') and shipping_meta ->> 'placed_by' is not distinct from meta0 ->> 'placed_by' from public.orders where id = o),
    'C3 · se quitan SOLO los datos de la guía; cuenta, vendedor, capturista y domicilio intactos');
  perform tests.ok((select status = 'cancelado' and tracking_number is null and provider_meta -> 'anulada' ->> 'tracking' = '1111111111' and provider_meta -> 'anulada' ->> 'motivo' = 'dirección equivocada'
                      and (provider_meta -> 'anulada' ->> 'por')::uuid = v_wh and label_path is not null from public.shipments where id = s), 'C4 · el envío queda cancelado, con su número, motivo y autor como constancia (y su etiqueta guardada)');
  perform tests.ok((select status = 'voided_manual' and voided_by = v_wh and voided_at is not null and void_reference like 'Anulada en el sistema: dirección equivocada' from public.shipping_attempts where order_id = o), 'C5 · el intento de guía queda anulado');
  perform tests.ok((select status = 'fallido' and last_error like 'GUIA_ANULADA%1111111111%' from public.comm_outbox where order_id = o and plantilla = 'pedido_enviado'), 'C6 · el aviso al cliente con el número anulado ya NO saldrá');
  perform tests.ok(tests.qty(lot) = q0 and m0 = (select md5(coalesce(string_agg(e.id::text || e.amount, ',' order by e.id), '')) from public.payment_entries e) and tests.conciliacion_errores() = 0, 'C7 · inventario y dinero intactos');
  perform tests.ok(exists (select 1 from public.inventory_operations where op_id = op and kind = 'anulacion_guia' and actor = v_wh), 'C8 · la operación queda registrada con su autor');
  -- idempotencia
  h0 := (select md5(string_agg(to_jsonb(x)::text, ',' order by x.id)) from public.shipments x) || (select md5(string_agg(to_jsonb(a)::text, ',' order by a.id)) from public.shipping_attempts a);
  perform tests.act_as(v_wh); execute format(f, op, o, 'dirección equivocada') into r2;
  perform tests.ok(r2 ->> 'status' = 'already_applied', 'C9 · repetir la misma operación: ya aplicada, sin efectos');
  perform tests.throws(format(f, op, o, 'otro motivo'), 'OP_ID_REUTILIZADO', 'C10 · misma operación con otro contenido: rechazada');
  perform tests.throws(format(f, gen_random_uuid(), o, 'dirección equivocada'), 'PEDIDO_NO_ENVIADO', 'C11 · anular dos veces: el pedido ya no está enviado');
  perform tests.act_as_owner();
  perform tests.eq((select md5(string_agg(to_jsonb(x)::text, ',' order by x.id)) from public.shipments x) || (select md5(string_agg(to_jsonb(a)::text, ',' order by a.id)) from public.shipping_attempts a), h0, 'C12 · los reintentos no cambiaron nada');

  -- ══ D · GUÍA NUEVA SOBRE EL MISMO PEDIDO ══
  perform tests.act_as_owner();
  insert into public.shipping_attempts (order_id, provider, idempotency_key, service_code, request_fingerprint, status) values (o, 'dhl', o::text || ':N', 'N', md5('nuevo'), 'pending') returning id into o4;
  perform tests.act_as(v_pk);
  r := public.finalize_shipment(o4, jsonb_build_object('order_id', o, 'carrier', 'DHL', 'tracking_number', '2222222222', 'provider', 'dhl', 'service_code', 'N', 'label_path', 'x/2222222222.pdf', 'provider_cost', '300', 'currency', 'MXN'));
  perform tests.ok((r ->> 'ok')::boolean and not coalesce((r ->> 'reused')::boolean, false), 'D1 · el pedido admite una guía NUEVA (misma llave de servicio; la anulada no estorba)');
  update public.orders set status = 'shipped', shipping_meta = shipping_meta || '{"method":"paqueteria","carrier":"DHL","tracking":"2222222222"}'::jsonb where id = o;
  perform tests.act_as_owner();
  perform tests.ok((select count(*) = 2 from public.shipments where order_id = o) and (select count(*) = 1 from public.shipments where order_id = o and tracking_number is not null), 'D2 · quedan dos envíos: el anulado (constancia) y el vigente');
  perform tests.ok((select count(*) = 1 and bool_and(status = 'pendiente' and payload ->> 'rastreo' = '2222222222') from public.comm_outbox where order_id = o and event_key = 'pedido_enviado:' || o || ':r1'),
    'D3 · la guía nueva genera SU aviso al cliente, con el número vigente');
  -- segunda anulación y tercer envío: la llave sigue avanzando
  perform tests.act_as(v_admin); execute format(f, gen_random_uuid(), o, 'paquete mal medido') into r;
  perform tests.ok(r ->> 'guia_anulada' = '2222222222', 'D4 · Dirección anula la segunda guía');
  perform tests.act_as_owner();
  insert into public.shipments (order_id, carrier, tracking_number, status, provider) values (o, 'DHL', '3333333333', 'in_transit', 'dhl');
  insert into public.shipping_attempts (order_id, provider, idempotency_key, service_code, request_fingerprint, status, tracking_number) values (o, 'dhl', o::text || ':N', 'N', md5('3'), 'succeeded', '3333333333');
  perform tests.act_as(v_pk); update public.orders set status = 'shipped', shipping_meta = shipping_meta || '{"method":"paqueteria","carrier":"DHL","tracking":"3333333333"}'::jsonb where id = o;
  perform tests.act_as_owner();
  perform tests.ok(exists (select 1 from public.comm_outbox where event_key = 'pedido_enviado:' || o || ':r2' and payload ->> 'rastreo' = '3333333333'), 'D5 · tercer envío: aviso propio (…:r2)');

  -- ══ E · OTROS ESTADOS Y REGRESIONES ══
  o2 := pg_temp.enviado(dA, p, '4444444444', v_pk);
  perform tests.ok(not exists (select 1 from public.comm_outbox where order_id = o2 and event_key <> 'pedido_enviado:' || o2 and plantilla = 'pedido_enviado'), 'E1 · un pedido SIN anulaciones conserva la llave de aviso de siempre');
  perform tests.act_as_owner(); update public.shipping_attempts set status = 'unknown_requires_reconciliation' where order_id = o2;
  perform tests.act_as(v_wh); perform tests.throws(format(f, gen_random_uuid(), o2, 'dirección equivocada'), 'GUIA_EN_PROCESO', 'E2 · guía en estado desconocido: no se anula');
  perform tests.act_as_owner(); update public.shipping_attempts set status = 'succeeded' where order_id = o2;
  -- aviso ya enviado: no se toca
  perform set_config('app.trusted', 'on', true); update public.comm_outbox set status = 'enviado', provider_message_id = 'm1', sent_at = now() where order_id = o2 and plantilla = 'pedido_enviado'; perform set_config('app.trusted', 'off', true);
  perform tests.act_as(v_pk); execute format(f, gen_random_uuid(), o2, 'dirección equivocada') into r;
  perform tests.act_as_owner();
  perform tests.ok(r ->> 'status' = 'applied' and (select status = 'enviado' from public.comm_outbox where order_id = o2 and plantilla = 'pedido_enviado'), 'E3 · Empaque anula; un aviso que YA se envió queda como evidencia, sin tocar');
  -- tras anular, el pedido empacado se puede cancelar por su vía normal (ya no hay guía activa)
  perform tests.act_as(v_admin); r := public.cancelar_pedido(gen_random_uuid(), o2, 'el cliente ya no lo quiere');
  perform tests.ok(r ->> 'status' = 'applied', 'E4 · tras anular la guía, el pedido se puede cancelar por su comando normal');
  -- entregado / con chofer / sin guía
  o3 := pg_temp.enviado(dA, p, '5555555555', v_wh);
  perform tests.act_as(v_wh); perform public.confirmar_entrega((select id from public.shipments where order_id = o3), null, 'Recepción');
  perform tests.throws(format(f, gen_random_uuid(), o3, 'dirección equivocada'), 'PEDIDO_NO_ENVIADO', 'E5 · pedido ya entregado: no se anula');
  perform tests.act_as_owner();
  o3 := tests.packed_order(dA, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)));
  insert into public.shipments (order_id, driver_id, status) values (o3, v_drv, 'despachado');
  perform tests.act_as(v_wh); update public.orders set status = 'shipped' where id = o3;
  perform tests.throws(format(f, gen_random_uuid(), o3, 'dirección equivocada'), 'SIN_GUIA', 'E6 · envío con chofer propio: no hay guía de paquetería que anular');
  perform tests.act_as_owner();
  perform tests.eq(tests.conciliacion_errores(), 0, 'Z1 · inventario concilia al final');
end $t$;
rollback;
