-- CS-1A.1a (184) · intentos de cobro con tarjeta: un intento activo por pedido (reserva), importe fijado en servidor,
-- máquina de estados, reconfirmación del saldo antes de enviar al banco, contabilización idempotente vía registrar_cobro,
-- desconocidos que bloquean hasta conciliar con evidencia, expiración solo antes de enviar, permisos y RLS.
-- Matriz CS-1A.1 (casos 1–16): los que requieren banco se cubren con transiciones simuladas.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); v_doc uuid := tests.user('doctor'); v_doc2 uuid := tests.user('doctor');
        v_bill uuid := tests.user('billing'); v_pos uuid := tests.user('pos');
        v_prod uuid := tests.product(100); v_o1 uuid; v_o2 uuid; v_o3 uuid; v_o4 uuid; v_o5 uuid;
        r jsonb; r2 jsonb; v_id uuid; v_id2 uuid; v_entry uuid; m record; n int;
begin
  perform tests.act_as_owner();
  v_o1 := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 100)));   -- 10,000
  v_o2 := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 50)));    -- 5,000
  v_o3 := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 30)));    -- 3,000
  v_o4 := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 10)), 'paid');   -- 1,000 pagado
  v_o5 := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 20)));    -- 2,000

  -- ══ 1/2/5 · abrir: importe = saldo completo; segunda apertura (dos pestañas, doble clic) devuelve el MISMO intento ═══
  perform tests.act_as(v_doc);
  r := public.cs_intento_abrir(v_o1, 'test');
  perform tests.eq(r ->> 'status', 'created', '1 · abre');
  perform tests.eq((r ->> 'amount')::numeric, 10000::numeric, '1 · importe = saldo pendiente completo (CS-D07)');
  v_id := (r ->> 'attempt_id')::uuid;
  r2 := public.cs_intento_abrir(v_o1, 'test');
  perform tests.eq(r2 ->> 'status', 'existing', '2 · segunda apertura devuelve el existente');
  perform tests.eq((r2 ->> 'attempt_id')::uuid, v_id, '2 · mismo intento (sin segundo cargo)');
  perform tests.eq((select count(*) from public.card_payment_attempts where order_id = v_o1), 1::bigint, '2 · un solo intento en la tabla');
  perform tests.eq(public.saldo_disponible(v_o1), 0::numeric, '3 · saldo disponible = 0 con la reserva activa');
  select * into m from public.v_order_disponible where order_id = v_o1;
  perform tests.ok(m.saldo_contable = 10000 and m.reservas_activas = 10000 and m.saldo_disponible = 0 and m.intento_activo_id = v_id, '3 · v_order_disponible distingue contable vs disponible');

  -- ══ 14 · otro doctor, pos y anónimo no abren; billing no abre (solo dueño o Dirección) ═══════════
  perform tests.act_as(v_doc2);
  perform tests.throws(format($q$select public.cs_intento_abrir('%s', 'test')$q$, v_o1), 'NO_AUTORIZADO', '14 · doctor ajeno');
  perform tests.ok(not exists (select 1 from public.card_payment_attempts where order_id = v_o1), '14 · RLS: el doctor ajeno no ve el intento');
  perform tests.act_as(v_pos);
  perform tests.throws(format($q$select public.cs_intento_abrir('%s', 'test')$q$, v_o1), 'NO_AUTORIZADO', '14 · pos');
  perform tests.ok(not exists (select 1 from public.card_payment_attempts), '14 · RLS: pos no ve intentos');
  perform tests.act_as(v_bill);
  perform tests.throws(format($q$select public.cs_intento_abrir('%s', 'test')$q$, v_o1), 'NO_AUTORIZADO', '14 · billing no abre');
  perform tests.eq((select count(*) from public.card_payment_attempts), 1::bigint, '14 · RLS: billing ve todos');
  perform tests.act_as(v_doc);
  perform tests.eq((select count(*) from public.card_payment_attempts), 1::bigint, '14 · RLS: el dueño ve el suyo');
  perform tests.ok(not exists (select 1 from public.card_payment_attempt_events), '14 · RLS: el doctor no ve la bitácora');

  -- ══ permisos de avanzar/contabilizar: solo servidor ════════════════════════════════════════════
  perform tests.throws(format($q$select public.cs_intento_avanzar('%s', 'tokenized')$q$, v_id), 'NO_AUTORIZADO', 'avanzar · doctor no');
  perform tests.throws(format($q$select public.cs_intento_contabilizar('%s')$q$, v_id), 'NO_AUTORIZADO', 'contabilizar · doctor no');
  perform tests.throws(format($q$update public.card_payment_attempts set status = 'captured' where id = '%s'$q$, v_id), 'denied', 'tabla · el doctor no escribe');

  -- ══ 3/4 · abono de otro canal durante el checkout → authz_sent reconfirma y cierra amount_changed ═══
  perform tests.act_as_owner();
  perform public._w2_trusted(true); update public.orders set total = 6000 where id = v_o1; perform public._w2_trusted(false);   -- el importe cobrable cambió (con 1b, un abono de otro canal ya sería rechazado por la reserva)
  perform tests.act_as_service();
  perform tests.eq(public.cs_intento_avanzar(v_id, 'tokenized') ->> 'status', 'applied', '5 · created → tokenized');
  perform tests.eq(public.cs_intento_avanzar(v_id, 'tokenized') ->> 'status', 'already', '9 · misma transición repetida = idempotente');
  perform public.cs_intento_avanzar(v_id, 'auth_setup', jsonb_build_object('cs_auth_reference_id', 'ref-1'));
  perform public.cs_intento_avanzar(v_id, 'auth_pending');
  perform public.cs_intento_avanzar(v_id, 'auth_validated', jsonb_build_object('cs_auth_status', 'AUTHENTICATION_SUCCESSFUL', 'cs_auth_transaction_id', 'tx-1', 'cs_eci', '05'));
  r := public.cs_intento_avanzar(v_id, 'authz_sent');
  perform tests.eq(r ->> 'status', 'amount_changed', '3 · el saldo cambió (pedido ajustado a 6,000): no se envía al banco');
  perform tests.eq((select status from public.card_payment_attempts where id = v_id), 'amount_changed', '3 · intento cerrado');
  perform tests.eq(public.cs_reservas_activas(v_o1), 0::numeric, '3 · la reserva se liberó');
  perform tests.throws(format($q$select public.cs_intento_avanzar('%s', 'authz_sent')$q$, v_id), 'TRANSICION_INVALIDA', '3 · un intento cerrado no avanza');

  -- ══ 5/15/16/12 · nuevo intento por el saldo actualizado; flujo completo hasta posted ═══════════════
  perform tests.act_as(v_doc);
  r := public.cs_intento_abrir(v_o1, 'test');
  perform tests.eq(r ->> 'status', 'created', '4 · reabre con el saldo actualizado');
  perform tests.eq((r ->> 'amount')::numeric, 6000::numeric, '4 · importe = saldo vigente 6,000');
  v_id2 := (r ->> 'attempt_id')::uuid;
  perform tests.act_as_service();
  perform tests.throws(format($q$select public.cs_intento_avanzar('%s', 'captured')$q$, v_id2), 'TRANSICION_INVALIDA', '6 · created → captured prohibido');
  perform public.cs_intento_avanzar(v_id2, 'tokenized'); perform public.cs_intento_avanzar(v_id2, 'auth_setup'); perform public.cs_intento_avanzar(v_id2, 'auth_pending'); perform public.cs_intento_avanzar(v_id2, 'auth_validated');
  r := public.cs_intento_avanzar(v_id2, 'authz_sent');
  perform tests.eq(r ->> 'status', 'applied', '5 · authz_sent (saldo reconfirmado)');
  perform tests.ok((select cs_request_sent_at is not null from public.card_payment_attempts where id = v_id2), '5 · sello de envío al banco');
  perform tests.throws(format($q$select public.cs_intento_avanzar('%s', 'expired')$q$, v_id2), 'TRANSICION_INVALIDA', '6 · tras enviar al banco no expira');
  perform tests.throws(format($q$select public.cs_intento_avanzar('%s', 'failed_safe_to_retry')$q$, v_id2), 'TRANSICION_INVALIDA', '6 · tras enviar al banco no es fallo seguro');
  perform tests.throws(format($q$select public.cs_intento_avanzar('%s', 'authorized')$q$, v_id2), 'PAGO_SIN_ID', '15 · authorized exige cs_payment_id');
  perform public.cs_intento_avanzar(v_id2, 'authorized', jsonb_build_object('cs_payment_id', 'PAY-0001', 'cs_payment_status', 'AUTHORIZED', 'cs_approval_code', '831000'));
  perform tests.throws(format($q$select public.cs_intento_contabilizar('%s')$q$, v_id2), 'NO_CAPTURADO', '15 · AUTHORIZED ≠ cobro: no se contabiliza');
  perform tests.ok(not exists (select 1 from public.payment_entries where external_ref = 'PAY-0001'), '15 · sin asiento');
  perform public.cs_intento_avanzar(v_id2, 'captured', jsonb_build_object('cs_payment_status', 'PENDING', 'cs_reconciliation_id', 'rec-1'));
  perform tests.eq(public.cs_reservas_activas(v_o1), 6000::numeric, '16 · captured sigue reservando hasta contabilizar');
  r := public.cs_intento_contabilizar(v_id2);
  perform tests.eq(r ->> 'status', 'posted', '16 · captured → posted');
  perform tests.eq(r ->> 'como', 'nuevo', '16 · asiento nuevo');
  v_entry := (r ->> 'entry_id')::uuid;
  perform tests.ok((select method = 'tarjeta' and amount = 6000 and external_ref = 'PAY-0001' and evidence_ref = v_id2::text and direction = 'in' from public.payment_entries where id = v_entry), '16 · asiento tarjeta 6,000 con external_ref = id de pago');
  perform tests.eq((select op_id from public.card_payment_attempts where id = v_id2), public._cs_op_id('PAY-0001'), '16 · op_id derivado del id de pago');
  perform tests.eq((select estado_pago from public.v_order_money where order_id = v_o1), 'paid', '16 · pedido pagado');
  perform tests.eq(public.cs_reservas_activas(v_o1), 0::numeric, '16 · reserva consumida');
  r := public.cs_intento_contabilizar(v_id2);
  perform tests.eq(r ->> 'status', 'already_posted', '12 · contabilizar de nuevo = idempotente');
  perform tests.eq((select count(*) from public.payment_entries where external_ref = 'PAY-0001'), 1::bigint, '12 · un solo asiento');
  perform tests.throws(format($q$select public.cs_intento_avanzar('%s', 'captured')$q$, v_id2), 'TRANSICION_INVALIDA', '6 · posted es terminal');
  perform tests.eq((select count(*) from public.card_payment_attempt_events where attempt_id = v_id2), 9::bigint, 'bitácora · 9 transiciones registradas (created…posted)');
  perform tests.act_as(v_doc);
  perform tests.throws(format($q$select public.cs_intento_abrir('%s', 'test')$q$, v_o1), 'SIN_SALDO', '13 · pedido liquidado no abre');

  -- ══ 6/7/10 · timeout → desconocido: bloquea, no expira, sale solo con evidencia ════════════════════
  r := public.cs_intento_abrir(v_o2, 'test'); v_id := (r ->> 'attempt_id')::uuid;
  perform tests.act_as_service();
  perform public.cs_intento_avanzar(v_id, 'tokenized'); perform public.cs_intento_avanzar(v_id, 'auth_setup'); perform public.cs_intento_avanzar(v_id, 'auth_pending'); perform public.cs_intento_avanzar(v_id, 'auth_validated'); perform public.cs_intento_avanzar(v_id, 'authz_sent');
  perform public.cs_intento_avanzar(v_id, 'unknown_requires_reconciliation', jsonb_build_object('error', 'timeout 30s hablando con apitest.cybersource.com token abcdefghijklmnopqrstuvwxyz0123456789ABCDEF correo doc@x.mx tarjeta 4111111111111111'));
  perform tests.ok((select error_safe from public.card_payment_attempts where id = v_id) !~ 'abcdefghijklmnopqrstuvwxyz0123456789|doc@x\.mx|4111111111111111', '6 · texto depurado (sin token, correo ni dígitos largos)');
  perform tests.act_as(v_doc);
  r := public.cs_intento_abrir(v_o2, 'test');
  perform tests.ok(r ->> 'status' = 'existing' and (r ->> 'bloqueado')::boolean, '10 · desconocido bloquea nuevos cargos');
  perform tests.act_as_owner();
  update public.card_payment_attempts set status_at = clock_timestamp() - interval '3 hours' where id = v_id;
  perform tests.eq(public.cs_intentos_expirar(), 0, '10 · un desconocido NUNCA expira solo');
  perform tests.act_as_service();
  perform tests.throws(format($q$select public.cs_intento_avanzar('%s', 'captured', '{"cs_payment_id":"PAY-0002"}')$q$, v_id), 'EVIDENCIA_REQUERIDA', '7 · salir de desconocido exige evidencia');
  perform tests.act_as(v_bill);
  perform tests.throws(format($q$select public.cs_intento_avanzar('%s', 'captured', '{"cs_payment_id":"PAY-0002","evidencia":"Transaction Search: aprobada, rec-2"}')$q$, v_id), 'PROVEEDOR_REQUERIDO', '7 · (187) una persona no marca capturado sin los hechos del proveedor');
  r := public.cs_intento_avanzar(v_id, 'captured', jsonb_build_object('cs_payment_id', 'PAY-0002', 'evidencia', 'Transaction Search: aprobada, rec-2', 'proveedor', '{"autorizacion":{"estado":"aprobada","id":"PAY-0002"},"captura":{"estado":"aprobada","id":"PAY-0002"}}'::jsonb));
  perform tests.eq(r ->> 'status', 'applied', '7 · Facturación concilia con evidencia');
  perform tests.ok((select reconciled_at is not null and reconciled_by = v_bill and reconcile_note like 'Transaction Search%' from public.card_payment_attempts where id = v_id), '7 · marca de conciliación');
  r := public.cs_intento_contabilizar(v_id);
  perform tests.eq(r ->> 'status', 'posted', '7 · banco confirmó, base falló, conciliación contabiliza sin repetir el cargo');
  perform tests.eq((select estado_pago from public.v_order_money where order_id = v_o2), 'paid', '7 · pedido pagado');

  -- ══ 11 · reserva abandonada antes de enviar al banco expira a los 15 min; se puede reabrir ═══════
  perform tests.act_as(v_doc);
  r := public.cs_intento_abrir(v_o3, 'test'); v_id := (r ->> 'attempt_id')::uuid;
  perform tests.act_as_owner();
  perform tests.eq(public.cs_intentos_expirar(), 0, '11 · recién abierto no expira');
  update public.card_payment_attempts set status_at = clock_timestamp() - interval '16 minutes' where id = v_id;
  perform tests.eq(public.cs_intentos_expirar(), 1, '11 · expira tras 15 min de inactividad');
  perform tests.eq((select status from public.card_payment_attempts where id = v_id), 'expired', '11 · estado expired');
  perform tests.act_as(v_doc);
  r := public.cs_intento_abrir(v_o3, 'test');
  perform tests.ok(r ->> 'status' = 'created' and (r ->> 'attempt_id')::uuid <> v_id, '11 · se reabre con un intento nuevo');

  -- ══ 13 · pedido pagado y cancelado ═══════════════════════════════════════════════════════════════
  perform tests.throws(format($q$select public.cs_intento_abrir('%s', 'test')$q$, v_o4), 'SIN_SALDO', '13 · pagado');
  perform tests.act_as_owner();
  perform public._w2_trusted(true); update public.orders set status = 'cancelled' where id = v_o5; perform public._w2_trusted(false);
  perform tests.act_as(v_doc);
  perform tests.throws(format($q$select public.cs_intento_abrir('%s', 'test')$q$, v_o5), 'PEDIDO_NO_PAGABLE', '13 · cancelado');

  -- ══ 8 · asiento ya registrado a mano con la misma referencia → se enlaza, no se duplica ═══════════
  perform tests.act_as_owner();
  v_o5 := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 7)));   -- 700
  perform tests.act_as(v_doc);
  r := public.cs_intento_abrir(v_o5, 'test'); v_id := (r ->> 'attempt_id')::uuid;
  perform tests.act_as_service();
  perform public.cs_intento_avanzar(v_id, 'tokenized'); perform public.cs_intento_avanzar(v_id, 'auth_setup'); perform public.cs_intento_avanzar(v_id, 'auth_pending'); perform public.cs_intento_avanzar(v_id, 'auth_validated'); perform public.cs_intento_avanzar(v_id, 'authz_sent');
  perform public.cs_intento_avanzar(v_id, 'captured', jsonb_build_object('cs_payment_id', 'PAY-0003'));
  perform tests.act_as(v_admin);
  perform public.registrar_cobro(tests.op(), v_o5, 'tarjeta', 700, null, 'PAY-0003');   -- alguien lo registró antes con la misma referencia
  perform tests.act_as_service();
  r := public.cs_intento_contabilizar(v_id);
  perform tests.ok(r ->> 'status' = 'posted' and r ->> 'como' = 'enlazado', '8 · se enlaza al asiento existente');
  perform tests.eq((select count(*) from public.payment_entries where external_ref = 'PAY-0003'), 1::bigint, '8 · un solo asiento');

  -- ══ bitácora y tablas append-only ═════════════════════════════════════════════════════════════════
  perform tests.act_as_owner();
  perform tests.throws($q$delete from public.card_payment_attempts$q$, 'APPEND_ONLY', 'intentos · no se borran');
  perform tests.throws($q$update public.card_payment_attempt_events set to_status = 'x'$q$, 'APPEND_ONLY', 'eventos · no se editan');
  perform tests.throws($q$delete from public.card_payment_attempt_events$q$, 'APPEND_ONLY', 'eventos · no se borran');
  perform tests.ok(exists (select 1 from cron.job where jobname = 'renovacell-cs-intentos'), 'cron · tarea de expiración programada');
  perform tests.act_as_owner();
end $t$;
rollback;
