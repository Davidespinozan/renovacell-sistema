-- W2-C · CONCILIACIÓN E1–E9. Sobre un estado SANO debe dar cero. Y cada comprobación
-- tiene que DETECTAR su daño: una conciliación que nunca encuentra nada no prueba nada.
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_wh uuid := tests.user('warehouse'); v_pos uuid := tests.user('pos');
  v_p uuid := tests.product(150); v_lot uuid; v_lot2 uuid; v_lot3 uuid; v_cus uuid; v_sale uuid := gen_random_uuid();
  v_line uuid; v_mov uuid; v_cus2 uuid; v_inv uuid;
begin
  v_lot  := tests.stock(v_p, 'W2C-K1', 20);
  v_lot2 := tests.stock(v_p, 'W2C-K2', 10);
  v_lot3 := tests.stock(v_p, 'W2C-K3', 10);   -- NUNCA se entrega a ninguna custodia
  v_cus  := tests.custodia('vendedor', v_pos);
  perform tests.entregar(v_cus, v_lot, 8);

  -- ── 17) Ciclo completo sano ⇒ conciliación en CERO ──────────────────────────
  perform tests.act_as(v_pos);
  perform public.vender_pos(v_sale, 'POS-K1', 1, 'efectivo', null, '{}',
    jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 3)),
    jsonb_build_array(jsonb_build_object('line_index', 0, 'lot_id', v_lot, 'qty', 3)),
    false, null, null, 450, v_cus);
  perform tests.act_as(v_wh);
  perform public.devolver_de_custodia(tests.op(), v_cus,
    jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', 4, 'inspection', 'ok')));
  perform public.registrar_perdida_custodia(tests.op(), v_cus, 'faltante',
    jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', 1)), 'conteo físico');
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*)::int from public.conciliar_custodia() where severidad = 'error'), 0,
    '17: entrega + venta + devolución + pérdida, todo cuadra: 0 errores');
  perform tests.eq(tests.conciliacion_errores(), 0, '17: la conciliación de inventario de W1 también en cero');
  perform tests.eq((select count(*)::int from public.conciliar_dinero() where severidad = 'error'), 0,
    '17: la conciliación de dinero de W2 también en cero');

  -- A partir de aquí se DAÑA el estado a propósito para comprobar que cada verificación
  -- encuentra su problema. Se deja un saldo vivo en custodia para poder dañarlo.
  perform tests.entregar(v_cus, v_lot2, 5);
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*)::int from public.conciliar_custodia() where severidad = 'error'), 0,
    'con saldo vivo en custodia sigue en cero');

  -- ── E2 detecta custodia por encima de la existencia propia ──────────────────
  perform tests.act_as_owner();
  perform set_config('app.trusted', 'on', true);
  update public.lots set quantity = 1 where id = v_lot2;   -- daño simulado: 5 en custodia, 1 propia
  perform set_config('app.trusted', 'off', true);
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*)::int from public.conciliar_custodia()
                     where check_id = 'E2_custodia_excede_propio'), 1,
    'E2: detecta que la custodia excede la existencia propia');
  perform tests.act_as_owner();
  perform set_config('app.trusted', 'on', true);
  update public.lots set quantity = 10 where id = v_lot2;  -- reparado
  perform set_config('app.trusted', 'off', true);
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*)::int from public.conciliar_custodia() where severidad = 'error'), 0,
    'reparado el daño, vuelve a cero');

  -- ── E3 detecta una venta de custodia sin su movimiento de inventario ────────
  perform tests.act_as_owner();
  select id into v_mov from public.inventory_movements where order_id = v_sale and reason = 'venta';
  perform set_config('renovacell.purge', 'on', true);
  delete from public.inventory_movements where id = v_mov;
  perform set_config('renovacell.purge', 'off', true);
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*)::int from public.conciliar_custodia()
                     where check_id = 'E3_venta_sin_movimiento'), 1,
    'E3: una venta de custodia sin su salida de inventario se reporta');

  -- ── E6 detecta una salida de un lote que nunca se entregó ───────────────────
  perform tests.act_as_owner();
  perform set_config('app.trusted', 'on', true);
  insert into public.custody_lines (id, custody_id, kind, product_id, lot_id, qty, held_delta, motivo, inventory_op_id)
  values (gen_random_uuid(), v_cus, 'merma', v_p, v_lot3, 1, -1, 'daño inventado',
          (select op_id from public.inventory_operations limit 1));
  perform set_config('app.trusted', 'off', true);
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*)::int from public.conciliar_custodia()
                     where check_id = 'E6_lote_no_entregado'), 1,
    'E6: no se puede perder un lote que nunca se entregó a esa custodia');
  perform tests.eq((select count(*)::int from public.conciliar_custodia()
                     where check_id = 'E8_perdida_sin_baja'), 1,
    'E8: esa pérdida tampoco tiene baja real de inventario que la respalde');

  -- ── E7 avisa de lo que vence en poder del tenedor ───────────────────────────
  perform tests.act_as_owner();
  update public.lots set expiry_date = public.hoy_local() + 10 where id = v_lot2;
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*)::int from public.conciliar_custodia()
                     where check_id = 'E7_por_caducar_en_custodia'), 1,
    'E7: avisa de un lote por caducar que todavía trae el vendedor');
  perform tests.act_as_owner();
  update public.lots set expiry_date = public.hoy_local() - 1 where id = v_lot2;
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*)::int from public.conciliar_custodia()
                     where check_id = 'E7_caducado_en_custodia' and severidad = 'error'), 1,
    'E7: un lote YA vencido en custodia es un error, no un aviso');

  -- ── E5 detecta una custodia cerrada con saldo ───────────────────────────────
  perform tests.act_as_owner();
  v_cus2 := tests.custodia('evento', tests.user('pos', 'ev2@test.local'), 'Expo E5');
  perform tests.entregar(v_cus2, v_lot, 2);
  perform set_config('app.trusted', 'on', true);
  update public.custodies set status = 'cerrada', closed_at = now(), close_reason = 'cierre inventado' where id = v_cus2;
  perform set_config('app.trusted', 'off', true);
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*)::int from public.conciliar_custodia()
                     where check_id = 'E5_cerrada_con_saldo'), 1,
    'E5: una custodia cerrada con producto en la calle se reporta');

  -- ── Autoridad de la conciliación ────────────────────────────────────────────
  perform tests.act_as(v_wh);
  perform tests.throws('select * from public.conciliar_custodia()', 'NO_AUTORIZADO',
    'Almacén no concilia custodia');
end
$t$;
set constraints all immediate;
rollback;
