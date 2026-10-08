-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- CX-0b (migración 136) · INTEGRIDAD DE LA CUENTA COMERCIAL DEL PEDIDO
--   Hallazgos (auditoría CX-0b, confirmados con sondas en cluster desechable):
--     A · crear_pedido aceptaba de un doctor verificado CUALQUIER p_customer_id activo: el pedido quedaba en la cuenta
--         ajena, el doctor leía nombre/teléfono ajenos en el snapshot, el CFDI tomaba el perfil fiscal ajeno y los avisos
--         iban al correo ajeno. El personal podía combinar un comprador con la cuenta de otro.
--     B · orders_guard no protegía customer_id, doctor_id (Dirección) ni shipping_meta.customer: doctor (pendiente),
--         almacén, empaque, facturación y Dirección podían reasignar la cuenta en cualquier estado, incluso a NULL.
--     C · admin/pos podían INSERTAR directo en orders (p. ej. entregado + pagado, total arbitrario) sin pasar por
--         crear_pedido / vender_pos.
--   Cambios (decisiones aprobadas por el dueño):
--     1 · crear_pedido: doctor → la cuenta se DERIVA de su identidad (_cc_chk_customer); p_customer_id distinto →
--         CUENTA_NO_AUTORIZADA genérico (no distingue ajena / inexistente / inactiva). Personal → cuenta activa; con
--         comprador, pareja coherente (PAR_INCONSISTENTE). El snapshot shipping_meta.customer lo escribe solo el servidor.
--         Firma, precios (precio_de con la lista del comprador), folio, idempotencia y payload SIN cambios.
--     2 · orders_guard: customer_id, doctor_id y shipping_meta.customer INMUTABLES para todos (incluye app.trusted,
--         service_role y Dirección); el bloque va antes de cualquier salida anticipada. Resto de la guarda VERBATIM.
--         Corregir = cancelar y recrear (no hay excepción administrativa).
--     3 · vender_pos (POS): comprador OPCIONAL (NULL = mostrador o cuenta histórica sin portal, como hoy). Si viene, debe
--         ser un perfil doctor (COMPRADOR_INVALIDO) y coherente con la cuenta (PAR_INCONSISTENTE, misma regla que el personal
--         en crear_pedido). Snapshot del cliente solo del servidor. Precio, lotes, custodia, caja (asiento W2), folio e
--         idempotencia (_w1_op_begin) SIN cambios.
--     4 · Sin INSERT directo: se elimina la política orders_insert_scoped y se revoca INSERT a authenticated/anon.
--         crear_pedido / vender_pos (SECURITY DEFINER, dueño de la tabla) y service_role no dependen de ellos.
--   Efecto colateral documentado: borrar un customer CON pedidos ya no los deja huérfanos (ON DELETE SET NULL choca con la
--   inmutabilidad) → falla; no existe flujo de borrado de clientes (se desactivan con active=false).
--   No cambia datos ni pedidos existentes. Fuera de alcance: shipping_meta.seller (CX-0c — Seller Snapshot Integrity).
--   Rollback: supabase/rollback/cx0b/99_down.sql (md5 de producción; REABRE los hallazgos).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if md5(pg_get_functiondef('public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)'::regprocedure)) <> '408d0b2d90ae8431a3f4583988d11a32' then
    raise exception 'CX-0b: crear_pedido no es el texto esperado (ya aplicada o cambió en producción)';
  end if;
  if md5(pg_get_functiondef('public.orders_guard()'::regprocedure)) <> 'acc92355dbeb6b9adaf901a859369849' then
    raise exception 'CX-0b: orders_guard no es el texto esperado (ya aplicada o cambió en producción)';
  end if;
  if not exists (select 1 from pg_policy where polrelid = 'public.orders'::regclass and polname = 'orders_insert_scoped') then
    raise exception 'CX-0b: falta la política orders_insert_scoped esperada';
  end if;
  if md5(pg_get_functiondef('public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure)) <> '82bf405665b9e9b1cc6ccc4edc0b6b00' then
    raise exception 'CX-0b: vender_pos no es el texto esperado (ya aplicada o cambió en producción)';
  end if;
  if to_regprocedure('public._cc_chk_customer(uuid)') is null then raise exception 'CX-0b: falta _cc_chk_customer'; end if;
end $pre$;

-- 1) crear_pedido · texto de 20261031130000 (folio del servidor) + cuenta decidida en el servidor.
create or replace function public.crear_pedido(
  p_order_id          uuid,
  p_folio             text,
  p_doctor_id         uuid,
  p_lines             jsonb,
  p_shipping_meta     jsonb    default null,
  p_invoice_requested boolean  default false,
  p_customer_id       uuid     default null
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  ln jsonb; pid uuid; q int; up numeric; tot numeric := 0;
  list uuid; act boolean; out_items jsonb := '[]'::jsonb;
  v_cname text; v_cphone text; v_meta jsonb; v_folio text; v_intento int;
  v_cust uuid; v_cust_profile uuid;
begin
  if p_doctor_id is null and p_customer_id is null then
    raise exception 'FALTA_IDENTIDAD: el pedido requiere doctor_id o customer_id';
  end if;
  if not (
    (public.auth_role() = 'doctor' and p_doctor_id = auth.uid() and public.is_verified())
    or public.auth_role() = any (array['admin','pos'])
  ) then
    raise exception 'No autorizado';
  end if;
  -- CX-0b · CUENTA COMERCIAL del pedido, decidida en el servidor.
  --   Doctor (portal): SU cuenta, derivada de la identidad autenticada (_cc_chk_customer: customers.profile_id = auth.uid()
  --   y activa). p_customer_id solo se acepta si ES esa cuenta; cualquier otra (ajena, inexistente o inactiva) → el MISMO
  --   error genérico (no se puede sondear si una cuenta existe ni de quién es).
  --   ⇢ B2B-3 sustituye SOLO esta derivación por: cuenta seleccionada + membresía activa + permiso de compra.
  --   Personal (admin/pos): cualquier cuenta activa (facultad existente); si además hay comprador, la pareja debe ser
  --   coherente: la cuenta ligada a ese comprador, o una cuenta sin portal cuando el comprador no tiene cuenta ligada.
  if public.auth_role() = 'doctor' then
    v_cust := public._cc_chk_customer(auth.uid());
    if p_customer_id is not null and p_customer_id is distinct from v_cust then
      raise exception 'CUENTA_NO_AUTORIZADA: el pedido solo puede crearse para tu propia cuenta' using errcode = 'insufficient_privilege';
    end if;
    if v_cust is not null then
      select full_name, phone into v_cname, v_cphone from public.customers where id = v_cust;
    end if;
  else
    v_cust := p_customer_id;
    if v_cust is not null then
      select full_name, phone, profile_id into v_cname, v_cphone, v_cust_profile from public.customers where id = v_cust and active = true;
      if not found then raise exception 'CUSTOMER_INEXISTENTE: customer inexistente o inactivo'; end if;
      if p_doctor_id is not null
         and v_cust_profile is distinct from p_doctor_id
         and (v_cust_profile is not null or exists (select 1 from public.customers c where c.profile_id = p_doctor_id)) then
        raise exception 'PAR_INCONSISTENTE: el comprador y la cuenta comercial no corresponden';
      end if;
    end if;
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'El pedido no tiene renglones';
  end if;
  if exists (select 1 from public.orders where id = p_order_id) then
    return (select jsonb_build_object('order_id', o.id, 'total', o.total, 'folio', o.external_ref, 'idempotent', true)
            from public.orders o where o.id = p_order_id);
  end if;

  if p_doctor_id is not null then
    select price_list_id into list from public.profiles where id = p_doctor_id;
  end if;

  for ln in select * from jsonb_array_elements(p_lines) loop
    pid := nullif(ln ->> 'product_id','')::uuid;
    q   := (ln ->> 'qty')::int;
    if pid is null then raise exception 'Producto inválido'; end if;
    if q is null or q <= 0 then raise exception 'Cantidad inválida (debe ser > 0)'; end if;
    select active into act from public.products where id = pid;
    if not found then raise exception 'Producto % no existe', pid; end if;
    if act is not true then raise exception 'Producto % no está activo', pid; end if;
    up := public.precio_de(pid, list, q);   -- ← precio autorizado con CANTIDAD (volumen)
    if up is null then raise exception 'Producto % sin precio válido', pid; end if;
    tot := tot + up * q;
    out_items := out_items || jsonb_build_array(jsonb_build_object('product_id', pid, 'qty', q, 'unit_price', up));
  end loop;

  -- CX-0b · el snapshot del cliente lo escribe SOLO el servidor (el que venga del navegador se descarta).
  v_meta := p_shipping_meta - 'customer';
  if v_cust is not null then
    v_meta := jsonb_set(coalesce(v_meta, '{}'::jsonb), '{customer}', jsonb_build_object('id', v_cust, 'name', v_cname, 'phone', v_cphone), true);
  end if;

  -- FOLIO: el del cliente solo si viene y no existe; si no, el del servidor (único, no reciclable).
  -- Ante una colisión CONCURRENTE (dos clientes con el mismo folio, o la secuencia alcanzando un folio
  -- histórico), el índice único lo detecta y se reintenta con folio del servidor: nunca un duplicado,
  -- nunca un pedido perdido.
  v_folio := nullif(btrim(coalesce(p_folio, '')), '');
  if v_folio is null or exists (select 1 from public.orders where external_ref = v_folio) then v_folio := public.siguiente_folio(); end if;
  for v_intento in 1..5 loop
    begin
      insert into public.orders (id, external_ref, doctor_id, customer_id, total, currency, status, payment_method, payment_status, invoice_requested, shipping_meta)
      values (p_order_id, v_folio, p_doctor_id, v_cust, tot, 'MXN', 'pending_payment', 'contra_pedido', 'pending', coalesce(p_invoice_requested, false), v_meta);
      exit;
    exception when unique_violation then
      if v_intento = 5 then raise; end if;
      v_folio := public.siguiente_folio();
    end;
  end loop;

  insert into public.order_items (order_id, product_id, qty, unit_price)
  select p_order_id, (i->>'product_id')::uuid, (i->>'qty')::int, (i->>'unit_price')::numeric
  from jsonb_array_elements(out_items) i;

  return jsonb_build_object('order_id', p_order_id, 'folio', v_folio, 'total', tot, 'items', out_items);
end;
$fn$;
comment on function public.crear_pedido(uuid, text, uuid, jsonb, jsonb, boolean, uuid) is 'CX-0b · Pedido canónico (W1). Cuenta comercial decidida en el servidor: doctor = su cuenta; personal = cuenta activa con pareja coherente. Snapshot del cliente solo del servidor.';
revoke all on function public.crear_pedido(uuid, text, uuid, jsonb, jsonb, boolean, uuid) from public, anon;
grant execute on function public.crear_pedido(uuid, text, uuid, jsonb, jsonb, boolean, uuid) to authenticated;

-- 2) orders_guard · identidad comercial inmutable antes de cualquier atajo; resto verbatim (W3-A F4).
CREATE OR REPLACE FUNCTION public.orders_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r text := public.auth_role();
BEGIN
  -- CX-0b · IDENTIDAD COMERCIAL INMUTABLE. Va ANTES de cualquier salida anticipada (app.trusted, service_role,
  -- Dirección): ninguna ruta legítima cambia la cuenta, el comprador ni el snapshot del cliente de un pedido
  -- creado; corregir un error = cancelar y recrear. Comparación NULL-safe y estructural (jsonb).
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id
     OR (NEW.shipping_meta -> 'customer') IS DISTINCT FROM (OLD.shipping_meta -> 'customer') THEN
    RAISE EXCEPTION 'IDENTIDAD_PEDIDO_INMUTABLE: la cuenta, el comprador y los datos del cliente de un pedido no se modifican; cancela y crea uno nuevo'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

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
comment on function public.orders_guard() is 'CX-0b · customer_id, doctor_id y shipping_meta.customer inmutables para todos; resto de la guarda W1/W2/W3-A sin cambios.';

-- 3) vender_pos · texto de producción (W2-C) + comprador/cuenta coherentes + snapshot del servidor.
CREATE OR REPLACE FUNCTION public.vender_pos(p_order_id uuid, p_folio text, p_total numeric, p_payment_method text, p_doctor_id uuid, p_shipping_meta jsonb, p_lines jsonb, p_allocations jsonb, p_invoice_requested boolean DEFAULT false, p_invoice_meta jsonb DEFAULT NULL::jsonb, p_customer_id uuid DEFAULT NULL::uuid, p_efectivo_recibido numeric DEFAULT NULL::numeric, p_custody_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_req jsonb; v_prev jsonb;
  a record; ln record; v_nlines int; qty int; pid uuid; up numeric; tot numeric := 0;
  v_items uuid[] := '{}'; v_item uuid; v_bad int;
  v_cname text; v_cphone text; v_meta jsonb; v_metodo text;
  v_cus record; v_falta record;
  v_cust_profile uuid;
begin
  if not (public.auth_role() = any (array['admin','pos'])) then
    raise exception 'No autorizado';
  end if;
  v_req := jsonb_build_object('folio', p_folio, 'total', p_total, 'payment_method', p_payment_method,
             'doctor', p_doctor_id, 'shipping_meta', p_shipping_meta, 'lines', p_lines, 'allocations', p_allocations,
             'invoice_requested', p_invoice_requested, 'invoice_meta', p_invoice_meta, 'customer', p_customer_id,
             'custody', p_custody_id);
  v_prev := public._w1_op_begin(p_order_id, 'venta_pos', v_req);
  if v_prev is not null then return true; end if;  -- ya aplicada: éxito idempotente

  if p_customer_id is not null then
    select full_name, phone, profile_id into v_cname, v_cphone, v_cust_profile from public.customers where id = p_customer_id and active = true;
    if not found then raise exception 'CUSTOMER_INEXISTENTE: customer inexistente o inactivo'; end if;
  end if;
  -- CX-0b · comprador opcional (NULL = mostrador / cuenta histórica sin portal). Si viene, debe ser un comprador real
  -- (perfil doctor) y la pareja con la cuenta debe ser coherente: la cuenta ligada a ese comprador, o una cuenta sin
  -- portal cuando el comprador no tiene cuenta ligada. Misma regla que crear_pedido (personal).
  --   ⇢ B2B-3: la coherencia pasa a ser membresía activa del comprador en la cuenta con permiso de compra.
  if p_doctor_id is not null then
    if not exists (select 1 from public.profiles where id = p_doctor_id and role_id = 'doctor') then
      raise exception 'COMPRADOR_INVALIDO: el comprador indicado no es válido';
    end if;
    if p_customer_id is not null
       and v_cust_profile is distinct from p_doctor_id
       and (v_cust_profile is not null or exists (select 1 from public.customers c where c.profile_id = p_doctor_id)) then
      raise exception 'PAR_INCONSISTENTE: el comprador y la cuenta comercial no corresponden';
    end if;
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

  -- W2-C · VENTA DESDE CUSTODIA. Todo lo anterior (precio del servidor, lote vigente,
  -- asignaciones completas) ya se validó igual que en mostrador; aquí solo se añade lo
  -- propio de la custodia. El cerrojo de la custodia serializa dos ventas simultáneas
  -- del mismo saldo.
  if p_custody_id is not null then
    select * into v_cus from public.custodies where id = p_custody_id for update;
    if not found then raise exception 'CUSTODIA_INEXISTENTE'; end if;
    if v_cus.status <> 'abierta' then raise exception 'CUSTODIA_CERRADA: esa custodia ya se cerró'; end if;
    if not (public.auth_role() = 'admin' or v_cus.holder_user_id = v_uid) then
      raise exception 'NO_AUTORIZADO: solo el tenedor de la custodia (o Dirección) vende de ella';
    end if;
    -- Cada lote asignado tiene que estar EN PODER de esa custodia, y alcanzar.
    -- Se agrega por lote: una venta puede partir un renglón en dos lotes y dos
    -- renglones pueden tocar el mismo lote.
    select x.lot_id, sum(x.qty)::int as pedido, public.custody_held_en(p_custody_id, x.lot_id) as en_poder
      into v_falta
      from jsonb_to_recordset(p_allocations) as x(line_index int, lot_id uuid, qty int)
     group by x.lot_id
    having sum(x.qty) > public.custody_held_en(p_custody_id, x.lot_id)
     limit 1;
    if found then
      raise exception 'CUSTODIA_SALDO_INSUFICIENTE: del lote % tienes % y la venta pide %',
        v_falta.lot_id, v_falta.en_poder, v_falta.pedido;
    end if;
  end if;

  if p_efectivo_recibido is not null and v_metodo = 'efectivo' and p_efectivo_recibido < tot then
    raise exception 'EFECTIVO_INSUFICIENTE: recibido % para un total de %', p_efectivo_recibido, tot;
  end if;

  -- CX-0b · el snapshot del cliente lo escribe SOLO el servidor (el que venga del navegador se descarta).
  v_meta := p_shipping_meta - 'customer';
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

  -- W2-C: el libro de custodia se escribe ANTES del descuento. Así `custody_held` ya
  -- refleja que esas unidades dejaron de estar en poder del tenedor y el descuento de
  -- abajo usa EXACTAMENTE la misma condición que una venta de mostrador: una sola
  -- semántica de disponibilidad, sin excepciones ni banderas.
  if p_custody_id is not null then
    insert into public.custody_lines (id, custody_id, kind, product_id, lot_id, qty, held_delta,
                                      unit_price, order_id, order_item_id, actor, actor_role, op_id)
    select gen_random_uuid(), p_custody_id, 'venta', l.product_id, x.lot_id, x.qty, -x.qty,
           public.precio_de(l.product_id, null, (p_lines -> x.line_index ->> 'qty')::int),
           p_order_id, v_items[x.line_index + 1], v_uid, coalesce(public.auth_role(), ''), p_order_id
      from jsonb_to_recordset(p_allocations) as x(line_index int, lot_id uuid, qty int)
      join public.lots l on l.id = x.lot_id;
  end if;

  for a in select x.line_index, x.lot_id, x.qty from jsonb_to_recordset(p_allocations) as x(line_index int, lot_id uuid, qty int) loop
    -- W2-C · W2-X1: se descuenta contra la DISPONIBILIDAD (propio − en custodia).
    update public.lots set quantity = quantity - a.qty
     where id = a.lot_id and quantity - a.qty >= public.custody_held(a.lot_id);
    if not found then
      if exists (select 1 from public.lots l where l.id = a.lot_id and l.quantity >= a.qty) then
        raise exception 'CUSTODIA_EN_PODER: el lote % tiene % unidades en custodia; disponibles %',
          a.lot_id, public.custody_held(a.lot_id),
          (select l.quantity - public.custody_held(l.id) from public.lots l where l.id = a.lot_id);
      end if;
      raise exception 'Inventario insuficiente en el lote %', a.lot_id;
    end if;
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
$function$;
comment on function public.vender_pos(uuid, text, numeric, text, uuid, jsonb, jsonb, jsonb, boolean, jsonb, uuid, numeric, uuid) is 'CX-0b · Venta de mostrador (W1/W2/W2-C). Comprador opcional; si viene, perfil doctor coherente con la cuenta. Snapshot del cliente solo del servidor.';
revoke all on function public.vender_pos(uuid, text, numeric, text, uuid, jsonb, jsonb, jsonb, boolean, jsonb, uuid, numeric, uuid) from public, anon;
grant execute on function public.vender_pos(uuid, text, numeric, text, uuid, jsonb, jsonb, jsonb, boolean, jsonb, uuid, numeric, uuid) to authenticated;

-- 4) Sin INSERT directo sobre orders para usuarios de la API (los comandos SECURITY DEFINER no dependen de esto).
drop policy orders_insert_scoped on public.orders;
revoke insert on table public.orders from authenticated, anon;

do $post$ begin
  if has_table_privilege('authenticated', 'public.orders', 'INSERT') then raise exception 'CX-0b: authenticated conserva INSERT'; end if;
  if not has_table_privilege('authenticated', 'public.orders', 'SELECT') or not has_table_privilege('authenticated', 'public.orders', 'UPDATE') then
    raise exception 'CX-0b: se perdió SELECT/UPDATE de authenticated';
  end if;
  if exists (select 1 from pg_policy where polrelid = 'public.orders'::regclass and polcmd = 'a') then raise exception 'CX-0b: queda una política INSERT'; end if;
  if not has_function_privilege('authenticated', 'public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)', 'EXECUTE') then
    raise exception 'CX-0b: permisos de crear_pedido alterados';
  end if;
  if pg_get_functiondef('public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)'::regprocedure) !~ 'precio_de\(pid, list, q\)'
     or pg_get_functiondef('public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)'::regprocedure) !~ 'siguiente_folio' then
    raise exception 'CX-0b: crear_pedido perdió precio por volumen o folio del servidor';
  end if;
  if not has_function_privilege('authenticated', 'public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)', 'EXECUTE') then
    raise exception 'CX-0b: permisos de vender_pos alterados';
  end if;
  if pg_get_functiondef('public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure) !~ 'precio_de\(pid, null, qty\)'
     or pg_get_functiondef('public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure) !~ '_w2_asiento'
     or pg_get_functiondef('public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure) !~ '_w1_op_begin' then
    raise exception 'CX-0b: vender_pos perdió precio, asiento de caja o idempotencia';
  end if;
end $post$;
