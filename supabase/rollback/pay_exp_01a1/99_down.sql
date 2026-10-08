-- PAY-EXP-01A-1 (133) · down: restaura EXACTAMENTE el revisar_pago de W2 y retira el índice único. No toca datos:
-- los asientos y declaraciones existentes se conservan.
drop index if exists public.uq_entry_claim_original;
create or replace function public.revisar_pago(
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

