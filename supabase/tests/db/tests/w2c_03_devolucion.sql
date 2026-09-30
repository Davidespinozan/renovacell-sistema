-- W2-C · DEVOLUCIÓN DE CUSTODIA. Lo que vuelve ÍNTEGRO no mueve inventario: nunca dejó
-- de ser nuestro, solo vuelve a estar disponible. Lo que vuelve dañado o vencido se da
-- de baja en el MISMO acto (no queda una merma pendiente que alguien olvide).
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_wh uuid := tests.user('warehouse'); v_pos uuid := tests.user('pos');
  v_p uuid := tests.product(100); v_lot uuid; v_cad uuid; v_cus uuid; v_op uuid; v_r jsonb;
begin
  v_lot := tests.stock(v_p, 'W2C-D1', 20);
  v_cad := tests.stock(v_p, 'W2C-D2', 10, public.hoy_local() + 5);
  v_cus := tests.custodia('vendedor', v_pos);
  perform tests.entregar(v_cus, v_lot, 10);
  perform tests.entregar(v_cus, v_cad, 6);

  -- ── Autoridad e inspección obligatoria ──────────────────────────────────────
  perform tests.act_as(v_pos);
  perform tests.throws(format('select public.devolver_de_custodia(gen_random_uuid(), %L, %L)', v_cus,
    jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', 1, 'inspection', 'ok'))),
    'NO_AUTORIZADO', 'el tenedor no se recibe la devolución a sí mismo: la recibe Almacén');
  perform tests.act_as(v_wh);
  perform tests.throws(format('select public.devolver_de_custodia(gen_random_uuid(), %L, %L)', v_cus,
    jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', 2))),
    'INSPECCION_REQUERIDA', 'hay que decir en qué estado llegó');
  perform tests.throws(format('select public.devolver_de_custodia(gen_random_uuid(), %L, %L)', v_cus,
    jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', 2, 'inspection', 'regular'))),
    'INSPECCION_INVALIDA', 'la inspección tiene vocabulario cerrado');
  perform tests.throws(format('select public.devolver_de_custodia(gen_random_uuid(), %L, %L)', v_cus,
    jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', 99, 'inspection', 'ok'))),
    'CUSTODIA_SALDO_INSUFICIENTE', 'no se devuelve más de lo que tiene en poder');

  -- ── 9) Devolución LIMPIA: sube disponibilidad, no sube existencia propia ────
  v_op := tests.op();
  v_r := public.devolver_de_custodia(v_op, v_cus,
           jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', 4, 'inspection', 'ok')));
  perform tests.eq((v_r ->> 'devuelto_disponible')::int, 4, '9: 4 unidades vuelven a estar disponibles');
  perform tests.eq((v_r ->> 'dado_de_baja')::int, 0, '9: nada se dio de baja');
  perform tests.act_as_owner();
  perform tests.eq((select quantity from public.lots where id = v_lot), 20,
    '9: la existencia PROPIA no cambia (nunca dejó de ser nuestra)');
  perform tests.eq((select count(*)::int from public.inventory_movements where lot_id = v_lot and reason <> 'entrada'), 0,
    '9: la devolución limpia NO crea movimiento de inventario');
  perform tests.eq(tests.disp(v_lot), 14, '9: disponible 20 − 6 en custodia = 14');
  perform tests.eq(tests.en_poder(v_cus, v_lot), 6, '9: en poder 10 − 4 = 6');

  -- Idempotencia
  perform tests.act_as(v_wh);
  perform tests.eq(public.devolver_de_custodia(v_op, v_cus,
           jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', 4, 'inspection', 'ok'))) ->> 'status',
    'already_applied', 'reintento ⇒ no devuelve dos veces');
  perform tests.act_as_owner();
  perform tests.eq(tests.en_poder(v_cus, v_lot), 6, 'el reintento no duplicó la devolución');

  -- ── Devolución DAÑADA: baja real en el mismo acto ───────────────────────────
  perform tests.act_as(v_wh);
  v_r := public.devolver_de_custodia(tests.op(), v_cus,
           jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', 2, 'inspection', 'dañado')),
           'caja golpeada en el traslado');
  perform tests.eq((v_r ->> 'dado_de_baja')::int, 2, 'lo dañado se da de baja, no vuelve a venta');
  perform tests.act_as_owner();
  perform tests.eq((select quantity from public.lots where id = v_lot), 18,
    'la existencia propia SÍ baja: esas unidades se perdieron');
  perform tests.eq((select count(*)::int from public.inventory_movements
                     where lot_id = v_lot and reason = 'merma'), 1,
    'la baja física es una merma del kardex de W1');
  perform tests.eq(tests.en_poder(v_cus, v_lot), 4, 'sale del poder del tenedor');
  perform tests.eq((select count(*)::int from public.custody_lines
                     where custody_id = v_cus and kind = 'merma' and inventory_op_id is not null), 1,
    'la línea de merma queda ligada a su baja de inventario');
  perform tests.eq((select count(*)::int from public.payment_entries), 0,
    'una devolución dañada NO genera dinero ni deuda');

  -- ── Un lote VENCIDO no vuelve a estar disponible aunque llegue íntegro ──────
  perform tests.act_as_owner();
  update public.lots set expiry_date = public.hoy_local() - 1 where id = v_cad;
  perform tests.act_as(v_wh);
  v_r := public.devolver_de_custodia(tests.op(), v_cus,
           jsonb_build_array(jsonb_build_object('lot_id', v_cad, 'qty', 6, 'inspection', 'ok')),
           'regresó completo pero ya venció');
  perform tests.eq((v_r ->> 'dado_de_baja')::int, 6,
    'D-W2-C-9: vencido en custodia se reclasifica como caducado y se da de baja');
  perform tests.eq((v_r ->> 'devuelto_disponible')::int, 0, 'nada vencido vuelve a estar disponible');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.custody_lines
                     where custody_id = v_cus and kind = 'caducado'), 1, 'la causa queda registrada como caducado');
  perform tests.eq((select quantity from public.lots where id = v_cad), 4, 'se dieron de baja las 6 vencidas');
  perform tests.eq(tests.en_poder(v_cus, v_cad), 0, 'el tenedor ya no responde por ellas');

  perform tests.ok(tests.kardex_ok(v_lot) and tests.kardex_ok(v_cad), 'I-04 de W1 intacto tras devoluciones');
  perform tests.eq(tests.conciliacion_errores(), 0, 'conciliación de inventario en cero');
  perform tests.eq(tests.custodia_errores(), 0, 'conciliación de custodia en cero');
end
$t$;
set constraints all immediate;
rollback;
