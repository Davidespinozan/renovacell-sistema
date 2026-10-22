-- CS-1A.6 (186) · conciliación vista desde la base: reversa confirmada (authorized → declined) libera la reserva; una reversa o captura
-- desconocida conserva la reserva; los estados terminales no retroceden; sin evidencia no se sale de desconocido; el operador queda
-- como actor en la bitácora; un pago bancario = como máximo un asiento; captura confirmada se contabiliza después sin banco.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); v_bill uuid := tests.user('billing'); v_pos uuid := tests.user('pos'); v_doc uuid := tests.user('doctor');
        v_prod uuid := tests.product(100); v_o1 uuid; v_o2 uuid; v_o3 uuid; v_o4 uuid; r jsonb; v_id uuid; n int;
        v_3ds jsonb := '{"cs_auth_reference_id":"ref","cs_auth_transaction_id":"tx","cs_auth_status":"AUTHENTICATION_SUCCESSFUL"}';
begin
  perform tests.act_as_owner();
  v_o1 := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 60)));   -- 6,000
  v_o2 := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 30)));   -- 3,000
  v_o3 := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 20)));   -- 2,000
  v_o4 := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 10)));   -- 1,000

  -- ══ 8 · reversa CONFIRMADA de una autorización sin captura: authorized → declined (186), reserva liberada, sin asiento ═══
  perform tests.act_as(v_doc); r := public.cs_intento_abrir(v_o1, 'test'); v_id := (r ->> 'attempt_id')::uuid;
  perform tests.act_as_service();
  perform public.cs_intento_avanzar(v_id, 'tokenized'); perform public.cs_intento_avanzar(v_id, 'auth_setup'); perform public.cs_intento_avanzar(v_id, 'auth_pending'); perform public.cs_intento_avanzar(v_id, 'auth_validated', v_3ds); perform public.cs_intento_avanzar(v_id, 'authz_sent');
  perform public.cs_intento_avanzar(v_id, 'authorized', '{"cs_payment_id":"PAY-A6-1","cs_payment_status":"AUTHORIZED"}');
  perform tests.act_as(v_pos);
  perform tests.throws(format($q$select public.cs_intento_avanzar('%s', 'declined', '{"evidencia":"x"}')$q$, v_id), 'NO_AUTORIZADO', '16 · Caja no concilia');
  perform tests.act_as(v_doc);
  perform tests.throws(format($q$select public.cs_intento_avanzar('%s', 'declined', '{"evidencia":"x"}')$q$, v_id), 'NO_AUTORIZADO', '16 · el doctor no concilia');
  perform tests.act_as(v_bill);
  r := public.cs_intento_avanzar(v_id, 'declined', '{"cs_payment_status":"REVERSED","cs_reason":"reversal:r-1","evidencia":"[billing] cliente canceló · proveedor: auth=aprobada bill=ninguna · reversa REVERSED id r-1"}');
  perform tests.eq(r ->> 'status', 'applied', '8 · reversa confirmada → declined');
  perform tests.eq(public.cs_reservas_activas(v_o1), 0::numeric, '8 · la reserva se libera');
  perform tests.ok(not exists (select 1 from public.payment_entries where order_id = v_o1), '8 · sin asiento');
  perform tests.ok((select actor = v_bill and actor_role = 'billing' and detalle ->> 'evidencia' like '[billing] cliente canceló%' from public.card_payment_attempt_events where attempt_id = v_id and to_status = 'declined'), '8 · el operador y la evidencia quedan en la bitácora');
  perform tests.throws(format($q$select public.cs_intento_avanzar('%s', 'authorized', '{"evidencia":"x"}')$q$, v_id), 'TRANSICION_INVALIDA', 'terminal · declined no retrocede');

  -- ══ 9 · reversa DESCONOCIDA: authorized → unknown conserva la reserva y no expira ═════════════════════════════════
  perform tests.act_as(v_doc); r := public.cs_intento_abrir(v_o2, 'test'); v_id := (r ->> 'attempt_id')::uuid;
  perform tests.act_as_service();
  perform public.cs_intento_avanzar(v_id, 'tokenized'); perform public.cs_intento_avanzar(v_id, 'auth_setup'); perform public.cs_intento_avanzar(v_id, 'auth_pending'); perform public.cs_intento_avanzar(v_id, 'auth_validated', v_3ds); perform public.cs_intento_avanzar(v_id, 'authz_sent');
  perform public.cs_intento_avanzar(v_id, 'authorized', '{"cs_payment_id":"PAY-A6-2"}');
  perform tests.act_as(v_admin);
  perform public.cs_intento_avanzar(v_id, 'unknown_requires_reconciliation', '{"error":"reversa: sin respuesta","evidencia":"[admin] reversa sin respuesta: la reserva se conserva"}');
  perform tests.eq(public.cs_reservas_activas(v_o2), 3000::numeric, '9 · reversa desconocida NO libera la reserva');
  perform tests.throws(format($q$select public.registrar_cobro(tests.op(), '%s', 'efectivo', 1)$q$, v_o2), 'RESERVA_ACTIVA', '14 · otros canales siguen bloqueados');
  perform tests.act_as_owner(); update public.card_payment_attempts set status_at = clock_timestamp() - interval '3 days' where id = v_id;
  perform tests.eq(public.cs_intentos_expirar(), 0, '9 · no expira por tiempo');
  perform tests.act_as(v_admin);
  perform tests.throws(format($q$select public.cs_intento_avanzar('%s', 'declined')$q$, v_id), 'EVIDENCIA_REQUERIDA', '15 · sin evidencia no se resuelve');
  perform tests.throws(format($q$select public.cs_intento_avanzar('%s', 'declined', '{"evidencia":"   "}')$q$, v_id), 'EVIDENCIA_REQUERIDA', '15 · evidencia vacía tampoco');
  r := public.cs_intento_avanzar(v_id, 'declined', '{"evidencia":"[admin] proveedor: auth=aprobada reversa=aprobada (ics_auth_reversal SOK)"}');
  perform tests.ok(r ->> 'status' = 'applied' and public.cs_reservas_activas(v_o2) = 0, '9 · con evidencia de reversa aprobada se libera');

  -- ══ 3/4/5/10/11 · autorización recuperada por consulta → captura confirmada → contabilizar (reintento) ═════════════
  perform tests.act_as(v_doc); r := public.cs_intento_abrir(v_o3, 'test'); v_id := (r ->> 'attempt_id')::uuid;
  perform tests.act_as_service();
  perform public.cs_intento_avanzar(v_id, 'tokenized'); perform public.cs_intento_avanzar(v_id, 'auth_setup'); perform public.cs_intento_avanzar(v_id, 'auth_pending'); perform public.cs_intento_avanzar(v_id, 'auth_validated', v_3ds); perform public.cs_intento_avanzar(v_id, 'authz_sent');
  perform public.cs_intento_avanzar(v_id, 'unknown_requires_reconciliation', '{"error":"autorización: timeout"}');
  perform tests.act_as(v_bill);
  perform public.cs_intento_avanzar(v_id, 'authorized', '{"cs_payment_id":"PAY-A6-3","evidencia":"[billing] consulta: auth=aprobada bill=ninguna","proveedor":{"autorizacion":{"estado":"aprobada","id":"PAY-A6-3"},"captura":{"estado":"ninguna"}}}');
  perform tests.eq((select status from public.card_payment_attempts where id = v_id), 'authorized', '3 · autorización recuperada por consulta');
  perform tests.throws(format($q$select public.cs_intento_contabilizar('%s')$q$, v_id), 'NO_CAPTURADO', '4 · sin captura no hay asiento');
  perform public.cs_intento_avanzar(v_id, 'captured', '{"cs_payment_status":"CAPTURE_PENDING","evidencia":"[billing] captura id cap-3 PENDING","proveedor":{"autorizacion":{"estado":"aprobada","id":"PAY-A6-3"},"captura":{"estado":"aprobada","id":"cap-3","status":"PENDING"}}}');
  r := public.cs_intento_contabilizar(v_id);
  perform tests.eq(r ->> 'status', 'posted', '5 · captura confirmada → contabilizada por Facturación');
  perform tests.eq(public.cs_intento_contabilizar(v_id) ->> 'status', 'already_posted', '11 · reintento idempotente');
  perform tests.eq((select count(*) from public.payment_entries where external_ref = 'PAY-A6-3'), 1::bigint, '10 · un pago = un asiento');
  perform tests.throws(format($q$select public.cs_intento_avanzar('%s', 'unknown_requires_reconciliation', '{"evidencia":"x"}')$q$, v_id), 'TRANSICION_INVALIDA', 'terminal · posted no retrocede');

  -- ══ 13 · conciliación vs cobro manual con la misma referencia (secuencial; la carrera real está en concurrency/cs1a6) ═══
  perform tests.act_as(v_doc); r := public.cs_intento_abrir(v_o4, 'test'); v_id := (r ->> 'attempt_id')::uuid;
  perform tests.act_as_service();
  perform public.cs_intento_avanzar(v_id, 'tokenized'); perform public.cs_intento_avanzar(v_id, 'auth_setup'); perform public.cs_intento_avanzar(v_id, 'auth_pending'); perform public.cs_intento_avanzar(v_id, 'auth_validated', v_3ds); perform public.cs_intento_avanzar(v_id, 'authz_sent');
  perform public.cs_intento_avanzar(v_id, 'captured', '{"cs_payment_id":"PAY-A6-4"}');
  perform tests.act_as(v_admin);
  perform public.registrar_cobro(tests.op(), v_o4, 'tarjeta', 1000, null, 'PAY-A6-4');
  perform tests.ok(public.cs_intento_contabilizar(v_id) ->> 'como' = 'enlazado', '13 · se enlaza al asiento manual, no se duplica');
  perform tests.eq((select count(*) from public.payment_entries where order_id = v_o4), 1::bigint, '13 · un asiento');

  -- ══ 17 · manipulación de identificadores: un id ajeno/inexistente no hace nada ═══════════════════════════════════════
  perform tests.throws($q$select public.cs_intento_contabilizar('00000000-0000-4000-8000-000000000000')$q$, 'INTENTO_INEXISTENTE', '17 · contabilizar id inexistente');
  perform tests.throws($q$select public.cs_intento_avanzar('00000000-0000-4000-8000-000000000000', 'captured', '{"evidencia":"x"}')$q$, 'INTENTO_INEXISTENTE', '17 · avanzar id inexistente');
  -- 186 · máquina de estados: solo authorized ganó declined
  perform tests.ok(public._cs_transicion_valida('authorized', 'declined') and not public._cs_transicion_valida('captured', 'declined') and not public._cs_transicion_valida('posted', 'declined'), '186 · transición acotada');
  perform tests.act_as_owner();
end $t$;
rollback;
