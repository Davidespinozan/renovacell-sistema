-- CS-1A.1b (185) · guarda universal de reservas: ningún canal registra cobros que invadan una reserva activa de tarjeta.
-- Sin reservas, el ledger se comporta igual que antes (pagos parciales, sobrepago solo marcado, reembolsos, reversas, crédito).
-- El consumo de la reserva propia es estructural (captured + external_ref = cs_payment_id + importe + tarjeta): una variable de
-- sesión falsificada no evade nada. Las carreras reales están en concurrency/cs1b_concurrency.sh.
begin;
\ir ../../../rollback/pedidos_previos/99_down.sql   -- PEDIDOS-PREVIOS (20270207) se baja primero: esta prueba fija la versión anterior de pertenencia del doctor
do $t$
declare v_admin uuid := tests.fixture_admin(); v_doc uuid := tests.user('doctor'); v_bill uuid := tests.user('billing'); v_pos uuid := tests.user('pos');
        v_prod uuid := tests.product(100); v_o1 uuid; v_o2 uuid; v_o3 uuid; v_o4 uuid; v_o5 uuid; v_o6 uuid; v_pv uuid;
        r jsonb; v_id uuid; v_id2 uuid; v_claim uuid; v_ref uuid; v_entry uuid; m record;
begin
  perform tests.act_as_owner();
  v_o1 := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 100)));   -- 10,000
  v_o2 := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 50)));    -- 5,000
  v_o3 := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 20)));    -- 2,000
  v_o4 := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 10)));    -- 1,000
  v_o5 := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 30)));    -- 3,000
  v_o6 := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 40)));    -- 4,000

  -- ══ 12/13 · SIN reservas: comportamiento histórico intacto (parcial, total, sobrepago solo marcado) ═══
  perform tests.act_as(v_admin);
  perform public.registrar_cobro(tests.op(), v_o3, 'transferencia', 500);
  perform tests.eq((select estado_pago from public.v_order_money where order_id = v_o3), 'parcial', '12 · pago parcial sin reservas pasa');
  perform public.registrar_cobro(tests.op(), v_o3, 'efectivo', 2000);
  perform tests.ok((select sobrepago and estado_pago = 'paid' from public.v_order_money where order_id = v_o3), '13 · sobrepago histórico sigue permitido y solo marcado');

  -- ══ 1/2 · reserva total activa: Caja (efectivo) y Facturación (transferencia verificada) rechazados ═════
  perform tests.act_as(v_doc);
  r := public.cs_intento_abrir(v_o1, 'test'); v_id := (r ->> 'attempt_id')::uuid;
  perform tests.eq((r ->> 'amount')::numeric, 10000::numeric, '1 · reserva = saldo completo');
  perform tests.act_as(v_admin);
  perform tests.throws(format($q$select public.registrar_cobro(tests.op(), '%s', 'efectivo', 4000)$q$, v_o1), 'RESERVA_ACTIVA', '1 · Caja/Dirección no cobra sobre la reserva');
  perform tests.throws(format($q$select public.registrar_cobro(tests.op(), '%s', 'transferencia', 10000)$q$, v_o1), 'RESERVA_ACTIVA', '1 · ni el total');
  perform tests.act_as(v_doc);
  v_claim := (public.reportar_pago(tests.op(), v_o1, 'transferencia', 4000, 'REF-1') ->> 'claim_id')::uuid;   -- declarar no mueve dinero: permitido
  perform tests.act_as(v_bill);
  perform tests.throws(format($q$select public.revisar_pago(tests.op(), '%s', 'verificar')$q$, v_claim), 'RESERVA_ACTIVA', '2 · Facturación no verifica (asiento) sobre la reserva');
  perform tests.eq((select status from public.payment_claims where id = v_claim), 'reportado', '2 · la declaración sigue abierta (sin asiento)');
  perform tests.ok(not exists (select 1 from public.payment_entries where order_id = v_o1), '2 · cero asientos');
  perform tests.ok(not exists (select 1 from public.money_operations mo where mo.result ->> 'order_id' = v_o1::text), '2 · la operación fallida no quedó registrada');

  -- ══ 11 · reserva expirada de forma segura libera; cobros vuelven a pasar ═══════════════════════════
  perform tests.act_as_owner();
  update public.card_payment_attempts set status_at = clock_timestamp() - interval '16 minutes' where id = v_id;
  perform tests.eq(public.cs_intentos_expirar(), 1, '11 · expira (nunca se envió al banco)');
  perform tests.act_as(v_bill);
  perform tests.eq(public.revisar_pago(tests.op(), v_claim, 'verificar') ->> 'status', 'applied', '11 · tras expirar, Facturación verifica la transferencia');
  perform tests.eq((select saldo from public.v_order_money where order_id = v_o1), 6000::numeric, '11 · saldo 6,000');

  -- ══ 6 · desconocido mantiene la reserva ═══════════════════════════════════════════════════════════
  perform tests.act_as(v_doc);
  r := public.cs_intento_abrir(v_o1, 'test'); v_id := (r ->> 'attempt_id')::uuid;
  perform tests.eq((r ->> 'amount')::numeric, 6000::numeric, '6 · nueva reserva por el saldo vigente');
  perform tests.act_as_service();
  perform public.cs_intento_avanzar(v_id, 'tokenized'); perform public.cs_intento_avanzar(v_id, 'auth_setup'); perform public.cs_intento_avanzar(v_id, 'auth_pending'); perform public.cs_intento_avanzar(v_id, 'auth_validated'); perform public.cs_intento_avanzar(v_id, 'authz_sent');
  perform public.cs_intento_avanzar(v_id, 'unknown_requires_reconciliation', jsonb_build_object('error', 'timeout'));
  perform tests.act_as(v_admin);
  perform tests.throws(format($q$select public.registrar_cobro(tests.op(), '%s', 'efectivo', 1)$q$, v_o1), 'RESERVA_ACTIVA', '6 · desconocido bloquea hasta conciliar');
  perform tests.act_as_owner();
  update public.card_payment_attempts set status_at = clock_timestamp() - interval '3 days' where id = v_id;
  perform tests.eq(public.cs_intentos_expirar(), 0, '6 · el desconocido no expira');

  -- ══ 7/8/9/10 · capturado pendiente: bloquea a otros; solo su propio asiento pasa; contexto falsificado no sirve ═══
  perform tests.act_as(v_bill);
  perform public.cs_intento_avanzar(v_id, 'captured', jsonb_build_object('cs_payment_id', 'PAY-B1', 'evidencia', 'Transaction Search: aprobada', 'proveedor', '{"autorizacion":{"estado":"aprobada","id":"PAY-B1"},"captura":{"estado":"aprobada","id":"PAY-B1"}}'::jsonb));
  perform tests.act_as(v_admin);
  perform tests.throws(format($q$select public.registrar_cobro(tests.op(), '%s', 'efectivo', 6000)$q$, v_o1), 'RESERVA_ACTIVA', '7 · captured sin contabilizar sigue reservando');
  perform tests.throws(format($q$select set_config('app.cs_attempt', '%s', true); select public.registrar_cobro(tests.op(), '%s', 'efectivo', 6000)$q$, v_id, v_o1), 'RESERVA_ACTIVA', '10 · la variable de sesión falsificada no evade la guarda');
  perform tests.throws(format($q$select public.registrar_cobro(tests.op(), '%s', 'tarjeta', 5999, null, 'PAY-B1')$q$, v_o1), 'RESERVA_ACTIVA', '9 · misma referencia con otro importe: rechazado');
  perform tests.throws(format($q$select public.registrar_cobro(tests.op(), '%s', 'transferencia', 6000, null, 'PAY-B1')$q$, v_o1), 'RESERVA_ACTIVA', '9 · misma referencia e importe pero otra vía: rechazado');
  perform tests.throws(format($q$select public.registrar_cobro(tests.op(), '%s', 'tarjeta', 6000, null, 'PAY-OTRO')$q$, v_o1), 'RESERVA_ACTIVA', '9 · tarjeta con otra referencia: rechazado');
  perform tests.act_as_service();
  r := public.cs_intento_contabilizar(v_id);
  perform tests.ok(r ->> 'status' = 'posted' and r ->> 'como' = 'nuevo', '8 · la contabilización propia consume la reserva');
  perform tests.eq((select estado_pago from public.v_order_money where order_id = v_o1), 'paid', '8 · pagado');
  perform tests.eq(public.cs_reservas_activas(v_o1), 0::numeric, '8 · sin reservas');
  perform tests.act_as(v_admin);
  perform tests.throws(format($q$select public.registrar_cobro(tests.op(), '%s', 'tarjeta', 6000, null, 'PAY-B1')$q$, v_o1), 'uq_entry_external_ref', '15 · la misma referencia no se registra dos veces (ledger)');

  -- ══ 9 · reserva ajena: la referencia de un intento de OTRO pedido no abre la puerta ═══════════════════
  perform tests.act_as(v_doc);
  r := public.cs_intento_abrir(v_o2, 'test'); v_id2 := (r ->> 'attempt_id')::uuid;   -- 5,000 reservados en o2
  r := public.cs_intento_abrir(v_o4, 'test'); v_id := (r ->> 'attempt_id')::uuid;    -- 1,000 reservados en o4
  perform tests.act_as_service();
  perform public.cs_intento_avanzar(v_id2, 'tokenized'); perform public.cs_intento_avanzar(v_id2, 'auth_setup'); perform public.cs_intento_avanzar(v_id2, 'auth_pending'); perform public.cs_intento_avanzar(v_id2, 'auth_validated'); perform public.cs_intento_avanzar(v_id2, 'authz_sent');
  perform public.cs_intento_avanzar(v_id2, 'captured', jsonb_build_object('cs_payment_id', 'PAY-B2'));
  perform tests.act_as(v_admin);
  perform tests.throws(format($q$select public.registrar_cobro(tests.op(), '%s', 'tarjeta', 1000, null, 'PAY-B2')$q$, v_o4), 'RESERVA_ACTIVA', '9 · referencia ajena (de o2) no consume la reserva de o4');
  perform tests.act_as_service();
  perform tests.eq(public.cs_intento_contabilizar(v_id2) ->> 'status', 'posted', '9 · o2 se contabiliza con su propia referencia');

  -- ══ 5 · vender_pos: crea SIEMPRE su propio pedido; no puede apuntar a un pedido reservado ═══════════════
  perform tests.act_as_owner();
  v_pv := tests.venta_pos(v_pos, 250, 'efectivo');
  perform tests.ok((select estado_pago = 'paid' from public.v_order_money where order_id = v_pv), '5 · venta de mostrador normal pasa con reservas en otros pedidos');
  perform tests.act_as(v_pos);
  perform tests.throws(format($q$select public.vender_pos('%s', 'X', 1000, 'efectivo', null, '{}', '[]', '[]')$q$, v_o4), 'PEDIDO_EXISTENTE', '5 · vender_pos no cobra un pedido existente (ni reservado)');

  -- ══ 14 · reembolso y reversa no se ven afectados por reservas ═════════════════════════════════════════
  perform tests.act_as(v_admin);
  v_ref := (public.autorizar_reembolso(tests.op(), v_o2, 'devolucion', 1000, 'prueba 1b') ->> 'refund_id')::uuid;
  r := public.pagar_reembolso(tests.op(), v_ref, 'tarjeta');
  perform tests.eq(r ->> 'status', 'applied', '14 · reembolso (salida) pasa');
  perform tests.act_as(v_doc);
  r := public.cs_intento_abrir(v_o2, 'test');   -- reserva por el saldo restante (1,000)
  perform tests.eq((r ->> 'amount')::numeric, 1000::numeric, '14 · nueva reserva por lo reembolsado');
  perform tests.act_as(v_admin);
  select id into v_entry from public.payment_entries where order_id = v_o2 and direction = 'out' and reversal_of is null limit 1;
  r := public.reversar_asiento(tests.op(), v_entry, 'reversa de prueba');
  perform tests.eq(r ->> 'status', 'applied', '14 · reversa de una salida (entrada con reversal_of) pasa aunque haya reserva');
  perform tests.ok((select sobrepago from public.v_order_money where order_id = v_o2) is not null, '14 · vista intacta');

  -- ══ 12 · pago parcial legítimo con reserva PARCIAL: cabe en el disponible ═══════════════════════════════
  perform tests.act_as(v_admin);
  perform public.registrar_cobro(tests.op(), v_o5, 'transferencia', 1000);     -- saldo 2,000
  perform tests.act_as(v_doc);
  r := public.cs_intento_abrir(v_o5, 'test'); v_id := (r ->> 'attempt_id')::uuid;   -- reserva 2,000 (todo el saldo)
  perform tests.act_as_owner();
  perform public._w2_trusted(true); update public.orders set total = 3500 where id = v_o5; perform public._w2_trusted(false);   -- el pedido creció: disponible 500
  perform tests.act_as(v_admin);
  perform public.registrar_cobro(tests.op(), v_o5, 'efectivo', 500);
  perform tests.eq((select saldo_disponible from public.v_order_disponible where order_id = v_o5), 0::numeric, '12 · un cobro que cabe en el disponible pasa');
  perform tests.throws(format($q$select public.registrar_cobro(tests.op(), '%s', 'efectivo', 1)$q$, v_o5), 'RESERVA_ACTIVA', '12 · un peso más ya invade la reserva');

  -- ══ 17 · los comandos financieros no cambiaron ═══════════════════════════════════════════════════════
  perform tests.eq(md5(pg_get_functiondef('public.registrar_cobro(uuid,uuid,text,numeric,date,text,uuid,text)'::regprocedure)), '0283a2987642a72f1fca89d6691e3c71', '17 · registrar_cobro = SEC-B');
  perform tests.eq(md5(pg_get_functiondef('public.reportar_pago(uuid,uuid,text,numeric,text,uuid,text)'::regprocedure)), 'a41ef8615e80f0834c2e6b48e75d4004', '17 · reportar_pago = SEC-B');
  perform tests.ok(exists (select 1 from pg_trigger where tgname = 'trg_cs_reserva_guard' and tgrelid = 'public.payment_entries'::regclass), '17 · la guarda está en payment_entries');
  perform tests.act_as_owner();
end $t$;
rollback;
