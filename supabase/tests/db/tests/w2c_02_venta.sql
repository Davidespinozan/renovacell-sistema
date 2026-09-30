-- W2-C · VENTA DESDE CUSTODIA (G-4). UNA sola ruta económica: el mismo vender_pos que
-- el mostrador. La obligación económica nace AQUÍ, no en la entrega, y nace por el
-- camino de W1/W2 existente: pedido + renglones + movimiento 'venta' + asiento.
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_wh uuid := tests.user('warehouse');
  v_pos uuid := tests.user('pos'); v_otro uuid := tests.user('pos', 'otro-vendedor@test.local');
  v_doc uuid := tests.user('doctor'); v_p uuid := tests.product(150);
  v_lot uuid; v_lot2 uuid; v_cus uuid; v_cus2 uuid; v_sale uuid := gen_random_uuid(); v_ajeno uuid;
  v_cerrada uuid; v_mov int; v_lines jsonb; v_allocs jsonb;
begin
  v_lot  := tests.stock(v_p, 'W2C-V1', 10);
  v_lot2 := tests.stock(v_p, 'W2C-V2', 10);
  v_ajeno := tests.stock(v_p, 'W2C-AJENO', 5);
  v_cus  := tests.custodia('vendedor', v_pos);
  v_cus2 := tests.custodia('vendedor', v_otro);
  perform tests.entregar(v_cus, v_lot, 6);
  perform tests.entregar(v_cus2, v_lot2, 4);

  v_lines  := jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 2));
  v_allocs := jsonb_build_array(jsonb_build_object('line_index', 0, 'lot_id', v_lot, 'qty', 2));

  -- ── Autoridad: solo el tenedor (o Dirección) vende de esa custodia ───────────
  perform tests.act_as(v_otro);
  perform tests.throws(format($q$select public.vender_pos(%L, 'POS-AJ', 1, 'efectivo', null, '{}', %L, %L,
      false, null, null, null, %L)$q$, gen_random_uuid(), v_lines, v_allocs, v_cus),
    'NO_AUTORIZADO', 'otro vendedor NO vende de una custodia ajena');
  perform tests.act_as(v_pos);
  perform tests.throws(format($q$select public.vender_pos(%L, 'POS-AJ2', 1, 'efectivo', null, '{}', %L, %L,
      false, null, null, null, %L)$q$, gen_random_uuid(), v_lines,
      jsonb_build_array(jsonb_build_object('line_index', 0, 'lot_id', v_ajeno, 'qty', 2)), v_cus),
    'CUSTODIA_SALDO_INSUFICIENTE', 'no se vende un lote que nunca se le entregó');
  perform tests.throws(format($q$select public.vender_pos(%L, 'POS-EX', 1, 'efectivo', null, '{}', %L, %L,
      false, null, null, null, %L)$q$, gen_random_uuid(),
      jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 7)),
      jsonb_build_array(jsonb_build_object('line_index', 0, 'lot_id', v_lot, 'qty', 7)), v_cus),
    'CUSTODIA_SALDO_INSUFICIENTE', 'no se vende más de lo que trae en la mano');
  perform tests.throws(format($q$select public.vender_pos(%L, 'POS-NX', 1, 'efectivo', null, '{}', %L, %L,
      false, null, null, null, %L)$q$, gen_random_uuid(), v_lines, v_allocs, gen_random_uuid()),
    'CUSTODIA_INEXISTENTE', 'no se vende de una custodia que no existe');

  -- ── La venta ────────────────────────────────────────────────────────────────
  perform tests.ok(public.vender_pos(v_sale, 'POS-CUS1', 1, 'efectivo', null, '{}', v_lines, v_allocs,
      false, null, null, 500, v_cus),
    'el tenedor vende 2 de su custodia');

  perform tests.act_as_owner();
  -- 5) la venta SÍ reduce la existencia propia
  perform tests.eq((select quantity from public.lots where id = v_lot), 8,
    '5: la venta reduce lots.quantity (ahora sí salió de la empresa)');
  perform tests.eq(tests.en_poder(v_cus, v_lot), 4, 'en poder del tenedor: 6 − 2 = 4');
  perform tests.eq(tests.disp(v_lot), 4, 'disponible: 8 propias − 4 en custodia');

  -- 6) exactamente UN movimiento 'venta', con su referencia de negocio
  select count(*)::int into v_mov from public.inventory_movements
   where lot_id = v_lot and reason = 'venta' and order_id = v_sale;
  perform tests.eq(v_mov, 1, '6: exactamente UN movimiento venta');
  perform tests.eq((select -sum(change)::int from public.inventory_movements
                     where lot_id = v_lot and reason = 'venta' and order_id = v_sale), 2,
    '6: el movimiento es por 2 unidades');
  perform tests.ok((select order_item_id is not null from public.inventory_movements
                     where lot_id = v_lot and reason = 'venta' and order_id = v_sale),
    '6: el movimiento va ligado al renglón (trazabilidad lote→cliente)');

  -- 7) la realidad económica nace por la ruta de W2
  perform tests.eq((select count(*)::int from public.orders where id = v_sale), 1, '7: existe el pedido');
  perform tests.eq((select count(*)::int from public.order_items where order_id = v_sale), 1, '7: existe el renglón');
  perform tests.eq((select cobrado_neto from public.v_order_money where order_id = v_sale), 300::numeric,
    '7: el dinero entró al libro de W2 (2 × 150 del servidor)');
  perform tests.eq((select payment_status from public.orders where id = v_sale), 'paid', '7: proyección financiera correcta');
  perform tests.eq((select evidence_ref from public.payment_entries where order_id = v_sale),
    'recibido=500;cambio=200', '7: el efectivo recibido queda como evidencia del corte');
  -- el PRECIO lo pone el servidor, no el vendedor (D-W2-C-8)
  perform tests.eq((select unit_price from public.order_items where order_id = v_sale), 150::numeric,
    'el precio es el del servidor (precio_de), no el que mandó el cliente');
  perform tests.eq((select unit_price from public.custody_lines where order_id = v_sale), 150::numeric,
    'la línea de custodia guarda el precio del servidor');
  perform tests.eq((select count(*)::int from public.custody_lines where order_id = v_sale and kind = 'venta'), 1,
    'una línea de venta en el libro de custodia');

  -- 8) el reintento no duplica NADA
  perform tests.act_as(v_pos);
  perform tests.ok(public.vender_pos(v_sale, 'POS-CUS1', 1, 'efectivo', null, '{}', v_lines, v_allocs,
      false, null, null, 500, v_cus),
    '8: el reintento devuelve éxito idempotente');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.custody_lines where order_id = v_sale), 1, '8: una sola línea de custodia');
  perform tests.eq((select count(*)::int from public.inventory_movements where order_id = v_sale and reason = 'venta'), 1,
    '8: un solo movimiento de inventario');
  perform tests.eq((select count(*)::int from public.payment_entries where order_id = v_sale), 1, '8: un solo asiento');
  perform tests.eq((select quantity from public.lots where id = v_lot), 8, '8: la existencia no se descontó dos veces');
  perform tests.eq(tests.en_poder(v_cus, v_lot), 4, '8: el saldo de custodia no bajó dos veces');

  -- 12) producto VENCIDO no se puede vender
  perform tests.act_as_owner();
  update public.lots set expiry_date = public.hoy_local() - 1 where id = v_lot;
  perform tests.act_as(v_pos);
  perform tests.throws(format($q$select public.vender_pos(%L, 'POS-CAD', 1, 'efectivo', null, '{}', %L, %L,
      false, null, null, null, %L)$q$, gen_random_uuid(), v_lines, v_allocs, v_cus),
    'LOTE_CADUCADO', '12: producto vencido en custodia NO se vende');
  perform tests.act_as_owner();
  update public.lots set expiry_date = public.hoy_local() + 365 where id = v_lot;

  -- ── Venta de MOSTRADOR (sin custodia): el comportamiento no cambió ──────────
  perform tests.act_as(v_pos);
  perform tests.ok(public.vender_pos(gen_random_uuid(), 'POS-MOST', 1, 'efectivo', null, '{}',
      jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)),
      jsonb_build_array(jsonb_build_object('line_index', 0, 'lot_id', v_ajeno, 'qty', 1))),
    'la venta de mostrador sigue funcionando igual, sin custodia');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.custody_lines where kind = 'venta' and custody_id = v_cus), 1,
    'la venta de mostrador NO toca el libro de custodia');

  -- ── No se vende de una custodia CERRADA ─────────────────────────────────────
  v_cerrada := tests.custodia('evento', tests.user('pos', 'evento@test.local'), 'Expo Cerrada');
  perform tests.act_as(v_admin);
  perform public.cerrar_custodia(tests.op(), v_cerrada, 'sin operar');
  perform tests.act_as(v_pos);
  perform tests.throws(format($q$select public.vender_pos(%L, 'POS-CER', 1, 'efectivo', null, '{}', %L, %L,
      false, null, null, null, %L)$q$, gen_random_uuid(), v_lines, v_allocs, v_cerrada),
    'CUSTODIA_CERRADA', 'una custodia cerrada no vende');

  perform tests.act_as_owner();
  perform tests.ok(tests.kardex_ok(v_lot) and tests.kardex_ok(v_ajeno), 'I-04 de W1 intacto tras vender de custodia');
  perform tests.eq(tests.conciliacion_errores(), 0, 'conciliación de inventario en cero');
  perform tests.eq(tests.custodia_errores(), 0, 'conciliación de custodia en cero');
end
$t$;
set constraints all immediate;
rollback;
