-- W2-C · FALTANTE / MERMA / CADUCADO (G-5, D-W2-C-4). Una diferencia física es una
-- PÉRDIDA DE LA EMPRESA: baja de inventario con motivo y evidencia, en un solo acto
-- atómico. Nunca una venta fingida, y NUNCA una deuda inferida del tenedor.
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_wh uuid := tests.user('warehouse'); v_pos uuid := tests.user('pos');
  v_bill uuid := tests.user('billing'); v_p uuid := tests.product(100);
  v_lot uuid; v_cus uuid; v_op uuid; v_r jsonb; v_inv uuid;
begin
  v_lot := tests.stock(v_p, 'W2C-P1', 30);
  v_cus := tests.custodia('vendedor', v_pos);
  perform tests.entregar(v_cus, v_lot, 12);

  -- ── Autoridad: quien verifica físicamente asienta la pérdida ────────────────
  perform tests.act_as(v_pos);
  perform tests.throws(format('select public.registrar_perdida_custodia(gen_random_uuid(), %L, ''faltante'', %L, ''se me perdió'')',
    v_cus, jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', 1))),
    'NO_AUTORIZADO', 'el tenedor NO declara sus propias pérdidas');
  perform tests.act_as(v_bill);
  perform tests.throws(format('select public.registrar_perdida_custodia(gen_random_uuid(), %L, ''faltante'', %L, ''x'')',
    v_cus, jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', 1))),
    'NO_AUTORIZADO', 'facturación no asienta pérdidas físicas');

  -- ── Validaciones ────────────────────────────────────────────────────────────
  perform tests.act_as(v_wh);
  perform tests.throws(format('select public.registrar_perdida_custodia(gen_random_uuid(), %L, ''robo'', %L, ''x'')',
    v_cus, jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', 1))),
    'TIPO_INVALIDO', 'vocabulario cerrado: faltante, merma o caducado');
  perform tests.throws(format('select public.registrar_perdida_custodia(gen_random_uuid(), %L, ''faltante'', %L, ''   '')',
    v_cus, jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', 1))),
    'MOTIVO_REQUERIDO', 'toda pérdida lleva motivo');
  perform tests.throws(format('select public.registrar_perdida_custodia(gen_random_uuid(), %L, ''faltante'', %L, ''inventario fisico'')',
    v_cus, jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', 99))),
    'CUSTODIA_SALDO_INSUFICIENTE', 'no se pierde más de lo que tenía en poder');

  -- ── 10) La pérdida es ATÓMICA: libro + baja real ────────────────────────────
  v_op := tests.op();
  v_r := public.registrar_perdida_custodia(v_op, v_cus, 'faltante',
           jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', 3)),
           'conteo físico en el coche: faltan 3', 'acta-2026-11');
  perform tests.eq(v_r ->> 'status', 'applied', 'la pérdida se registra');
  perform tests.eq((v_r ->> 'unidades')::int, 3, '3 unidades perdidas');
  perform tests.act_as_owner();
  perform tests.eq((select quantity from public.lots where id = v_lot), 27,
    '10: la existencia propia baja de 30 a 27 (la pérdida es real)');
  perform tests.eq(tests.en_poder(v_cus, v_lot), 9, '10: el tenedor deja de responder por ellas (12 − 3)');
  perform tests.eq(tests.disp(v_lot), 18, '10: disponible = 27 − 9');
  perform tests.eq((select count(*)::int from public.inventory_movements
                     where lot_id = v_lot and reason = 'merma'), 1,
    '10: existe la baja física en el kardex de W1');
  select inventory_op_id into v_inv from public.custody_lines where custody_id = v_cus and kind = 'faltante';
  perform tests.ok(v_inv is not null, '10: la línea queda ligada a su baja');
  perform tests.eq((select -sum(change)::int from public.inventory_movements where op_id = v_inv), 3,
    '10: la baja es exactamente por las unidades perdidas');
  perform tests.eq((select count(*)::int from public.inventory_operations where op_id = v_inv), 1,
    '10: la baja tiene su propia operación registrada en W1');
  perform tests.eq((select evidence_ref from public.custody_lines where custody_id = v_cus and kind = 'faltante'),
    'acta-2026-11', 'la evidencia queda asentada');

  -- ── 11) La pérdida NO crea deuda ni dinero ──────────────────────────────────
  perform tests.eq((select count(*)::int from public.payment_entries), 0, '11: sin asientos de dinero');
  perform tests.eq((select count(*)::int from public.payment_claims), 0, '11: sin declaraciones de pago');
  perform tests.eq((select count(*)::int from public.refunds), 0, '11: sin reembolsos');
  perform tests.eq((select count(*)::int from public.credit_grants), 0, '11: sin crédito');
  perform tests.eq((select count(*)::int from public.orders), 0, '11: sin venta fingida');
  perform tests.eq((select count(*)::int from public.custody_lines where kind = 'faltante' and order_id is not null), 0,
    '11: la pérdida no se cuelga de ningún pedido');
  perform tests.ok((select nota from (select v_r ->> 'nota' as nota) x) like '%NO genera deuda%',
    '11: el comando lo dice explícito en su respuesta');

  -- ── Idempotencia ────────────────────────────────────────────────────────────
  perform tests.act_as(v_wh);
  perform tests.eq(public.registrar_perdida_custodia(v_op, v_cus, 'faltante',
           jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', 3)),
           'conteo físico en el coche: faltan 3', 'acta-2026-11') ->> 'status',
    'already_applied', 'reintento ⇒ no se pierde dos veces');
  perform tests.act_as_owner();
  perform tests.eq((select quantity from public.lots where id = v_lot), 27, 'el reintento no dio de baja otra vez');
  perform tests.eq((select count(*)::int from public.inventory_movements where lot_id = v_lot and reason = 'merma'), 1,
    'una sola baja en el kardex');

  -- ── Merma y caducado como causas distintas ──────────────────────────────────
  perform tests.act_as(v_wh);
  perform public.registrar_perdida_custodia(tests.op(), v_cus, 'merma',
    jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', 2)), 'frascos rotos');
  perform public.registrar_perdida_custodia(tests.op(), v_cus, 'caducado',
    jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', 1)), 'venció en poder del vendedor');
  perform tests.act_as_owner();
  perform tests.eq((select count(distinct kind)::int from public.custody_lines
                     where custody_id = v_cus and kind in ('faltante','merma','caducado')), 3,
    'las tres causas se distinguen en el libro; físicamente las tres son merma');
  perform tests.eq((select count(*)::int from public.inventory_movements where lot_id = v_lot and reason = 'merma'), 3,
    'tres bajas físicas, una por pérdida');
  perform tests.eq((select quantity from public.lots where id = v_lot), 24, '30 − 3 − 2 − 1 = 24');
  perform tests.eq(tests.en_poder(v_cus, v_lot), 6, '12 − 3 − 2 − 1 = 6 en poder');

  perform tests.ok(tests.kardex_ok(v_lot), 'I-04 de W1 intacto tras las pérdidas');
  perform tests.eq(tests.conciliacion_errores(), 0, 'conciliación de inventario en cero');
  perform tests.eq(tests.custodia_errores(), 0, 'conciliación de custodia en cero');
end
$t$;
set constraints all immediate;
rollback;
