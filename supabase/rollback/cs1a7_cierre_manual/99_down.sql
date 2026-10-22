-- CS-1A.7 (187) · rollback: retira cs_intento_cerrar_manual y devuelve cs_intento_avanzar EXACTAMENTE a la definición de la 184.
-- (La 185 y la 186 no tocan cs_intento_avanzar.) Los intentos ya cerrados manualmente conservan su estado y su bitácora.
-- Ejecutar en UNA transacción: psql -1 -v ON_ERROR_STOP=1 -f 99_down.sql
drop function if exists public.cs_intento_cerrar_manual(uuid, text, jsonb);
create or replace function public.cs_intento_avanzar(p_attempt uuid, p_estado text, p_datos jsonb default '{}'::jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_a record; v_o record; v_neto numeric; v_saldo numeric; v_pay text; v_detalle jsonb;
begin
  if not public._cs_es_servidor() then raise exception 'NO_AUTORIZADO: solo el servidor avanza intentos' using errcode = 'insufficient_privilege'; end if;
  p_datos := coalesce(p_datos, '{}'::jsonb);
  select * into v_o from public.orders o where o.id = (select order_id from public.card_payment_attempts where id = p_attempt) for update;
  select * into v_a from public.card_payment_attempts where id = p_attempt for update;
  if not found then raise exception 'INTENTO_INEXISTENTE' using errcode = 'no_data_found'; end if;
  if v_a.status = p_estado then
    return jsonb_build_object('status', 'already', 'attempt_id', v_a.id, 'estado', v_a.status, 'amount', v_a.amount);
  end if;
  if not public._cs_transicion_valida(v_a.status, p_estado) then
    raise exception 'TRANSICION_INVALIDA: % → %', v_a.status, p_estado using errcode = 'check_violation';
  end if;
  if v_a.status = 'unknown_requires_reconciliation' and nullif(btrim(coalesce(p_datos ->> 'evidencia', '')), '') is null then
    raise exception 'EVIDENCIA_REQUERIDA: salir de un resultado desconocido exige evidencia del proveedor o de conciliación' using errcode = 'check_violation';
  end if;
  v_pay := coalesce(nullif(btrim(coalesce(p_datos ->> 'cs_payment_id', '')), ''), v_a.cs_payment_id);
  if p_estado in ('authorized', 'captured') and v_pay is null then
    raise exception 'PAGO_SIN_ID: authorized/captured exigen cs_payment_id (evidencia del proveedor)' using errcode = 'check_violation';
  end if;

  if p_estado = 'authz_sent' then
    -- reconfirmación: el importe fijado debe seguir siendo el saldo contable vigente (abonos de otros canales, cambios del pedido)
    select coalesce(sum(case when direction = 'in' then amount else -amount end), 0) into v_neto from public.payment_entries where order_id = v_a.order_id;
    v_saldo := coalesce(v_o.total, 0) - v_neto;
    if v_saldo <> v_a.amount or v_o.status in ('draft', 'cancelled') then
      update public.card_payment_attempts set status = 'amount_changed', status_at = clock_timestamp(), updated_at = clock_timestamp(),
             error_safe = format('saldo vigente %s ≠ importe fijado %s', v_saldo, v_a.amount) where id = p_attempt;
      perform public._cs_evento(p_attempt, v_a.status, 'amount_changed', jsonb_build_object('saldo_vigente', v_saldo, 'amount', v_a.amount, 'order_status', v_o.status));
      return jsonb_build_object('status', 'amount_changed', 'attempt_id', v_a.id, 'estado', 'amount_changed', 'amount', v_a.amount, 'saldo_vigente', v_saldo);
    end if;
  end if;

  update public.card_payment_attempts set
    status = p_estado, status_at = clock_timestamp(), updated_at = clock_timestamp(),
    cs_capture_context_exp = coalesce((p_datos ->> 'cs_capture_context_exp')::timestamptz, cs_capture_context_exp),
    cs_auth_reference_id   = coalesce(nullif(p_datos ->> 'cs_auth_reference_id', ''), cs_auth_reference_id),
    cs_auth_transaction_id = coalesce(nullif(p_datos ->> 'cs_auth_transaction_id', ''), cs_auth_transaction_id),
    cs_auth_status         = coalesce(nullif(p_datos ->> 'cs_auth_status', ''), cs_auth_status),
    cs_eci                 = coalesce(nullif(p_datos ->> 'cs_eci', ''), cs_eci),
    cs_payment_id          = v_pay,
    cs_payment_status      = coalesce(nullif(p_datos ->> 'cs_payment_status', ''), cs_payment_status),
    cs_reconciliation_id   = coalesce(nullif(p_datos ->> 'cs_reconciliation_id', ''), cs_reconciliation_id),
    cs_reason              = coalesce(public._cs_texto_seguro(nullif(p_datos ->> 'cs_reason', '')), cs_reason),
    cs_approval_code       = coalesce(nullif(p_datos ->> 'cs_approval_code', ''), cs_approval_code),
    cs_request_sent_at     = case when p_estado = 'authz_sent' then clock_timestamp() else cs_request_sent_at end,
    cs_response_at         = case when v_a.status = 'authz_sent' and p_estado <> 'unknown_requires_reconciliation' then clock_timestamp() else cs_response_at end,
    error_safe             = coalesce(public._cs_texto_seguro(nullif(p_datos ->> 'error', '')), error_safe),
    reconciled_at          = case when v_a.status = 'unknown_requires_reconciliation' then clock_timestamp() else reconciled_at end,
    reconciled_by          = case when v_a.status = 'unknown_requires_reconciliation' then auth.uid() else reconciled_by end,
    reconcile_note         = case when v_a.status = 'unknown_requires_reconciliation' then public._cs_texto_seguro(p_datos ->> 'evidencia') else reconcile_note end
  where id = p_attempt;
  v_detalle := jsonb_strip_nulls(jsonb_build_object('cs_payment_id', v_pay, 'cs_auth_status', p_datos ->> 'cs_auth_status', 'cs_payment_status', p_datos ->> 'cs_payment_status',
                                                    'error', public._cs_texto_seguro(nullif(p_datos ->> 'error', '')), 'evidencia', public._cs_texto_seguro(nullif(p_datos ->> 'evidencia', ''))));
  perform public._cs_evento(p_attempt, v_a.status, p_estado, v_detalle);
  return jsonb_build_object('status', 'applied', 'attempt_id', v_a.id, 'estado', p_estado, 'amount', v_a.amount, 'cs_payment_id', v_pay);
end $$;
comment on function public.cs_intento_avanzar(uuid, text, jsonb) is 'CS-1A.1a · transición de estado de un intento (solo servidor); authz_sent reconfirma el saldo; unknown exige evidencia.';
revoke all on function public.cs_intento_avanzar(uuid, text, jsonb) from public, anon;
grant execute on function public.cs_intento_avanzar(uuid, text, jsonb) to authenticated, service_role;
