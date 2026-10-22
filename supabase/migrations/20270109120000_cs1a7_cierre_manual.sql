-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- CS-1A.7 · cierre manual de resultados desconocidos (migración 187)
--   Elimina la regla insegura: un intento en `unknown_requires_reconciliation` ya NO puede pasar a `failed_safe_to_retry`
--   por `cs_intento_avanzar` (ni por el servidor ni por una persona). Una búsqueda vacía en el proveedor no demuestra que
--   no hubo cargo; el tiempo transcurrido tampoco. Mientras el resultado sea desconocido la reserva se conserva y ningún
--   canal puede cobrar de más (guarda 185).
--   Nuevo: `cs_intento_cerrar_manual(p_attempt, p_motivo, p_consulta)` · SOLO Dirección o Facturación (service_role rechazado:
--   no existe camino automático). Exige: ≥ 24 h desde el envío al banco y desde que quedó desconocido; consulta reciente al
--   proveedor por identificador (si existe) y por referencia, ambas realizadas y sin transacciones; revisión del Business
--   Center declarada por el operador; motivo (≥ 10) y responsable (auth.uid()). Todo queda en la bitácora con la consulta.
--   Además (regla 9): una persona (admin/billing) solo entra a `authorized`/`captured` con `p_datos.proveedor` = hechos
--   estructurados del proveedor cuyo id coincide con cs_payment_id; el servidor (service_role) sigue como en la 184.
--   No se modifican la 184, 185 ni 186. Rollback: supabase/rollback/cs1a7_cierre_manual/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public.cs_intento_avanzar(uuid,text,jsonb)') is null or to_regprocedure('public._cs_evento(uuid,text,text,jsonb)') is null then raise exception 'CS1A7: falta CS-1A.1a'; end if;
  if to_regprocedure('public._cs_transicion_valida(text,text)') is null or not public._cs_transicion_valida('authorized', 'declined') then raise exception 'CS1A7: falta CS-1A.6'; end if;
  if to_regprocedure('public.cs_intento_cerrar_manual(uuid,text,jsonb)') is not null then raise exception 'CS1A7: ya aplicada'; end if;
end $pre$;

-- ---------------------------------------------------------------------------------------------------
-- 1) cs_intento_avanzar: igual que la 184 salvo dos guardas nuevas (marcadas CS-1A.7).
-- ---------------------------------------------------------------------------------------------------
create or replace function public.cs_intento_avanzar(p_attempt uuid, p_estado text, p_datos jsonb default '{}'::jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_a record; v_o record; v_neto numeric; v_saldo numeric; v_pay text; v_detalle jsonb; v_prov jsonb; v_prov_id text;
        v_servicio boolean := coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role';
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
  -- CS-1A.7 · un desconocido NUNCA se cierra sin cargo por esta vía: ni tiempo ni búsqueda vacía son evidencia.
  if v_a.status = 'unknown_requires_reconciliation' and p_estado = 'failed_safe_to_retry' then
    raise exception 'CIERRE_MANUAL_REQUERIDO: un resultado desconocido solo se cierra sin cargo con cs_intento_cerrar_manual (≥ 24 h, consultas al proveedor, revisión en Business Center, motivo y responsable)' using errcode = 'check_violation';
  end if;
  if v_a.status = 'unknown_requires_reconciliation' and nullif(btrim(coalesce(p_datos ->> 'evidencia', '')), '') is null then
    raise exception 'EVIDENCIA_REQUERIDA: salir de un resultado desconocido exige evidencia del proveedor o de conciliación' using errcode = 'check_violation';
  end if;
  v_pay := coalesce(nullif(btrim(coalesce(p_datos ->> 'cs_payment_id', '')), ''), v_a.cs_payment_id);
  if p_estado in ('authorized', 'captured') and v_pay is null then
    raise exception 'PAGO_SIN_ID: authorized/captured exigen cs_payment_id (evidencia del proveedor)' using errcode = 'check_violation';
  end if;
  -- CS-1A.7 · una persona no marca autorizaciones ni capturas: solo las DERIVA de lo que respondió el proveedor.
  if p_estado in ('authorized', 'captured') and not v_servicio then
    v_prov := case when jsonb_typeof(p_datos -> 'proveedor') = 'object' then p_datos -> 'proveedor' else null end;
    v_prov_id := case when p_estado = 'captured' then coalesce(v_prov -> 'autorizacion' ->> 'id', v_prov -> 'captura' ->> 'id') else v_prov -> 'autorizacion' ->> 'id' end;
    if v_prov is null
       or (p_estado = 'captured'   and (v_prov -> 'captura' ->> 'estado') is distinct from 'aprobada')
       or (p_estado = 'authorized' and (v_prov -> 'autorizacion' ->> 'estado') is distinct from 'aprobada')
       or v_prov_id is null or v_prov_id <> v_pay then
      raise exception 'PROVEEDOR_REQUERIDO: % exige los hechos del proveedor (proveedor.%.estado = aprobada con el mismo id que cs_payment_id)', p_estado, case when p_estado = 'captured' then 'captura' else 'autorizacion' end using errcode = 'check_violation';
    end if;
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
                                                    'error', public._cs_texto_seguro(nullif(p_datos ->> 'error', '')), 'evidencia', public._cs_texto_seguro(nullif(p_datos ->> 'evidencia', '')),
                                                    'proveedor', v_prov));
  perform public._cs_evento(p_attempt, v_a.status, p_estado, v_detalle);
  return jsonb_build_object('status', 'applied', 'attempt_id', v_a.id, 'estado', p_estado, 'amount', v_a.amount, 'cs_payment_id', v_pay);
end $$;
comment on function public.cs_intento_avanzar(uuid, text, jsonb) is 'CS-1A.1a/CS-1A.7 · transición de estado de un intento (solo servidor); authz_sent reconfirma el saldo; unknown exige evidencia y NUNCA va a failed_safe_to_retry por aquí; una persona entra a authorized/captured solo con proveedor.';
revoke all on function public.cs_intento_avanzar(uuid, text, jsonb) from public, anon;
grant execute on function public.cs_intento_avanzar(uuid, text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------
-- 2) cs_intento_cerrar_manual: decisión humana, documentada, tardía y comprobada. Nunca automática.
--    p_consulta (la construye la Edge cs-conciliar con lo que respondió el proveedor en ese momento):
--      { consultado_en: timestamptz (≤ 30 min),
--        por_id:          { realizada: true, resultado: 'no_encontrada' }   -- obligatoria si el intento tiene cs_payment_id
--                       | { realizada: false, motivo: 'sin_id' }            -- solo si no hay cs_payment_id
--        por_referencia:  { realizada: true, transacciones: 0 },
--        business_center_revisado: true }
--    Cualquier fallo, omisión o hallazgo → no se cierra. 24 h no son evidencia: son el mínimo para que la consulta sea creíble.
-- ---------------------------------------------------------------------------------------------------
create function public.cs_intento_cerrar_manual(p_attempt uuid, p_motivo text, p_consulta jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_a record; v_rol text := public.auth_role(); v_desde timestamptz; v_horas numeric; v_id jsonb; v_ref jsonb; v_en timestamptz; v_motivo text; v_detalle jsonb;
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role' or auth.uid() is null or coalesce(v_rol, '') not in ('admin', 'billing') then
    raise exception 'NO_AUTORIZADO: el cierre manual lo decide una persona de Dirección o Facturación' using errcode = 'insufficient_privilege';
  end if;
  v_motivo := regexp_replace(btrim(coalesce(p_motivo, '')), '\s+', ' ', 'g');
  if length(v_motivo) < 10 then raise exception 'MOTIVO_REQUERIDO: explica el cierre (mínimo 10 caracteres)' using errcode = 'check_violation'; end if;
  p_consulta := coalesce(p_consulta, '{}'::jsonb);

  -- mismo orden de bloqueo que cs_intento_avanzar / registrar_cobro: pedido → intento
  perform 1 from public.orders o where o.id = (select order_id from public.card_payment_attempts where id = p_attempt) for update;
  select * into v_a from public.card_payment_attempts where id = p_attempt for update;
  if not found then raise exception 'INTENTO_INEXISTENTE' using errcode = 'no_data_found'; end if;
  if v_a.status = 'failed_safe_to_retry' then
    return jsonb_build_object('status', 'already', 'attempt_id', v_a.id, 'estado', v_a.status, 'amount', v_a.amount);
  end if;
  if v_a.status <> 'unknown_requires_reconciliation' then
    raise exception 'ESTADO_INVALIDO: el cierre manual solo aplica a un resultado desconocido (estado actual %)', v_a.status using errcode = 'check_violation';
  end if;

  -- 1) tiempo mínimo: 24 h desde el envío al banco Y desde que quedó desconocido (lo más tardío)
  v_desde := greatest(coalesce(v_a.cs_request_sent_at, v_a.status_at), v_a.status_at);
  v_horas := extract(epoch from (clock_timestamp() - v_desde)) / 3600;
  if v_horas < 24 then
    raise exception 'CIERRE_PREMATURO: faltan % h para poder cerrar sin cargo (mínimo 24 h)', to_char(24 - v_horas, 'FM999990.0') using errcode = 'check_violation';
  end if;

  -- 2) consulta reciente y completa al proveedor
  v_en := nullif(p_consulta ->> 'consultado_en', '')::timestamptz;
  if v_en is null or v_en > clock_timestamp() + interval '1 minute' or v_en < clock_timestamp() - interval '30 minutes' then
    raise exception 'CONSULTA_CADUCA: la consulta al proveedor debe ser de los últimos 30 minutos' using errcode = 'check_violation';
  end if;
  v_id := p_consulta -> 'por_id'; v_ref := p_consulta -> 'por_referencia';
  if jsonb_typeof(v_ref) <> 'object' or (v_ref ->> 'realizada')::boolean is distinct from true or (v_ref ->> 'transacciones') is null then
    raise exception 'CONSULTA_INCOMPLETA: falta la búsqueda por referencia en el proveedor' using errcode = 'check_violation';
  end if;
  if v_a.cs_payment_id is not null then
    if jsonb_typeof(v_id) <> 'object' or (v_id ->> 'realizada')::boolean is distinct from true or (v_id ->> 'resultado') is distinct from 'no_encontrada' then
      raise exception 'CONSULTA_INCOMPLETA: el intento tiene id de pago; la consulta por identificador debe realizarse y no encontrar la transacción' using errcode = 'check_violation';
    end if;
  elsif jsonb_typeof(v_id) = 'object' and (v_id ->> 'realizada')::boolean is true and (v_id ->> 'resultado') is distinct from 'no_encontrada' then
    raise exception 'HALLAZGOS_EXISTEN: la consulta por identificador encontró una transacción: usa "resolver"' using errcode = 'check_violation';
  end if;
  if (v_ref ->> 'transacciones')::int <> 0 then
    raise exception 'HALLAZGOS_EXISTEN: el proveedor devuelve % transacción(es) con esta referencia: usa "resolver"', (v_ref ->> 'transacciones')::int using errcode = 'check_violation';
  end if;
  -- 3) revisión humana del Business Center declarada por quien cierra
  if (p_consulta ->> 'business_center_revisado')::boolean is distinct from true then
    raise exception 'REVISION_REQUERIDA: confirma la revisión del Business Center de CyberSource antes de cerrar' using errcode = 'check_violation';
  end if;

  update public.card_payment_attempts set
    status = 'failed_safe_to_retry', status_at = clock_timestamp(), updated_at = clock_timestamp(),
    reconciled_at = clock_timestamp(), reconciled_by = auth.uid(),
    reconcile_note = public._cs_texto_seguro('cierre manual sin cargo: ' || v_motivo)
  where id = p_attempt;
  v_detalle := jsonb_build_object(
    'cierre_manual', true, 'motivo', public._cs_texto_seguro(v_motivo), 'responsable', auth.uid(), 'rol', v_rol,
    'horas_desde_envio', round(v_horas, 1), 'consulta', jsonb_build_object('consultado_en', v_en, 'por_id', v_id, 'por_referencia', v_ref, 'business_center_revisado', true),
    'evidencia', public._cs_texto_seguro(format('[%s] cierre manual sin cargo tras %s h · proveedor: por_id=%s por_referencia=0 tx · Business Center revisado · %s',
                                               v_rol, round(v_horas, 1), case when v_a.cs_payment_id is null then 'sin id' else 'no_encontrada' end, v_motivo)));
  perform public._cs_evento(p_attempt, 'unknown_requires_reconciliation', 'failed_safe_to_retry', v_detalle);
  return jsonb_build_object('status', 'applied', 'attempt_id', v_a.id, 'estado', 'failed_safe_to_retry', 'amount', v_a.amount, 'horas', round(v_horas, 1));
end $$;
comment on function public.cs_intento_cerrar_manual(uuid, text, jsonb) is 'CS-1A.7 · cierre manual sin cargo de un resultado desconocido: solo admin/billing (nunca service_role), ≥ 24 h, consulta reciente por id y referencia sin transacciones, Business Center revisado, motivo y responsable en la bitácora.';
revoke all on function public.cs_intento_cerrar_manual(uuid, text, jsonb) from public, anon, service_role;
grant execute on function public.cs_intento_cerrar_manual(uuid, text, jsonb) to authenticated;

do $post$ begin
  if to_regprocedure('public.cs_intento_cerrar_manual(uuid,text,jsonb)') is null then raise exception 'CS1A7: falta la RPC de cierre manual'; end if;
  if position('CIERRE_MANUAL_REQUERIDO' in pg_get_functiondef('public.cs_intento_avanzar(uuid,text,jsonb)'::regprocedure)) = 0 then raise exception 'CS1A7: cs_intento_avanzar sin la guarda'; end if;
  if not public._cs_transicion_valida('authorized', 'declined') or not public._cs_transicion_valida('unknown_requires_reconciliation', 'captured') then raise exception 'CS1A7: máquina de estados alterada'; end if;
end $post$;
