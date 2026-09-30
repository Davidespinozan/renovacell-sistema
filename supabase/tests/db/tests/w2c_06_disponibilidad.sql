-- W2-C · ANTI-OVERSELL. El caso exacto del dueño: propio 10, en custodia 7, disponible 3.
-- Nadie —catálogo, POS, surtido ni baja— puede tocar la cuarta unidad, y la existencia
-- PROPIA sigue siendo 10 (la custodia no es un segundo stock: es una ubicación).
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_wh uuid := tests.user('warehouse'); v_pos uuid := tests.user('pos');
  v_doc uuid := tests.user('doctor'); v_p uuid := tests.product(100);
  v_lot uuid; v_cus uuid; v_o uuid; v_item uuid; v_sale uuid := gen_random_uuid();
begin
  v_lot := tests.stock(v_p, 'W2C-DISP', 10);
  v_cus := tests.custodia('vendedor', v_pos);
  perform tests.entregar(v_cus, v_lot, 7);

  -- ── El estado de partida: 10 propios, 7 en custodia, 3 disponibles ───────────
  perform tests.act_as_owner();
  perform tests.eq((select quantity from public.lots where id = v_lot), 10,
    'la existencia PROPIA sigue siendo 10: la entrega no crea ni destruye inventario');
  perform tests.eq(public.custody_held(v_lot), 7, 'en custodia 7');
  perform tests.eq(tests.disp(v_lot), 3, 'disponible = 10 − 7 = 3');
  perform tests.eq((select count(*)::int from public.inventory_movements where lot_id = v_lot and reason <> 'entrada'), 0,
    'la entrega NO generó ningún movimiento de inventario');

  -- ── 1) El CATÁLOGO promete máximo 3 ─────────────────────────────────────────
  perform tests.act_as(v_admin);
  perform tests.eq((select available from public.product_stock where product_id = v_p), 3,
    'catálogo/POS (product_stock): ofrece 3, no 10');
  perform tests.act_as(v_doc);
  perform tests.eq((select coalesce(max(available), 0)::int from public.product_stock where product_id = v_p), 3,
    'el doctor ve 3 disponibles: no se le promete producto que trae un vendedor');

  -- ── 2) El POS asigna máximo 3 ───────────────────────────────────────────────
  perform tests.act_as(v_pos);
  perform tests.throws(format($q$select public.vender_pos(%L, 'POS-D4', 1, 'efectivo', null, '{}',
      %L, %L)$q$, gen_random_uuid(),
      jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 4)),
      jsonb_build_array(jsonb_build_object('line_index', 0, 'lot_id', v_lot, 'qty', 4))),
    'CUSTODIA_EN_PODER', 'POS: la cuarta unidad está en custodia y se rechaza');
  perform tests.ok(public.vender_pos(v_sale, 'POS-D3', 1, 'efectivo', null, '{}',
      jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 3)),
      jsonb_build_array(jsonb_build_object('line_index', 0, 'lot_id', v_lot, 'qty', 3))),
    'POS: las 3 disponibles sí se venden');
  perform tests.act_as_owner();
  perform tests.eq((select quantity from public.lots where id = v_lot), 7, 'tras vender 3 de mostrador quedan 7 propias');
  perform tests.eq(public.custody_held(v_lot), 7, 'la custodia NO se tocó: sigue con 7');
  perform tests.eq(tests.disp(v_lot), 0, 'disponible 0: lo que queda es todo de la custodia');

  -- ── 3) El SURTIDO no puede tomar nada de la custodia ────────────────────────
  v_o := tests.order(v_doc, 'paid', jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.cobrar(v_o);   -- W2: el pedido se libera con un cobro registrado
  select id into v_item from public.order_items where order_id = v_o;
  perform tests.act_as(v_wh);
  perform tests.throws(format('select public.surtir_pedido(gen_random_uuid(), %L, %L)', v_o,
      jsonb_build_array(jsonb_build_object('order_item_id', v_item, 'lot_id', v_lot, 'qty', 1))),
    'CUSTODIA_EN_PODER', 'surtido: no surte con unidades que trae un vendedor');

  -- ── 4) La BAJA tampoco puede comerse la custodia ────────────────────────────
  perform tests.throws(format('select public.ajustar_lote(gen_random_uuid(), %L, -1, ''merma'', ''frasco roto'')', v_lot),
    'CUSTODIA_EN_PODER', 'merma: no da de baja producto que está en poder del vendedor');

  -- ── 5) Con 3 disponibles otra vez, todo vuelve a funcionar ──────────────────
  perform tests.act_as(v_wh);
  perform tests.lives(format($q$select public.devolver_de_custodia(gen_random_uuid(), %L, %L)$q$, v_cus,
      jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', 3, 'inspection', 'ok'))),
    'el vendedor devuelve 3 en buen estado');
  perform tests.act_as_owner();
  perform tests.eq((select quantity from public.lots where id = v_lot), 7,
    'la devolución limpia NO aumenta la existencia propia (nunca dejó de ser nuestra)');
  perform tests.eq(tests.disp(v_lot), 3, 'la devolución SÍ devuelve disponibilidad: 3');
  perform tests.act_as(v_wh);
  perform tests.lives(format('select public.surtir_pedido(gen_random_uuid(), %L, %L)', v_o,
      jsonb_build_array(jsonb_build_object('order_item_id', v_item, 'lot_id', v_lot, 'qty', 1))),
    'ahora sí surte: hay disponibilidad real');

  -- ── Invariantes de W1 intactos ──────────────────────────────────────────────
  perform tests.act_as_owner();
  perform tests.ok(tests.kardex_ok(v_lot), 'I-04 de W1 intacto: existencia = Σ kardex');
  perform tests.eq(tests.conciliacion_errores(), 0, 'conciliación de inventario sin errores');
  perform tests.eq(tests.custodia_errores(), 0, 'conciliación de custodia sin errores');
end
$t$;
set constraints all immediate;
rollback;
