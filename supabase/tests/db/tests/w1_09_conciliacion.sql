-- W1 · RC-20 Conciliación lote ↔ kardex tras un ciclo completo + detección de corrupción y alertas
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_wh uuid := tests.user('warehouse'); v_bill uuid := tests.user('billing');
  v_pos uuid := tests.user('pos'); v_doc uuid := tests.user('doctor');
  v_p uuid := tests.product(); v_q uuid := tests.product();
  v_rep uuid; v_r jsonb; v_lot uuid; v_lq uuid; v_o uuid; v_o2 uuid; v_ret uuid; v_c int; v_pre uuid;
begin
  -- Ciclo: compra parcial → completa → surtido → POS → cancelación empacado + reingreso → devolución + disposición → merma
  perform tests.act_as(v_bill);
  insert into public.replenishments (product_id, product_name, qty, unit_cost, kind) values (v_p, 'P', 30, 10, 'compra') returning id into v_rep;
  perform tests.act_as(v_wh);
  v_lot := (public.recibir_lote(p_op_id => tests.op(), p_product => v_p, p_lote => 'CC-1', p_caducidad => current_date + 300, p_cantidad => 20, p_replenishment_id => v_rep) ->> 'lot_id')::uuid;
  perform public.recibir_lote(p_op_id => tests.op(), p_product => v_p, p_lote => 'CC-1', p_caducidad => current_date + 300, p_cantidad => 10, p_replenishment_id => v_rep);
  v_lq := tests.stock(v_q, 'CQ-1', 10, current_date + 300);
  perform tests.act_as_owner();
  v_o := tests.packed_order(v_doc, jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 4)));
  v_o2 := tests.packed_order(v_doc, jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 3), jsonb_build_object('product_id', v_q, 'qty', 2)));
  perform tests.act_as(v_pos);
  perform public.vender_pos(gen_random_uuid(), 'POS-C', 1, 'efectivo', null, '{}',
    jsonb_build_array(jsonb_build_object('product_id', v_q, 'qty', 1)), jsonb_build_array(jsonb_build_object('line_index', 0, 'lot_id', v_lq, 'qty', 1)));
  perform tests.act_as(v_admin);
  v_ret := (public.cancelar_pedido(tests.op(), v_o2, 'cancelado') ->> 'return_id')::uuid;
  perform tests.eq(tests.conciliacion_errores(), 0, 'conciliación sin errores con reingreso PENDIENTE');
  perform tests.eq((select count(*)::int from public.conciliar_inventario() where check_id = 'C6_pendiente_fisico'), 2, 'C6: pendientes físicos visibles (stock físico esperado)');
  perform tests.act_as(v_wh);
  perform public.confirmar_reingreso(tests.op(), v_ret, (select jsonb_agg(jsonb_build_object('line_id', id, 'estado', 'ok')) from public.stock_return_lines where return_id = v_ret));
  perform tests.act_as_owner();
  perform tests.force_status(v_o, 'delivered');
  perform tests.act_as(v_wh);
  v_r := public.recibir_devolucion(tests.op(), v_o, jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', 2, 'inspection', 'ok')));
  perform tests.act_as(v_admin);
  perform public.disponer_devolucion(tests.op(), (select jsonb_agg(jsonb_build_object('line_id', id, 'disposition', 'vendible')) from public.stock_return_lines where return_id = (v_r ->> 'return_id')::uuid));
  perform tests.act_as(v_wh);
  perform public.ajustar_lote(tests.op(), v_lot, -1, 'merma', 'roto');
  perform tests.act_as_owner();

  perform tests.eq(tests.qty(v_lot), 30 - 4 - 3 + 3 + 2 - 1, 'existencia final esperada del ciclo');
  perform tests.eq(tests.conciliacion_errores(), 0, 'RC-20: ciclo completo ⇒ 0 errores de conciliación');
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*)::int from public.conciliar_inventario() where check_id = 'C6_pendiente_fisico'), 0, 'sin pendientes tras confirmar/disponer');

  -- La conciliación DETECTA corrupción (simulada como dueño, fuera de los comandos)
  perform tests.act_as_owner();
  update public.lots set quantity = quantity + 7 where id = v_lot;
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*)::int from public.conciliar_inventario() where check_id = 'C1_lote_kardex' and entidad_id = v_lot), 1, 'C1 detecta existencia ≠ Σ kardex');
  perform tests.act_as_owner();
  update public.lots set quantity = quantity - 7 where id = v_lot;
  perform tests.eq(tests.conciliacion_errores(), 0, 'corrección revertida ⇒ 0 errores');
  perform tests.throws(format('update public.replenishments set received_qty = 29, status = ''parcial'' where id = %L', v_rep),
    'REABASTECIMIENTO_SOLO_POR_COMANDO', 'la guarda de compras frena incluso al dueño fuera de un comando');
end
$t$;
set constraints all immediate;
rollback;

begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_doc uuid := tests.user('doctor'); v_wh uuid := tests.user('warehouse');
  v_p uuid := tests.product(); v_o uuid; v_l uuid;
begin
  -- C7 (alerta W2): llega un pago DESPUÉS de cancelar un pedido que no tenía evidencia de pago
  v_o := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.act_as(v_doc);
  perform public.cancelar_pedido(tests.op(), v_o);
  perform tests.act_as_service();
  update public.orders set payment_status = 'paid' where id = v_o and payment_status = 'pending';   -- lo que haría stripe-webhook hoy
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*)::int from public.conciliar_inventario() where check_id = 'C7_pago_tras_cancelar' and entidad_id = v_o), 1,
    'C7: pago llegado tras cancelar queda visible para Dirección (solución estructural en W2)');
  -- C8: caducado con existencia
  v_l := tests.stock(v_p, 'C8-1', 3, current_date + 30);
  perform tests.act_as_owner();
  update public.lots set expiry_date = public.hoy_local() - 1 where id = v_l;
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*)::int from public.conciliar_inventario() where check_id = 'C8_caducado_en_stock' and entidad_id = v_l), 1, 'C8: caducado con existencia visible');
  perform tests.eq((select count(*)::int from public.conciliar_inventario() where severidad = 'error'), 0, 'C7/C8 no son errores de inventario');
  perform tests.act_as(v_wh);
  perform tests.throws('select * from public.conciliar_inventario()', 'NO_AUTORIZADO', 'solo Dirección concilia');
  perform tests.act_as_owner();
end
$t$;
set constraints all immediate;
rollback;
