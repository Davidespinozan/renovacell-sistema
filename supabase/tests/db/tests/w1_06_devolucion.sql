-- W1 · D-02 Devolución en dos pasos: Almacén recibe/inspecciona → Dirección dispone; tope ≤ surtido
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_wh uuid := tests.user('warehouse'); v_bill uuid := tests.user('billing');
  v_pos uuid := tests.user('pos'); v_doc uuid := tests.user('doctor');
  v_p uuid := tests.product(); v_q uuid := tests.product();
  v_l1 uuid; v_l2 uuid; v_lq uuid; v_o uuid; v_pk uuid; v_r jsonb; v_ret uuid; v_op uuid; v_line_ok uuid; v_line_bad uuid;
  v_pos_o uuid := gen_random_uuid(); v_lx uuid;
begin
  v_l1 := tests.stock(v_p, 'D-1', 4, current_date + 60);
  v_l2 := tests.stock(v_p, 'D-2', 20, current_date + 300);
  v_lq := tests.stock(v_q, 'DQ-1', 10, current_date + 300);
  v_o := tests.packed_order(v_doc, jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 6)));   -- 4 de D-1 + 2 de D-2
  v_pk := tests.packed_order(v_doc, jsonb_build_array(jsonb_build_object('product_id', v_q, 'qty', 1)));

  -- Sin pedido / estado inadecuado / rol
  perform tests.act_as(v_wh);
  perform tests.throws(format('select public.recibir_devolucion(gen_random_uuid(), %L, %L)', gen_random_uuid(),
    jsonb_build_array(jsonb_build_object('lot_id', v_l1, 'qty', 1, 'inspection', 'ok'))), 'PEDIDO_INEXISTENTE', 'no hay devolución sin pedido previo');
  perform tests.throws(format('select public.recibir_devolucion(gen_random_uuid(), %L, %L)', v_pk,
    jsonb_build_array(jsonb_build_object('lot_id', v_lq, 'qty', 1, 'inspection', 'ok'))), 'cancélalo', 'empacado sin salir ⇒ cancelación, no devolución');
  perform tests.act_as_owner();
  perform tests.force_status(v_o, 'delivered');
  perform tests.act_as(v_bill);
  perform tests.throws(format('select public.recibir_devolucion(gen_random_uuid(), %L, %L)', v_o,
    jsonb_build_array(jsonb_build_object('lot_id', v_l1, 'qty', 1, 'inspection', 'ok'))), 'NO_AUTORIZADO', 'facturación no registra la recepción física');
  perform tests.act_as(v_pos);
  perform tests.throws(format('select public.recibir_devolucion(gen_random_uuid(), %L, %L)', v_o,
    jsonb_build_array(jsonb_build_object('lot_id', v_l1, 'qty', 1, 'inspection', 'ok'))), 'NO_AUTORIZADO', 'POS no registra la recepción física (Almacén)');

  -- Tope por pedido + lote, desde el kardex
  perform tests.act_as(v_wh);
  perform tests.throws(format('select public.recibir_devolucion(gen_random_uuid(), %L, %L)', v_o,
    jsonb_build_array(jsonb_build_object('lot_id', v_l2, 'qty', 3, 'inspection', 'ok'))), 'DEVOLUCION_EXCEDE_SURTIDO', 'I-06: no se devuelve más de lo surtido del lote');
  perform tests.throws(format('select public.recibir_devolucion(gen_random_uuid(), %L, %L)', v_o,
    jsonb_build_array(jsonb_build_object('lot_id', v_lq, 'qty', 1, 'inspection', 'ok'))), 'LOTE_NO_SURTIDO_EN_PEDIDO', 'lote que no salió en el pedido ⇒ rechazo');
  perform tests.throws(format('select public.recibir_devolucion(gen_random_uuid(), %L, %L)', v_o,
    jsonb_build_array(jsonb_build_object('lot_id', v_l1, 'qty', 1))), 'INSPECCION_REQUERIDA', 'inspección obligatoria al recibir');
  perform tests.throws(format('select public.recibir_devolucion(gen_random_uuid(), %L, %L)', v_o,
    jsonb_build_array(jsonb_build_object('lot_id', v_l1, 'qty', 0, 'inspection', 'ok'))), 'CANTIDAD_INVALIDA', 'cantidad cero rechazada');

  v_op := tests.op();
  v_r := public.recibir_devolucion(v_op, v_o, jsonb_build_array(
           jsonb_build_object('lot_id', v_l1, 'qty', 2, 'inspection', 'ok'),
           jsonb_build_object('lot_id', v_l2, 'qty', 1, 'inspection', 'dañado', 'notes', 'caja golpeada')), 'cliente devolvió 3');
  v_ret := (v_r ->> 'return_id')::uuid;
  perform tests.eq(tests.qty(v_l1) || '/' || tests.qty(v_l2), '0/18', 'recibir NO mueve stock (espera disposición)');
  perform tests.eq(public.recibir_devolucion(v_op, v_o, jsonb_build_array(
           jsonb_build_object('lot_id', v_l1, 'qty', 2, 'inspection', 'ok'),
           jsonb_build_object('lot_id', v_l2, 'qty', 1, 'inspection', 'dañado', 'notes', 'caja golpeada')), 'cliente devolvió 3') ->> 'status',
    'already_applied', 'reintento ⇒ sin duplicar la devolución');
  -- devoluciones previas (aunque estén pendientes) cuentan para el tope
  perform tests.throws(format('select public.recibir_devolucion(gen_random_uuid(), %L, %L)', v_o,
    jsonb_build_array(jsonb_build_object('lot_id', v_l1, 'qty', 3, 'inspection', 'ok'))), 'DEVOLUCION_EXCEDE_SURTIDO', 'el tope incluye devoluciones previas');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.refunds where order_id = v_o), 0, 'devolución física SIN reembolso es válida');
  select id into v_line_ok from public.stock_return_lines where return_id = v_ret and lot_id = v_l1;
  select id into v_line_bad from public.stock_return_lines where return_id = v_ret and lot_id = v_l2;

  -- Disposición: solo Dirección
  perform tests.act_as(v_wh);
  perform tests.throws(format('select public.disponer_devolucion(gen_random_uuid(), %L)',
    jsonb_build_array(jsonb_build_object('line_id', v_line_ok, 'disposition', 'vendible'))), 'NO_AUTORIZADO', 'almacén no dispone el destino');
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.disponer_devolucion(gen_random_uuid(), %L)',
    jsonb_build_array(jsonb_build_object('line_id', v_line_bad, 'disposition', 'vendible'))), 'VENDIBLE_NO_PERMITIDO', 'dañado no regresa a vendible');
  perform tests.throws(format('select public.disponer_devolucion(gen_random_uuid(), %L)',
    jsonb_build_array(jsonb_build_object('line_id', v_line_ok, 'disposition', 'vendible'), jsonb_build_object('line_id', v_line_ok, 'disposition', 'vendible'))),
    'RENGLON_DUPLICADO', 'renglón duplicado rechazado (evita doble reingreso)');
  v_op := tests.op();
  v_r := public.disponer_devolucion(v_op, jsonb_build_array(jsonb_build_object('line_id', v_line_ok, 'disposition', 'vendible'),
                                                           jsonb_build_object('line_id', v_line_bad, 'disposition', 'merma')));
  perform tests.eq((v_r ->> 'vendible')::int || '/' || (v_r ->> 'merma')::int, '1/1', 'Dirección dispone vendible + merma');
  perform tests.eq(tests.qty(v_l1) || '/' || tests.qty(v_l2), '2/18', 'vendible reingresa al lote; merma no mueve stock');
  perform tests.eq(public.disponer_devolucion(v_op, jsonb_build_array(jsonb_build_object('line_id', v_line_ok, 'disposition', 'vendible'),
                                                           jsonb_build_object('line_id', v_line_bad, 'disposition', 'merma'))) ->> 'status',
    'already_applied', 'reintento de disposición ⇒ sin doble reingreso');
  perform tests.throws(format('select public.disponer_devolucion(gen_random_uuid(), %L)',
    jsonb_build_array(jsonb_build_object('line_id', v_line_ok, 'disposition', 'merma'))), 'LINEA_YA_DISPUESTA', 'una línea se dispone una sola vez');
  perform tests.eq(tests.qty(v_l1), 2, 'reingreso exactamente una vez');

  -- Caducado al recibir ⇒ inspección caducado ⇒ solo merma
  perform tests.act_as_owner();
  update public.lots set expiry_date = public.hoy_local() - 3 where id = v_l2;
  perform tests.act_as(v_wh);
  v_r := public.recibir_devolucion(tests.op(), v_o, jsonb_build_array(jsonb_build_object('lot_id', v_l2, 'qty', 1, 'inspection', 'ok')));
  perform tests.act_as_owner();
  perform tests.eq((select inspection from public.stock_return_lines where return_id = (v_r ->> 'return_id')::uuid), 'caducado', 'devuelto caducado ⇒ clasificado caducado');
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.disponer_devolucion(gen_random_uuid(), %L)',
    (select jsonb_agg(jsonb_build_object('line_id', id, 'disposition', 'vendible')) from public.stock_return_lines where return_id = (v_r ->> 'return_id')::uuid)),
    'VENDIBLE_NO_PERMITIDO', 'caducado no regresa a vendible');
  perform tests.act_as_owner();
  update public.lots set expiry_date = current_date + 300 where id = v_l2;

  -- El reembolso (autorizar_reembolso) YA NO mueve inventario
  perform tests.act_as(v_bill);
  v_r := public.autorizar_reembolso(tests.op(), v_o, 'devolucion', 10, 'reembolso parcial', null, 'Caja');
  perform tests.act_as_owner();
  perform tests.eq(tests.qty(v_l2), 18, 'reembolso con items NO crea inventario (P0 cerrado)');
  perform tests.eq((select count(*)::int from public.refunds where order_id = v_o), 1, 'el reembolso sí se registra (W2 intacto)');

  -- Devolución de venta POS entregada
  v_lx := tests.stock(v_q, 'DQ-2', 5, current_date + 90);
  perform tests.act_as(tests.user('pos'));
  perform public.vender_pos(v_pos_o, 'POS-9', 1, 'efectivo', null, '{}',
    jsonb_build_array(jsonb_build_object('product_id', v_q, 'qty', 2)), jsonb_build_array(jsonb_build_object('line_index', 0, 'lot_id', v_lx, 'qty', 2)));
  perform tests.act_as(v_wh);
  v_r := public.recibir_devolucion(tests.op(), v_pos_o, jsonb_build_array(jsonb_build_object('lot_id', v_lx, 'qty', 2, 'inspection', 'ok')));
  perform tests.eq(v_r ->> 'status', 'applied', 'venta POS entregada ⇒ se devuelve por el flujo de devolución');
  perform tests.throws(format('select public.recibir_devolucion(gen_random_uuid(), %L, %L)', v_pos_o,
    jsonb_build_array(jsonb_build_object('lot_id', v_lx, 'qty', 1, 'inspection', 'ok'))), 'DEVOLUCION_EXCEDE_SURTIDO', 'POS: tope ≤ vendido');

  perform tests.act_as_owner();
  perform tests.ok(tests.kardex_ok(v_l1) and tests.kardex_ok(v_l2) and tests.kardex_ok(v_lx), 'I-04 tras devoluciones: existencia = Σ kardex');
  perform tests.eq(tests.conciliacion_errores(), 0, 'conciliación sin errores tras devoluciones');
end
$t$;
set constraints all immediate;
rollback;
