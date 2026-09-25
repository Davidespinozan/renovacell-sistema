-- ============================================================================
-- PAGOS · FASE 1 — Confirmar/Rechazar transferencia de forma ATÓMICA y auditada.
-- Reutiliza el modelo existente (no hay tabla de pagos): el estado de revisión vive en
-- orders.shipping_meta.transfer.review = { status, reviewed_at, reviewed_by, reason }.
-- Solo un pago CONFIRMADO pone payment_status='paid'. Rechazar NO borra pedido ni evidencia.
-- ADITIVA: no cambia columnas ni otras RPC.
-- ============================================================================
create or replace function public.review_transfer_payment(
  p_order uuid,
  p_action text,               -- 'confirm' | 'reject'
  p_reason text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_meta        jsonb;
  v_transfer    jsonb;
  v_review      text;
  v_pay         text;
  v_status      text;
  v_method      text;
  v_now         text := now()::text;
begin
  -- Autorización: SOLO quien valida pagos (Dirección/Facturación). Doctor NO.
  if not (public.auth_role() = any (array['admin','billing'])) then
    raise exception 'NO_AUTORIZADO: solo Dirección/Facturación puede revisar pagos';
  end if;
  if p_action not in ('confirm','reject') then
    raise exception 'ACCION_INVALIDA: usa confirm o reject';
  end if;

  select payment_status, status, payment_method, shipping_meta
    into v_pay, v_status, v_method, v_meta
    from public.orders where id = p_order for update;
  if not found then raise exception 'PEDIDO_INEXISTENTE'; end if;

  v_transfer := coalesce(v_meta -> 'transfer', '{}'::jsonb);
  v_review   := coalesce(v_transfer -> 'review' ->> 'status', case when (v_transfer->>'reported')::boolean then 'pending' else null end);

  -- Debe existir una transferencia reportada por revisar.
  if coalesce(v_transfer->>'reported','false') <> 'true' and v_review is null then
    raise exception 'SIN_TRANSFERENCIA: el pedido no tiene una transferencia reportada por revisar';
  end if;

  -- ---------------- CONFIRMAR ----------------
  if p_action = 'confirm' then
    -- Idempotente: ya pagado/confirmado → no-op.
    if v_pay = 'paid' or v_review = 'confirmed' then
      return jsonb_build_object('ok', true, 'status', 'already_confirmed', 'payment_status', 'paid');
    end if;
    -- No confirmar un reporte previamente RECHAZADO (requiere nuevo reporte).
    if v_review = 'rejected' then
      raise exception 'REPORTE_RECHAZADO: requiere un nuevo reporte del cliente antes de confirmar';
    end if;
    v_transfer := jsonb_set(v_transfer, '{review}', jsonb_build_object('status','confirmed','reviewed_at',v_now,'reviewed_by',auth.uid()), true);
    v_transfer := jsonb_set(v_transfer, '{reported}', 'false'::jsonb, true);
    perform set_config('app.trusted','on', true);
    update public.orders
       set payment_status = 'paid',
           status = case when status = 'pending_payment' then 'paid' else status end,
           payment_ref = coalesce(payment_ref, v_transfer->>'reference'),
           shipping_meta = jsonb_set(coalesce(v_meta,'{}'::jsonb), '{transfer}', v_transfer, true)
     where id = p_order;
    return jsonb_build_object('ok', true, 'status', 'confirmed', 'payment_status', 'paid');
  end if;

  -- ---------------- RECHAZAR ----------------
  -- No se puede rechazar un pago ya confirmado.
  if v_pay = 'paid' or v_review = 'confirmed' then
    raise exception 'YA_CONFIRMADO: no se puede rechazar un pago ya confirmado';
  end if;
  if coalesce(btrim(p_reason),'') = '' then
    raise exception 'MOTIVO_REQUERIDO: el rechazo necesita un motivo';
  end if;
  -- Idempotente: ya rechazado → no-op (conserva el motivo/fecha originales).
  if v_review = 'rejected' then
    return jsonb_build_object('ok', true, 'status', 'already_rejected', 'payment_status', v_pay);
  end if;
  v_transfer := jsonb_set(v_transfer, '{review}', jsonb_build_object('status','rejected','reviewed_at',v_now,'reviewed_by',auth.uid(),'reason',left(btrim(p_reason),400)), true);
  v_transfer := jsonb_set(v_transfer, '{reported}', 'false'::jsonb, true); -- sale de la cola; payment_status intacto
  perform set_config('app.trusted','on', true);
  update public.orders
     set shipping_meta = jsonb_set(coalesce(v_meta,'{}'::jsonb), '{transfer}', v_transfer, true)
   where id = p_order;
  return jsonb_build_object('ok', true, 'status', 'rejected', 'payment_status', v_pay);
end;
$fn$;

revoke all on function public.review_transfer_payment(uuid, text, text) from public, anon;
grant execute on function public.review_transfer_payment(uuid, text, text) to authenticated;
