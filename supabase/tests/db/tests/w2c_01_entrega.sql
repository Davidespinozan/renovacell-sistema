-- W2-C · ENTREGA A CUSTODIA (G-3). Entregar NO es vender ni prestar dinero: el producto
-- sigue siendo de la empresa, solo cambia de manos quién responde por él. Lo ÚNICO que
-- cambia es la disponibilidad.
begin;
do $t$
declare
  v_admin uuid := tests.user('admin'); v_wh uuid := tests.user('warehouse'); v_pos uuid := tests.user('pos');
  v_doc uuid := tests.user('doctor'); v_bill uuid := tests.user('billing');
  v_p uuid := tests.product(100); v_lot uuid; v_lot2 uuid; v_cad uuid; v_cus uuid; v_op uuid; v_r jsonb;
  v_cust_ext uuid;
begin
  v_lot  := tests.stock(v_p, 'W2C-E1', 20);
  v_lot2 := tests.stock(v_p, 'W2C-E2', 5);
  v_cad  := tests.stock(v_p, 'W2C-CAD', 8, public.hoy_local() + 10);
  v_cus  := tests.custodia('vendedor', v_pos);

  -- ── Autoridad: solo Almacén o Dirección entregan ────────────────────────────
  perform tests.act_as(v_pos);
  perform tests.throws(format('select public.entregar_custodia(gen_random_uuid(), %L, %L)', v_cus,
    jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', 5))),
    'NO_AUTORIZADO', 'el tenedor NO se entrega producto a sí mismo');
  perform tests.act_as(v_bill);
  perform tests.throws(format('select public.entregar_custodia(gen_random_uuid(), %L, %L)', v_cus,
    jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', 5))),
    'NO_AUTORIZADO', 'facturación no entrega producto físico');
  perform tests.act_as(v_doc);
  perform tests.throws(format('select public.entregar_custodia(gen_random_uuid(), %L, %L)', v_cus,
    jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', 5))),
    'NO_AUTORIZADO', 'un doctor no entrega en custodia');

  -- ── Validaciones ────────────────────────────────────────────────────────────
  perform tests.act_as(v_wh);
  perform tests.throws(format('select public.entregar_custodia(gen_random_uuid(), %L, ''[]''::jsonb)', v_cus),
    'ENTREGA_SIN_RENGLONES', 'no se entrega la nada');
  perform tests.throws(format('select public.entregar_custodia(gen_random_uuid(), gen_random_uuid(), %L)',
    jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', 1))),
    'CUSTODIA_INEXISTENTE', 'no se entrega a una custodia que no existe');
  perform tests.throws(format('select public.entregar_custodia(gen_random_uuid(), %L, %L)', v_cus,
    jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', 0))),
    'CANTIDAD_INVALIDA', 'cantidad cero rechazada');
  perform tests.throws(format('select public.entregar_custodia(gen_random_uuid(), %L, %L)', v_cus,
    jsonb_build_array(jsonb_build_object('lot_id', gen_random_uuid(), 'qty', 1))),
    'LOTE_INEXISTENTE', 'lote inexistente rechazado');
  perform tests.throws(format('select public.entregar_custodia(gen_random_uuid(), %L, %L)', v_cus,
    jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', 999))),
    'DISPONIBILIDAD_INSUFICIENTE', 'no se entrega más de lo disponible');
  -- Dos renglones del MISMO lote no pueden burlar el tope entre los dos.
  perform tests.throws(format('select public.entregar_custodia(gen_random_uuid(), %L, %L)', v_cus,
    jsonb_build_array(jsonb_build_object('lot_id', v_lot2, 'qty', 3), jsonb_build_object('lot_id', v_lot2, 'qty', 3))),
    'DISPONIBILIDAD_INSUFICIENTE', 'el tope se evalúa AGREGADO por lote (3+3 > 5)');

  -- ── Un lote CADUCADO no se entrega (D-W2-C-9) ───────────────────────────────
  perform tests.act_as_owner();
  update public.lots set expiry_date = public.hoy_local() - 1 where id = v_cad;
  perform tests.act_as(v_wh);
  perform tests.throws(format('select public.entregar_custodia(gen_random_uuid(), %L, %L)', v_cus,
    jsonb_build_array(jsonb_build_object('lot_id', v_cad, 'qty', 1))),
    'LOTE_CADUCADO', 'no se entrega producto vencido en custodia');

  -- ── La entrega ──────────────────────────────────────────────────────────────
  v_op := tests.op();
  v_r := public.entregar_custodia(v_op, v_cus,
           jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', 8),
                             jsonb_build_object('lot_id', v_lot2, 'qty', 2)));
  perform tests.eq(v_r ->> 'status', 'applied', 'la entrega se registra');
  perform tests.eq((v_r ->> 'unidades')::int, 10, 'se entregaron 10 unidades');

  -- 1) NO cambia la existencia propia · 2) NO crea movimiento · 3) NO crea dinero
  perform tests.act_as_owner();
  perform tests.eq((select quantity from public.lots where id = v_lot), 20,
    '1: la entrega NO decrementa lots.quantity (el producto sigue siendo nuestro)');
  perform tests.eq((select count(*)::int from public.inventory_movements
                     where lot_id in (v_lot, v_lot2) and reason <> 'entrada'), 0,
    '2: la entrega NO crea ningún inventory_movement');
  perform tests.eq((select count(*)::int from public.payment_entries), 0,
    '3: la entrega NO crea dinero');
  perform tests.eq((select count(*)::int from public.money_operations), 0,
    '3: la entrega NO genera ninguna operación de dinero');
  perform tests.eq((select count(*)::int from public.refunds), 0, '3: ni reembolsos');
  perform tests.eq((select count(*)::int from public.credit_grants), 0,
    '3: ni crédito: entregar no crea cuenta por cobrar');

  -- 4) SÍ reduce la disponibilidad
  perform tests.eq(tests.disp(v_lot), 12, '4: disponible = 20 − 8');
  perform tests.eq(tests.disp(v_lot2), 3, '4: disponible = 5 − 2');
  perform tests.eq(tests.en_poder(v_cus, v_lot), 8, 'en poder del tenedor: 8');

  -- ── Idempotencia ────────────────────────────────────────────────────────────
  perform tests.act_as(v_wh);
  perform tests.eq(public.entregar_custodia(v_op, v_cus,
           jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', 8),
                             jsonb_build_object('lot_id', v_lot2, 'qty', 2))) ->> 'status',
    'already_applied', 'reintento con el mismo op_id ⇒ no entrega otra vez');
  perform tests.act_as_owner();
  perform tests.eq(tests.en_poder(v_cus, v_lot), 8, 'el reintento no duplicó la entrega');
  perform tests.act_as(v_wh);
  perform tests.throws(format('select public.entregar_custodia(%L, %L, %L)', v_op, v_cus,
    jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', 1))),
    'OP_ID_REUTILIZADO', 'el mismo op_id con otros datos se rechaza');

  -- ── Tenedor EXTERNO: referencia estable, no un correo (D-W2-C-7) ────────────
  perform tests.act_as_owner();
  insert into public.customers (full_name, email, active) values ('Distribuidora Norte', 'a@b.mx', true)
    returning id into v_cust_ext;
  perform tests.act_as(v_admin);
  perform tests.lives(format('select public.abrir_custodia(gen_random_uuid(), ''vendedor'', ''tercero'', null, %L)', v_cust_ext),
    'un tercero sin cuenta puede tener custodia, referenciado en el maestro de clientes');
  perform tests.throws('select public.abrir_custodia(gen_random_uuid(), ''vendedor'', ''staff'', null, null)',
    'TENEDOR_REQUERIDO', 'no hay custodia sin tenedor identificado');
  perform tests.throws(format('select public.abrir_custodia(gen_random_uuid(), ''vendedor'', ''tercero'', %L, %L)', v_pos, v_cust_ext),
    'TENEDOR_REQUERIDO', 'el tenedor es UNO: usuario o cliente, nunca los dos');
  perform tests.throws(format('select public.abrir_custodia(gen_random_uuid(), ''vendedor'', ''tercero'', null, %L)', gen_random_uuid()),
    'CLIENTE_INEXISTENTE', 'un tercero inventado no puede tener custodia');
  perform tests.throws(format('select public.abrir_custodia(gen_random_uuid(), ''vendedor'', ''staff'', %L, null)', v_pos),
    'CUSTODIA_YA_ABIERTA', 'un vendedor tiene UNA sola custodia abierta');

  -- ── Cierre de estado sano ───────────────────────────────────────────────────
  perform tests.act_as_owner();
  perform tests.ok(tests.kardex_ok(v_lot) and tests.kardex_ok(v_lot2), 'I-04 de W1 intacto tras entregar');
  perform tests.eq(tests.conciliacion_errores(), 0, 'conciliación de inventario en cero');
  perform tests.eq(tests.custodia_errores(), 0, 'conciliación de custodia en cero');
end
$t$;
set constraints all immediate;
rollback;
