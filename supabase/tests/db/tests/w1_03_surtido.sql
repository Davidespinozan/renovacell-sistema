-- W1 · RC-08 Surtido: asignaciones validadas contra renglones, caducidad, stock, idempotencia
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_wh uuid := tests.user('warehouse'); v_doc uuid := tests.user('doctor');
  v_pos uuid := tests.user('pos'); v_bill uuid := tests.user('billing');
  v_a uuid := tests.product(); v_b uuid := tests.product();
  v_l1 uuid; v_l2 uuid; v_lb uuid; v_lx uuid;
  v_o uuid; v_o2 uuid; v_ia uuid; v_ib uuid; v_i2 uuid; v_ok jsonb; v_op uuid := tests.op(); v_r jsonb; v_e uuid;
begin
  v_l1 := tests.stock(v_a, 'A-1', 5, current_date + 100);
  v_l2 := tests.stock(v_a, 'A-2', 10, current_date + 200);
  v_lb := tests.stock(v_b, 'B-1', 10, current_date + 150);
  v_lx := tests.stock(v_a, 'A-X', 9, current_date + 50);
  update public.lots set expiry_date = public.hoy_local() - 1 where id = v_lx;   -- caducó en bodega (dueño)
  v_o := tests.order(v_doc, 'paid', jsonb_build_array(jsonb_build_object('product_id', v_a, 'qty', 7),
                                                      jsonb_build_object('product_id', v_b, 'qty', 3)), 'paid');
  select id into v_ia from public.order_items where order_id = v_o and product_id = v_a;
  select id into v_ib from public.order_items where order_id = v_o and product_id = v_b;
  v_o2 := tests.order(v_doc, 'paid', jsonb_build_array(jsonb_build_object('product_id', v_b, 'qty', 1)), 'paid');
  select id into v_i2 from public.order_items where order_id = v_o2;
  v_ok := jsonb_build_array(jsonb_build_object('order_item_id', v_ia, 'lot_id', v_l1, 'qty', 5),
                            jsonb_build_object('order_item_id', v_ia, 'lot_id', v_l2, 'qty', 2),
                            jsonb_build_object('order_item_id', v_ib, 'lot_id', v_lb, 'qty', 3));

  perform tests.act_as(v_wh);
  -- cantidades: negativa SUMARÍA stock en la versión previa → ahora rechazo
  perform tests.throws(format('select public.surtir_pedido(gen_random_uuid(), %L, %L)', v_o,
    jsonb_build_array(jsonb_build_object('order_item_id', v_ia, 'lot_id', v_l2, 'qty', -5))), 'CANTIDAD_INVALIDA', 'asignación negativa rechazada');
  perform tests.throws(format('select public.surtir_pedido(gen_random_uuid(), %L, %L)', v_o,
    jsonb_build_array(jsonb_build_object('order_item_id', v_ia, 'lot_id', v_l2, 'qty', 0))), 'CANTIDAD_INVALIDA', 'asignación cero rechazada');
  perform tests.throws(format('select public.surtir_pedido(gen_random_uuid(), %L, %L)', v_o,
    jsonb_build_array(jsonb_build_object('order_item_id', v_ia, 'lot_id', v_lb, 'qty', 7), jsonb_build_object('order_item_id', v_ib, 'lot_id', v_lb, 'qty', 3))),
    'LOTE_DE_OTRO_PRODUCTO', 'lote de otro producto rechazado');
  perform tests.throws(format('select public.surtir_pedido(gen_random_uuid(), %L, %L)', v_o,
    jsonb_build_array(jsonb_build_object('order_item_id', v_ia, 'lot_id', v_lx, 'qty', 7), jsonb_build_object('order_item_id', v_ib, 'lot_id', v_lb, 'qty', 3))),
    'LOTE_CADUCADO', 'I-09: lote caducado no se surte');
  perform tests.throws(format('select public.surtir_pedido(gen_random_uuid(), %L, %L)', v_o,
    v_ok || jsonb_build_array(jsonb_build_object('order_item_id', v_i2, 'lot_id', v_lb, 'qty', 1))), 'ASIGNACION_INVALIDA', 'renglón de otro pedido rechazado');
  perform tests.throws(format('select public.surtir_pedido(gen_random_uuid(), %L, %L)', v_o,
    jsonb_build_array(jsonb_build_object('order_item_id', v_ia, 'lot_id', v_l1, 'qty', 5), jsonb_build_object('order_item_id', v_ib, 'lot_id', v_lb, 'qty', 3))),
    'ASIGNACION_INCOMPLETA', 'Σ asignado ≠ cantidad del renglón rechazado');
  perform tests.throws(format('select public.surtir_pedido(gen_random_uuid(), %L, %L)', v_o,
    jsonb_build_array(jsonb_build_object('order_item_id', v_ib, 'lot_id', v_lb, 'qty', 3))), 'ASIGNACION_INCOMPLETA', 'renglón sin asignar rechazado');
  perform tests.throws(format('select public.surtir_pedido(gen_random_uuid(), %L, %L)', v_o,
    jsonb_build_array(jsonb_build_object('order_item_id', v_ia, 'lot_id', v_l1, 'qty', 7), jsonb_build_object('order_item_id', v_ib, 'lot_id', v_lb, 'qty', 3))),
    'INVENTARIO_INSUFICIENTE', 'stock insuficiente rechazado');
  perform tests.eq(tests.qty(v_l1) || '/' || tests.qty(v_lb), '5/10', 'fallas previas: CERO efecto parcial');
  perform tests.throws(format('select public.surtir_pedido(gen_random_uuid(), %L, %L)', v_o, '[]'), 'ASIGNACIONES_REQUERIDAS', 'sin asignaciones rechazado');

  -- roles
  perform tests.act_as(v_pos);
  perform tests.throws(format('select public.surtir_pedido(gen_random_uuid(), %L, %L)', v_o, v_ok), 'NO_AUTORIZADO', 'pos no surte');
  perform tests.act_as(v_bill);
  perform tests.throws(format('select public.surtir_pedido(gen_random_uuid(), %L, %L)', v_o, v_ok), 'NO_AUTORIZADO', 'facturación no surte');
  perform tests.act_as(v_doc);
  perform tests.throws(format('select public.surtir_pedido(gen_random_uuid(), %L, %L)', v_o, v_ok), 'NO_AUTORIZADO', 'doctor no surte');

  -- surtido válido multi-lote
  perform tests.act_as(v_wh);
  v_r := public.surtir_pedido(v_op, v_o, v_ok);
  perform tests.eq(v_r ->> 'status', 'applied', 'surtido válido aplicado');
  perform tests.act_as_owner();
  perform tests.eq((select status from public.orders where id = v_o), 'packed', 'pedido queda empacado');
  perform tests.eq(tests.qty(v_l1) || '/' || tests.qty(v_l2) || '/' || tests.qty(v_lb), '0/8/7', 'descuento exacto por lote');
  perform tests.eq((select count(*)::int from public.inventory_movements where order_id = v_o and reason = 'surtido' and order_item_id is not null and op_id = v_op), 3,
    'cada salida lleva pedido + renglón + op_id');
  perform tests.eq((select lot_id from public.order_items where id = v_ia), v_l1, 'order_items.lot_id = primer lote (solo dato de pantalla)');
  -- idempotencia
  perform tests.act_as(v_wh);
  v_r := public.surtir_pedido(v_op, v_o, v_ok);
  perform tests.eq(v_r ->> 'status', 'already_applied', 'reintento mismo op_id ⇒ already_applied');
  perform tests.eq(tests.qty(v_l2), 8, 'reintento no descuenta dos veces');
  perform tests.throws(format('select public.surtir_pedido(gen_random_uuid(), %L, %L)', v_o, v_ok), 'PEDIDO_YA_SURTIDO', 'otro op sobre pedido empacado ⇒ rechazo (no doble descuento)');

  -- estados no surtibles
  perform tests.act_as_owner();
  v_e := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_b, 'qty', 1)));
  perform tests.act_as(v_wh);
  perform tests.throws(format('select public.surtir_pedido(gen_random_uuid(), %L, %L)', v_e, tests.alloc(v_e)), 'PEDIDO_NO_LIBERADO', 'W2: pedido sin cobro ni crédito no se surte');
  perform tests.act_as_owner();
  perform tests.credito(v_e);            -- crédito autorizado ⇒ liberado SIN tocar payment_status
  perform tests.act_as(v_wh);
  perform tests.eq((select payment_status from public.orders where id = v_e), 'pending', 'W2: el crédito NO falsifica payment_status');
  perform tests.eq((select status from public.orders where id = v_e), 'pending_payment', 'W2: el crédito NO falsifica orders.status');
  perform tests.eq(public.surtir_pedido(gen_random_uuid(), v_e, tests.alloc(v_e)) ->> 'status', 'applied', 'W2: se surte a crédito sin cobro');
  perform tests.act_as_owner();
  v_e := tests.order(v_doc, 'paid', '[]'::jsonb);
  perform tests.credito(v_e);            -- liberado, para que el corte sea por FALTA DE RENGLONES
  perform tests.act_as(v_wh);
  perform tests.throws(format('select public.surtir_pedido(gen_random_uuid(), %L, %L)', v_e, jsonb_build_array(jsonb_build_object('order_item_id', gen_random_uuid(), 'lot_id', v_lb, 'qty', 1))),
    'PEDIDO_SIN_RENGLONES', 'pedido sin renglones (caso QA-DHL-E2E) no puede quedar empacado');
  perform tests.act_as(v_admin);
  perform public.cancelar_pedido(tests.op(), v_o2, 'cliente desistió');
  perform tests.act_as(v_wh);
  perform tests.throws(format('select public.surtir_pedido(gen_random_uuid(), %L, %L)', v_o2, tests.alloc(v_o2)), 'PEDIDO_CANCELADO', 'pedido cancelado no se surte');
  perform tests.throws(format('select public.surtir_pedido(gen_random_uuid(), %L, %L)', gen_random_uuid(), v_ok), 'PEDIDO_INEXISTENTE', 'pedido inexistente');

  perform tests.act_as_owner();
  perform tests.ok(tests.kardex_ok(v_l1) and tests.kardex_ok(v_l2) and tests.kardex_ok(v_lb), 'I-04 tras surtido: existencia = Σ kardex');
  perform tests.eq(tests.conciliacion_errores(), 0, 'conciliación sin errores tras surtido');
end
$t$;
set constraints all immediate;
rollback;
