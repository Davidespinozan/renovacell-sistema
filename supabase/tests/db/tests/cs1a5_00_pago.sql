-- CS-1A.5 (sobre 184/185, sin migración nueva) · el camino de cobro visto desde la base: authz_sent es la compuerta (la segunda
-- solicitud recibe 'already'), AUTHORIZED sin captura no se contabiliza, captured → posted una sola vez, el desconocido conserva
-- la reserva, el fallo tras captura se completa después sin repetir el cargo, y el importe fijado no cambia con el navegador.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); v_doc uuid := tests.user('doctor'); v_prod uuid := tests.product(100);
        v_o1 uuid; v_o2 uuid; v_o3 uuid; v_o4 uuid; r jsonb; v_id uuid; v_entry uuid; m record;
        v_3ds jsonb := '{"cs_auth_reference_id":"ref-1","cs_auth_transaction_id":"tx-1","cs_auth_status":"AUTHENTICATION_SUCCESSFUL","cs_eci":"05"}';
begin
  perform tests.act_as_owner();
  v_o1 := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 60)));   -- 6,000
  v_o2 := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 30)));   -- 3,000
  v_o3 := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 20)));   -- 2,000
  v_o4 := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 10)));   -- 1,000

  -- ══ 1/2 · 3DS validada (frictionless o reto: mismo estado final) → authz_sent → authorized → captured → posted ═══
  perform tests.act_as(v_doc);
  r := public.cs_intento_abrir(v_o1, 'test'); v_id := (r ->> 'attempt_id')::uuid;
  perform tests.act_as_service();
  perform public.cs_intento_avanzar(v_id, 'tokenized'); perform public.cs_intento_avanzar(v_id, 'auth_setup', '{"cs_auth_reference_id":"ref-1"}'); perform public.cs_intento_avanzar(v_id, 'auth_pending');
  perform public.cs_intento_avanzar(v_id, 'auth_validated', v_3ds);
  perform tests.throws(format($q$select public.cs_intento_contabilizar('%s')$q$, v_id), 'NO_CAPTURADO', '13 · auth_validated no se contabiliza');
  r := public.cs_intento_avanzar(v_id, 'authz_sent');
  perform tests.eq(r ->> 'status', 'applied', '1 · authz_sent (saldo reconfirmado) antes de llamar al banco');
  r := public.cs_intento_avanzar(v_id, 'authz_sent');
  perform tests.eq(r ->> 'status', 'already', '8 · segunda solicitud simultánea: already (la Edge NO llama al banco)');
  -- 3 · AUTHORIZED sin captura: evidencia guardada, SIN asiento
  perform public.cs_intento_avanzar(v_id, 'authorized', '{"cs_payment_id":"PAY-A5-1","cs_payment_status":"AUTHORIZED","cs_reconciliation_id":"rec-1","cs_approval_code":"831000"}');
  perform tests.throws(format($q$select public.cs_intento_contabilizar('%s')$q$, v_id), 'NO_CAPTURADO', '3 · autorizada sin captura NO se contabiliza');
  perform tests.ok(not exists (select 1 from public.payment_entries where order_id = v_o1), '3 · cero asientos');
  perform tests.eq(public.cs_reservas_activas(v_o1), 6000::numeric, '3 · la reserva sigue (dinero retenido en el banco)');
  perform tests.act_as(v_admin);
  perform tests.throws(format($q$select public.registrar_cobro(tests.op(), '%s', 'efectivo', 100)$q$, v_o1), 'RESERVA_ACTIVA', '10 · otros canales siguen bloqueados');
  perform tests.act_as_service();
  -- captura confirmada → posted
  perform public.cs_intento_avanzar(v_id, 'captured', '{"cs_payment_status":"CAPTURE_PENDING","cs_reason":"capture:CAP-1"}');
  r := public.cs_intento_contabilizar(v_id);
  perform tests.ok(r ->> 'status' = 'posted' and r ->> 'como' = 'nuevo' and r ->> 'payment_status' = 'paid', '1 · captured → posted: asiento y pedido pagado');
  v_entry := (r ->> 'entry_id')::uuid;
  perform tests.ok((select amount = 6000 and method = 'tarjeta' and external_ref = 'PAY-A5-1' and evidence_ref = v_id::text from public.payment_entries where id = v_entry), '4 · asiento = importe del intento, referencia = id de pago');
  r := public.cs_intento_contabilizar(v_id);
  perform tests.eq(r ->> 'status', 'already_posted', '18 · repetición idempotente');
  perform tests.eq((select count(*) from public.payment_entries where order_id = v_o1), 1::bigint, '18 · un solo asiento');
  perform tests.eq((select cs_approval_code from public.card_payment_attempts where id = v_id), '831000', '4 · evidencia bancaria conservada');

  -- ══ 4 · rechazo bancario: declined, reserva liberada, el pedido vuelve a ser cobrable ═══════════════════════════
  perform tests.act_as(v_doc);
  r := public.cs_intento_abrir(v_o2, 'test'); v_id := (r ->> 'attempt_id')::uuid;
  perform tests.act_as_service();
  perform public.cs_intento_avanzar(v_id, 'tokenized'); perform public.cs_intento_avanzar(v_id, 'auth_setup'); perform public.cs_intento_avanzar(v_id, 'auth_pending'); perform public.cs_intento_avanzar(v_id, 'auth_validated', v_3ds); perform public.cs_intento_avanzar(v_id, 'authz_sent');
  perform public.cs_intento_avanzar(v_id, 'declined', '{"cs_payment_id":"PAY-A5-2","cs_payment_status":"DECLINED","cs_reason":"INSUFFICIENT_FUND"}');
  perform tests.eq(public.cs_reservas_activas(v_o2), 0::numeric, '4 · rechazo libera la reserva');
  perform tests.act_as(v_doc);
  perform tests.eq(public.cs_intento_abrir(v_o2, 'test') ->> 'status', 'created', '4 · se puede intentar con otra tarjeta');

  -- ══ 5/6 · timeout tras enviar = desconocido: conserva la reserva, no expira, no se contabiliza; se resuelve con evidencia ═══
  r := public.cs_intento_abrir(v_o3, 'test'); v_id := (r ->> 'attempt_id')::uuid;
  perform tests.act_as_service();
  perform public.cs_intento_avanzar(v_id, 'tokenized'); perform public.cs_intento_avanzar(v_id, 'auth_setup'); perform public.cs_intento_avanzar(v_id, 'auth_pending'); perform public.cs_intento_avanzar(v_id, 'auth_validated', v_3ds); perform public.cs_intento_avanzar(v_id, 'authz_sent');
  perform public.cs_intento_avanzar(v_id, 'unknown_requires_reconciliation', '{"error":"autorización: sin respuesta en 30000 ms"}');
  perform tests.eq(public.cs_reservas_activas(v_o3), 2000::numeric, '5 · desconocido conserva la reserva');
  perform tests.throws(format($q$select public.cs_intento_contabilizar('%s')$q$, v_id), 'NO_CAPTURADO', '6 · desconocido no se contabiliza');
  perform tests.throws(format($q$select public.cs_intento_avanzar('%s', 'authz_sent')$q$, v_id), 'TRANSICION_INVALIDA', '7 · no se vuelve a enviar al banco');
  perform tests.act_as_owner();
  update public.card_payment_attempts set status_at = clock_timestamp() - interval '2 days' where id = v_id;
  perform tests.eq(public.cs_intentos_expirar(), 0, '6 · no expira solo');
  perform tests.act_as(v_admin);
  r := public.cs_intento_avanzar(v_id, 'captured', '{"cs_payment_id":"PAY-A5-3","evidencia":"Transaction Search: AUTHORIZED+capture PENDING","proveedor":{"autorizacion":{"estado":"aprobada","id":"PAY-A5-3"},"captura":{"estado":"aprobada","id":"PAY-A5-3","status":"PENDING"}}}');
  perform tests.eq(r ->> 'status', 'applied', '6 · conciliación con evidencia → captured');
  perform tests.eq(public.cs_intento_contabilizar(v_id) ->> 'status', 'posted', '6 · y se contabiliza una vez');

  -- ══ 17 · captura confirmada pero la base falló antes de contabilizar: el intento queda captured; completar después sin repetir ═══
  perform tests.act_as(v_doc);
  r := public.cs_intento_abrir(v_o4, 'test'); v_id := (r ->> 'attempt_id')::uuid;
  perform tests.act_as_service();
  perform public.cs_intento_avanzar(v_id, 'tokenized'); perform public.cs_intento_avanzar(v_id, 'auth_setup'); perform public.cs_intento_avanzar(v_id, 'auth_pending'); perform public.cs_intento_avanzar(v_id, 'auth_validated', v_3ds); perform public.cs_intento_avanzar(v_id, 'authz_sent');
  perform public.cs_intento_avanzar(v_id, 'authorized', '{"cs_payment_id":"PAY-A5-4"}'); perform public.cs_intento_avanzar(v_id, 'captured');
  perform tests.eq((select status from public.card_payment_attempts where id = v_id), 'captured', '17 · evidencia persistida antes de contabilizar');
  perform tests.eq(public.cs_reservas_activas(v_o4), 1000::numeric, '17 · mientras tanto la reserva protege el pedido');
  perform tests.eq(public.cs_intento_contabilizar(v_id) ->> 'status', 'posted', '17 · "estado" lo completa más tarde sin volver a llamar al banco');
  perform tests.eq((select count(*) from public.payment_entries where external_ref = 'PAY-A5-4'), 1::bigint, '17 · un asiento');

  -- ══ 11 · el importe es el del intento: el navegador no puede alterarlo (la RPC no acepta importe; el asiento usa amount del intento) ═══
  perform tests.ok(not exists (select 1 from pg_proc p where p.proname = 'cs_intento_contabilizar' and pg_get_function_arguments(p.oid) <> 'p_attempt uuid'), '11 · contabilizar solo recibe el id del intento');
  perform tests.ok((select bool_and(e.amount = a.amount) from public.card_payment_attempts a join public.payment_entries e on e.id = a.entry_id where a.status = 'posted'), '11 · todo asiento = importe fijado del intento');
  perform tests.act_as_owner();
end $t$;
rollback;
