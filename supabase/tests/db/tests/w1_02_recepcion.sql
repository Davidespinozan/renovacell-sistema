-- W1 · D-04 Recepción parcial, acumulada, idempotente; excedente; cierre; correcciones; carga inicial
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_wh uuid := tests.user('warehouse'); v_pk uuid := tests.user('packing');
  v_bill uuid := tests.user('billing');
  v_p uuid := tests.product(); v_p2 uuid := tests.product(); v_exp date := current_date + 300;
  v_oc uuid; v_oc2 uuid; v_oc3 uuid; v_r jsonb; v_r2 jsonb; v_op uuid := tests.op(); v_lot uuid; v_rc uuid; v_q int;
  v_sku text;
begin
  -- Alta de orden (billing): el estado inicial se FUERZA aunque el cliente mande otro
  perform tests.act_as(v_bill);
  insert into public.replenishments (product_id, product_name, qty, unit_cost, kind, status, received_qty)
  values (v_p, 'P', 100, 50, 'compra', 'recibida', 99) returning id into v_oc;
  perform tests.act_as_owner();
  perform tests.eq((select status || '/' || received_qty from public.replenishments where id = v_oc), 'pendiente/0', 'alta: estado inicial forzado (pendiente, 0)');

  -- Parcial 60 + 40 ⇒ recibida
  perform tests.act_as(v_wh);
  v_r := public.recibir_lote(p_op_id => v_op, p_product => v_p, p_lote => 'OC-L1', p_caducidad => v_exp, p_cantidad => 60, p_replenishment_id => v_oc);
  v_lot := (v_r ->> 'lot_id')::uuid; v_rc := (v_r ->> 'receipt_id')::uuid;
  perform tests.eq(v_r ->> 'replenishment_status', 'parcial', 'recepción 60/100 ⇒ parcial');
  perform tests.eq((v_r ->> 'pending_qty')::int, 40, 'pendiente 40');
  -- Reintento (timeout / doble clic) con el MISMO op_id ⇒ CERO incremento
  v_r2 := public.recibir_lote(p_op_id => v_op, p_product => v_p, p_lote => 'OC-L1', p_caducidad => v_exp, p_cantidad => 60, p_replenishment_id => v_oc);
  perform tests.eq(v_r2 ->> 'status', 'already_applied', 'mismo op_id ⇒ already_applied');
  perform tests.eq(tests.qty(v_lot), 60, 'reintento no duplica stock');
  perform tests.eq((select received_qty from public.replenishments where id = v_oc), 60, 'reintento no duplica acumulado');
  perform tests.eq((select count(*)::int from public.purchase_receipts where replenishment_id = v_oc), 1, 'una sola recepción registrada');
  perform tests.throws(format($s$select public.recibir_lote(p_op_id => %L, p_product => %L, p_lote => 'OC-L1', p_caducidad => %L, p_cantidad => 61, p_replenishment_id => %L)$s$,
    v_op, v_p, v_exp, v_oc), 'OP_ID_REUTILIZADO', 'mismo op_id con otro contenido ⇒ rechazo');
  -- Excede pendiente ⇒ rechazo (no silencioso)
  perform tests.throws(format($s$select public.recibir_lote(p_op_id => gen_random_uuid(), p_product => %L, p_lote => 'OC-L1', p_caducidad => %L, p_cantidad => 41, p_replenishment_id => %L)$s$,
    v_p, v_exp, v_oc), 'RECEPCION_EXCEDE_PENDIENTE', 'recibir más de lo pendiente se rechaza');
  perform tests.act_as(v_pk);
  v_r := public.recibir_lote(p_op_id => tests.op(), p_product => v_p, p_lote => 'OC-L1', p_caducidad => v_exp, p_cantidad => 40, p_replenishment_id => v_oc);
  perform tests.eq(v_r ->> 'replenishment_status', 'recibida', '60 + 40 ⇒ recibida (empaque también recibe)');
  perform tests.eq(tests.qty(v_lot), 100, 'lote con 100');
  -- Orden recibida ⇒ no se reabre
  perform tests.throws(format($s$select public.recibir_lote(p_op_id => gen_random_uuid(), p_product => %L, p_lote => 'OC-L1', p_caducidad => %L, p_cantidad => 1, p_replenishment_id => %L)$s$,
    v_p, v_exp, v_oc), 'ORDEN_CERRADA', 'orden recibida no admite más recepciones');

  -- Excedente: solo Dirección, con motivo; no suma al acumulado
  perform tests.throws(format($s$select public.recibir_lote(p_op_id => gen_random_uuid(), p_product => %L, p_lote => 'OC-L1', p_caducidad => %L, p_cantidad => 3, p_replenishment_id => %L, p_kind => 'excedente', p_reason => 'llegaron 103')$s$,
    v_p, v_exp, v_oc), 'NO_AUTORIZADO', 'almacén no registra excedente');
  perform tests.act_as(v_admin);
  perform tests.throws(format($s$select public.recibir_lote(p_op_id => gen_random_uuid(), p_product => %L, p_lote => 'OC-L1', p_caducidad => %L, p_cantidad => 3, p_replenishment_id => %L, p_kind => 'excedente')$s$,
    v_p, v_exp, v_oc), 'MOTIVO_REQUERIDO', 'excedente sin motivo se rechaza');
  v_r := public.recibir_lote(p_op_id => tests.op(), p_product => v_p, p_lote => 'OC-L1', p_caducidad => v_exp, p_cantidad => 3,
           p_replenishment_id => v_oc, p_kind => 'excedente', p_reason => 'llegaron 103', p_evidence => 'remisión 881');
  perform tests.eq(tests.qty(v_lot), 103, 'excedente autorizado entra como entrada separada');
  perform tests.eq((select received_qty from public.replenishments where id = v_oc), 100, 'excedente NO suma a la orden');
  perform tests.eq((select authorized_by from public.purchase_receipts where id = (v_r ->> 'receipt_id')::uuid), v_admin, 'excedente registra quién autorizó');

  -- Entrada sin orden: solo Dirección + motivo
  perform tests.act_as(v_wh);
  perform tests.throws(format($s$select public.recibir_lote(p_op_id => gen_random_uuid(), p_product => %L, p_lote => 'X', p_caducidad => %L, p_cantidad => 1, p_kind => 'sin_orden', p_reason => 'encontrado')$s$,
    v_p, v_exp), 'NO_AUTORIZADO', 'almacén no hace entradas sin orden');
  perform tests.throws(format($s$select public.recibir_lote(p_op_id => gen_random_uuid(), p_product => %L, p_lote => 'X', p_caducidad => %L, p_cantidad => 1)$s$,
    v_p, v_exp), 'ORDEN_REQUERIDA', 'recepción de orden sin orden se rechaza');
  perform tests.act_as(v_admin);
  perform tests.throws(format($s$select public.recibir_lote(p_op_id => gen_random_uuid(), p_product => %L, p_lote => 'X', p_caducidad => %L, p_cantidad => 1, p_kind => 'sin_orden')$s$,
    v_p, v_exp), 'MOTIVO_REQUERIDO', 'entrada sin orden sin motivo se rechaza');

  -- Otra orden: producto distinto / cierre incompleto / terminal
  perform tests.act_as(v_bill);
  insert into public.replenishments (product_id, product_name, qty, unit_cost, kind) values (v_p, 'P', 100, 80, 'produccion') returning id into v_oc2;
  perform tests.act_as(v_wh);
  perform tests.throws(format($s$select public.recibir_lote(p_op_id => gen_random_uuid(), p_product => %L, p_lote => 'Y', p_caducidad => %L, p_cantidad => 1, p_replenishment_id => %L)$s$,
    v_p2, v_exp, v_oc2), 'ORDEN_PRODUCTO_DISTINTO', 'recepción contra orden de otro producto se rechaza');
  -- costo: orden de producción a 80 sobre el mismo lote con 103 a 50 ⇒ promedio ponderado (preservado)
  v_r := public.recibir_lote(p_op_id => tests.op(), p_product => v_p, p_lote => 'OC-L1', p_caducidad => v_exp, p_cantidad => 60, p_replenishment_id => v_oc2);
  perform tests.eq((v_r ->> 'lot_unit_cost')::numeric, round((103 * 50 + 60 * 80)::numeric / 163, 4), 'costo del lote: promedio ponderado preservado');
  perform tests.throws(format($s$select public.cerrar_orden_compra(gen_random_uuid(), %L, 'proveedor no surtió')$s$, v_oc2), 'NO_AUTORIZADO', 'almacén no cierra órdenes');
  perform tests.act_as(v_admin);
  perform tests.throws(format($s$select public.cerrar_orden_compra(gen_random_uuid(), %L, '  ')$s$, v_oc2), 'MOTIVO_REQUERIDO', 'cierre sin motivo se rechaza');
  v_r := public.cerrar_orden_compra(tests.op(), v_oc2, 'proveedor no surtió el resto');
  perform tests.eq((select status from public.replenishments where id = v_oc2), 'cerrada_incompleta', 'Dirección cierra incompleta');
  perform tests.eq((v_r ->> 'faltante')::int, 40, 'faltante informado');
  perform tests.act_as(v_wh);
  perform tests.throws(format($s$select public.recibir_lote(p_op_id => gen_random_uuid(), p_product => %L, p_lote => 'OC-L1', p_caducidad => %L, p_cantidad => 1, p_replenishment_id => %L)$s$,
    v_p, v_exp, v_oc2), 'ORDEN_CERRADA', 'orden cerrada no se reabre');
  perform tests.act_as(v_admin);
  perform tests.throws(format($s$select public.cerrar_orden_compra(gen_random_uuid(), %L, 'otra vez')$s$, v_oc2), 'ORDEN_NO_ABIERTA', 'cerrada no se vuelve a cerrar');

  -- Corrección compensatoria de una recepción (nunca edición destructiva, nunca reabre)
  perform tests.throws(format($s$select public.ajustar_lote(gen_random_uuid(), %L, 5, 'correccion_recepcion', 'capturé de menos', %L)$s$, v_lot, v_rc),
    'CORRECCION_DEBE_SER_NEGATIVA', 'corrección positiva se rechaza (va como otra recepción)');
  v_r := public.ajustar_lote(tests.op(), v_lot, -10, 'correccion_recepcion', 'se capturaron 10 de más', v_rc);
  perform tests.eq((select status || '/' || received_qty from public.replenishments where id = v_oc), 'cerrada_incompleta/90', 'corregir una orden recibida ⇒ cerrada_incompleta (no reabre)');
  perform tests.throws(format($s$select public.ajustar_lote(gen_random_uuid(), %L, -51, 'correccion_recepcion', 'demasiado', %L)$s$, v_lot, v_rc),
    'CORRECCION_EXCEDE_RECEPCION', 'no se corrige más de lo recibido en esa recepción');
  perform tests.act_as(v_wh);
  perform tests.throws(format($s$select public.ajustar_lote(gen_random_uuid(), %L, -1, 'correccion_recepcion', 'x', %L)$s$, v_lot, v_rc),
    'NO_AUTORIZADO', 'almacén no corrige recepciones');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.inventory_movements where receipt_id = v_rc), 2, 'la recepción original queda intacta + 1 asiento compensatorio');

  -- Escritura directa de compras: solo `paid`
  perform tests.act_as(v_wh);
  perform tests.throws(format($s$update public.replenishments set status = 'recibida' where id = %L$s$, v_oc), 'permission denied', 'almacén no cambia estado directo');
  perform tests.act_as(v_bill);
  perform tests.throws(format($s$update public.replenishments set received_qty = 0 where id = %L$s$, v_oc), 'permission denied', 'facturación no cambia acumulado directo');
  update public.replenishments set paid = true where id = v_oc;
  perform tests.act_as_owner();
  perform tests.eq((select paid from public.replenishments where id = v_oc), true, 'facturación sí marca pagada (W2 intacto)');

  -- Carga inicial (importación): solo Dirección, caducidad estricta, idempotente por lote
  select sku into v_sku from public.products where id = v_p2;
  perform tests.act_as(v_wh);
  perform tests.throws(format($s$select public.importar_lote(gen_random_uuid(), %L, 'IMP-1', '2031-01-01', 5)$s$, v_sku), 'NO_AUTORIZADO', 'almacén no importa inventario');
  perform tests.act_as(v_admin);
  perform tests.throws(format($s$select public.importar_lote(gen_random_uuid(), %L, 'IMP-1', '31/31/2031', 5)$s$, v_sku), 'CADUCIDAD_INVALIDA', 'fecha inválida ya no entra como NULL');
  perform tests.throws(format($s$select public.importar_lote(gen_random_uuid(), %L, 'IMP-1', '', 5)$s$, v_sku), 'CADUCIDAD_REQUERIDA', 'importación sin caducidad se rechaza');
  v_r := public.importar_lote(tests.op(), v_sku, 'IMP-1', '2031-01-01', 5);
  perform tests.eq(v_r ->> 'result', 'created', 'importa un lote nuevo');
  v_r := public.importar_lote(tests.op(), v_sku, ' imp-1 ', '2031-01-01', 5);
  perform tests.eq(v_r ->> 'result', 'skipped', 're-importar el mismo lote no duplica');
  perform tests.throws(format($s$select public.importar_lote(gen_random_uuid(), %L, 'IMP-1', '2032-01-01', 5)$s$, v_sku), 'LOTE_CADUCIDAD_DISTINTA', 'importación con otra caducidad se rechaza');
  perform tests.act_as_owner();
  perform tests.eq((select sum(quantity)::int from public.lots where product_id = v_p2), 5, 'carga inicial aplicada una sola vez');
  perform tests.ok(tests.kardex_ok(v_lot), 'I-04 lote de compras: existencia = Σ kardex');
  perform tests.eq(tests.conciliacion_errores(), 0, 'conciliación sin errores tras recepción/corrección');
end
$t$;
set constraints all immediate;
rollback;
