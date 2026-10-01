-- ============================================================================
-- W3-A · F4 — CIERRE DE AUTORIDAD FISCAL.
--
--  · orders.invoice_meta / orders.invoice_requested dejan de ser escribibles por
--    el cliente. Vale para TODOS los roles, Dirección incluida.
--  · Los comandos internos de W3 no son ejecutables por clientes.
--  · La evidencia fiscal queda fuera del alcance de cualquier UPDATE directo.
--
-- ESTE es el cierre que hace imposible el P0:
--
--     request CFDI → el PAC pudo timbrar → timeout del cliente
--     → el cliente escribía invoice_meta = null   ← AQUÍ se destruía la evidencia
--     → la UI volvía a ofrecer emitir → segundo POST → doble CFDI real
--
-- A partir de F4 ese UPDATE no existe: ningún cliente puede escribir, borrar ni
-- modificar evidencia fiscal. Solo los comandos del servidor, con bitácora.
--
-- Las definiciones previas quedan en supabase/rollback/w3a/00_w2c_snapshot.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) orders_guard · se conserva VERBATIM la guarda de W2 y se antepone el
--    bloqueo de los campos FISCALES (mismo patrón con el que W2 antepuso los
--    campos de dinero y W1 las transiciones de inventario).
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

  -- W3-A · H-3: la evidencia fiscal NO la escribe el cliente. `invoice_meta` es la
  -- PROYECCIÓN de fiscal_documents y `invoice_requested` la marca la solicitud.
  -- Un fallo de red del frontend jamás puede borrar el rastro de un timbre.
  IF NEW.invoice_meta IS DISTINCT FROM OLD.invoice_meta
     OR NEW.invoice_requested IS DISTINCT FROM OLD.invoice_requested THEN
    RAISE EXCEPTION 'FISCAL_SOLO_POR_COMANDO: la factura se solicita y se timbra con los comandos del servidor (solicitar_cfdi), no editando el pedido';
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
-- 2) Internos de W3: fuera del alcance de los clientes. La aritmética de la
--    intención, el reclamo y la proyección no se invocan desde fuera.
-- ---------------------------------------------------------------------------
revoke all on function
  public._w3_op_begin(uuid, text, jsonb),
  public._w3_op_finish(uuid, text, jsonb, jsonb),
  public._w3_transicion(uuid, text, text, text, text, jsonb, text, text, text, text, text, timestamptz, text, text, uuid, text, uuid),
  public._w3_reclamar(uuid, uuid),
  public._w3_receptor(uuid, jsonb),
  public._w3_norm_legacy(jsonb, text),
  public._w3_fingerprint(uuid, jsonb),
  public._w3_proyectar(uuid),
  public._w3_transicion_valida(text, text),
  public.fiscal_documents_guard()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) Comandos públicos de W3-A. Ninguno habla con el PAC.
-- ---------------------------------------------------------------------------
revoke all on function public.solicitar_cfdi(uuid, uuid, jsonb) from public, anon;
revoke all on function public.descartar_solicitud_cfdi(uuid, uuid, text) from public, anon;
revoke all on function public.estado_fiscal_pedido(uuid) from public, anon;
revoke all on function public.conciliar_cfdi() from public, anon;
grant execute on function public.solicitar_cfdi(uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.descartar_solicitud_cfdi(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.estado_fiscal_pedido(uuid) to authenticated, service_role;
grant execute on function public.conciliar_cfdi() to authenticated, service_role;

comment on table public.fiscal_documents is
  'Intención fiscal durable por pedido. Se escribe ANTES de cualquier salida al PAC y sobrevive a timeouts, caídas y fallos del cliente. orders.invoice_meta es su proyección, no su verdad. W3-A: el timbrado todavía NO está activado.';
