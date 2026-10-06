-- UX-2 / P2-1 · Alta de compra a proveedor por COMANDO idempotente (crear_orden_compra): autoridad
-- igual a la política vigente (Dirección/Facturación), estado inicial forzado, reintento = misma
-- orden, CERO inventario; la recepción canónica (recibir_lote 'orden') sigue siendo la única vía al
-- stock. UX-1 · cc_leer_conversacion expone `leido_hasta` (cursor del actor) sin cambiar autoridad.
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_bill uuid := tests.user('billing'); v_wh uuid := tests.user('warehouse'); v_doc uuid := tests.user('doctor');
  v_p uuid := tests.product(); v_op uuid := tests.op(); v_op2 uuid := tests.op(); r jsonb; r2 jsonb; v_oc uuid; n_mov int; n_lots int; n_ops int;
  cD uuid; m jsonb;
begin
  select count(*) into n_mov from public.inventory_movements; select count(*) into n_lots from public.lots; select count(*) into n_ops from public.inventory_operations;

  -- ══ autoridad: igual que la política RLS de replenishments (admin/billing) ══
  perform tests.act_as(v_wh);
  perform tests.throws(format('select public.crear_orden_compra(%L, %L, 10, 50, ''compra'', ''Proveedor X'')', v_op, v_p), 'NO_AUTORIZADO', '19/20 · almacén no crea compras');
  perform tests.act_as(v_doc);
  perform tests.throws(format('select public.crear_orden_compra(%L, %L, 10, 50, ''compra'', ''Proveedor X'')', v_op, v_p), 'NO_AUTORIZADO', 'doctor no crea compras');
  perform tests.act_as_anon();
  perform tests.throws(format('select public.crear_orden_compra(%L, %L, 10, 50, ''compra'', ''Proveedor X'')', v_op, v_p), 'permission denied', 'anon no invoca el comando');

  -- ══ validaciones ══
  perform tests.act_as(v_bill);
  perform tests.throws(format('select public.crear_orden_compra(%L, %L, 0, 50, ''compra'', ''Proveedor X'')', v_op, v_p), 'CANTIDAD_INVALIDA', 'cantidad > 0');
  perform tests.throws(format('select public.crear_orden_compra(%L, %L, 10, 0, ''compra'', ''Proveedor X'')', v_op, v_p), 'COSTO_INVALIDO', 'costo > 0');
  perform tests.throws(format('select public.crear_orden_compra(%L, %L, 10, 50, ''compra'', null)', v_op, v_p), 'PROVEEDOR_REQUERIDO', 'compra exige proveedor');
  perform tests.throws(format('select public.crear_orden_compra(%L, %L, 10, 50, ''regalo'', ''P'')', v_op, v_p), 'TIPO_INVALIDO', 'tipo cerrado');
  perform tests.throws(format('select public.crear_orden_compra(%L, %L, 10, 50, ''compra'', ''P'')', v_op, gen_random_uuid()), 'PRODUCTO_INEXISTENTE', 'producto debe existir');
  perform tests.throws(format('select public.crear_orden_compra(null, %L, 10, 50, ''compra'', ''P'')', v_p), 'OP_ID_REQUERIDO', 'op_id obligatorio');
  perform tests.eq((select count(*)::int from public.replenishments where product_id = v_p), 0, 'ninguna validación fallida dejó orden');

  -- ══ alta (Facturación) + reintento con el MISMO op_id ⇒ la misma orden ══
  r := public.crear_orden_compra(v_op, v_p, 100, 50, 'compra', '  Proveedor X  ');
  v_oc := (r ->> 'replenishment_id')::uuid;
  perform tests.eq(r ->> 'status', 'applied', '17 · alta aplicada');
  perform tests.ok((select status = 'pendiente' and received_qty = 0 and paid = false and supplier = 'Proveedor X' and qty = 100 and unit_cost = 50 and created_by = v_bill
                      from public.replenishments where id = v_oc), '17 · pendiente/0, sin pagar, proveedor recortado, autor registrado');
  r2 := public.crear_orden_compra(v_op, v_p, 100, 50, 'compra', 'Proveedor X');
  perform tests.eq(r2 ->> 'status', 'already_applied', '17 · doble clic / reintento ⇒ already_applied');
  perform tests.eq((r2 ->> 'replenishment_id')::uuid, v_oc, '17 · devuelve la MISMA orden');
  perform tests.eq((select count(*)::int from public.replenishments where product_id = v_p), 1, '17 · UNA sola orden');
  perform tests.throws(format('select public.crear_orden_compra(%L, %L, 200, 50, ''compra'', ''Proveedor X'')', v_op, v_p), 'OP_ID_REUTILIZADO', 'mismo op_id con otros datos ⇒ rechazado');

  -- ══ 14 · crear la compra NO mueve inventario (se cuenta como dueño: el registro solo lo lee Dirección) ══
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.inventory_movements), n_mov, '14 · cero movimientos');
  perform tests.eq((select count(*)::int from public.lots), n_lots, '14 · cero lotes');
  perform tests.eq((select count(*)::int from public.inventory_operations where kind = 'alta_compra'), 1, 'la alta quedó en el registro de operaciones');

  -- ══ producción interna: nace pagada (no hay proveedor) ══
  perform tests.act_as(v_admin);
  r := public.crear_orden_compra(v_op2, v_p, 20, 30, 'produccion', 'ignorado');
  perform tests.ok((select paid and supplier is null and kind = 'produccion' from public.replenishments where id = (r ->> 'replenishment_id')::uuid), 'producción: pagada y sin proveedor');

  -- ══ 15/16 · la recepción canónica contra la orden sigue igual (parcial, acumulada) ══
  perform tests.act_as(v_wh);
  r := public.recibir_lote(p_op_id => tests.op(), p_product => v_p, p_lote => 'UX2-L1', p_caducidad => current_date + 300, p_cantidad => 40, p_replenishment_id => v_oc);
  perform tests.eq(r ->> 'replenishment_status', 'parcial', '16 · recepción parcial 40/100');
  perform tests.eq((r ->> 'pending_qty')::int, 60, '16 · pendiente 60');
  perform tests.eq((select received_qty from public.replenishments where id = v_oc), 40, '15 · acumulado por recibir_lote');
  perform tests.eq((select count(*)::int from public.inventory_movements), n_mov + 1, '15 · el stock entra SOLO al recibir');

  -- ══ 18/19 · marcar pagado: Facturación/Dirección sí; almacén afecta 0 filas (RLS), nunca error silencioso de autoridad ampliada ══
  perform tests.act_as(v_wh);
  update public.replenishments set paid = true where id = v_oc;
  perform tests.ok((select not paid from public.replenishments where id = v_oc), '18 · almacén no marca pagado (0 filas)');
  perform tests.act_as(v_bill);
  update public.replenishments set paid = true where id = v_oc;
  perform tests.ok((select paid from public.replenishments where id = v_oc), '19 · Facturación sí marca pagado');

  -- ══ UX-1 · leido_hasta en la lectura de conversación ══
  perform tests.act_as_service();
  cD := (public.cc_abrir_conversacion(null, v_doc) ->> 'conversation_id')::uuid;
  m := public.cc_enviar_mensaje(cD, 'admin', null, v_admin, 'c:ux1', 'Hola doctor');
  r := public.cc_leer_conversacion(cD, 'doctor', null, v_doc);
  perform tests.eq((r ->> 'leido_hasta')::int, 0, '12 · sin leer: leido_hasta 0');
  perform tests.ok((r ->> 'ultimo_seq')::int >= 1 and jsonb_array_length(r -> 'mensajes') >= 1, '12 · ultimo_seq y mensajes presentes');
  perform public.cc_marcar_leido(cD, 'doctor', null, v_doc, (r ->> 'ultimo_seq')::int);
  r2 := public.cc_leer_conversacion(cD, 'doctor', null, v_doc);
  perform tests.eq((r2 ->> 'leido_hasta')::int, (r ->> 'ultimo_seq')::int, '12 · tras marcar leído, leido_hasta = ultimo_seq');
  perform tests.throws(format('select public.cc_leer_conversacion(%L, ''doctor'', null, %L)', cD, tests.user('doctor')), 'NO_AUTORIZADO', '12 · la autoridad de lectura no cambió');
end $t$;
rollback;
