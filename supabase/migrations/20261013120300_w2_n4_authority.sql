-- ============================================================================
-- W2 · N4 — CIERRE DE AUTORIDAD: el dinero solo cambia por comandos.
--
--  · orders: payment_status / payment_method / payment_ref / stripe_payment_id
--    quedan fuera del alcance de TODOS los actores no confiables, incluida
--    Dirección (F-4). Antes admin pasaba completo y billing solo tenía bloqueados
--    doctor_id y total.
--  · el doctor no puede escribir shipping_meta.transfer (las declaraciones viven
--    en payment_claims; sin espejo, sin segunda fuente de verdad · D-W2-6).
--  · pay_order: revocado (lo reemplazan registrar_cobro y autorizar_credito).
--  · cash_closings: sin escritura directa ni DELETE (D-W2-7).
--
-- Las definiciones previas quedan en supabase/rollback/w2/00_prod_snapshot.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) orders_guard · se conserva VERBATIM la guarda de W1 y se antepone el
--    bloqueo de los campos de dinero (mismo patrón con el que W1 antepuso las
--    transiciones de inventario).
-- ---------------------------------------------------------------------------
create or replace function public.orders_guard() returns trigger
  language plpgsql security definer set search_path = public as
$function$
DECLARE r text := public.auth_role();
BEGIN
  IF coalesce(current_setting('app.trusted', true), '') = 'on'
     OR coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role','') = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- W2 · F-4: los campos financieros SOLO los escriben los comandos del servidor.
  -- Vale para todos los roles, Dirección incluida: el dinero se registra con
  -- evidencia (registrar_cobro / revisar_pago / pagar_reembolso), no a mano.
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
     OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
     OR NEW.payment_ref IS DISTINCT FROM OLD.payment_ref
     OR NEW.stripe_payment_id IS DISTINCT FROM OLD.stripe_payment_id THEN
    RAISE EXCEPTION 'PAGO_SOLO_POR_COMANDO: el estado de pago se registra con evidencia (registrar_cobro / revisar_pago / pagar_reembolso), no editando el pedido';
  END IF;

  -- W1: transiciones de inventario solo por comando; sin regresar desde empacado o posterior.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('packed','cancelled') THEN
      RAISE EXCEPTION 'TRANSICION_SOLO_POR_COMANDO: % → % solo por comando del servidor (surtir_pedido / cancelar_pedido)', OLD.status, NEW.status;
    END IF;
    IF OLD.status IN ('packed','shipped','delivered','fulfilled')
       AND NEW.status IN ('draft','pending_payment','paid','picking') THEN
      RAISE EXCEPTION 'TRANSICION_REGRESIVA: % → % no permitido', OLD.status, NEW.status;
    END IF;
    IF (NEW.status = 'picking'   AND OLD.status IS DISTINCT FROM 'paid')
       OR (NEW.status = 'shipped'   AND OLD.status IS DISTINCT FROM 'packed')
       OR (NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'shipped')
       OR (NEW.status = 'fulfilled' AND OLD.status IS DISTINCT FROM 'delivered') THEN
      RAISE EXCEPTION 'TRANSICION_INVALIDA: % → %', OLD.status, NEW.status;
    END IF;
  END IF;

  IF r = 'admin' THEN RETURN NEW; END IF;

  IF r = 'doctor' AND OLD.doctor_id = auth.uid() THEN
    -- W2: la declaración de pago vive en payment_claims; el doctor no la fabrica en el JSON.
    IF NEW.shipping_meta -> 'transfer' IS DISTINCT FROM OLD.shipping_meta -> 'transfer' THEN
      RAISE EXCEPTION 'PAGO_SOLO_POR_COMANDO: reporta tu pago con el comando, no editando el pedido';
    END IF;
    IF OLD.status IS NOT NULL AND OLD.status NOT IN ('draft','pending_payment') THEN
      RAISE EXCEPTION 'No autorizado: el pedido ya está en proceso';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NEW.status NOT IN ('draft','pending_payment','cancelled') THEN
      RAISE EXCEPTION 'No autorizado: el doctor no puede mover el pedido a ese estado';
    END IF;
    IF NEW.doctor_id IS DISTINCT FROM OLD.doctor_id OR NEW.total IS DISTINCT FROM OLD.total
       OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.invoice_meta IS DISTINCT FROM OLD.invoice_meta THEN
      RAISE EXCEPTION 'No autorizado: no puedes modificar campos financieros del pedido';
    END IF;
    RETURN NEW;
  END IF;

  IF r IN ('warehouse','packing') THEN
    IF NEW.doctor_id IS DISTINCT FROM OLD.doctor_id OR NEW.total IS DISTINCT FROM OLD.total
       OR NEW.invoice_meta IS DISTINCT FROM OLD.invoice_meta THEN
      RAISE EXCEPTION 'No autorizado: almacén/empaque solo actualiza estado y envío';
    END IF;
    RETURN NEW;
  END IF;

  IF r = 'billing' THEN
    IF NEW.doctor_id IS DISTINCT FROM OLD.doctor_id OR NEW.total IS DISTINCT FROM OLD.total THEN
      RAISE EXCEPTION 'No autorizado: facturación no modifica doctor ni total';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'No autorizado';
END; $function$;

-- ---------------------------------------------------------------------------
-- 2) pay_order: fuera del alcance de los clientes. Lo reemplazan
--    registrar_cobro (dinero con evidencia) y autorizar_credito (liberar sin cobro).
-- ---------------------------------------------------------------------------
revoke all on function public.pay_order(uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) Corte de caja: sin escritura directa ni DELETE (D-W2-7).
-- ---------------------------------------------------------------------------
drop policy if exists cash_closings_all on public.cash_closings;
revoke insert, update, delete, truncate on public.cash_closings from anon, authenticated;
create policy cash_closings_select_finanzas on public.cash_closings
  for select to authenticated using (public.auth_role() = any (array['admin','billing','pos']));

-- ---------------------------------------------------------------------------
-- 4) Guardas internas de W2: no ejecutables por clientes.
-- ---------------------------------------------------------------------------
revoke all on function public.payment_claims_guard(), public.credit_grants_guard(),
  public.cash_closings_guard(), public._w2_recalc_payment_status(uuid) from public, anon, authenticated;
