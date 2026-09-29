-- W1 · RC-08 Venta POS: asignaciones por renglón, caducidad, idempotencia por order_id
begin;
do $t$
declare
  v_pos uuid := tests.user('pos'); v_wh uuid := tests.user('warehouse'); v_doc uuid := tests.user('doctor');
  v_a uuid := tests.product(250); v_b uuid := tests.product(90);
  v_la uuid; v_la2 uuid; v_lb uuid; v_lx uuid; v_id uuid := gen_random_uuid(); v_lines jsonb; v_alloc jsonb; v_ok boolean; v_ex uuid;
begin
  v_la := tests.stock(v_a, 'PA-1', 3, current_date + 90);
  v_la2 := tests.stock(v_a, 'PA-2', 5, current_date + 180);
  v_lb := tests.stock(v_b, 'PB-1', 4, current_date + 90);
  v_lx := tests.stock(v_b, 'PB-X', 4, current_date + 30);
  update public.lots set expiry_date = public.hoy_local() - 2 where id = v_lx;
  v_lines := jsonb_build_array(jsonb_build_object('product_id', v_a, 'qty', 4, 'unit_price', 1, 'lot_id', null),
                               jsonb_build_object('product_id', v_b, 'qty', 2, 'unit_price', 1, 'lot_id', null));
  v_alloc := jsonb_build_array(jsonb_build_object('line_index', 0, 'lot_id', v_la, 'qty', 3),
                               jsonb_build_object('line_index', 0, 'lot_id', v_la2, 'qty', 1),
                               jsonb_build_object('line_index', 1, 'lot_id', v_lb, 'qty', 2));

  perform tests.act_as(v_wh);
  perform tests.throws(format('select public.vender_pos(%L, ''F-1'', 1, ''efectivo'', null, ''{}'', %L, %L)', v_id, v_lines, v_alloc), 'No autorizado', 'almacén no vende en POS');

  perform tests.act_as(v_pos);
  perform tests.throws(format('select public.vender_pos(gen_random_uuid(), ''F-1'', 1, ''efectivo'', null, ''{}'', %L, %L)', v_lines,
    jsonb_build_array(jsonb_build_object('line_index', 0, 'lot_id', v_la, 'qty', 4), jsonb_build_object('line_index', 1, 'lot_id', v_lb, 'qty', -2))),
    'CANTIDAD_INVALIDA', 'asignación negativa rechazada');
  perform tests.throws(format('select public.vender_pos(gen_random_uuid(), ''F-1'', 1, ''efectivo'', null, ''{}'', %L, %L)', v_lines,
    jsonb_build_array(jsonb_build_object('line_index', 0, 'lot_id', v_lb, 'qty', 4), jsonb_build_object('line_index', 1, 'lot_id', v_lb, 'qty', 2))),
    'LOTE_DE_OTRO_PRODUCTO', 'lote de otro producto rechazado');
  perform tests.throws(format('select public.vender_pos(gen_random_uuid(), ''F-1'', 1, ''efectivo'', null, ''{}'', %L, %L)', v_lines,
    jsonb_build_array(jsonb_build_object('line_index', 0, 'lot_id', v_la2, 'qty', 4), jsonb_build_object('line_index', 1, 'lot_id', v_lx, 'qty', 2))),
    'LOTE_CADUCADO', 'I-09: lote caducado no se vende');
  perform tests.throws(format('select public.vender_pos(gen_random_uuid(), ''F-1'', 1, ''efectivo'', null, ''{}'', %L, %L)', v_lines,
    jsonb_build_array(jsonb_build_object('line_index', 0, 'lot_id', v_la, 'qty', 3), jsonb_build_object('line_index', 1, 'lot_id', v_lb, 'qty', 2))),
    'ASIGNACION_INCOMPLETA', 'Σ por renglón ≠ cantidad vendida rechazado');
  perform tests.throws(format('select public.vender_pos(gen_random_uuid(), ''F-1'', 1, ''efectivo'', null, ''{}'', %L, %L)', v_lines,
    v_alloc || jsonb_build_array(jsonb_build_object('line_index', 5, 'lot_id', v_lb, 'qty', 1))),
    'ASIGNACION_INVALIDA', 'renglón inexistente rechazado');
  perform tests.throws(format('select public.vender_pos(gen_random_uuid(), ''F-1'', 1, ''efectivo'', null, ''{}'', %L, %L)', v_lines,
    jsonb_build_array(jsonb_build_object('line_index', 0, 'lot_id', v_la, 'qty', 4), jsonb_build_object('line_index', 1, 'lot_id', v_lb, 'qty', 2))),
    'insuficiente', 'stock insuficiente rechazado');
  perform tests.eq(tests.qty(v_la) || '/' || tests.qty(v_lb), '3/4', 'fallas previas: CERO efecto');

  -- venta válida (precio autoritativo del servidor, ignora p_total)
  v_ok := public.vender_pos(v_id, 'F-1', 1, 'efectivo', null, '{}', v_lines, v_alloc);
  perform tests.ok(v_ok, 'venta válida ⇒ true');
  perform tests.act_as_owner();
  perform tests.eq((select status || '/' || payment_status from public.orders where id = v_id), 'delivered/paid', 'pedido POS entregado (sin cambios de W2)');
  perform tests.eq((select total from public.orders where id = v_id), 4 * public.precio_de(v_a, null, 4) + 2 * public.precio_de(v_b, null, 2), 'total = precio del servidor (precio_de preservado)');
  perform tests.eq(tests.qty(v_la) || '/' || tests.qty(v_la2) || '/' || tests.qty(v_lb), '0/4/2', 'descuento exacto por lote');
  perform tests.eq((select count(*)::int from public.inventory_movements where order_id = v_id and reason = 'venta' and order_item_id is not null), 3, 'salidas ligadas a pedido + renglón');
  -- reintento idéntico ⇒ éxito sin duplicar (antes devolvía false y el operador re-vendía)
  perform tests.act_as(v_pos);
  v_ok := public.vender_pos(v_id, 'F-1', 1, 'efectivo', null, '{}', v_lines, v_alloc);
  perform tests.ok(v_ok, 'reintento con el mismo order_id ⇒ true (idempotente)');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.orders where id = v_id), 1, 'una sola venta');
  perform tests.eq(tests.qty(v_la2), 4, 'reintento no descuenta dos veces');
  perform tests.act_as(v_pos);
  perform tests.throws(format('select public.vender_pos(%L, ''F-1'', 1, ''tarjeta'', null, ''{}'', %L, %L)', v_id, v_lines, v_alloc),
    'OP_ID_REUTILIZADO', 'mismo order_id con otro contenido ⇒ rechazo');
  perform tests.act_as_owner();
  v_ex := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_b, 'qty', 1)));
  perform tests.act_as(v_pos);
  perform tests.throws(format('select public.vender_pos(%L, ''F-2'', 1, ''efectivo'', null, ''{}'', %L, %L)', v_ex,
    jsonb_build_array(jsonb_build_object('product_id', v_b, 'qty', 1)), jsonb_build_array(jsonb_build_object('line_index', 0, 'lot_id', v_lb, 'qty', 1))),
    'PEDIDO_EXISTENTE', 'id de otro pedido existente ⇒ rechazo');
  perform tests.throws(format('select public.vender_pos(gen_random_uuid(), ''F-3'', 1, ''efectivo'', null, ''{}'', ''[]'', ''[]'')'),
    'VENTA_SIN_RENGLONES', 'venta sin renglones rechazada');
  perform tests.act_as_owner();
  perform tests.ok(tests.kardex_ok(v_la) and tests.kardex_ok(v_la2) and tests.kardex_ok(v_lb), 'I-04 tras POS: existencia = Σ kardex');
  perform tests.eq(tests.conciliacion_errores(), 0, 'conciliación sin errores tras POS');
end
$t$;
set constraints all immediate;
rollback;
