-- W1 · D-03 Cancelación atómica + idempotente + reingreso pendiente; fronteras A (guía) y B (dinero)
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_wh uuid := tests.user('warehouse'); v_pk uuid := tests.user('packing');
  v_bill uuid := tests.user('billing'); v_pos uuid := tests.user('pos'); v_doc uuid := tests.user('doctor'); v_doc2 uuid := tests.user('doctor');
  v_p uuid := tests.product(); v_q uuid := tests.product();
  v_l1 uuid; v_l2 uuid; v_lq uuid; v_o uuid; v_r jsonb; v_r2 jsonb; v_ret uuid; v_lines jsonb; v_op uuid; v_att uuid; v_n int;
  v_it jsonb;
begin
  v_l1 := tests.stock(v_p, 'C-1', 3, current_date + 60);
  v_l2 := tests.stock(v_p, 'C-2', 50, current_date + 400);
  v_lq := tests.stock(v_q, 'Q-1', 50, current_date + 400);
  v_it := jsonb_build_array(jsonb_build_object('product_id', v_q, 'qty', 1));

  -- ANTES DE PAGAR ------------------------------------------------------------
  v_o := tests.order(v_doc, 'pending_payment', v_it);
  perform tests.act_as(v_doc2);
  perform tests.throws(format('select public.cancelar_pedido(gen_random_uuid(), %L)', v_o), 'PEDIDO_INEXISTENTE', 'doctor no cancela pedido ajeno');
  perform tests.act_as(v_doc);
  v_r := public.cancelar_pedido(tests.op(), v_o);
  perform tests.eq(v_r ->> 'status' || '/' || (v_r ->> 'refund_review'), 'applied/no_aplica', 'doctor cancela su pedido sin pagar (sin motivo)');
  perform tests.act_as_owner();
  perform tests.eq((select status from public.orders where id = v_o), 'cancelled', 'pedido cancelado');
  perform tests.act_as(v_doc);
  v_r := public.cancelar_pedido(tests.op(), v_o);
  perform tests.eq(v_r ->> 'status', 'already_cancelled', 'repetir cancelación ⇒ CERO efecto adicional');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.order_cancellations where order_id = v_o), 1, 'una sola cancelación registrada');

  v_o := tests.order(v_doc, 'pending_payment', v_it, 'pending', '{"transfer":{"reported":true,"review":{"status":"pending"}}}');
  perform tests.act_as(v_doc);
  perform tests.throws(format('select public.cancelar_pedido(gen_random_uuid(), %L)', v_o), 'CANCELACION_REQUIERE_DIRECCION', 'frontera B: transferencia en revisión ⇒ doctor no cancela');
  perform tests.act_as(v_bill);
  perform tests.throws(format('select public.cancelar_pedido(gen_random_uuid(), %L, ''x'')', v_o), 'CANCELACION_REQUIERE_DIRECCION', 'frontera B: facturación tampoco');
  perform tests.act_as(v_admin);
  v_r := public.cancelar_pedido(tests.op(), v_o, 'cliente pidió cancelar tras transferir');
  perform tests.eq(v_r ->> 'refund_review' || '/' || (v_r ->> 'money_signal'), 'pendiente_revision/transferencia_en_revision', 'frontera B: Dirección cancela + REEMBOLSO PENDIENTE DE REVISIÓN');

  v_o := tests.order(v_doc, 'pending_payment', v_it);
  perform tests.act_as(v_bill);
  perform tests.throws(format('select public.cancelar_pedido(gen_random_uuid(), %L)', v_o), 'MOTIVO_REQUERIDO', 'staff: motivo obligatorio');
  v_r := public.cancelar_pedido(tests.op(), v_o, 'duplicado');
  perform tests.eq(v_r ->> 'status', 'applied', 'staff autorizado (facturación) cancela sin pagar con motivo');
  perform tests.act_as(v_pos);
  perform tests.throws(format('select public.cancelar_pedido(gen_random_uuid(), %L, ''x'')', v_o), 'NO_AUTORIZADO', 'pos no cancela');
  perform tests.act_as(v_wh);
  perform tests.throws(format('select public.cancelar_pedido(gen_random_uuid(), %L, ''x'')', v_o), 'NO_AUTORIZADO', 'almacén no cancela');

  -- PAGADO / PICKING -----------------------------------------------------------
  v_o := tests.order(v_doc, 'paid', v_it, 'paid');
  perform tests.act_as(v_bill);
  perform tests.throws(format('select public.cancelar_pedido(gen_random_uuid(), %L, ''x'')', v_o), 'CANCELACION_REQUIERE_DIRECCION', 'pagado: solo Dirección');
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.cancelar_pedido(gen_random_uuid(), %L)', v_o), 'MOTIVO_REQUERIDO', 'pagado: motivo obligatorio');
  v_r := public.cancelar_pedido(tests.op(), v_o, 'sin existencia comprometida');
  perform tests.eq(v_r ->> 'refund_review', 'pendiente_revision', 'pagado ⇒ reembolso pendiente de revisión (no se finge devolución)');
  perform tests.act_as_owner();
  perform tests.eq((select payment_status from public.orders where id = v_o), 'paid', 'W1 no toca payment_status (verdad financiera es W2)');
  perform tests.eq((select count(*)::int from public.inventory_movements where order_id = v_o), 0, 'pagado: sin efecto de inventario');

  v_o := tests.order(v_doc, 'picking', v_it, 'paid');
  perform tests.act_as(v_admin);
  v_r := public.cancelar_pedido(tests.op(), v_o, 'cancelado en picking');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.inventory_movements where order_id = v_o), 0, 'picking: sin entrada artificial de stock');
  perform tests.eq(v_r ->> 'return_id', null, 'picking: sin reingreso pendiente');

  -- EMPACADO: reingreso pendiente con confirmación física de Almacén ----------------
  v_o := tests.packed_order(v_doc, jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 5)));   -- FEFO: 3 de C-1 + 2 de C-2
  perform tests.eq(tests.qty(v_l1) || '/' || tests.qty(v_l2), '0/48', 'empacado consumió 2 lotes');
  perform tests.act_as(v_bill);
  perform tests.throws(format('select public.cancelar_pedido(gen_random_uuid(), %L, ''x'')', v_o), 'CANCELACION_REQUIERE_DIRECCION', 'empacado: solo Dirección');
  perform tests.act_as(v_admin);
  v_op := tests.op();
  v_r := public.cancelar_pedido(v_op, v_o, 'cliente canceló antes de salir');
  v_ret := (v_r ->> 'return_id')::uuid;
  perform tests.ok((v_r ->> 'reingreso_pendiente')::boolean, 'empacado ⇒ reingreso pendiente');
  perform tests.eq(tests.qty(v_l1) || '/' || tests.qty(v_l2), '0/48', 'el stock NO reaparece al cancelar (espera confirmación física)');
  perform tests.eq((select count(*)::int || ':' || sum(qty) from public.stock_return_lines where return_id = v_ret), '2:5', 'renglones = lotes realmente consumidos (desde kardex)');
  v_r2 := public.cancelar_pedido(v_op, v_o, 'cliente canceló antes de salir');
  perform tests.eq(v_r2 ->> 'status', 'already_applied', 'mismo op_id ⇒ already_applied');
  perform tests.eq(public.cancelar_pedido(tests.op(), v_o, 'otra vez') ->> 'status', 'already_cancelled', 'otro op ⇒ already_cancelled, sin efecto');

  select jsonb_agg(jsonb_build_object('line_id', id, 'estado', 'ok')) into v_lines from public.stock_return_lines where return_id = v_ret;
  perform tests.act_as(v_bill);
  perform tests.throws(format('select public.confirmar_reingreso(gen_random_uuid(), %L, %L)', v_ret, v_lines), 'NO_AUTORIZADO', 'facturación no confirma reingreso físico');
  perform tests.act_as(v_wh);
  perform tests.throws(format('select public.confirmar_reingreso(gen_random_uuid(), %L, %L)', v_ret, jsonb_build_array(v_lines -> 0)), 'REINGRESO_INCOMPLETO', 'confirmación parcial rechazada');
  perform tests.throws(format('select public.confirmar_reingreso(gen_random_uuid(), %L, %L)', v_ret, v_lines || (v_lines -> 0)), 'REINGRESO_INCOMPLETO', 'renglón duplicado rechazado');
  v_op := tests.op();
  v_r := public.confirmar_reingreso(v_op, v_ret, v_lines);
  perform tests.eq((v_r ->> 'cantidad_reingresada')::int, 5, 'Almacén confirma: reingreso de 5');
  perform tests.eq(tests.qty(v_l1) || '/' || tests.qty(v_l2), '3/50', 'regresa a los MISMOS lotes consumidos');
  v_r := public.confirmar_reingreso(v_op, v_ret, v_lines);
  perform tests.eq(v_r ->> 'status', 'already_applied', 'reintento de confirmación ⇒ sin doble reingreso');
  perform tests.throws(format('select public.confirmar_reingreso(gen_random_uuid(), %L, %L)', v_ret, v_lines), 'REINGRESO_YA_CONFIRMADO', 'otra confirmación ⇒ rechazo');
  perform tests.eq(tests.qty(v_l2), 50, 'reingreso exactamente una vez');
  perform tests.act_as_owner();
  perform tests.ok(tests.kardex_ok(v_l1) and tests.kardex_ok(v_l2), 'I-04 tras cancelación: existencia = Σ kardex');

  -- EMPACADO con daño y con lote caducado ⇒ disposición de Dirección
  v_o := tests.packed_order(v_doc, jsonb_build_array(jsonb_build_object('product_id', v_q, 'qty', 4)));
  perform tests.act_as(v_admin);
  v_ret := (public.cancelar_pedido(tests.op(), v_o, 'dañado en empaque') ->> 'return_id')::uuid;
  select jsonb_agg(jsonb_build_object('line_id', id, 'estado', 'dañado')) into v_lines from public.stock_return_lines where return_id = v_ret;
  perform tests.act_as(v_pk);
  v_r := public.confirmar_reingreso(tests.op(), v_ret, v_lines);
  perform tests.eq((v_r ->> 'pendientes_direccion')::int, 1, 'dañado ⇒ queda para Dirección');
  perform tests.eq(tests.qty(v_lq), 46, 'dañado no reingresa');
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.disponer_devolucion(gen_random_uuid(), %L)',
    (select jsonb_agg(jsonb_build_object('line_id', id, 'disposition', 'vendible')) from public.stock_return_lines where return_id = v_ret)),
    'VENDIBLE_NO_PERMITIDO', 'dañado no puede ir a vendible');
  v_r := public.disponer_devolucion(tests.op(), (select jsonb_agg(jsonb_build_object('line_id', id, 'disposition', 'merma')) from public.stock_return_lines where return_id = v_ret));
  perform tests.eq((v_r ->> 'merma')::int, 1, 'Dirección dispone merma');
  perform tests.eq(tests.qty(v_lq), 46, 'merma: sin movimiento de stock');

  v_o := tests.packed_order(v_doc, jsonb_build_array(jsonb_build_object('product_id', v_q, 'qty', 2)));
  perform tests.act_as(v_admin);
  v_ret := (public.cancelar_pedido(tests.op(), v_o, 'tardó demasiado') ->> 'return_id')::uuid;
  perform tests.act_as_owner();
  update public.lots set expiry_date = public.hoy_local() - 1 where id = v_lq;   -- caducó entre empaque y reacomodo
  select jsonb_agg(jsonb_build_object('line_id', id, 'estado', 'ok')) into v_lines from public.stock_return_lines where return_id = v_ret;
  perform tests.act_as(v_wh);
  v_r := public.confirmar_reingreso(tests.op(), v_ret, v_lines);
  perform tests.eq((select inspection from public.stock_return_lines where return_id = v_ret), 'caducado', 'lote caducado ⇒ inspección forzada a caducado');
  perform tests.eq(tests.qty(v_lq), 44, 'caducado no vuelve a stock vendible');
  perform tests.act_as_owner();
  update public.lots set expiry_date = current_date + 400 where id = v_lq;

  -- FRONTERA A: guía activa bloquea; anulación manual registrada por Dirección
  v_o := tests.packed_order(v_doc, jsonb_build_array(jsonb_build_object('product_id', v_q, 'qty', 1)));
  insert into public.shipping_attempts (order_id, idempotency_key, status) values (v_o, 'k1', 'succeeded') returning id into v_att;
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.cancelar_pedido(gen_random_uuid(), %L, ''x'')', v_o), 'GUIA_ACTIVA', 'guía creada bloquea la cancelación');
  perform tests.act_as(v_wh);
  perform tests.throws(format('select public.anular_guia_manual(gen_random_uuid(), %L, ''PORTAL-123'')', v_att), 'NO_AUTORIZADO', 'almacén no registra anulación de guía');
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.anular_guia_manual(gen_random_uuid(), %L, '' '')', v_att), 'REFERENCIA_REQUERIDA', 'anulación manual exige referencia');
  v_r := public.anular_guia_manual(tests.op(), v_att, 'PORTAL-DHL-123', 'captura.png');
  perform tests.act_as_owner();
  perform tests.eq((select status from public.shipping_attempts where id = v_att), 'voided_manual', 'guía queda anulada manualmente (con referencia)');
  perform tests.act_as(v_admin);
  v_r := public.cancelar_pedido(tests.op(), v_o, 'guía anulada en portal');
  perform tests.eq(v_r ->> 'status', 'applied', 'tras anular la guía, Dirección cancela');
  perform tests.act_as_service();
  perform tests.throws(format('insert into public.shipping_attempts (order_id, idempotency_key, status) values (%L, ''k2'', ''pending'')', v_o),
    'PEDIDO_CANCELADO', 'no se puede crear guía para un pedido cancelado (edge sin cambios)');
  perform tests.act_as_owner();

  v_o := tests.packed_order(v_doc, jsonb_build_array(jsonb_build_object('product_id', v_q, 'qty', 1)));
  insert into public.shipping_attempts (order_id, idempotency_key, status) values (v_o, 'k3', 'unknown_requires_reconciliation') returning id into v_att;
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.cancelar_pedido(gen_random_uuid(), %L, ''x'')', v_o), 'reconciliación', 'unknown_requires_reconciliation sigue bloqueando');
  perform tests.throws(format('select public.anular_guia_manual(gen_random_uuid(), %L, ''PORTAL-9'')', v_att), 'GUIA_EN_RECONCILIACION', 'una guía desconocida NO se anula manualmente');
  perform tests.act_as_owner();
  v_o := tests.packed_order(v_doc, jsonb_build_array(jsonb_build_object('product_id', v_q, 'qty', 1)));
  insert into public.shipping_attempts (order_id, idempotency_key, status) values (v_o, 'k4', 'pending');
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.cancelar_pedido(gen_random_uuid(), %L, ''x'')', v_o), 'GUIA_ACTIVA', 'guía en proceso bloquea');
  perform tests.act_as_owner();
  v_o := tests.packed_order(v_doc, jsonb_build_array(jsonb_build_object('product_id', v_q, 'qty', 1)));
  insert into public.shipments (order_id, dispatched_at) values (v_o, now());
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.cancelar_pedido(gen_random_uuid(), %L, ''x'')', v_o), 'USAR_DEVOLUCION', 'ya salió con chofer ⇒ devolución');

  -- Guarda de guía: solo pedidos EMPACADOS (flujo real: Empaque › Cola → edge create_shipment)
  perform tests.act_as_owner();
  v_o := tests.order(v_doc, 'paid', v_it, 'paid');
  perform tests.act_as_service();
  perform tests.throws(format('insert into public.shipping_attempts (order_id, idempotency_key, status) values (%L, ''g1'', ''pending'')', v_o),
    'PEDIDO_NO_EMPACADO', 'guía para pedido pagado sin surtir ⇒ rechazo');
  perform tests.act_as_owner();
  perform tests.force_status(v_o, 'picking');
  perform tests.act_as_service();
  perform tests.throws(format('insert into public.shipping_attempts (order_id, idempotency_key, status) values (%L, ''g2'', ''pending'')', v_o),
    'PEDIDO_NO_EMPACADO', 'guía para pedido en picking ⇒ rechazo');
  perform tests.throws(format('insert into public.shipping_attempts (order_id, idempotency_key, status) values (%L, ''g3'', ''pending'')', gen_random_uuid()),
    'PEDIDO_NO_EMPACADO', 'guía para pedido inexistente ⇒ rechazo');
  perform tests.act_as_owner();
  v_o := tests.packed_order(v_doc, jsonb_build_array(jsonb_build_object('product_id', v_q, 'qty', 1)));
  perform tests.force_status(v_o, 'shipped');
  perform tests.act_as_service();
  perform tests.throws(format('insert into public.shipping_attempts (order_id, idempotency_key, status) values (%L, ''g4'', ''pending'')', v_o),
    'PEDIDO_NO_EMPACADO', 'guía para pedido ya enviado ⇒ rechazo');
  perform tests.act_as_owner();
  perform tests.force_status(v_o, 'delivered');
  perform tests.act_as_service();
  perform tests.throws(format('insert into public.shipping_attempts (order_id, idempotency_key, status) values (%L, ''g5'', ''pending'')', v_o),
    'PEDIDO_NO_EMPACADO', 'guía para pedido entregado ⇒ rechazo');
  perform tests.act_as_owner();
  v_o := tests.packed_order(v_doc, jsonb_build_array(jsonb_build_object('product_id', v_q, 'qty', 1)));
  perform tests.act_as_service();
  insert into public.shipping_attempts (order_id, idempotency_key, status) values (v_o, 'g6', 'pending') returning id into v_att;
  update public.shipping_attempts set status = 'succeeded', tracking_number = 'TRK-1' where id = v_att;   -- finalize (UPDATE) no pasa por la guarda
  perform tests.ok(true, 'pedido empacado: la edge crea y finaliza la guía como hoy');
  perform tests.act_as_owner();

  -- ENVIADO / ENTREGADO / POS ⇒ devolución, no cancelación
  perform tests.act_as_owner();
  v_o := tests.packed_order(v_doc, jsonb_build_array(jsonb_build_object('product_id', v_q, 'qty', 1)));
  perform tests.force_status(v_o, 'shipped');
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.cancelar_pedido(gen_random_uuid(), %L, ''x'')', v_o), 'USAR_DEVOLUCION', 'enviado ⇒ no se cancela');
  perform tests.act_as_owner();
  perform tests.force_status(v_o, 'delivered');
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.cancelar_pedido(gen_random_uuid(), %L, ''x'')', v_o), 'USAR_DEVOLUCION', 'entregado ⇒ no se cancela');

  perform tests.act_as_owner();
  perform tests.eq((select current_setting('app.trusted', true)), 'off', 'app.trusted queda apagado tras los comandos');
  perform tests.eq(tests.conciliacion_errores(), 0, 'conciliación sin errores tras cancelaciones');
end
$t$;
set constraints all immediate;
rollback;
