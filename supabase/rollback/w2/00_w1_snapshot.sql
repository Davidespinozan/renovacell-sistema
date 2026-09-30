-- ============================================================================
-- W2 · SNAPSHOT DEL ESTADO W1 — definiciones tal como las dejó W1 (capturadas de
-- un cluster con las migraciones hasta W1 inclusive). Las usa 99_down.sql para
-- restaurar. NO ejecutar por separado.
-- ============================================================================

-- public.surtir_pedido(uuid,uuid,jsonb)
CREATE OR REPLACE FUNCTION public.surtir_pedido(p_op_id uuid, p_order uuid, p_allocations jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  if v_ord.status not in ('paid','picking') then
    raise exception 'PEDIDO_NO_SURTIBLE: el pedido está %; solo se surte un pedido pagado', v_ord.status;
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
$function$;

-- public.cancelar_pedido(uuid,uuid,text)
CREATE OR REPLACE FUNCTION public.cancelar_pedido(p_op_id uuid, p_order uuid, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text := public.auth_role(); v_uid uuid := auth.uid();
  v_req jsonb; v_prev jsonb; v_res jsonb;
  v_o record; v_c record; v_money text; v_review text; v_ret uuid; v_attempt text;
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

  -- Frontera B: evidencia de dinero ⇒ ruta Dirección + posible reembolso (sin fingir devolución).
  v_money := case
    when v_o.payment_status = 'paid' then 'pago_registrado'
    when (v_o.shipping_meta -> 'transfer' ->> 'reported') = 'true'
         and coalesce(v_o.shipping_meta -> 'transfer' -> 'review' ->> 'status', 'pending') in ('pending','confirmed')
      then 'transferencia_en_revision'
    when v_o.stripe_payment_id is not null then 'stripe'
    else null end;

  if v_o.status in ('draft','pending_payment') and v_money is null then
    null;  -- antes de pagar: doctor (su pedido) o staff autorizado (admin/billing)
  elsif v_role <> 'admin' then
    raise exception 'CANCELACION_REQUIERE_DIRECCION: pedido % (%)%: solo Dirección puede cancelarlo',
      coalesce(v_o.external_ref, p_order::text), v_o.status,
      case when v_money is not null then ' con evidencia de pago' else '' end;
  end if;
  if v_role <> 'doctor' and nullif(btrim(p_reason), '') is null then
    raise exception 'MOTIVO_REQUERIDO: la cancelación requiere motivo';
  end if;
  v_review := case when v_money is not null then 'pendiente_revision' else 'no_aplica' end;

  if v_o.status = 'packed' then
    -- Frontera A: guía activa (o desconocida) bloquea; se anula manualmente antes.
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

    -- Reingreso PENDIENTE de confirmación física, desde los movimientos reales del pedido.
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
             'reingreso_pendiente', v_ret is not null);
  return public._w1_op_finish(p_op_id, 'cancelacion', v_req, v_res);
end;
$function$;

-- public.orders_guard()
CREATE OR REPLACE FUNCTION public.orders_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r text := public.auth_role();
BEGIN
  IF coalesce(current_setting('app.trusted', true), '') = 'on'
     OR coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role','') = 'service_role' THEN
    RETURN NEW;
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
    IF OLD.status IS NOT NULL AND OLD.status NOT IN ('draft','pending_payment') THEN
      RAISE EXCEPTION 'No autorizado: el pedido ya está en proceso';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NEW.status NOT IN ('draft','pending_payment','cancelled') THEN
      RAISE EXCEPTION 'No autorizado: el doctor no puede mover el pedido a ese estado';
    END IF;
    IF NEW.doctor_id IS DISTINCT FROM OLD.doctor_id OR NEW.total IS DISTINCT FROM OLD.total
       OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
       OR NEW.payment_ref IS DISTINCT FROM OLD.payment_ref OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
       OR NEW.stripe_payment_id IS DISTINCT FROM OLD.stripe_payment_id OR NEW.invoice_meta IS DISTINCT FROM OLD.invoice_meta THEN
      RAISE EXCEPTION 'No autorizado: no puedes modificar campos financieros del pedido';
    END IF;
    RETURN NEW;
  END IF;

  IF r IN ('warehouse','packing') THEN
    IF NEW.doctor_id IS DISTINCT FROM OLD.doctor_id OR NEW.total IS DISTINCT FROM OLD.total
       OR NEW.payment_status IS DISTINCT FROM OLD.payment_status OR NEW.payment_ref IS DISTINCT FROM OLD.payment_ref
       OR NEW.payment_method IS DISTINCT FROM OLD.payment_method OR NEW.stripe_payment_id IS DISTINCT FROM OLD.stripe_payment_id
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

-- public.registrar_devolucion(uuid,text,numeric,text,text,jsonb)
CREATE OR REPLACE FUNCTION public.registrar_devolucion(p_order_id uuid, p_tipo text, p_monto numeric, p_motivo text, p_usuario text DEFAULT NULL::text, p_items jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_total    numeric;
  v_status   text;
  v_metodo   text;
  v_folio    text;
  v_devuelto numeric;
  v_restante numeric;
  v_id       uuid;
begin
  if public.auth_role() <> all (array['admin','billing','pos']) then
    raise exception 'NO_AUTORIZADO: no tienes permiso para registrar devoluciones';
  end if;
  if p_tipo is null or p_tipo <> all (array['devolucion','correccion','cortesia']) then
    raise exception 'TIPO_INVALIDO: usa devolucion, correccion o cortesia';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'MOTIVO_REQUERIDO: sin motivo no se puede auditar la devolución';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'MONTO_INVALIDO: el monto debe ser mayor a cero';
  end if;

  select o.total, o.status, o.payment_method, o.external_ref
    into v_total, v_status, v_metodo, v_folio
    from public.orders o where o.id = p_order_id;
  if v_total is null then
    raise exception 'PEDIDO_INVALIDO: el pedido no existe';
  end if;
  if v_status = 'draft' then
    raise exception 'PEDIDO_INVALIDO: no se puede devolver un borrador';
  end if;

  select coalesce(sum(r.monto), 0) into v_devuelto
    from public.refunds r where r.order_id = p_order_id;
  v_restante := v_total - v_devuelto;
  if p_monto > v_restante then
    raise exception 'MONTO_EXCEDE: el máximo por devolver de este pedido es %', v_restante;
  end if;

  -- items queda como dato informativo del reembolso (W2 lo ligará a la devolución física).
  insert into public.refunds (order_id, tipo, monto, motivo, metodo, usuario, created_by, items)
  values (p_order_id, p_tipo, p_monto, left(btrim(p_motivo), 400), v_metodo,
          coalesce(nullif(btrim(p_usuario), ''), 'Sistema'), auth.uid(),
          case when p_tipo = 'devolucion' then p_items else null end)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'restante', v_restante - p_monto);
end;
$function$;

-- public.review_transfer_payment(uuid,text,text)
CREATE OR REPLACE FUNCTION public.review_transfer_payment(p_order uuid, p_action text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid)
CREATE OR REPLACE FUNCTION public.vender_pos(p_order_id uuid, p_folio text, p_total numeric, p_payment_method text, p_doctor_id uuid, p_shipping_meta jsonb, p_lines jsonb, p_allocations jsonb, p_invoice_requested boolean DEFAULT false, p_invoice_meta jsonb DEFAULT NULL::jsonb, p_customer_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_req jsonb; v_prev jsonb;
  a record; ln record; v_nlines int; qty int; pid uuid; up numeric; tot numeric := 0;
  v_items uuid[] := '{}'; v_prods uuid[] := '{}'; v_item uuid; v_bad int;
  v_cname text; v_cphone text; v_meta jsonb;
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

  -- Renglones: validación + precio autorizado (mostrador: base + volumen con CANTIDAD)
  for ln in select value as j, ordinality as n from jsonb_array_elements(p_lines) with ordinality loop
    pid := nullif(ln.j ->> 'product_id', '')::uuid; qty := (ln.j ->> 'qty')::int;
    if pid is null then raise exception 'Producto inválido'; end if;
    if qty is null or qty <= 0 then raise exception 'Cantidad inválida'; end if;
    up := public.precio_de(pid, null, qty);
    if up is null then raise exception 'Producto % sin precio válido', pid; end if;
    tot := tot + up * qty;
  end loop;

  -- Asignaciones: por renglón (line_index base 0), qty > 0, lote del producto, vigente
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

  v_meta := p_shipping_meta;
  if p_customer_id is not null then
    v_meta := jsonb_set(coalesce(v_meta, '{}'::jsonb), '{customer}', jsonb_build_object('id', p_customer_id, 'name', v_cname, 'phone', v_cphone), true);
  end if;

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

  perform public._w1_op_finish(p_order_id, 'venta_pos', v_req,
    jsonb_build_object('status', 'applied', 'order_id', p_order_id, 'total', tot));
  return true;
end;
$function$;
