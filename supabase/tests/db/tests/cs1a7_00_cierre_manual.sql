-- CS-1A.7 (187) · cierre manual de resultados desconocidos. Reglas: una búsqueda vacía nunca demuestra ausencia de cargo (1);
-- lo desconocido conserva la reserva (2) y bloquea otros canales (3,10); el cierre es una acción separada solo para Dirección y
-- Facturación (4); exige 24 h, consulta por id y referencia, Business Center, motivo y responsable (5); 24 h no son evidencia (6);
-- consulta fallida/incompleta/con hallazgos no cierra (7); todo queda en la bitácora (8); nadie marca capturas a mano (9).
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); v_bill uuid := tests.user('billing'); v_pos uuid := tests.user('pos'); v_doc uuid := tests.user('doctor');
        v_prod uuid := tests.product(100); v_o1 uuid; v_o2 uuid; v_o3 uuid; v_o4 uuid; v_o5 uuid; r jsonb; v_id uuid; v_id2 uuid; v_ok jsonb; v_ev record;
        v_3ds jsonb := '{"cs_auth_reference_id":"ref","cs_auth_transaction_id":"tx","cs_auth_status":"AUTHENTICATION_SUCCESSFUL"}';
begin
  perform tests.act_as_owner();
  v_o1 := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 60)));   -- 6,000
  v_o2 := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 30)));   -- 3,000
  v_o3 := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 20)));   -- 2,000
  v_o4 := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 10)));   -- 1,000
  v_o5 := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 10)));   -- 1,000
  v_ok := jsonb_build_object('consultado_en', clock_timestamp(), 'por_id', jsonb_build_object('realizada', true, 'resultado', 'no_encontrada'),
                             'por_referencia', jsonb_build_object('realizada', true, 'transacciones', 0), 'business_center_revisado', true);

  -- ══ intento 1: desconocido CON id de pago (timeout de captura tras autorización) ═══════════════════════════════════
  perform tests.act_as(v_doc); r := public.cs_intento_abrir(v_o1, 'test'); v_id := (r ->> 'attempt_id')::uuid;
  perform tests.act_as_service();
  perform public.cs_intento_avanzar(v_id, 'tokenized'); perform public.cs_intento_avanzar(v_id, 'auth_setup'); perform public.cs_intento_avanzar(v_id, 'auth_pending'); perform public.cs_intento_avanzar(v_id, 'auth_validated', v_3ds); perform public.cs_intento_avanzar(v_id, 'authz_sent');
  perform public.cs_intento_avanzar(v_id, 'authorized', '{"cs_payment_id":"PAY-A7-1"}');
  perform public.cs_intento_avanzar(v_id, 'unknown_requires_reconciliation', '{"error":"captura: timeout"}');

  -- 1 · la regla insegura ya no existe: ni el servidor ni una persona cierran un desconocido por cs_intento_avanzar
  perform tests.throws(format($q$select public.cs_intento_avanzar('%s', 'failed_safe_to_retry', '{"evidencia":"sin transacciones en el proveedor 45 min después del envío"}')$q$, v_id), 'CIERRE_MANUAL_REQUERIDO', '1 · servidor: búsqueda vacía + tiempo NO cierran');
  perform tests.act_as(v_admin);
  perform tests.throws(format($q$select public.cs_intento_avanzar('%s', 'failed_safe_to_retry', '{"evidencia":"[admin] sin transacciones 3 días después"}')$q$, v_id), 'CIERRE_MANUAL_REQUERIDO', '1 · Dirección tampoco por la vía genérica');
  perform tests.eq(public.cs_reservas_activas(v_o1), 6000::numeric, '2 · la reserva se conserva');
  perform tests.throws(format($q$select public.registrar_cobro(tests.op(), '%s', 'efectivo', 1)$q$, v_o1), 'RESERVA_ACTIVA', '3 · otros canales bloqueados mientras hay incertidumbre');

  -- 4 · solo Dirección y Facturación; el servidor NO (no existe camino automático)
  perform tests.act_as_service();
  perform tests.throws_any(format($q$select public.cs_intento_cerrar_manual('%s', 'motivo suficientemente largo', '%s')$q$, v_id, v_ok), array['NO_AUTORIZADO', 'denied'], '4 · service_role no cierra (sin grant ni camino automático)');
  perform tests.act_as(v_pos);
  perform tests.throws(format($q$select public.cs_intento_cerrar_manual('%s', 'motivo suficientemente largo', '%s')$q$, v_id, v_ok), 'NO_AUTORIZADO', '4 · Caja no cierra');
  perform tests.act_as(v_doc);
  perform tests.throws(format($q$select public.cs_intento_cerrar_manual('%s', 'motivo suficientemente largo', '%s')$q$, v_id, v_ok), 'NO_AUTORIZADO', '4 · el doctor no cierra');
  perform tests.act_as_anon();
  perform tests.throws_any(format($q$select public.cs_intento_cerrar_manual('%s', 'motivo suficientemente largo', '%s')$q$, v_id, v_ok), array['NO_AUTORIZADO', 'denied'], '4 · anon no cierra');

  -- 5/6 · antes de 24 h no se cierra aunque la consulta esté completa
  perform tests.act_as(v_bill);
  perform tests.throws(format($q$select public.cs_intento_cerrar_manual('%s', 'cliente confirma que no vio cargo', '%s')$q$, v_id, v_ok), 'CIERRE_PREMATURO', '5 · faltan horas: no cierra');
  perform tests.act_as_owner(); update public.card_payment_attempts set cs_request_sent_at = clock_timestamp() - interval '30 hours', status_at = clock_timestamp() - interval '20 hours' where id = v_id;
  perform tests.act_as(v_bill);
  perform tests.throws(format($q$select public.cs_intento_cerrar_manual('%s', 'cliente confirma que no vio cargo', '%s')$q$, v_id, v_ok), 'CIERRE_PREMATURO', '5 · 24 h cuentan desde lo MÁS tardío (envío o desconocido)');
  perform tests.act_as_owner(); update public.card_payment_attempts set status_at = clock_timestamp() - interval '25 hours' where id = v_id;
  perform tests.act_as(v_bill);
  -- 6 · 24 h cumplidas NO bastan: sin consulta no hay cierre
  perform tests.throws(format($q$select public.cs_intento_cerrar_manual('%s', 'cliente confirma que no vio cargo', '{}')$q$, v_id), 'CONSULTA_CADUCA', '6 · 24 h sin consulta no cierran');
  perform tests.throws(format($q$select public.cs_intento_cerrar_manual('%s', 'cliente confirma que no vio cargo', '%s')$q$, v_id, v_ok || jsonb_build_object('consultado_en', clock_timestamp() - interval '2 hours')), 'CONSULTA_CADUCA', '7 · consulta vieja no sirve');
  perform tests.throws(format($q$select public.cs_intento_cerrar_manual('%s', 'cliente confirma que no vio cargo', '%s')$q$, v_id, v_ok - 'por_referencia'), 'CONSULTA_INCOMPLETA', '7 · sin búsqueda por referencia');
  perform tests.throws(format($q$select public.cs_intento_cerrar_manual('%s', 'cliente confirma que no vio cargo', '%s')$q$, v_id, v_ok - 'por_id'), 'CONSULTA_INCOMPLETA', '7 · con id de pago, falta la consulta por id');
  perform tests.throws(format($q$select public.cs_intento_cerrar_manual('%s', 'cliente confirma que no vio cargo', '%s')$q$, v_id, v_ok || '{"por_id":{"realizada":false,"motivo":"proveedor sin respuesta"}}'), 'CONSULTA_INCOMPLETA', '7 · consulta por id fallida no cierra');
  perform tests.throws(format($q$select public.cs_intento_cerrar_manual('%s', 'cliente confirma que no vio cargo', '%s')$q$, v_id, v_ok || '{"por_id":{"realizada":true,"resultado":"encontrada"}}'), 'CONSULTA_INCOMPLETA', '7 · transacción encontrada por id → no cierra');
  perform tests.throws(format($q$select public.cs_intento_cerrar_manual('%s', 'cliente confirma que no vio cargo', '%s')$q$, v_id, v_ok || '{"por_referencia":{"realizada":true,"transacciones":1}}'), 'HALLAZGOS_EXISTEN', '7 · hay transacciones con la referencia → no cierra');
  perform tests.throws(format($q$select public.cs_intento_cerrar_manual('%s', 'cliente confirma que no vio cargo', '%s')$q$, v_id, v_ok - 'business_center_revisado'), 'REVISION_REQUERIDA', '5 · sin revisión del Business Center');
  perform tests.throws(format($q$select public.cs_intento_cerrar_manual('%s', 'corto', '%s')$q$, v_id, v_ok), 'MOTIVO_REQUERIDO', '5 · motivo insuficiente');
  perform tests.eq((select status from public.card_payment_attempts where id = v_id), 'unknown_requires_reconciliation', '7 · tras todos los rechazos sigue desconocido');
  perform tests.eq((select count(*) from public.card_payment_attempt_events where attempt_id = v_id and to_status = 'failed_safe_to_retry'), 0::bigint, '7 · ningún evento de cierre');

  -- cierre válido por Facturación
  r := public.cs_intento_cerrar_manual(v_id, 'Cliente y banco confirman sin cargo; Business Center sin transacción', v_ok);
  perform tests.eq(r ->> 'status', 'applied', '5 · cierre manual aplicado');
  perform tests.eq((select status from public.card_payment_attempts where id = v_id), 'failed_safe_to_retry', '5 · estado final sin cargo');
  perform tests.eq(public.cs_reservas_activas(v_o1), 0::numeric, '2 · la reserva se libera solo al cerrar');
  select * into v_ev from public.card_payment_attempt_events where attempt_id = v_id and to_status = 'failed_safe_to_retry';
  perform tests.ok(v_ev.actor = v_bill and v_ev.actor_role = 'billing' and v_ev.from_status = 'unknown_requires_reconciliation', '8 · responsable en la bitácora');
  perform tests.ok((v_ev.detalle ->> 'cierre_manual')::boolean and v_ev.detalle ->> 'motivo' like 'Cliente y banco%' and (v_ev.detalle -> 'consulta' -> 'por_referencia' ->> 'transacciones') = '0'
               and (v_ev.detalle -> 'consulta' -> 'por_id' ->> 'resultado') = 'no_encontrada' and (v_ev.detalle -> 'consulta' ->> 'business_center_revisado')::boolean
               and (v_ev.detalle ->> 'horas_desde_envio')::numeric >= 24, '8 · motivo, consulta, Business Center y horas en la bitácora');
  perform tests.ok((select reconciled_by = v_bill and reconciled_at is not null and reconcile_note like 'cierre manual sin cargo:%' from public.card_payment_attempts where id = v_id), '8 · marca de conciliación en el intento');
  perform tests.eq(public.cs_intento_cerrar_manual(v_id, 'Cliente y banco confirman sin cargo; Business Center sin transacción', v_ok) ->> 'status', 'already', '10 · idempotente');
  perform tests.throws(format($q$select public.cs_intento_avanzar('%s', 'captured', '{"cs_payment_id":"x","evidencia":"x"}')$q$, v_id), 'TRANSICION_INVALIDA', '10 · cerrado es terminal');
  perform tests.act_as(v_admin);
  r := public.registrar_cobro(tests.op(), v_o1, 'efectivo', 6000);
  perform tests.eq(r ->> 'status', 'applied', '3 · tras el cierre otros canales cobran');
  perform tests.ok(not (select sobrepago from public.v_order_money where order_id = v_o1), '10 · nunca sobrepago');

  -- ══ intento 2: desconocido SIN id de pago (timeout de la autorización): por_id no realizada es aceptable; abrir de nuevo tras cerrar ═══
  perform tests.act_as(v_doc); r := public.cs_intento_abrir(v_o2, 'test'); v_id := (r ->> 'attempt_id')::uuid;
  perform tests.act_as_service();
  perform public.cs_intento_avanzar(v_id, 'tokenized'); perform public.cs_intento_avanzar(v_id, 'auth_setup'); perform public.cs_intento_avanzar(v_id, 'auth_pending'); perform public.cs_intento_avanzar(v_id, 'auth_validated', v_3ds); perform public.cs_intento_avanzar(v_id, 'authz_sent');
  perform public.cs_intento_avanzar(v_id, 'unknown_requires_reconciliation', '{"error":"autorización: timeout"}');
  perform tests.act_as_owner(); update public.card_payment_attempts set cs_request_sent_at = clock_timestamp() - interval '25 hours', status_at = clock_timestamp() - interval '25 hours' where id = v_id;
  perform tests.act_as(v_doc);
  r := public.cs_intento_abrir(v_o2, 'test');
  perform tests.ok(r ->> 'status' = 'existing' and (r ->> 'bloqueado')::boolean, '3 · el doctor no puede volver a cobrar mientras es desconocido');
  perform tests.act_as(v_admin);
  perform tests.throws(format($q$select public.cs_intento_cerrar_manual('%s', 'sin id de pago, nada en el proveedor', '%s')$q$, v_id, v_ok || '{"por_id":{"realizada":true,"resultado":"encontrada"}}'), 'HALLAZGOS_EXISTEN', '7 · sin id pero la consulta por id encontró algo → no cierra');
  r := public.cs_intento_cerrar_manual(v_id, 'sin id de pago, nada en el proveedor ni en Business Center', v_ok || '{"por_id":{"realizada":false,"motivo":"sin_id"}}');
  perform tests.ok(r ->> 'status' = 'applied' and (select actor_role from public.card_payment_attempt_events where attempt_id = v_id and to_status = 'failed_safe_to_retry') = 'admin', '5 · Dirección cierra un desconocido sin id');
  perform tests.act_as(v_doc);
  r := public.cs_intento_abrir(v_o2, 'test');
  perform tests.ok(r ->> 'status' = 'created' and (r ->> 'attempt_id')::uuid <> v_id, '10 · tras el cierre el doctor puede intentar de nuevo (nuevo intento)');

  -- ══ intento 3: estados distintos de desconocido no admiten cierre manual ═══════════════════════════════════════════
  perform tests.act_as(v_doc); r := public.cs_intento_abrir(v_o3, 'test'); v_id := (r ->> 'attempt_id')::uuid;
  perform tests.act_as_service();
  perform public.cs_intento_avanzar(v_id, 'tokenized'); perform public.cs_intento_avanzar(v_id, 'auth_setup'); perform public.cs_intento_avanzar(v_id, 'auth_pending'); perform public.cs_intento_avanzar(v_id, 'auth_validated', v_3ds); perform public.cs_intento_avanzar(v_id, 'authz_sent');
  perform public.cs_intento_avanzar(v_id, 'authorized', '{"cs_payment_id":"PAY-A7-3"}');
  perform tests.act_as_owner(); update public.card_payment_attempts set cs_request_sent_at = clock_timestamp() - interval '48 hours', status_at = clock_timestamp() - interval '48 hours' where id = v_id;
  perform tests.act_as(v_admin);
  perform tests.throws(format($q$select public.cs_intento_cerrar_manual('%s', 'motivo suficientemente largo', '%s')$q$, v_id, v_ok), 'ESTADO_INVALIDO', '4 · una autorización vigente no se "cierra sin cargo"');
  perform tests.throws($q$select public.cs_intento_cerrar_manual('00000000-0000-4000-8000-000000000000', 'motivo suficientemente largo', '{}')$q$, 'INTENTO_INEXISTENTE', '4 · id inexistente');

  -- ══ 9 · nadie marca a mano: una persona solo entra a authorized/captured con los hechos del proveedor ═══════════════
  perform tests.act_as(v_doc); r := public.cs_intento_abrir(v_o4, 'test'); v_id := (r ->> 'attempt_id')::uuid;
  perform tests.act_as_service();
  perform public.cs_intento_avanzar(v_id, 'tokenized'); perform public.cs_intento_avanzar(v_id, 'auth_setup'); perform public.cs_intento_avanzar(v_id, 'auth_pending'); perform public.cs_intento_avanzar(v_id, 'auth_validated', v_3ds); perform public.cs_intento_avanzar(v_id, 'authz_sent');
  perform public.cs_intento_avanzar(v_id, 'unknown_requires_reconciliation', '{"error":"timeout"}');
  perform tests.act_as(v_bill);
  perform tests.throws(format($q$select public.cs_intento_avanzar('%s', 'captured', '{"cs_payment_id":"PAY-A7-4","evidencia":"[billing] lo vi en el Business Center"}')$q$, v_id), 'PROVEEDOR_REQUERIDO', '9 · captura a mano (solo texto) rechazada');
  perform tests.throws(format($q$select public.cs_intento_avanzar('%s', 'captured', '{"cs_payment_id":"PAY-A7-4","evidencia":"x","proveedor":{"captura":{"estado":"rechazada","id":"PAY-A7-4"}}}')$q$, v_id), 'PROVEEDOR_REQUERIDO', '9 · captura rechazada en el proveedor no se marca capturada');
  perform tests.throws(format($q$select public.cs_intento_avanzar('%s', 'captured', '{"cs_payment_id":"PAY-A7-4","evidencia":"x","proveedor":{"captura":{"estado":"aprobada","id":"OTRO"}}}')$q$, v_id), 'PROVEEDOR_REQUERIDO', '9 · id del proveedor distinto al declarado');
  perform tests.throws(format($q$select public.cs_intento_avanzar('%s', 'authorized', '{"cs_payment_id":"PAY-A7-4","evidencia":"x","proveedor":{"captura":{"estado":"aprobada","id":"PAY-A7-4"}}}')$q$, v_id), 'PROVEEDOR_REQUERIDO', '9 · authorized exige autorización aprobada, no captura');
  perform tests.eq((select status from public.card_payment_attempts where id = v_id), 'unknown_requires_reconciliation', '9 · sigue desconocido');
  r := public.cs_intento_avanzar(v_id, 'captured', '{"cs_payment_id":"PAY-A7-4","cs_payment_status":"CAPTURE_PENDING","evidencia":"[billing] consulta: bill aprobada","proveedor":{"autorizacion":{"estado":"aprobada","id":"PAY-A7-4"},"captura":{"estado":"aprobada","id":"PAY-A7-4","status":"PENDING"}}}');
  perform tests.eq(r ->> 'status', 'applied', '9 · con los hechos del proveedor sí');
  perform tests.ok((select detalle -> 'proveedor' -> 'captura' ->> 'estado' = 'aprobada' from public.card_payment_attempt_events where attempt_id = v_id and to_status = 'captured'), '8 · los hechos del proveedor quedan en la bitácora');
  perform tests.eq(public.cs_intento_contabilizar(v_id) ->> 'status', 'posted', '10 · contabiliza una vez');
  perform tests.eq((select count(*) from public.payment_entries where external_ref = 'PAY-A7-4'), 1::bigint, '10 · un asiento');

  -- 9 · también authorized → captured por una persona exige proveedor; el servidor (cs-pago) sigue sin ese requisito
  perform tests.act_as(v_doc); r := public.cs_intento_abrir(v_o5, 'test'); v_id2 := (r ->> 'attempt_id')::uuid;
  perform tests.act_as_service();
  perform public.cs_intento_avanzar(v_id2, 'tokenized'); perform public.cs_intento_avanzar(v_id2, 'auth_setup'); perform public.cs_intento_avanzar(v_id2, 'auth_pending'); perform public.cs_intento_avanzar(v_id2, 'auth_validated', v_3ds); perform public.cs_intento_avanzar(v_id2, 'authz_sent');
  perform public.cs_intento_avanzar(v_id2, 'authorized', '{"cs_payment_id":"PAY-A7-5"}');
  perform tests.act_as(v_admin);
  perform tests.throws(format($q$select public.cs_intento_avanzar('%s', 'captured', '{"cs_payment_status":"CAPTURE_PENDING","evidencia":"[admin] capturado"}')$q$, v_id2), 'PROVEEDOR_REQUERIDO', '9 · Dirección no marca capturada una autorización sin hechos del proveedor');
  perform tests.act_as_service();
  r := public.cs_intento_avanzar(v_id2, 'captured', '{"cs_payment_status":"CAPTURE_PENDING"}');
  perform tests.eq(r ->> 'status', 'applied', '9 · el servidor (respuesta directa del banco) no cambia');
  perform tests.act_as_owner();
end $t$;
rollback;
