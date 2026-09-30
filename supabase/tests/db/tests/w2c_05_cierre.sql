-- W2-C · CIERRE Y LIQUIDACIÓN. Una custodia no se cierra con producto en la calle: todo
-- lo entregado tiene que estar vendido, devuelto o dado de baja. La liquidación es un
-- ESTADO (qué salió, qué volvió, qué se vendió, cuánto entró), no un evento de dinero:
-- el dinero ya nació en cada venta por la ruta de W2.
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_wh uuid := tests.user('warehouse'); v_pos uuid := tests.user('pos');
  v_p uuid := tests.product(150); v_lot uuid; v_cus uuid; v_op uuid; v_r jsonb; v_liq record;
  v_sale uuid := gen_random_uuid();
begin
  v_lot := tests.stock(v_p, 'W2C-C1', 20);
  v_cus := tests.custodia('evento', v_pos, 'Congreso Nacional');
  perform tests.entregar(v_cus, v_lot, 10);

  -- ── Autoridad ───────────────────────────────────────────────────────────────
  perform tests.act_as(v_wh);
  perform tests.throws(format('select public.cerrar_custodia(gen_random_uuid(), %L, ''terminó el evento'')', v_cus),
    'NO_AUTORIZADO', 'solo Dirección cierra y liquida');
  perform tests.act_as(v_pos);
  perform tests.throws(format('select public.cerrar_custodia(gen_random_uuid(), %L, ''ya acabé'')', v_cus),
    'NO_AUTORIZADO', 'el tenedor no se cierra su propia custodia');
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.cerrar_custodia(gen_random_uuid(), %L, ''  '')', v_cus),
    'MOTIVO_REQUERIDO', 'el cierre lleva motivo');

  -- ── 14) No cierra con saldo en poder ────────────────────────────────────────
  perform tests.throws(format('select public.cerrar_custodia(gen_random_uuid(), %L, ''terminó el evento'')', v_cus),
    'CUSTODIA_CON_SALDO', '14: no se cierra con 10 unidades todavía en la calle');

  -- Se vende parte, se devuelve parte, se pierde parte.
  perform tests.act_as(v_pos);
  perform tests.ok(public.vender_pos(v_sale, 'POS-EV1', 1, 'efectivo', null, '{}',
      jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 4)),
      jsonb_build_array(jsonb_build_object('line_index', 0, 'lot_id', v_lot, 'qty', 4)),
      false, null, null, 600, v_cus),
    'el evento vende 4');
  perform tests.act_as(v_wh);
  perform public.devolver_de_custodia(tests.op(), v_cus,
    jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', 5, 'inspection', 'ok')));
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.cerrar_custodia(gen_random_uuid(), %L, ''terminó el evento'')', v_cus),
    'CUSTODIA_CON_SALDO', '14: sigue faltando 1 unidad por resolver');
  perform tests.act_as(v_wh);
  perform public.registrar_perdida_custodia(tests.op(), v_cus, 'faltante',
    jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', 1)), 'no apareció al cierre del stand');

  -- ── El cierre con liquidación ───────────────────────────────────────────────
  perform tests.act_as(v_admin);
  v_op := tests.op();
  v_r := public.cerrar_custodia(v_op, v_cus, 'terminó el evento');
  perform tests.eq(v_r ->> 'status', 'applied', 'la custodia se cierra cuando ya no hay nada en la calle');
  perform tests.eq((v_r ->> 'entregadas')::int, 10, 'liquidación: 10 entregadas');
  perform tests.eq((v_r ->> 'vendidas')::int, 4, 'liquidación: 4 vendidas');
  perform tests.eq((v_r ->> 'devueltas')::int, 5, 'liquidación: 5 devueltas');
  perform tests.eq((v_r ->> 'perdidas')::int, 1, 'liquidación: 1 perdida');
  perform tests.eq((v_r ->> 'importe_vendido')::numeric, 600::numeric, 'liquidación: importe del servidor (4 × 150)');
  perform tests.eq((v_r ->> 'cobrado')::numeric, 600::numeric, 'liquidación: cobrado, leído del libro de W2');
  perform tests.eq((v_r ->> 'saldo')::numeric, 0::numeric, 'liquidación: sin saldo, se cobró todo al vender');

  -- El cierre NO mueve dinero: lo que hay es lo que ya entró en la venta.
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.payment_entries), 1,
    'el cierre no crea ni un asiento más: el dinero nació en la venta');
  perform tests.eq((select count(*)::int from public.refunds), 0, 'el cierre no genera reembolsos');
  perform tests.eq((select count(*)::int from public.credit_grants), 0, 'el cierre no genera crédito');
  perform tests.eq((select status from public.custodies where id = v_cus), 'cerrada', 'queda cerrada');
  perform tests.ok((select closed_at is not null and closed_by is not null and close_reason is not null
                      from public.custodies where id = v_cus), 'quién, cuándo y por qué quedó registrado');

  -- ── Idempotencia y efectos posteriores ──────────────────────────────────────
  perform tests.act_as(v_admin);
  perform tests.eq(public.cerrar_custodia(v_op, v_cus, 'terminó el evento') ->> 'status', 'already_applied',
    'reintento con el mismo op_id ⇒ idempotente');
  perform tests.eq(public.cerrar_custodia(tests.op(), v_cus, 'otra vez') ->> 'status', 'already_closed',
    'cerrar de nuevo con otro op_id ⇒ ya estaba cerrada, sin efecto');
  perform tests.act_as(v_wh);
  perform tests.throws(format('select public.entregar_custodia(gen_random_uuid(), %L, %L)', v_cus,
    jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', 1))),
    'CUSTODIA_CERRADA', 'a una custodia cerrada no se le entrega más');
  perform tests.throws(format('select public.devolver_de_custodia(gen_random_uuid(), %L, %L)', v_cus,
    jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', 1, 'inspection', 'ok'))),
    'CUSTODIA_CERRADA', 'ni se le reciben devoluciones');

  -- ── El evento se identifica por su ID, no por su nombre (bug legacy cerrado) ─
  perform tests.act_as(v_admin);
  perform tests.lives(format('select public.abrir_custodia(gen_random_uuid(), ''evento'', ''staff'', %L, null, ''Congreso Nacional'')', v_pos),
    'un evento HOMÓNIMO es otra custodia: los sobrantes ya no se confunden por nombre');

  perform tests.act_as_owner();
  select * into v_liq from public.v_custody_liquidacion where custody_id = v_cus;
  perform tests.eq(v_liq.unidades_en_poder, 0, 'la custodia cerrada no tiene nada en poder');
  perform tests.eq((select quantity from public.lots where id = v_lot), 15,
    'existencia final: 20 − 4 vendidas − 1 perdida = 15');
  perform tests.eq(tests.disp(v_lot), 15, 'todo lo que queda está disponible otra vez');
  perform tests.ok(tests.kardex_ok(v_lot), 'I-04 de W1 intacto tras el ciclo completo');
  perform tests.eq(tests.conciliacion_errores(), 0, 'conciliación de inventario en cero');
  perform tests.eq(tests.custodia_errores(), 0, 'conciliación de custodia en cero');
end
$t$;
set constraints all immediate;
rollback;
