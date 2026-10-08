-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- PAY-EXP-01A-1 (migración 133) · ORDEN DE BLOQUEOS E IDEMPOTENCIA DE DECLARACIONES
--   · revisar_pago bloqueaba la DECLARACIÓN y después el PEDIDO; todos los demás comandos de dinero bloquean
--     PEDIDO → declaración/asientos. El orden inverso no daña hoy (la cancelación no toca declaraciones), pero
--     provocaría deadlocks en cuanto un comando bloquee pedido y luego declaración (vencimiento, revisión
--     económica). Ahora: operación → pedido → declaración, y el estado se relee con ambos bloqueos.
--   · Segunda barrera contra asientos duplicados por declaración: índice ÚNICO parcial sobre
--     payment_entries(claim_id) para asientos ORIGINALES (las reversas quedan fuera; ninguna otra ruta del libro
--     escribe claim_id). La primera barrera sigue siendo el estado de la declaración bajo bloqueo.
--   · Sin cambios de firma, roles, respuestas, estados económicos, reembolsos ni de v_order_money. CREATE OR
--     REPLACE conserva los permisos existentes.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$
declare d text;
begin
  if to_regprocedure('public.revisar_pago(uuid,uuid,text,numeric,date,text)') is null then raise exception 'PAY-EXP-01A-1: requiere W2 (revisar_pago)'; end if;
  d := pg_get_functiondef('public.revisar_pago(uuid,uuid,text,numeric,date,text)'::regprocedure);
  if position('PAY-EXP-01A-1' in d) > 0 or to_regclass('public.uq_entry_claim_original') is not null then raise exception 'PAY-EXP-01A-1: ya aplicada'; end if;
  if position('perform 1 from public.orders where id = v_c.order_id for update;' in d) = 0 then
    raise exception 'PAY-EXP-01A-1: revisar_pago no es la versión auditada (W2) — revisar antes de aplicar';
  end if;
  if exists (select claim_id from public.payment_entries where claim_id is not null and reversal_of is null group by claim_id having count(*) > 1) then
    raise exception 'PAY-EXP-01A-1: ya existen asientos duplicados por declaración — conciliar antes de aplicar';
  end if;
end $pre$;

create or replace function public.revisar_pago(
  p_op_id uuid, p_claim_id uuid, p_accion text,
  p_amount_verificado numeric default null, p_value_date date default null, p_motivo text default null
) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_req jsonb; v_prev jsonb; v_c record; v_amount numeric; v_entry uuid; v_estado text; v_order uuid;
begin
  if not (public.auth_role() = any (array['admin','billing'])) then
    raise exception 'NO_AUTORIZADO: solo Dirección/Facturación puede revisar pagos';
  end if;
  if p_accion not in ('verificar','rechazar') then raise exception 'ACCION_INVALIDA: usa verificar o rechazar'; end if;
  v_req := jsonb_build_object('claim', p_claim_id, 'accion', p_accion, 'amount', p_amount_verificado,
             'value_date', p_value_date, 'motivo', p_motivo);
  v_prev := public._w2_op_begin(p_op_id, 'revision_pago', v_req);
  if v_prev is not null then return v_prev; end if;

  -- PAY-EXP-01A-1 · ORDEN CANÓNICO DE BLOQUEOS: operación → PEDIDO → declaración → asientos (el mismo de
  -- reportar_pago, registrar_cobro, cancelar_pedido y los reembolsos). Antes se bloqueaba la declaración y después
  -- el pedido: el orden inverso provocaría deadlocks con cualquier comando que bloquee pedido y luego declaración.
  -- El estado de la declaración se relee DESPUÉS de tener ambos bloqueos.
  select c.order_id into v_order from public.payment_claims c where c.id = p_claim_id;
  if not found then raise exception 'DECLARACION_INEXISTENTE'; end if;
  perform 1 from public.orders where id = v_order for update;
  select * into v_c from public.payment_claims where id = p_claim_id for update;
  if not found or v_c.order_id is distinct from v_order then raise exception 'DECLARACION_INEXISTENTE'; end if;
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


create unique index uq_entry_claim_original on public.payment_entries (claim_id) where claim_id is not null and reversal_of is null;
comment on index public.uq_entry_claim_original is 'PAY-EXP-01A-1 · Un solo asiento ORIGINAL por declaración (las reversas quedan fuera). Segunda barrera tras el estado de la declaración bajo bloqueo.';
