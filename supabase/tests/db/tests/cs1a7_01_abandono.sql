-- CS-DEPLOY-03B-FIX · abandono y reservas: una vez enviada la operación al banco, NADIE (ni el servidor que usa cs-3ds/abandonar)
-- puede cerrar el intento como "fallo seguro" ni liberar la reserva: authz_sent, authorized, captured y unknown rechazan
-- failed_safe_to_retry; antes del envío sí se abandona y la reserva se libera.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); v_doc uuid := tests.user('doctor'); v_prod uuid := tests.product(100); v_o uuid; r jsonb; v_id uuid; e text;
        v_3ds jsonb := '{"cs_auth_reference_id":"ref","cs_auth_transaction_id":"tx","cs_auth_status":"AUTHENTICATION_SUCCESSFUL"}';
begin
  perform tests.act_as_owner();
  -- antes del envío: abandonar libera (lo que hace cs-3ds/abandonar con service_role)
  v_o := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 10)));   -- 1,000
  perform tests.act_as(v_doc); r := public.cs_intento_abrir(v_o, 'test'); v_id := (r ->> 'attempt_id')::uuid;
  perform tests.act_as_service();
  perform public.cs_intento_avanzar(v_id, 'tokenized'); perform public.cs_intento_avanzar(v_id, 'auth_setup'); perform public.cs_intento_avanzar(v_id, 'auth_pending');
  perform tests.eq(public.cs_reservas_activas(v_o), 1000::numeric, 'antes del envío · reserva activa');
  r := public.cs_intento_avanzar(v_id, 'failed_safe_to_retry', '{"error":"abandonado por el cliente antes de enviar al banco"}');
  perform tests.ok(r ->> 'status' = 'applied' and public.cs_reservas_activas(v_o) = 0, 'antes del envío · abandonar libera la reserva');

  -- después del envío: cada estado posterior rechaza failed_safe_to_retry y conserva la reserva
  foreach e in array array['authz_sent', 'authorized', 'captured', 'unknown_requires_reconciliation'] loop
    v_o := tests.order(v_doc, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 10)));
    perform tests.act_as(v_doc); r := public.cs_intento_abrir(v_o, 'test'); v_id := (r ->> 'attempt_id')::uuid;
    perform tests.act_as_service();
    perform public.cs_intento_avanzar(v_id, 'tokenized'); perform public.cs_intento_avanzar(v_id, 'auth_setup'); perform public.cs_intento_avanzar(v_id, 'auth_pending');
    perform public.cs_intento_avanzar(v_id, 'auth_validated', v_3ds); perform public.cs_intento_avanzar(v_id, 'authz_sent');
    if e in ('authorized', 'captured') then perform public.cs_intento_avanzar(v_id, 'authorized', jsonb_build_object('cs_payment_id', 'PAY-AB-' || e)); end if;
    if e = 'captured' then perform public.cs_intento_avanzar(v_id, 'captured', '{"cs_payment_status":"CAPTURE_PENDING"}'); end if;
    if e = 'unknown_requires_reconciliation' then perform public.cs_intento_avanzar(v_id, 'unknown_requires_reconciliation', '{"error":"timeout"}'); end if;
    perform tests.eq((select status from public.card_payment_attempts where id = v_id), e, e || ' · estado preparado');
    perform tests.throws_any(format($q$select public.cs_intento_avanzar('%s', 'failed_safe_to_retry', '{"error":"abandonado","evidencia":"abandono"}')$q$, v_id), array['TRANSICION_INVALIDA', 'CIERRE_MANUAL_REQUERIDO'], e || ' · servidor: abandonar NO cierra');
    perform tests.act_as(v_admin);
    perform tests.throws_any(format($q$select public.cs_intento_avanzar('%s', 'failed_safe_to_retry', '{"error":"abandonado","evidencia":"abandono"}')$q$, v_id), array['TRANSICION_INVALIDA', 'CIERRE_MANUAL_REQUERIDO'], e || ' · Dirección: abandonar NO cierra');
    perform tests.throws(format($q$select public.cs_intento_avanzar('%s', 'expired')$q$, v_id), 'TRANSICION_INVALIDA', e || ' · tampoco expira a mano');
    perform tests.eq(public.cs_reservas_activas(v_o), 1000::numeric, e || ' · la reserva se conserva');
    perform tests.throws(format($q$select public.registrar_cobro(tests.op(), '%s', 'efectivo', 1)$q$, v_o), 'RESERVA_ACTIVA', e || ' · otros canales siguen bloqueados');
    perform tests.act_as_owner();
    update public.card_payment_attempts set status_at = clock_timestamp() - interval '3 hours' where id = v_id;
    perform tests.eq(public.cs_intentos_expirar(), 0, e || ' · el cron no lo expira');
  end loop;
end $t$;
rollback;
