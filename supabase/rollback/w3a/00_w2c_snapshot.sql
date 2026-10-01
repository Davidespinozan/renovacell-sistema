-- ============================================================================
-- W3-A · SNAPSHOT PREVIO (estado que dejaron W2 · N4 y la fase fiscal omnicanal).
--
-- Restaura las definiciones EXACTAS que W3-A reemplaza:
--   · orders_guard()               sin el bloqueo de los campos fiscales
--   · set_order_fiscal_snapshot()  sin la sincronización con fiscal_documents
--
-- Lo invoca supabase/rollback/w3a/99_down.sql. No se ejecuta por separado.
-- ============================================================================

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

create or replace function public.set_order_fiscal_snapshot(p_order_id uuid, p_receiver jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role  text := public.auth_role();
  v_err   text;
  v_clean jsonb;
  v_meta  jsonb;
  v_doc   uuid;
  v_cust  uuid;
begin
  if p_order_id is null then raise exception 'PEDIDO_REQUERIDO'; end if;

  select invoice_meta, doctor_id, customer_id into v_meta, v_doc, v_cust
    from public.orders where id = p_order_id for update;
  if not found then raise exception 'PEDIDO_INEXISTENTE'; end if;

  -- Autorización idéntica al master, pero sobre el pedido.
  if v_role = any (array['admin','billing','pos']) then
    null;
  elsif v_doc = auth.uid()
     or exists (select 1 from public.customers c where c.id = v_cust and c.profile_id = auth.uid()) then
    null;
  else
    raise exception 'NO_AUTORIZADO: no puedes editar los datos fiscales de este pedido';
  end if;

  -- Un CFDI ya timbrado NO puede cambiar de receptor en silencio (refacturación = otra fase).
  if coalesce(v_meta->>'status','') in ('timbrada','emitida') then
    raise exception 'YA_TIMBRADO: el CFDI ya fue emitido; no se puede cambiar el receptor';
  end if;

  v_err := public._fiscal_error(p_receiver);
  if v_err is not null then raise exception 'FISCAL_INVALIDO: %', v_err; end if;
  v_clean := public._fiscal_clean(p_receiver);

  -- Congela el snapshot preservando cualquier otra clave de invoice_meta. Marca la solicitud.
  perform set_config('app.trusted','on', true);
  update public.orders
     set invoice_meta = jsonb_set(coalesce(invoice_meta, '{}'::jsonb), '{receiver}', v_clean, true),
         invoice_requested = true
   where id = p_order_id;

  perform public._fiscal_audit('Snapshot fiscal congelado', 'order:' || p_order_id, v_clean);
  return jsonb_build_object('ok', true, 'order_id', p_order_id);
end $$;
