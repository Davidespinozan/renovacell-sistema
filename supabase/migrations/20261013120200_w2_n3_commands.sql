-- ============================================================================
-- W2 · N3 — COMANDOS DEL SERVIDOR (única autoridad sobre el dinero).
--
-- Protocolo común (igual que W1): rol → lock por op_id → locks de fila en orden
-- fijo (pedido → declaración/reembolso) → validación → escritura en el libro →
-- recálculo de la proyección → registro de la operación → resultado canónico.
--
-- Reemplazos (la firma vieja se ELIMINA → el frontend viejo falla cerrado):
--   review_transfer_payment → revisar_pago
--   registrar_devolucion    → autorizar_reembolso
--   pay_order               → registrar_cobro / autorizar_credito  (se revoca en N4)
--
-- Recreadas de W1 con cambio QUIRÚRGICO (el resto queda VERBATIM):
--   surtir_pedido   → compuerta de liberación (cobro suficiente OR crédito)
--   cancelar_pedido → money_signal desde el libro + regla de actor con liberación
--   vender_pos      → escribe su asiento de cobro en la MISMA transacción
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Infraestructura de idempotencia (gemela de la de W1, tabla propia)
-- ---------------------------------------------------------------------------
create or replace function public._w2_op_begin(p_op uuid, p_kind text, p_req jsonb) returns jsonb
  language plpgsql set search_path = public as
$$
declare r record;
begin
  if p_op is null then
    raise exception 'OP_ID_REQUERIDO: la operación requiere un op_id estable (reintentos con el mismo op_id no duplican)';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('w2-op:' || p_op::text, 0));
  select kind, request_hash, result into r from public.money_operations where op_id = p_op;
  if not found then return null; end if;
  if r.kind <> p_kind or r.request_hash <> md5(p_kind || ':' || p_req::text) then
    raise exception 'OP_ID_REUTILIZADO: el op_id % ya se usó para otra operación distinta', p_op;
  end if;
  return r.result || jsonb_build_object('status', 'already_applied');
end;
$$;

create or replace function public._w2_op_finish(p_op uuid, p_kind text, p_req jsonb, p_result jsonb) returns jsonb
  language plpgsql set search_path = public as
$$
begin
  insert into public.money_operations (op_id, kind, actor, actor_role, request_hash, result)
  values (p_op, p_kind, auth.uid(), coalesce(public.auth_role(), ''), md5(p_kind || ':' || p_req::text), p_result);
  return p_result;
end;
$$;

create or replace function public._w2_trusted(p_on boolean) returns void
  language sql set search_path = public as
$$ select set_config('app.trusted', case when p_on then 'on' else 'off' end, true); $$;

-- ---------------------------------------------------------------------------
-- 1) LIBERACIÓN PARA SURTIR (F-7) — derivada, sin columna cacheada.
--    liberado = cobro suficiente OR crédito autorizado vigente.
--    NO consulta ni escribe payment_status ni orders.status: son otra cosa.
-- ---------------------------------------------------------------------------
create or replace function public.pedido_liberado_para_surtir(p_order uuid) returns boolean
  language sql stable security definer set search_path = public as
$$
  select coalesce((
    select (m.cobrado_neto >= m.total and m.total > 0) or m.credito_autorizado
      from public.v_order_money m where m.order_id = p_order
  ), false);
$$;

comment on function public.pedido_liberado_para_surtir(uuid) is
  'W2 · F-7: TRUE si el pedido tiene cobro suficiente O crédito autorizado vigente. '
  'Un pedido a crédito se surte SIN falsificar payment_status ni orders.status.';

-- ---------------------------------------------------------------------------
-- 2) PROYECCIÓN FINANCIERA (F-8) — payment_status se recalcula desde el libro.
--    Nunca describe autorización operativa; solo dinero.
-- ---------------------------------------------------------------------------
create or replace function public._w2_recalc_payment_status(p_order uuid) returns text
  language plpgsql security definer set search_path = public as
$$
declare v_estado text;
begin
  select estado_pago into v_estado from public.v_order_money where order_id = p_order;
  if v_estado is null then return null; end if;
  perform public._w2_trusted(true);
  update public.orders set payment_status = v_estado where id = p_order and payment_status is distinct from v_estado;
  perform public._w2_trusted(false);
  return v_estado;
end;
$$;

-- Helper interno: asiento en el libro (única puerta de escritura de payment_entries).
create or replace function public._w2_asiento(
  p_id uuid, p_order uuid, p_direction text, p_method text, p_amount numeric, p_value_date date,
  p_claim uuid default null, p_refund uuid default null, p_external_ref text default null,
  p_bank uuid default null, p_evidence text default null, p_reversal_of uuid default null, p_notes text default null
) returns uuid
  language plpgsql security definer set search_path = public as
$$
begin
  if p_amount is null or p_amount <= 0 then raise exception 'MONTO_INVALIDO: el monto debe ser mayor a cero'; end if;
  if p_value_date > public.hoy_local() then raise exception 'FECHA_VALOR_FUTURA: la fecha valor no puede ser futura'; end if;
  insert into public.payment_entries (id, order_id, claim_id, refund_id, direction, method, amount,
                                      value_date, external_ref, bank_account_id, evidence_ref, reversal_of, notes,
                                      recorded_by, actor_role, created_at)
  values (p_id, p_order, p_claim, p_refund, p_direction, p_method, p_amount,
          coalesce(p_value_date, public.hoy_local()), nullif(btrim(p_external_ref), ''), p_bank,
          nullif(btrim(p_evidence), ''), p_reversal_of, nullif(btrim(p_notes), ''), auth.uid(),
          coalesce(nullif(public.auth_role(), ''),
                   case when coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
                        then 'service_role' else '' end),
          -- mismo reloj que el tramo del corte de caja (D-W2-CASH-CUTOFF)
          clock_timestamp());
  return p_id;
end;
$$;

revoke all on function public._w2_op_begin(uuid, text, jsonb), public._w2_op_finish(uuid, text, jsonb, jsonb),
  public._w2_trusted(boolean), public._w2_recalc_payment_status(uuid),
  public._w2_asiento(uuid, uuid, text, text, numeric, date, uuid, uuid, text, uuid, text, uuid, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) REPORTAR PAGO (F-3) — el cliente o el staff DECLARA. No mueve dinero.
-- ---------------------------------------------------------------------------
create function public.reportar_pago(
  p_op_id uuid, p_order uuid, p_method text, p_amount numeric,
  p_reference text default null, p_bank_account_id uuid default null, p_proof_path text default null
) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_role text := public.auth_role(); v_uid uuid := auth.uid();
  v_req jsonb; v_prev jsonb; v_o record; v_saldo numeric;
begin
  v_req := jsonb_build_object('order', p_order, 'method', p_method, 'amount', p_amount,
             'reference', p_reference, 'bank', p_bank_account_id, 'proof', p_proof_path);
  v_prev := public._w2_op_begin(p_op_id, 'reporte_pago', v_req);
  if v_prev is not null then return v_prev; end if;

  select * into v_o from public.orders where id = p_order for update;
  if not found then raise exception 'PEDIDO_INEXISTENTE'; end if;
  select m.saldo into v_saldo from public.v_order_money m where m.order_id = p_order;
  if not (v_role = any (array['admin','billing','pos']) or (v_role = 'doctor' and v_o.doctor_id = v_uid)) then
    raise exception 'NO_AUTORIZADO: no puedes reportar un pago de este pedido';
  end if;
  if v_o.status = 'cancelled' then raise exception 'PEDIDO_CANCELADO: ese pedido está cancelado'; end if;
  if v_saldo <= 0 then raise exception 'SIN_SALDO: ese pedido no tiene saldo por cobrar'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'MONTO_INVALIDO: el monto debe ser mayor a cero'; end if;
  if p_method is null or p_method not in ('transferencia','efectivo','tarjeta','stripe','otro') then
    raise exception 'METODO_INVALIDO';
  end if;
  if p_bank_account_id is not null and not exists (
       select 1 from public.company_bank_accounts where id = p_bank_account_id and active) then
    raise exception 'CUENTA_INVALIDA: la cuenta bancaria no existe o está inactiva';
  end if;
  if exists (select 1 from public.payment_claims c where c.order_id = p_order and c.status = 'reportado') then
    raise exception 'DECLARACION_ABIERTA: ya hay un comprobante en revisión para este pedido';
  end if;

  insert into public.payment_claims (id, order_id, method, amount_declared, reference, bank_account_id, proof_path, declared_by)
  values (p_op_id, p_order, p_method, p_amount, nullif(btrim(p_reference), ''), p_bank_account_id,
          nullif(btrim(p_proof_path), ''), v_uid);

  return public._w2_op_finish(p_op_id, 'reporte_pago', v_req,
    jsonb_build_object('status', 'applied', 'claim_id', p_op_id, 'order_id', p_order, 'saldo', v_saldo));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) REVISAR PAGO — verificar (genera asiento) o rechazar (con motivo).
--    Conserva la semántica de review_transfer_payment: idempotente, no confirmar
--    lo rechazado, no rechazar lo confirmado.
-- ---------------------------------------------------------------------------
create function public.revisar_pago(
  p_op_id uuid, p_claim_id uuid, p_accion text,
  p_amount_verificado numeric default null, p_value_date date default null, p_motivo text default null
) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_req jsonb; v_prev jsonb; v_c record; v_amount numeric; v_entry uuid; v_estado text;
begin
  if not (public.auth_role() = any (array['admin','billing'])) then
    raise exception 'NO_AUTORIZADO: solo Dirección/Facturación puede revisar pagos';
  end if;
  if p_accion not in ('verificar','rechazar') then raise exception 'ACCION_INVALIDA: usa verificar o rechazar'; end if;
  v_req := jsonb_build_object('claim', p_claim_id, 'accion', p_accion, 'amount', p_amount_verificado,
             'value_date', p_value_date, 'motivo', p_motivo);
  v_prev := public._w2_op_begin(p_op_id, 'revision_pago', v_req);
  if v_prev is not null then return v_prev; end if;

  select * into v_c from public.payment_claims where id = p_claim_id for update;
  if not found then raise exception 'DECLARACION_INEXISTENTE'; end if;
  if v_c.status = 'verificado' then
    if p_accion = 'rechazar' then
      raise exception 'YA_VERIFICADO: no se puede rechazar un pago ya verificado';
    end if;
    return public._w2_op_finish(p_op_id, 'revision_pago', v_req,
      jsonb_build_object('status', 'already_verified', 'claim_id', p_claim_id, 'entry_id', v_c.entry_id));
  end if;
  if v_c.status = 'rechazado' then
    if p_accion = 'verificar' then
      raise exception 'DECLARACION_RECHAZADA: requiere un comprobante nuevo del cliente antes de verificar';
    end if;
    return public._w2_op_finish(p_op_id, 'revision_pago', v_req,
      jsonb_build_object('status', 'already_rejected', 'claim_id', p_claim_id));
  end if;
  perform 1 from public.orders where id = v_c.order_id for update;

  if p_accion = 'rechazar' then
    if nullif(btrim(p_motivo), '') is null then raise exception 'MOTIVO_REQUERIDO: el rechazo necesita un motivo'; end if;
    update public.payment_claims
       set status = 'rechazado', resolved_by = auth.uid(), resolved_at = now(), reject_reason = left(btrim(p_motivo), 400)
     where id = p_claim_id;
    return public._w2_op_finish(p_op_id, 'revision_pago', v_req,
      jsonb_build_object('status', 'applied', 'resultado', 'rechazado', 'claim_id', p_claim_id));
  end if;

  -- VERIFICAR: nace el asiento. El monto verificado manda sobre el declarado.
  v_amount := coalesce(p_amount_verificado, v_c.amount_declared);
  v_entry := public._w2_asiento(p_op_id, v_c.order_id, 'in', v_c.method, v_amount,
               coalesce(p_value_date, public.hoy_local()), p_claim_id, null, null, v_c.bank_account_id, v_c.proof_path);
  update public.payment_claims
     set status = 'verificado', resolved_by = auth.uid(), resolved_at = now(), entry_id = v_entry
   where id = p_claim_id;
  v_estado := public._w2_recalc_payment_status(v_c.order_id);

  return public._w2_op_finish(p_op_id, 'revision_pago', v_req,
    jsonb_build_object('status', 'applied', 'resultado', 'verificado', 'claim_id', p_claim_id,
                       'entry_id', v_entry, 'monto', v_amount, 'payment_status', v_estado));
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) REGISTRAR COBRO — dinero recibido directamente (mostrador, depósito, ajuste).
-- ---------------------------------------------------------------------------
create function public.registrar_cobro(
  p_op_id uuid, p_order uuid, p_method text, p_amount numeric,
  p_value_date date default null, p_reference text default null,
  p_bank_account_id uuid default null, p_evidence text default null
) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_req jsonb; v_prev jsonb; v_o record; v_entry uuid; v_estado text; v_m record; v_srv boolean;
begin
  -- service_role = webhook del proveedor (Stripe): su notificación firmada ES la evidencia.
  v_srv := coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role';
  if not (v_srv or public.auth_role() = any (array['admin','billing','pos'])) then
    raise exception 'NO_AUTORIZADO: no tienes permiso para registrar cobros';
  end if;
  v_req := jsonb_build_object('order', p_order, 'method', p_method, 'amount', p_amount,
             'value_date', p_value_date, 'reference', p_reference, 'bank', p_bank_account_id, 'evidence', p_evidence);
  v_prev := public._w2_op_begin(p_op_id, 'cobro', v_req);
  if v_prev is not null then return v_prev; end if;

  select * into v_o from public.orders where id = p_order for update;
  if not found then raise exception 'PEDIDO_INEXISTENTE'; end if;
  if p_method is null or p_method not in ('transferencia','efectivo','tarjeta','stripe','otro') then
    raise exception 'METODO_INVALIDO';
  end if;
  if p_bank_account_id is not null and not exists (
       select 1 from public.company_bank_accounts where id = p_bank_account_id and active) then
    raise exception 'CUENTA_INVALIDA: la cuenta bancaria no existe o está inactiva';
  end if;

  -- F-9: el dinero que llegó SE REGISTRA SIEMPRE, incluso sobre un pedido cancelado.
  -- El conflicto no se niega: queda como excepción en la conciliación (D5).
  v_entry := public._w2_asiento(p_op_id, p_order, 'in', p_method, p_amount,
               coalesce(p_value_date, public.hoy_local()), null, null, p_reference, p_bank_account_id, p_evidence);
  v_estado := public._w2_recalc_payment_status(p_order);
  select * into v_m from public.v_order_money where order_id = p_order;

  return public._w2_op_finish(p_op_id, 'cobro', v_req,
    jsonb_build_object('status', 'applied', 'entry_id', v_entry, 'order_id', p_order,
                       'payment_status', v_estado, 'cobrado_neto', v_m.cobrado_neto, 'saldo', v_m.saldo,
                       'sobrepago', v_m.sobrepago, 'sobre_pedido_cancelado', (v_o.status = 'cancelled')));
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) AUTORIZAR REEMBOLSO — reemplaza registrar_devolucion (que W1 ya había dejado
--    puramente financiera). NO mueve dinero: solo autoriza cuánto se debe devolver.
--    Devolución física (W1) y reembolso siguen separados; `p_return_id` solo los liga.
-- ---------------------------------------------------------------------------
create function public.autorizar_reembolso(
  p_op_id uuid, p_order uuid, p_tipo text, p_monto numeric, p_motivo text,
  p_return_id uuid default null, p_usuario text default null
) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_req jsonb; v_prev jsonb; v_o record; v_devuelto numeric; v_restante numeric; v_id uuid;
begin
  if not (public.auth_role() = any (array['admin','billing','pos'])) then
    raise exception 'NO_AUTORIZADO: no tienes permiso para autorizar reembolsos';
  end if;
  v_req := jsonb_build_object('order', p_order, 'tipo', p_tipo, 'monto', p_monto, 'motivo', p_motivo, 'return', p_return_id);
  v_prev := public._w2_op_begin(p_op_id, 'reembolso_autorizado', v_req);
  if v_prev is not null then return v_prev; end if;

  if p_tipo is null or p_tipo <> all (array['devolucion','correccion','cortesia']) then
    raise exception 'TIPO_INVALIDO: usa devolucion, correccion o cortesia';
  end if;
  if nullif(btrim(p_motivo), '') is null then
    raise exception 'MOTIVO_REQUERIDO: sin motivo no se puede auditar el reembolso';
  end if;
  if p_monto is null or p_monto <= 0 then raise exception 'MONTO_INVALIDO: el monto debe ser mayor a cero'; end if;

  select * into v_o from public.orders where id = p_order for update;
  if not found then raise exception 'PEDIDO_INVALIDO: el pedido no existe'; end if;
  if v_o.status = 'draft' then raise exception 'PEDIDO_INVALIDO: no se puede reembolsar un borrador'; end if;
  if p_return_id is not null and not exists (
       select 1 from public.stock_returns sr where sr.id = p_return_id and sr.order_id = p_order) then
    raise exception 'DEVOLUCION_INVALIDA: esa devolución física no pertenece a este pedido';
  end if;

  select coalesce(sum(r.monto), 0) into v_devuelto from public.refunds r where r.order_id = p_order;
  v_restante := coalesce(v_o.total, 0) - v_devuelto;
  if p_monto > v_restante then
    raise exception 'MONTO_EXCEDE: el máximo por reembolsar de este pedido es %', v_restante;
  end if;

  insert into public.refunds (order_id, tipo, monto, motivo, metodo, usuario, created_by, items, op_id, return_id)
  values (p_order, p_tipo, p_monto, left(btrim(p_motivo), 400), v_o.payment_method,
          coalesce(nullif(btrim(p_usuario), ''), 'Sistema'), auth.uid(), null, p_op_id, p_return_id)
  returning id into v_id;

  return public._w2_op_finish(p_op_id, 'reembolso_autorizado', v_req,
    jsonb_build_object('status', 'applied', 'refund_id', v_id, 'restante', v_restante - p_monto,
                       'nota', 'Autorizado. El dinero NO ha salido hasta registrar el pago del reembolso.'));
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) PAGAR REEMBOLSO — el egreso real (F-6). Una autorización se paga UNA vez.
--    D-W2-5: se prefiere la vía del cobro; otra vía exige Dirección y motivo.
-- ---------------------------------------------------------------------------
create function public.pagar_reembolso(
  p_op_id uuid, p_refund_id uuid, p_method text, p_value_date date default null,
  p_reference text default null, p_motivo_via text default null
) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_role text := public.auth_role();
  v_req jsonb; v_prev jsonb; v_r record; v_entry uuid; v_estado text; v_vias text[]; v_misma boolean;
begin
  if not (v_role = any (array['admin','billing'])) then
    raise exception 'NO_AUTORIZADO: solo Dirección/Facturación paga reembolsos';
  end if;
  v_req := jsonb_build_object('refund', p_refund_id, 'method', p_method, 'value_date', p_value_date,
             'reference', p_reference, 'motivo_via', p_motivo_via);
  v_prev := public._w2_op_begin(p_op_id, 'reembolso_pagado', v_req);
  if v_prev is not null then return v_prev; end if;

  select * into v_r from public.refunds where id = p_refund_id;
  if not found then raise exception 'REEMBOLSO_INEXISTENTE'; end if;
  perform 1 from public.orders where id = v_r.order_id for update;
  if exists (select 1 from public.payment_entries e
              where e.refund_id = p_refund_id and e.reversal_of is null) then
    raise exception 'REEMBOLSO_YA_PAGADO: ese reembolso ya tiene su egreso registrado';
  end if;
  if p_method is null or p_method not in ('transferencia','efectivo','tarjeta','stripe','otro') then
    raise exception 'METODO_INVALIDO';
  end if;

  -- D-W2-5: vía distinta a la del cobro ⇒ Dirección + motivo. Siempre se registra la vía REAL.
  select array_agg(distinct e.method) into v_vias from public.payment_entries e
   where e.order_id = v_r.order_id and e.direction = 'in';
  v_misma := v_vias is not null and p_method = any (v_vias);
  if not v_misma then
    if v_role <> 'admin' then
      raise exception 'VIA_DISTINTA_REQUIERE_DIRECCION: reembolsar por una vía distinta a la del cobro requiere Dirección';
    end if;
    if nullif(btrim(p_motivo_via), '') is null then
      raise exception 'MOTIVO_VIA_REQUERIDO: explica por qué el reembolso sale por otra vía';
    end if;
  end if;

  v_entry := public._w2_asiento(p_op_id, v_r.order_id, 'out', p_method, v_r.monto,
               coalesce(p_value_date, public.hoy_local()), null, p_refund_id, p_reference, null,
               null, null, case when v_misma then null else 'Vía distinta: ' || btrim(p_motivo_via) end);
  v_estado := public._w2_recalc_payment_status(v_r.order_id);

  return public._w2_op_finish(p_op_id, 'reembolso_pagado', v_req,
    jsonb_build_object('status', 'applied', 'entry_id', v_entry, 'refund_id', p_refund_id,
                       'monto', v_r.monto, 'misma_via', v_misma, 'payment_status', v_estado));
end;
$$;

-- ---------------------------------------------------------------------------
-- 8) CRÉDITO (D-W2-1) — SOLO Dirección. Guarda actor, timestamp, motivo y
--    due_date EXPLÍCITA. No toca payment_status ni orders.status.
-- ---------------------------------------------------------------------------
create function public.autorizar_credito(p_op_id uuid, p_order uuid, p_due_date date, p_motivo text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_req jsonb; v_prev jsonb; v_o record; v_m record;
begin
  if public.auth_role() <> 'admin' then
    raise exception 'NO_AUTORIZADO: solo Dirección autoriza crédito';
  end if;
  v_req := jsonb_build_object('order', p_order, 'due_date', p_due_date, 'motivo', p_motivo);
  v_prev := public._w2_op_begin(p_op_id, 'credito_autorizado', v_req);
  if v_prev is not null then return v_prev; end if;

  if nullif(btrim(p_motivo), '') is null then raise exception 'MOTIVO_REQUERIDO: el crédito requiere motivo'; end if;
  if p_due_date is null then raise exception 'VENCIMIENTO_REQUERIDO: indica la fecha límite de pago'; end if;
  if p_due_date < public.hoy_local() then raise exception 'VENCIMIENTO_PASADO: la fecha límite no puede ser anterior a hoy'; end if;

  select * into v_o from public.orders where id = p_order for update;
  if not found then raise exception 'PEDIDO_INEXISTENTE'; end if;
  if v_o.status = 'cancelled' then raise exception 'PEDIDO_CANCELADO: no se autoriza crédito a un pedido cancelado'; end if;
  if exists (select 1 from public.credit_grants g where g.order_id = p_order and g.revoked_at is null) then
    raise exception 'CREDITO_YA_AUTORIZADO: ese pedido ya tiene crédito vigente';
  end if;

  insert into public.credit_grants (id, order_id, due_date, reason, granted_by)
  values (p_op_id, p_order, p_due_date, left(btrim(p_motivo), 400), auth.uid());

  select * into v_m from public.v_order_money where order_id = p_order;
  return public._w2_op_finish(p_op_id, 'credito_autorizado', v_req,
    jsonb_build_object('status', 'applied', 'grant_id', p_op_id, 'order_id', p_order, 'due_date', p_due_date,
                       'liberado', v_m.liberado, 'payment_status', v_o.payment_status, 'saldo', v_m.saldo));
end;
$$;

create function public.revocar_credito(p_op_id uuid, p_order uuid, p_motivo text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_req jsonb; v_prev jsonb; v_g record;
begin
  if public.auth_role() <> 'admin' then raise exception 'NO_AUTORIZADO: solo Dirección revoca crédito'; end if;
  v_req := jsonb_build_object('order', p_order, 'motivo', p_motivo);
  v_prev := public._w2_op_begin(p_op_id, 'credito_revocado', v_req);
  if v_prev is not null then return v_prev; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'MOTIVO_REQUERIDO'; end if;

  select * into v_g from public.credit_grants where order_id = p_order and revoked_at is null for update;
  if not found then raise exception 'SIN_CREDITO_VIGENTE: ese pedido no tiene crédito que revocar'; end if;

  update public.credit_grants
     set revoked_by = auth.uid(), revoked_at = now(), revoke_reason = left(btrim(p_motivo), 400)
   where id = v_g.id;

  return public._w2_op_finish(p_op_id, 'credito_revocado', v_req,
    jsonb_build_object('status', 'applied', 'grant_id', v_g.id, 'order_id', p_order,
                       'liberado', public.pedido_liberado_para_surtir(p_order)));
end;
$$;

-- ---------------------------------------------------------------------------
-- 9) REVERSAR ASIENTO (F-2) — corrección por compensación, nunca edición.
-- ---------------------------------------------------------------------------
create function public.reversar_asiento(p_op_id uuid, p_entry_id uuid, p_motivo text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_req jsonb; v_prev jsonb; v_e record; v_new uuid; v_estado text;
begin
  if public.auth_role() <> 'admin' then raise exception 'NO_AUTORIZADO: solo Dirección reversa asientos'; end if;
  v_req := jsonb_build_object('entry', p_entry_id, 'motivo', p_motivo);
  v_prev := public._w2_op_begin(p_op_id, 'reversa_asiento', v_req);
  if v_prev is not null then return v_prev; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'MOTIVO_REQUERIDO'; end if;

  select * into v_e from public.payment_entries where id = p_entry_id;
  if not found then raise exception 'ASIENTO_INEXISTENTE'; end if;
  if v_e.reversal_of is not null then raise exception 'ASIENTO_ES_REVERSA: no se reversa una reversa'; end if;
  if exists (select 1 from public.payment_entries x where x.reversal_of = p_entry_id) then
    raise exception 'ASIENTO_YA_REVERSADO';
  end if;
  perform 1 from public.orders where id = v_e.order_id for update;

  v_new := public._w2_asiento(p_op_id, v_e.order_id, case when v_e.direction = 'in' then 'out' else 'in' end,
             v_e.method, v_e.amount, public.hoy_local(), null, v_e.refund_id, null, v_e.bank_account_id,
             null, p_entry_id, left(btrim(p_motivo), 400));
  v_estado := public._w2_recalc_payment_status(v_e.order_id);

  return public._w2_op_finish(p_op_id, 'reversa_asiento', v_req,
    jsonb_build_object('status', 'applied', 'entry_id', v_new, 'reversa_de', p_entry_id, 'payment_status', v_estado));
end;
$$;

-- ---------------------------------------------------------------------------
-- 10) CORTE DE CAJA (F-10) — el ESPERADO lo calcula el servidor desde el libro.
--     alcance 'dia' = todo el efectivo del día · 'cajero' = el de quien lo recibió.
-- ---------------------------------------------------------------------------
-- D-W2-CASH-CUTOFF · un corte cerrado establece un LÍMITE ECONÓMICO.
--
-- La cadena de un alcance: cada corte (y cada anulación) apunta al renglón que
-- continúa. El renglón al que nadie apunta es la COLA: ahí está el límite vigente.
--   · cola = corte válido      ⇒ el tramo nuevo arranca donde terminó ese corte
--   · cola = anulación de X    ⇒ X ya no establece límite: se REABRE su tramo
--   · sin cadena (primer corte) ⇒ arranca al inicio del día local del periodo
-- Todo se resuelve con el reloj del SERVIDOR sobre `payment_entries.created_at`
-- (cuándo pasó el efectivo por el cajón). El cliente no manda fechas ni montos.
create function public._w2_corte_cola(p_alcance text, p_cajero uuid)
returns public.cash_closings
  language sql stable security definer set search_path = public as
$$
  select c.* from public.cash_closings c
   where c.alcance = p_alcance and c.cajero is not distinct from p_cajero
     and not exists (select 1 from public.cash_closings x where x.prev_closing_id = c.id)
   order by c.created_at desc limit 1;
$$;

-- Inicio EXCLUSIVO del tramo que arquearía un corte nuevo de este alcance.
create function public._w2_corte_desde(p_fecha date, p_alcance text, p_cajero uuid)
returns timestamptz
  language plpgsql stable security definer set search_path = public as
$$
declare v_cola public.cash_closings; v_anulado public.cash_closings;
begin
  v_cola := public._w2_corte_cola(p_alcance, p_cajero);
  if v_cola.id is null then
    -- Primer corte del alcance: desde el inicio del periodo operativo (día local).
    return (p_fecha::timestamp) at time zone 'America/Mazatlan';
  end if;
  if v_cola.voids_closing_id is not null then
    -- La cola es una anulación: el corte anulado NO establece límite ⇒ su tramo se reabre.
    select * into v_anulado from public.cash_closings where id = v_cola.voids_closing_id;
    return v_anulado.corte_desde;
  end if;
  return v_cola.corte_hasta;
end;
$$;

-- Efectivo NETO que pasó por el cajón en un tramo (in − out). Es la única aritmética
-- del arqueo y vive en el servidor.
create function public._w2_efectivo_tramo(p_desde timestamptz, p_hasta timestamptz, p_alcance text, p_cajero uuid)
returns numeric
  language sql stable security definer set search_path = public as
$$
  select coalesce(sum(case when e.direction = 'in' then e.amount else -e.amount end), 0)
    from public.payment_entries e
   where e.method = 'efectivo'
     and e.created_at >  p_desde
     and e.created_at <= p_hasta
     and (p_alcance = 'dia' or e.recorded_by is not distinct from p_cajero);
$$;

-- Vista previa del esperado de un corte nuevo (lo que la pantalla muestra ANTES de cerrar).
-- Misma definición que usa el comando: el cliente nunca calcula ni envía el esperado.
create function public.efectivo_esperado(p_fecha date, p_alcance text default 'dia', p_cajero uuid default null)
returns numeric
  language plpgsql stable security definer set search_path = public as
$$
declare v_cajero uuid := case when p_alcance = 'dia' then null else p_cajero end;
begin
  -- El efectivo en caja es información de caja: no la ve un doctor ni Almacén.
  if not (public.auth_role() = any (array['admin','billing','pos'])) then
    raise exception 'NO_AUTORIZADO: no tienes permiso para consultar el efectivo esperado';
  end if;
  return public._w2_efectivo_tramo(
    public._w2_corte_desde(p_fecha, p_alcance, v_cajero), clock_timestamp(), p_alcance, v_cajero);
end;
$$;

-- Tramo pendiente de arquear, para que la pantalla pueda explicar el número.
create function public.tramo_corte_caja(p_fecha date, p_alcance text default 'dia', p_cajero uuid default null)
returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_cajero uuid := case when p_alcance = 'dia' then null else p_cajero end;
        v_desde timestamptz; v_cola public.cash_closings;
begin
  if not (public.auth_role() = any (array['admin','billing','pos'])) then
    raise exception 'NO_AUTORIZADO: no tienes permiso para consultar el corte';
  end if;
  v_cola  := public._w2_corte_cola(p_alcance, v_cajero);
  v_desde := public._w2_corte_desde(p_fecha, p_alcance, v_cajero);
  return jsonb_build_object(
    'desde', v_desde, 'hasta', clock_timestamp(),
    'esperado', public._w2_efectivo_tramo(v_desde, clock_timestamp(), p_alcance, v_cajero),
    'primer_corte', (v_cola.id is null),
    'continua_de', v_cola.id,
    'reabre_anulado', v_cola.voids_closing_id);
end;
$$;

create function public.registrar_corte_caja(
  p_op_id uuid, p_fecha date, p_alcance text, p_fondo numeric, p_contado numeric,
  p_motivo text default null, p_cajero uuid default null
) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_req jsonb; v_prev jsonb; v_esperado numeric; v_dif numeric; v_id uuid := gen_random_uuid();
  v_cajero uuid; v_desde timestamptz; v_hasta timestamptz; v_cola public.cash_closings;
begin
  if not (public.auth_role() = any (array['admin','billing','pos'])) then
    raise exception 'NO_AUTORIZADO: no tienes permiso para cerrar caja';
  end if;
  v_req := jsonb_build_object('fecha', p_fecha, 'alcance', p_alcance, 'fondo', p_fondo, 'contado', p_contado,
             'motivo', p_motivo, 'cajero', p_cajero);
  v_prev := public._w2_op_begin(p_op_id, 'corte_caja', v_req);
  if v_prev is not null then return v_prev; end if;

  if p_alcance not in ('dia','cajero') then raise exception 'ALCANCE_INVALIDO: usa dia o cajero'; end if;
  if p_alcance = 'cajero' and p_cajero is null then raise exception 'CAJERO_REQUERIDO'; end if;
  if p_fecha > public.hoy_local() then raise exception 'FECHA_FUTURA'; end if;
  if p_contado is null or p_contado < 0 or coalesce(p_fondo, 0) < 0 then raise exception 'MONTO_INVALIDO'; end if;
  v_cajero := case when p_alcance = 'dia' then null else p_cajero end;

  -- D-W2-CASH-CUTOFF · un solo corte a la vez por alcance: el cerrojo serializa
  -- "leer el límite vigente → reclamar el tramo siguiente". El índice único de la
  -- cadena es el respaldo duro si dos transacciones llegaran igual.
  perform pg_advisory_xact_lock(hashtext('w2_corte:' || p_alcance || ':' || coalesce(v_cajero::text, '-')));

  -- F-10 + cutoff: el tramo y el esperado los calcula el SERVIDOR. `now()` se fija una
  -- sola vez para que el esperado y el tramo guardado no puedan discrepar.
  v_hasta := clock_timestamp();
  v_cola  := public._w2_corte_cola(p_alcance, v_cajero);
  -- Cerrojo de fila sobre el límite vigente: respaldo del cerrojo de aviso de arriba.
  if v_cola.id is not null then perform 1 from public.cash_closings where id = v_cola.id for update; end if;
  v_desde := public._w2_corte_desde(p_fecha, p_alcance, v_cajero);
  if v_desde >= v_hasta then
    raise exception 'TRAMO_VACIO: el último corte de este alcance ya cubre hasta ahora';
  end if;
  v_esperado := public._w2_efectivo_tramo(v_desde, v_hasta, p_alcance, v_cajero);

  v_dif := p_contado - (v_esperado + coalesce(p_fondo, 0));
  if abs(v_dif) > 0 and nullif(btrim(p_motivo), '') is null then
    raise exception 'MOTIVO_REQUERIDO: hay una diferencia de %; explica por qué', v_dif;
  end if;

  perform public._w2_trusted(true);
  insert into public.cash_closings (id, fecha, alcance, esperado, fondo, contado, diferencia, motivo, usuario,
                                    created_by, op_id, cajero, corte_desde, corte_hasta, prev_closing_id)
  values (v_id, p_fecha, p_alcance, v_esperado, coalesce(p_fondo, 0), p_contado, v_dif,
          nullif(btrim(p_motivo), ''), coalesce(public.auth_role(), ''), auth.uid(), p_op_id,
          v_cajero, v_desde, v_hasta, v_cola.id);
  perform public._w2_trusted(false);

  return public._w2_op_finish(p_op_id, 'corte_caja', v_req,
    jsonb_build_object('status', 'applied', 'closing_id', v_id, 'esperado', v_esperado,
                       'contado', p_contado, 'diferencia', v_dif,
                       'desde', v_desde, 'hasta', v_hasta, 'continua_de', v_cola.id));
end;
$$;

create function public.anular_corte_caja(p_op_id uuid, p_closing_id uuid, p_motivo text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_req jsonb; v_prev jsonb; v_c record; v_id uuid := gen_random_uuid(); v_cola public.cash_closings;
begin
  if public.auth_role() <> 'admin' then
    raise exception 'NO_AUTORIZADO: solo Dirección anula un corte de caja';
  end if;
  v_req := jsonb_build_object('closing', p_closing_id, 'motivo', p_motivo);
  v_prev := public._w2_op_begin(p_op_id, 'anulacion_corte', v_req);
  if v_prev is not null then return v_prev; end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'MOTIVO_REQUERIDO'; end if;

  select * into v_c from public.cash_closings where id = p_closing_id for update;
  if not found then raise exception 'CORTE_INEXISTENTE'; end if;
  if v_c.voids_closing_id is not null then raise exception 'CORTE_ES_ANULACION: no se anula una anulación'; end if;
  if exists (select 1 from public.cash_closings x where x.voids_closing_id = p_closing_id) then
    raise exception 'CORTE_YA_ANULADO';
  end if;

  perform pg_advisory_xact_lock(hashtext('w2_corte:' || v_c.alcance || ':' || coalesce(v_c.cajero::text, '-')));

  -- D-W2-CASH-CUTOFF · solo se anula el ÚLTIMO corte del alcance. Anular uno intermedio
  -- dejaría un hueco entre tramos y el siguiente corte tendría que reclamar dos veces el
  -- efectivo de los cortes posteriores. Para corregir uno viejo, se anula hacia atrás.
  v_cola := public._w2_corte_cola(v_c.alcance, v_c.cajero);
  if v_cola.id is distinct from p_closing_id then
    raise exception 'CORTE_NO_ES_EL_ULTIMO: solo se anula el corte más reciente de este alcance (anula primero los posteriores)';
  end if;

  -- D-W2-7: compensación, nunca DELETE. La anulación entra a la CADENA (continúa al corte
  -- que anula): así el tramo de ese corte queda libre sin editar ni borrar nada, y ningún
  -- otro corte puede volver a arrancar desde él.
  perform public._w2_trusted(true);
  insert into public.cash_closings (id, fecha, alcance, esperado, fondo, contado, diferencia, motivo,
                                    usuario, created_by, op_id, voids_closing_id, void_reason,
                                    cajero, prev_closing_id)
  values (v_id, v_c.fecha, v_c.alcance, -v_c.esperado, -v_c.fondo, -v_c.contado, -v_c.diferencia,
          'Anulación de corte', coalesce(public.auth_role(), ''), auth.uid(), p_op_id,
          p_closing_id, left(btrim(p_motivo), 400), v_c.cajero, p_closing_id);
  perform public._w2_trusted(false);

  return public._w2_op_finish(p_op_id, 'anulacion_corte', v_req,
    jsonb_build_object('status', 'applied', 'anulacion_id', v_id, 'corte_anulado', p_closing_id,
                       'tramo_reabierto_desde', v_c.corte_desde));
end;
$$;

-- ---------------------------------------------------------------------------
-- 11) CONSULTAS
-- ---------------------------------------------------------------------------
create function public.estado_dinero_pedido(p_order uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_m record; v_o record;
begin
  select * into v_o from public.orders where id = p_order;
  if not found then raise exception 'PEDIDO_INEXISTENTE'; end if;
  if not (public.auth_role() = any (array['admin','billing','pos','warehouse','packing'])
          or v_o.doctor_id = auth.uid()) then
    raise exception 'NO_AUTORIZADO';
  end if;
  select * into v_m from public.v_order_money where order_id = p_order;
  return to_jsonb(v_m) || jsonb_build_object(
    'claims', coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'status', c.status, 'method', c.method,
                                'monto', c.amount_declared, 'declarado', c.declared_at, 'motivo_rechazo', c.reject_reason)
                          order by c.declared_at desc) from public.payment_claims c where c.order_id = p_order), '[]'::jsonb),
    'asientos', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'direction', e.direction, 'method', e.method,
                                'monto', e.amount, 'fecha_valor', e.value_date, 'reversa_de', e.reversal_of)
                          order by e.created_at) from public.payment_entries e where e.order_id = p_order), '[]'::jsonb));
end;
$$;

-- Recuperación ante respuesta AMBIGUA (red/timeout): ¿el servidor ya registró la operación?
create function public.estado_operacion_dinero(p_op_id uuid) returns jsonb
  language sql stable security definer set search_path = public as
$$
  select result || jsonb_build_object('status', 'already_applied')
    from public.money_operations
   where op_id = p_op_id and (actor = auth.uid() or public.auth_role() = any (array['admin','billing']));
$$;

create function public.conciliar_dinero()
returns table (check_id text, severidad text, entidad text, entidad_id uuid, detalle text, esperado numeric, obtenido numeric)
  language plpgsql stable security definer set search_path = public as
$$
begin
  if public.auth_role() <> 'admin' then raise exception 'NO_AUTORIZADO: solo Dirección'; end if;
  return query
  -- D1: la proyección financiera coincide con el libro
  select 'D1_proyeccion_vs_libro', 'error', 'order', m.order_id, coalesce(m.external_ref, '') || ' · ' || m.payment_status,
         null::numeric, m.cobrado_neto
    from public.v_order_money m where m.payment_status is distinct from m.estado_pago
  union all
  -- D2: sobrepago pendiente de devolver (D-W2-4: no hay saldo a favor)
  select 'D2_sobrepago', 'error', 'order', m.order_id, coalesce(m.external_ref, ''), m.total, m.cobrado_neto
    from public.v_order_money m where m.sobrepago and m.reembolso_pendiente <= 0
  union all
  -- D3: egreso sin autorización o que excede lo autorizado
  select 'D3_egreso_sin_autorizacion', 'error', 'order', x.order_id, 'reembolsado > autorizado', x.autorizado, x.pagado
    from (select e.order_id, sum(case when e.direction = 'out' then e.amount else -e.amount end) pagado,
                 coalesce((select sum(r.monto) from public.refunds r where r.order_id = e.order_id), 0) autorizado
            from public.payment_entries e where e.refund_id is not null group by e.order_id) x
   where x.pagado > x.autorizado
  union all
  -- D4: reembolsos autorizados que todavía no se pagan (el dinero NO ha salido)
  select 'D4_reembolso_pendiente', 'info', 'order', m.order_id, coalesce(m.external_ref, ''), m.reembolso_pendiente, null::numeric
    from public.v_order_money m where m.reembolso_pendiente > 0
  union all
  -- D5: cancelado con dinero cobrado y sin reembolso autorizado (pago tardío · F-9)
  select 'D5_cancelado_con_dinero', 'alerta', 'order', m.order_id, coalesce(m.external_ref, ''), null::numeric, m.cobrado_neto
    from public.v_order_money m
    join public.orders o on o.id = m.order_id
   where o.status = 'cancelled' and m.cobrado_neto > 0
     and not exists (select 1 from public.refunds r where r.order_id = m.order_id)
  union all
  -- D6: declaración verificada sin asiento, o asiento colgado de una declaración no verificada
  select 'D6_declaracion_vs_asiento', 'error', 'claim', c.id, c.status, null::numeric, null::numeric
    from public.payment_claims c
   where (c.status = 'verificado' and c.entry_id is null)
      or (c.status <> 'verificado' and exists (select 1 from public.payment_entries e where e.claim_id = c.id))
  union all
  -- D7: crédito vencido con saldo (cobranza)
  select 'D7_credito_vencido', 'alerta', 'order', m.order_id,
         coalesce(m.external_ref, '') || ' · vence ' || m.due_date::text, null::numeric, m.saldo
    from public.v_order_money m where m.vencido and m.saldo > 0
  union all
  -- D8: corte VIGENTE cuyo TRAMO ya no cuadra con el libro. Recalcula el mismo tramo que
  -- el corte cerró —(corte_desde, corte_hasta]— así que también detecta el efectivo que
  -- aterrizó dentro de un tramo ya cortado (la única forma de que un arqueo cerrado deje
  -- de ser cierto).
  select 'D8_corte_vs_libro', 'error', 'cash_closing', c.id,
         c.fecha::text || ' · ' || c.alcance || ' · tramo ' || c.corte_desde::text || ' → ' || c.corte_hasta::text,
         public._w2_efectivo_tramo(c.corte_desde, c.corte_hasta, c.alcance, c.cajero), c.esperado
    from public.cash_closings c
   where c.voids_closing_id is null
     and not exists (select 1 from public.cash_closings v where v.voids_closing_id = c.id)
     and c.corte_desde is not null
     and c.esperado is distinct from public._w2_efectivo_tramo(c.corte_desde, c.corte_hasta, c.alcance, c.cajero)
  union all
  -- D9: entregado a crédito y todavía sin cobrar (cuenta por cobrar viva)
  select 'D9_entregado_sin_cobrar', 'info', 'order', m.order_id, coalesce(m.external_ref, ''), m.total, m.cobrado_neto
    from public.v_order_money m
    join public.orders o on o.id = m.order_id
   where o.status in ('delivered','fulfilled') and m.saldo > 0 and m.credito_autorizado;
end;
$$;

-- ============================================================================
-- RECREADAS DE W1 — cambio QUIRÚRGICO, el resto VERBATIM.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- surtir_pedido · ÚNICO cambio: la compuerta de liberación (F-7).
--   antes: status in ('paid','picking')  ← obligaba a fingir el pago
--   ahora: liberado (cobro suficiente OR crédito) + estados operativos válidos
-- ---------------------------------------------------------------------------
create or replace function public.surtir_pedido(p_op_id uuid, p_order uuid, p_allocations jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_uid uuid := auth.uid();
  v_req jsonb; v_prev jsonb; v_res jsonb;
  v_ord record; a record; v_bad int; v_items int;
begin
  if not (public.auth_role() = any (array['admin','warehouse','packing'])) then
    raise exception 'NO_AUTORIZADO: sin permiso para surtir';
  end if;
  v_req := jsonb_build_object('order', p_order, 'allocations', p_allocations);
  v_prev := public._w1_op_begin(p_op_id, 'surtido', v_req);
  if v_prev is not null then return v_prev; end if;

  select id, status, external_ref into v_ord from public.orders where id = p_order for update;
  if not found then raise exception 'PEDIDO_INEXISTENTE'; end if;
  if v_ord.status = 'cancelled' or exists (select 1 from public.order_cancellations where order_id = p_order) then
    raise exception 'PEDIDO_CANCELADO: no se surte un pedido cancelado';
  end if;
  if v_ord.status in ('packed','shipped','delivered','fulfilled') then
    raise exception 'PEDIDO_YA_SURTIDO: el pedido ya está %', v_ord.status;
  end if;
  -- W2 · F-7: se surte lo LIBERADO, no lo "marcado como pagado". Un pedido a crédito
  -- se surte con payment_status='pending' y sin tocar orders.status.
  if not public.pedido_liberado_para_surtir(p_order) then
    raise exception 'PEDIDO_NO_LIBERADO: el pedido no tiene cobro suficiente ni crédito autorizado';
  end if;
  if v_ord.status not in ('pending_payment','paid','picking') then
    raise exception 'PEDIDO_NO_SURTIBLE: el pedido está %', v_ord.status;
  end if;
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) = 0 then
    raise exception 'ASIGNACIONES_REQUERIDAS';
  end if;
  select count(*) into v_items from public.order_items where order_id = p_order;
  if v_items = 0 then raise exception 'PEDIDO_SIN_RENGLONES: no hay nada que surtir'; end if;

  -- a) cada asignación: renglón del pedido, qty > 0, lote del mismo producto, vigente
  for a in
    select x.order_item_id, x.lot_id, x.qty, oi.product_id as item_product, l.product_id as lot_product, l.expiry_date
      from jsonb_to_recordset(p_allocations) as x(order_item_id uuid, lot_id uuid, qty int)
      left join public.order_items oi on oi.id = x.order_item_id and oi.order_id = p_order
      left join public.lots l on l.id = x.lot_id
  loop
    if a.item_product is null then raise exception 'ASIGNACION_INVALIDA: el renglón % no pertenece al pedido', a.order_item_id; end if;
    if a.qty is null or a.qty <= 0 then raise exception 'CANTIDAD_INVALIDA: cada asignación debe ser mayor a cero'; end if;
    if a.lot_product is null then raise exception 'LOTE_INEXISTENTE: %', a.lot_id; end if;
    if a.lot_product <> a.item_product then raise exception 'LOTE_DE_OTRO_PRODUCTO: el lote % no es del producto del renglón', a.lot_id; end if;
    if public.lote_caducado(a.expiry_date) then raise exception 'LOTE_CADUCADO: el lote % caducó el %', a.lot_id, a.expiry_date; end if;
  end loop;

  -- b) cobertura exacta: Σ asignado por renglón = cantidad del renglón (todo o nada)
  select count(*) into v_bad
    from public.order_items oi
    left join (select x.order_item_id, sum(x.qty) s
                 from jsonb_to_recordset(p_allocations) as x(order_item_id uuid, lot_id uuid, qty int)
                group by 1) s on s.order_item_id = oi.id
   where oi.order_id = p_order and coalesce(s.s, 0) <> oi.qty;
  if v_bad > 0 then
    raise exception 'ASIGNACION_INCOMPLETA: % renglón(es) no cuadran con la cantidad pedida', v_bad;
  end if;

  -- c) locks de lotes en orden determinista (evita deadlocks entre surtidos)
  perform 1 from public.lots
   where id in (select x.lot_id from jsonb_to_recordset(p_allocations) as x(order_item_id uuid, lot_id uuid, qty int))
   order by id for update;

  -- d) descuento condicional + kardex con referencia de negocio
  for a in select x.order_item_id, x.lot_id, x.qty
             from jsonb_to_recordset(p_allocations) as x(order_item_id uuid, lot_id uuid, qty int)
  loop
    update public.lots set quantity = quantity - a.qty where id = a.lot_id and quantity - a.qty >= 0;
    if not found then raise exception 'INVENTARIO_INSUFICIENTE: el lote % no alcanza', a.lot_id; end if;
    insert into public.inventory_movements (lot_id, change, reason, reference, created_by, op_id, order_id, order_item_id)
    values (a.lot_id, -a.qty, 'surtido', coalesce(v_ord.external_ref, p_order::text), v_uid, p_op_id, p_order, a.order_item_id);
  end loop;

  -- e) empacado (solo por comando) + lote de referencia por renglón (dato de pantalla)
  perform public._w1_trusted(true);
  update public.orders set status = 'packed' where id = p_order;
  perform public._w1_trusted(false);
  update public.order_items oi set lot_id = f.lot_id
    from (select distinct on ((e.j ->> 'order_item_id')::uuid)
                 (e.j ->> 'order_item_id')::uuid as order_item_id, (e.j ->> 'lot_id')::uuid as lot_id
            from jsonb_array_elements(p_allocations) with ordinality as e(j, n)
           order by (e.j ->> 'order_item_id')::uuid, e.n) f
   where oi.id = f.order_item_id;

  v_res := jsonb_build_object('status', 'applied', 'order_id', p_order, 'order_status', 'packed',
             'allocations', jsonb_array_length(p_allocations));
  return public._w1_op_finish(p_op_id, 'surtido', v_req, v_res);
end;
$$;

-- ---------------------------------------------------------------------------
-- cancelar_pedido · DOS cambios quirúrgicos (D-W2-6):
--   1) money_signal sale del LIBRO y de las declaraciones (sin espejo en JSON).
--   2) la regla de actor considera la LIBERACIÓN: un pedido a crédito se queda en
--      'pending_payment', así que sin esto un doctor podría cancelar un pedido que
--      Dirección ya autorizó y Almacén ya está preparando.
--   El resto (reingreso pendiente, frontera de guía, idempotencia) queda VERBATIM.
-- ---------------------------------------------------------------------------
create or replace function public.cancelar_pedido(p_op_id uuid, p_order uuid, p_reason text default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_role text := public.auth_role(); v_uid uuid := auth.uid();
  v_req jsonb; v_prev jsonb; v_res jsonb;
  v_o record; v_c record; v_money text; v_review text; v_ret uuid; v_attempt text;
  v_cobrado numeric; v_liberado boolean;
begin
  if not (v_role = any (array['admin','billing','doctor'])) then
    raise exception 'NO_AUTORIZADO: tu rol no cancela pedidos';
  end if;
  v_req := jsonb_build_object('order', p_order, 'reason', p_reason);
  v_prev := public._w1_op_begin(p_op_id, 'cancelacion', v_req);
  if v_prev is not null then return v_prev; end if;

  select * into v_o from public.orders where id = p_order for update;
  if not found or (v_role = 'doctor' and v_o.doctor_id is distinct from v_uid) then
    raise exception 'PEDIDO_INEXISTENTE';
  end if;

  -- Ya cancelado ⇒ CERO efecto adicional (idempotencia natural por pedido).
  select * into v_c from public.order_cancellations where order_id = p_order;
  if found then
    v_res := jsonb_build_object('status', 'already_cancelled', 'order_id', p_order, 'prior_status', v_c.prior_status,
               'refund_review', v_c.refund_review, 'return_id', v_c.return_id);
    return public._w1_op_finish(p_op_id, 'cancelacion', v_req, v_res);
  end if;
  if v_o.status = 'cancelled' then
    v_res := jsonb_build_object('status', 'already_cancelled', 'order_id', p_order);
    return public._w1_op_finish(p_op_id, 'cancelacion', v_req, v_res);
  end if;

  if v_o.status in ('shipped','delivered','fulfilled') then
    raise exception 'USAR_DEVOLUCION: el pedido ya salió o se entregó (%); registra una devolución', v_o.status;
  end if;
  if v_o.status not in ('draft','pending_payment','paid','picking','packed') then
    raise exception 'ESTADO_INVALIDO: %', v_o.status;
  end if;

  -- W2 · fuente canónica del dinero: el LIBRO y las declaraciones (sin shipping_meta).
  select cobrado_neto, liberado into v_cobrado, v_liberado from public.v_order_money where order_id = p_order;
  v_money := case
    when v_o.payment_status = 'paid' or coalesce(v_cobrado, 0) > 0 then 'pago_registrado'
    when exists (select 1 from public.payment_claims c where c.order_id = p_order and c.status = 'reportado')
      then 'pago_reportado_en_revision'
    when v_o.stripe_payment_id is not null then 'stripe'
    else null end;

  if v_o.status in ('draft','pending_payment') and v_money is null and not coalesce(v_liberado, false) then
    null;  -- antes de pagar y sin liberar: doctor (su pedido) o staff autorizado (admin/billing)
  elsif v_role <> 'admin' then
    raise exception 'CANCELACION_REQUIERE_DIRECCION: pedido % (%)%: solo Dirección puede cancelarlo',
      coalesce(v_o.external_ref, p_order::text), v_o.status,
      case when v_money is not null then ' con evidencia de pago'
           when coalesce(v_liberado, false) then ' con crédito autorizado' else '' end;
  end if;
  if v_role <> 'doctor' and nullif(btrim(p_reason), '') is null then
    raise exception 'MOTIVO_REQUERIDO: la cancelación requiere motivo';
  end if;
  v_review := case when v_money is not null then 'pendiente_revision' else 'no_aplica' end;

  if v_o.status = 'packed' then
    select status into v_attempt from public.shipping_attempts
     where order_id = p_order and status in ('pending','succeeded','unknown_requires_reconciliation') limit 1;
    if found then
      raise exception 'GUIA_ACTIVA: el pedido tiene una guía en estado %; %', v_attempt,
        case when v_attempt = 'unknown_requires_reconciliation' then 'requiere reconciliación con la paquetería antes de cancelar'
             when v_attempt = 'pending' then 'hay una guía en proceso'
             else 'Dirección debe registrar su anulación manual antes de cancelar' end;
    end if;
    if exists (select 1 from public.shipments
                where order_id = p_order
                  and (dispatched_at is not null or status in ('despachado','out_for_delivery','delivered','incident'))) then
      raise exception 'USAR_DEVOLUCION: el pedido ya salió con el chofer/paquetería';
    end if;

    if exists (select 1 from public.inventory_movements where order_id = p_order and reason in ('surtido','venta')) then
      v_ret := gen_random_uuid();
      insert into public.stock_returns (id, order_id, origin, notes, created_by)
      values (v_ret, p_order, 'cancelacion', btrim(p_reason), v_uid);
      insert into public.stock_return_lines (return_id, order_id, order_item_id, product_id, lot_id, qty)
      select v_ret, p_order, m.order_item_id, l.product_id, m.lot_id, sum(-m.change)
        from public.inventory_movements m join public.lots l on l.id = m.lot_id
       where m.order_id = p_order and m.reason in ('surtido','venta')
       group by m.order_item_id, l.product_id, m.lot_id
      having sum(-m.change) > 0;
    end if;

    update public.shipments set status = 'cancelado'
     where order_id = p_order and dispatched_at is null
       and coalesce(status, '') not in ('despachado','out_for_delivery','delivered','incident');
  end if;

  perform public._w1_trusted(true);
  update public.orders set status = 'cancelled' where id = p_order;
  perform public._w1_trusted(false);

  insert into public.order_cancellations (order_id, op_id, prior_status, reason, cancelled_by, actor_role,
                                          money_signal, refund_review, return_id)
  values (p_order, p_op_id, v_o.status, nullif(btrim(p_reason), ''), v_uid, v_role, v_money, v_review, v_ret);

  v_res := jsonb_build_object('status', 'applied', 'order_id', p_order, 'prior_status', v_o.status,
             'refund_review', v_review, 'money_signal', v_money, 'return_id', v_ret,
             'reingreso_pendiente', v_ret is not null, 'cobrado_neto', coalesce(v_cobrado, 0));
  return public._w1_op_finish(p_op_id, 'cancelacion', v_req, v_res);
end;
$$;

-- ---------------------------------------------------------------------------
-- vender_pos · ÚNICO cambio: escribe su ASIENTO de cobro en la MISMA transacción
--   (F-1: el POS deja de afirmar 'paid' sin evidencia) y captura el efectivo
--   recibido para el corte de caja. El resto queda VERBATIM.
-- ---------------------------------------------------------------------------
drop function if exists public.vender_pos(uuid, text, numeric, text, uuid, jsonb, jsonb, jsonb, boolean, jsonb, uuid);

create function public.vender_pos(p_order_id uuid, p_folio text, p_total numeric, p_payment_method text,
  p_doctor_id uuid, p_shipping_meta jsonb, p_lines jsonb, p_allocations jsonb,
  p_invoice_requested boolean default false, p_invoice_meta jsonb default null::jsonb, p_customer_id uuid default null::uuid,
  p_efectivo_recibido numeric default null)
returns boolean
  language plpgsql security definer set search_path = public as
$$
declare
  v_uid uuid := auth.uid();
  v_req jsonb; v_prev jsonb;
  a record; ln record; v_nlines int; qty int; pid uuid; up numeric; tot numeric := 0;
  v_items uuid[] := '{}'; v_item uuid; v_bad int;
  v_cname text; v_cphone text; v_meta jsonb; v_metodo text;
begin
  if not (public.auth_role() = any (array['admin','pos'])) then
    raise exception 'No autorizado';
  end if;
  v_req := jsonb_build_object('folio', p_folio, 'total', p_total, 'payment_method', p_payment_method,
             'doctor', p_doctor_id, 'shipping_meta', p_shipping_meta, 'lines', p_lines, 'allocations', p_allocations,
             'invoice_requested', p_invoice_requested, 'invoice_meta', p_invoice_meta, 'customer', p_customer_id);
  v_prev := public._w1_op_begin(p_order_id, 'venta_pos', v_req);
  if v_prev is not null then return true; end if;  -- ya aplicada: éxito idempotente

  if p_customer_id is not null then
    select full_name, phone into v_cname, v_cphone from public.customers where id = p_customer_id and active = true;
    if not found then raise exception 'CUSTOMER_INEXISTENTE: customer inexistente o inactivo'; end if;
  end if;
  if exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'PEDIDO_EXISTENTE: el id % ya pertenece a otro pedido', p_order_id;
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'VENTA_SIN_RENGLONES';
  end if;
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'ASIGNACIONES_REQUERIDAS';
  end if;
  v_nlines := jsonb_array_length(p_lines);
  v_metodo := case when p_payment_method in ('efectivo','tarjeta','transferencia','stripe') then p_payment_method else 'otro' end;

  for ln in select value as j, ordinality as n from jsonb_array_elements(p_lines) with ordinality loop
    pid := nullif(ln.j ->> 'product_id', '')::uuid; qty := (ln.j ->> 'qty')::int;
    if pid is null then raise exception 'Producto inválido'; end if;
    if qty is null or qty <= 0 then raise exception 'Cantidad inválida'; end if;
    up := public.precio_de(pid, null, qty);
    if up is null then raise exception 'Producto % sin precio válido', pid; end if;
    tot := tot + up * qty;
  end loop;

  for a in
    select x.line_index, x.lot_id, x.qty, l.product_id as lot_product, l.expiry_date,
           nullif(p_lines -> x.line_index ->> 'product_id', '')::uuid as line_product
      from jsonb_to_recordset(p_allocations) as x(line_index int, lot_id uuid, qty int)
      left join public.lots l on l.id = x.lot_id
  loop
    if a.line_index is null or a.line_index < 0 or a.line_index >= v_nlines then
      raise exception 'ASIGNACION_INVALIDA: renglón % inexistente', a.line_index;
    end if;
    if a.qty is null or a.qty <= 0 then raise exception 'CANTIDAD_INVALIDA: cada asignación debe ser mayor a cero'; end if;
    if a.lot_product is null then raise exception 'LOTE_INEXISTENTE: %', a.lot_id; end if;
    if a.lot_product <> a.line_product then raise exception 'LOTE_DE_OTRO_PRODUCTO: el lote % no es del producto del renglón', a.lot_id; end if;
    if public.lote_caducado(a.expiry_date) then raise exception 'LOTE_CADUCADO: el lote % caducó el %', a.lot_id, a.expiry_date; end if;
  end loop;
  select count(*) into v_bad
    from generate_series(0, v_nlines - 1) g(i)
    left join (select x.line_index, sum(x.qty) s from jsonb_to_recordset(p_allocations) as x(line_index int, lot_id uuid, qty int)
                group by 1) s on s.line_index = g.i
   where coalesce(s.s, 0) <> (p_lines -> g.i ->> 'qty')::int;
  if v_bad > 0 then raise exception 'ASIGNACION_INCOMPLETA: % renglón(es) no cuadran con la cantidad vendida', v_bad; end if;

  if p_efectivo_recibido is not null and v_metodo = 'efectivo' and p_efectivo_recibido < tot then
    raise exception 'EFECTIVO_INSUFICIENTE: recibido % para un total de %', p_efectivo_recibido, tot;
  end if;

  v_meta := p_shipping_meta;
  if p_customer_id is not null then
    v_meta := jsonb_set(coalesce(v_meta, '{}'::jsonb), '{customer}', jsonb_build_object('id', p_customer_id, 'name', v_cname, 'phone', v_cphone), true);
  end if;

  -- El POS cobra al momento: payment_status='paid' queda respaldado por el asiento de abajo.
  insert into public.orders (id, external_ref, doctor_id, customer_id, total, currency, status, payment_method, payment_status, invoice_requested, invoice_meta, shipping_meta)
  values (p_order_id, p_folio, p_doctor_id, p_customer_id, tot, 'MXN', 'delivered', p_payment_method, 'paid', coalesce(p_invoice_requested, false), p_invoice_meta, v_meta);

  for ln in select value as j, ordinality as n from jsonb_array_elements(p_lines) with ordinality loop
    pid := (ln.j ->> 'product_id')::uuid; qty := (ln.j ->> 'qty')::int;
    insert into public.order_items (order_id, product_id, lot_id, qty, unit_price)
    values (p_order_id, pid,
            (select (e.j ->> 'lot_id')::uuid from jsonb_array_elements(p_allocations) with ordinality as e(j, k)
              where (e.j ->> 'line_index')::int = ln.n - 1 order by e.k limit 1),
            qty, public.precio_de(pid, null, qty))
    returning id into v_item;
    v_items := v_items || v_item;
  end loop;

  perform 1 from public.lots
   where id in (select x.lot_id from jsonb_to_recordset(p_allocations) as x(line_index int, lot_id uuid, qty int))
   order by id for update;

  for a in select x.line_index, x.lot_id, x.qty from jsonb_to_recordset(p_allocations) as x(line_index int, lot_id uuid, qty int) loop
    update public.lots set quantity = quantity - a.qty where id = a.lot_id and quantity - a.qty >= 0;
    if not found then raise exception 'Inventario insuficiente en el lote %', a.lot_id; end if;
    insert into public.inventory_movements (lot_id, change, reason, reference, created_by, op_id, order_id, order_item_id)
    values (a.lot_id, -a.qty, 'venta', p_folio, v_uid, p_order_id, p_order_id, v_items[a.line_index + 1]);
  end loop;

  -- W2 · F-1: el cobro de mostrador nace como ASIENTO en el libro, en esta misma
  -- transacción. El efectivo recibido queda como evidencia para el corte de caja.
  perform public._w2_asiento(gen_random_uuid(), p_order_id, 'in', v_metodo, tot, public.hoy_local(),
    null, null, null, null,
    case when v_metodo = 'efectivo' and p_efectivo_recibido is not null
         then format('recibido=%s;cambio=%s', p_efectivo_recibido, p_efectivo_recibido - tot) end);

  perform public._w1_op_finish(p_order_id, 'venta_pos', v_req,
    jsonb_build_object('status', 'applied', 'order_id', p_order_id, 'total', tot));
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reemplazos: las firmas viejas se ELIMINAN (el frontend viejo falla cerrado).
-- ---------------------------------------------------------------------------
drop function if exists public.review_transfer_payment(uuid, text, text);
drop function if exists public.registrar_devolucion(uuid, text, numeric, text, text, jsonb);

-- ---------------------------------------------------------------------------
-- Privilegios
-- ---------------------------------------------------------------------------
revoke all on function
  public.reportar_pago(uuid, uuid, text, numeric, text, uuid, text),
  public.revisar_pago(uuid, uuid, text, numeric, date, text),
  public.registrar_cobro(uuid, uuid, text, numeric, date, text, uuid, text),
  public.autorizar_reembolso(uuid, uuid, text, numeric, text, uuid, text),
  public.pagar_reembolso(uuid, uuid, text, date, text, text),
  public.autorizar_credito(uuid, uuid, date, text),
  public.revocar_credito(uuid, uuid, text),
  public.reversar_asiento(uuid, uuid, text),
  public.registrar_corte_caja(uuid, date, text, numeric, numeric, text, uuid),
  public.anular_corte_caja(uuid, uuid, text),
  public.efectivo_esperado(date, text, uuid),
  public.tramo_corte_caja(date, text, uuid),
  public.estado_dinero_pedido(uuid),
  public.estado_operacion_dinero(uuid),
  public.conciliar_dinero(),
  public.pedido_liberado_para_surtir(uuid),
  public.vender_pos(uuid, text, numeric, text, uuid, jsonb, jsonb, jsonb, boolean, jsonb, uuid, numeric)
  from public, anon;

-- Aritmética interna del arqueo: no ejecutable por clientes (el esperado se pide por
-- efectivo_esperado / tramo_corte_caja, que sí validan rol).
revoke all on function
  public._w2_corte_cola(text, uuid),
  public._w2_corte_desde(date, text, uuid),
  public._w2_efectivo_tramo(timestamptz, timestamptz, text, uuid)
  from public, anon, authenticated;

grant execute on function
  public.reportar_pago(uuid, uuid, text, numeric, text, uuid, text),
  public.revisar_pago(uuid, uuid, text, numeric, date, text),
  public.registrar_cobro(uuid, uuid, text, numeric, date, text, uuid, text),
  public.autorizar_reembolso(uuid, uuid, text, numeric, text, uuid, text),
  public.pagar_reembolso(uuid, uuid, text, date, text, text),
  public.autorizar_credito(uuid, uuid, date, text),
  public.revocar_credito(uuid, uuid, text),
  public.reversar_asiento(uuid, uuid, text),
  public.registrar_corte_caja(uuid, date, text, numeric, numeric, text, uuid),
  public.anular_corte_caja(uuid, uuid, text),
  public.efectivo_esperado(date, text, uuid),
  public.tramo_corte_caja(date, text, uuid),
  public.estado_dinero_pedido(uuid),
  public.estado_operacion_dinero(uuid),
  public.conciliar_dinero(),
  public.pedido_liberado_para_surtir(uuid),
  public.vender_pos(uuid, text, numeric, text, uuid, jsonb, jsonb, jsonb, boolean, jsonb, uuid, numeric)
  to authenticated, service_role;
