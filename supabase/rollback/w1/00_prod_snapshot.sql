-- W1 ROLLBACK SNAPSHOT — capturado de PRODUCCIÓN (amurlvlvfohwucvxfdot) en modo SOLO LECTURA.
-- Contiene las definiciones que W1 reemplaza/revoca. Restaurar = ejecutar este archivo tras
-- los DROP de 99_down.sql. NO ejecutar sin autorización.

-- ===== FUNCIONES =====
-- recibir_lote(uuid,text,text,integer,text,numeric,text,text,uuid)  ACL: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
CREATE OR REPLACE FUNCTION public.recibir_lote(p_product uuid, p_lote text, p_caducidad text, p_cantidad integer, p_ubicacion text, p_unit_cost numeric DEFAULT NULL::numeric, p_reason text DEFAULT 'entrada'::text, p_reference text DEFAULT NULL::text, p_replenishment_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_lot uuid; v_exp date; v_oldq int; v_oldc numeric; v_newc numeric; v_inc numeric; v_created boolean := false;
begin
  -- 1) Autorización: staff de recepción (igual alcance que la operación actual).
  if not (public.auth_role() = any (array['admin','warehouse','packing'])) then
    raise exception 'NO_AUTORIZADO: sin permiso para recibir inventario';
  end if;
  -- 2/3) Producto + cantidad.
  if p_product is null or not exists (select 1 from public.products where id = p_product) then
    raise exception 'PRODUCTO_INEXISTENTE';
  end if;
  if coalesce(btrim(p_lote), '') = '' then raise exception 'LOTE_REQUERIDO'; end if;
  if p_cantidad is null or p_cantidad <= 0 then raise exception 'CANTIDAD_INVALIDA'; end if;

  begin v_exp := nullif(btrim(p_caducidad), '')::date; exception when others then v_exp := null; end;

  -- Costo de ESTA entrada. Fallback OPERATIVO a product_costs (costo de referencia) SOLO
  -- cuando no viene costo explícito (entrada directa sin costo). En recepción de compra
  -- siempre llega p_unit_cost (= replenishments.unit_cost). Si tampoco hay referencia → NULL
  -- (desconocido, no se fabrica). La RPC es SECURITY DEFINER: puede leer product_costs aunque
  -- el rol del llamante no tenga acceso directo por RLS.
  v_inc := coalesce(p_unit_cost, (select unit_cost from public.product_costs where product_id = p_product));

  -- 4) Identidad del lote: producto + código de lote (case/trim-insensible). NO idempotente.
  select id, quantity, unit_cost into v_lot, v_oldq, v_oldc
    from public.lots
   where product_id = p_product and lower(btrim(lot_code)) = lower(btrim(p_lote))
   limit 1;

  if v_lot is null then
    insert into public.lots (product_id, lot_code, expiry_date, quantity, location, unit_cost)
    values (p_product, btrim(p_lote), v_exp, 0,
            coalesce(nullif(btrim(p_ubicacion), ''), 'Bodega central'), v_inc)
    returning id into v_lot;
    v_oldq := 0; v_oldc := null; v_created := true;
  end if;

  -- 6) Costo del LOTE (promedio ponderado solo con ambos conocidos; nunca fabrica costo).
  v_newc := case
    when v_inc is null then v_oldc
    when coalesce(v_oldq, 0) <= 0 then v_inc
    when v_oldc is null then null
    else round((v_oldq * v_oldc + p_cantidad * v_inc) / (v_oldq + p_cantidad), 4)
  end;

  -- 5) Incrementa cantidad + actualiza costo/caducidad.
  update public.lots
     set quantity    = quantity + p_cantidad,
         unit_cost   = v_newc,
         expiry_date = coalesce(expiry_date, v_exp)
   where id = v_lot;

  -- 7/8/9) Movimiento con costo congelado (el entrante) + reason/reference/actor.
  insert into public.inventory_movements (lot_id, change, reason, reference, created_by, unit_cost)
  values (v_lot, p_cantidad, coalesce(nullif(btrim(p_reason), ''), 'entrada'), p_reference, auth.uid(), v_inc);

  -- Atomicidad compra→recepción: marcar 'recibida' en la MISMA transacción (si aplica).
  if p_replenishment_id is not null then
    update public.replenishments set status = 'recibida'
     where id = p_replenishment_id and status <> 'recibida';
  end if;

  return jsonb_build_object('result', case when v_created then 'created' else 'added' end,
                           'lot_id', v_lot, 'lot_unit_cost', v_newc);
end;
$function$;

-- importar_lote(text,text,text,integer,text)  ACL: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
CREATE OR REPLACE FUNCTION public.importar_lote(p_sku text, p_lote text, p_caducidad text, p_cantidad integer, p_ubicacion text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_product uuid;
  v_lot     uuid;
  v_exp     date;
begin
  if public.auth_role() <> all (array['admin','warehouse']) then
    raise exception 'NO_AUTORIZADO: no tienes permiso para importar inventario';
  end if;
  if coalesce(btrim(p_lote), '') = '' then
    raise exception 'LOTE_REQUERIDO: falta el código de lote';
  end if;
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'CANTIDAD_INVALIDA: la cantidad debe ser mayor a cero';
  end if;

  select id into v_product from public.products where lower(btrim(sku)) = lower(btrim(p_sku));
  if v_product is null then
    raise exception 'SKU_INEXISTENTE: no existe un producto con SKU %', p_sku;
  end if;

  -- Idempotencia: mismo producto + mismo código de lote ⇒ ya está, no se duplica.
  select id into v_lot from public.lots
   where product_id = v_product and lower(btrim(lot_code)) = lower(btrim(p_lote));
  if v_lot is not null then
    return jsonb_build_object('result', 'skipped');
  end if;

  -- Caducidad tolerante: lo que no parezca fecha entra como NULL (no rompe la fila).
  begin
    v_exp := nullif(btrim(p_caducidad), '')::date;
  exception when others then
    v_exp := null;
  end;

  -- Atómico: el lote y su movimiento de entrada, juntos.
  insert into public.lots (product_id, lot_code, expiry_date, quantity, location)
  values (v_product, btrim(p_lote), v_exp, p_cantidad, coalesce(nullif(btrim(p_ubicacion), ''), 'Bodega central'))
  returning id into v_lot;

  insert into public.inventory_movements (lot_id, change, reason, reference, created_by)
  values (v_lot, p_cantidad, 'entrada', 'MIGRACION', auth.uid());

  return jsonb_build_object('result', 'created', 'lot_id', v_lot);
end;
$function$;

-- surtir_pedido(uuid,text,jsonb,jsonb)  ACL: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
CREATE OR REPLACE FUNCTION public.surtir_pedido(p_order uuid, p_ref text, p_allocations jsonb, p_item_lots jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE a jsonb; lot uuid; qty int; k text; v text;
BEGIN
  IF NOT (public.auth_role() = ANY (ARRAY['admin','warehouse','packing'])) THEN RAISE EXCEPTION 'No autorizado'; END IF;
  -- Solo un pedido pagado y aún no empacado (idempotencia / no saltar pasos).
  IF NOT EXISTS (SELECT 1 FROM public.orders WHERE id = p_order AND status IN ('paid','picking')) THEN RETURN false; END IF;
  -- Descuenta cada lote (falla si dejaría negativo) + registra el movimiento.
  FOR a IN SELECT * FROM jsonb_array_elements(p_allocations) LOOP
    lot := (a ->> 'lot_id')::uuid; qty := (a ->> 'qty')::int;
    UPDATE public.lots SET quantity = quantity - qty WHERE id = lot AND quantity - qty >= 0;
    IF NOT FOUND THEN RAISE EXCEPTION 'Inventario insuficiente en el lote %', lot; END IF;
    INSERT INTO public.inventory_movements(lot_id, change, reason, reference, created_by)
    VALUES (lot, -qty, 'surtido', p_ref, auth.uid());
  END LOOP;
  -- Marca empacado y asigna el lote por renglón.
  UPDATE public.orders SET status = 'packed' WHERE id = p_order;
  FOR k, v IN SELECT * FROM jsonb_each_text(p_item_lots) LOOP
    UPDATE public.order_items SET lot_id = NULLIF(v, '')::uuid WHERE id = k::uuid;
  END LOOP;
  RETURN true;
END; $function$;

-- vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid)  ACL: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
CREATE OR REPLACE FUNCTION public.vender_pos(p_order_id uuid, p_folio text, p_total numeric, p_payment_method text, p_doctor_id uuid, p_shipping_meta jsonb, p_lines jsonb, p_allocations jsonb, p_invoice_requested boolean DEFAULT false, p_invoice_meta jsonb DEFAULT NULL::jsonb, p_customer_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a jsonb; ln jsonb; lot uuid; qty int; pid uuid; up numeric; tot numeric := 0; computed jsonb := '[]'::jsonb;
  v_cname text; v_cphone text; v_meta jsonb;
begin
  if not (public.auth_role() = any (array['admin','pos'])) then
    raise exception 'No autorizado';
  end if;
  if p_customer_id is not null then
    select full_name, phone into v_cname, v_cphone from public.customers where id = p_customer_id and active = true;
    if not found then raise exception 'CUSTOMER_INEXISTENTE: customer inexistente o inactivo'; end if;
  end if;
  if exists (select 1 from public.orders where id = p_order_id) then
    return false;
  end if;

  for a in select * from jsonb_array_elements(p_allocations) loop
    lot := (a ->> 'lot_id')::uuid; qty := (a ->> 'qty')::int;
    update public.lots set quantity = quantity - qty where id = lot and quantity - qty >= 0;
    if not found then raise exception 'Inventario insuficiente en el lote %', lot; end if;
    insert into public.inventory_movements(lot_id, change, reason, reference, created_by)
    values (lot, -qty, 'venta', p_folio, auth.uid());
  end loop;

  for ln in select * from jsonb_array_elements(p_lines) loop
    pid := nullif(ln ->> 'product_id','')::uuid; qty := (ln ->> 'qty')::int;
    if pid is null then raise exception 'Producto inválido'; end if;
    if qty is null or qty <= 0 then raise exception 'Cantidad inválida'; end if;
    up := public.precio_de(pid, null, qty);   -- ← mostrador: base + volumen (universal) con CANTIDAD
    if up is null then raise exception 'Producto % sin precio válido', pid; end if;
    tot := tot + up * qty;
    computed := computed || jsonb_build_array(jsonb_build_object('product_id', pid, 'lot_id', ln ->> 'lot_id', 'qty', qty, 'unit_price', up));
  end loop;

  v_meta := p_shipping_meta;
  if p_customer_id is not null then
    v_meta := jsonb_set(coalesce(v_meta, '{}'::jsonb), '{customer}', jsonb_build_object('id', p_customer_id, 'name', v_cname, 'phone', v_cphone), true);
  end if;

  insert into public.orders (id, external_ref, doctor_id, customer_id, total, currency, status, payment_method, payment_status, invoice_requested, invoice_meta, shipping_meta)
  values (p_order_id, p_folio, p_doctor_id, p_customer_id, tot, 'MXN', 'delivered', p_payment_method, 'paid', coalesce(p_invoice_requested, false), p_invoice_meta, v_meta);

  for ln in select * from jsonb_array_elements(computed) loop
    insert into public.order_items (order_id, product_id, lot_id, qty, unit_price)
    values (p_order_id, (ln ->> 'product_id')::uuid, nullif(ln ->> 'lot_id','')::uuid, (ln ->> 'qty')::int, (ln ->> 'unit_price')::numeric);
  end loop;

  return true;
end;
$function$;

-- registrar_devolucion(uuid,text,numeric,text,text,jsonb)  ACL: {postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}
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
  it         jsonb;
  v_lot      uuid;
  v_qty      int;
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

  insert into public.refunds (order_id, tipo, monto, motivo, metodo, usuario, created_by, items)
  values (p_order_id, p_tipo, p_monto, left(btrim(p_motivo), 400), v_metodo,
          coalesce(nullif(btrim(p_usuario), ''), 'Sistema'), auth.uid(),
          case when p_tipo = 'devolucion' then p_items else null end)
  returning id into v_id;

  -- Solo 'devolucion' reingresa producto (correccion/cortesia no traen producto de vuelta).
  if p_tipo = 'devolucion' and jsonb_typeof(p_items) = 'array' then
    for it in select * from jsonb_array_elements(p_items) loop
      v_lot := nullif(it ->> 'lot_id', '')::uuid;
      v_qty := coalesce((it ->> 'qty')::int, 0);
      if v_lot is not null and v_qty > 0 then
        update public.lots set quantity = quantity + v_qty where id = v_lot;
        insert into public.inventory_movements(lot_id, change, reason, reference, created_by)
        values (v_lot, v_qty, 'devolucion', coalesce(v_folio, 'DEV'), auth.uid());
      end if;
    end loop;
  end if;

  return jsonb_build_object('id', v_id, 'restante', v_restante - p_monto);
end;
$function$;

-- orders_guard()  ACL: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
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

-- apply_lot_movement(uuid,integer,text,text)  ACL: {=X/postgres,postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
CREATE OR REPLACE FUNCTION public.apply_lot_movement(p_lot uuid, p_change integer, p_reason text, p_reference text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.auth_role() = ANY (ARRAY['admin','warehouse','packing','pos'])) THEN
    RAISE EXCEPTION 'No autorizado para mover inventario';
  END IF;
  IF p_change < 0 THEN
    -- Salida: descuenta solo si hay existencia suficiente (evita sobreventa).
    UPDATE public.lots SET quantity = quantity + p_change
      WHERE id = p_lot AND quantity + p_change >= 0;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Inventario insuficiente en el lote % (se evitó sobreventa)', p_lot;
    END IF;
  ELSE
    UPDATE public.lots SET quantity = quantity + p_change WHERE id = p_lot;
  END IF;
  INSERT INTO public.inventory_movements(lot_id, change, reason, reference, created_by)
  VALUES (p_lot, p_change, p_reason, p_reference, auth.uid());
END; $function$;

-- ===== POLÍTICAS RLS =====
CREATE POLICY invmov_insert_ops ON public.inventory_movements AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((auth_role() = ANY (ARRAY['admin'::text, 'warehouse'::text, 'packing'::text, 'pos'::text])));

CREATE POLICY invmov_select_ops ON public.inventory_movements AS PERMISSIVE FOR SELECT TO authenticated
  USING ((auth_role() = ANY (ARRAY['admin'::text, 'warehouse'::text, 'packing'::text, 'pos'::text])));

CREATE POLICY lots_select_ops ON public.lots AS PERMISSIVE FOR SELECT TO authenticated
  USING ((auth_role() = ANY (ARRAY['admin'::text, 'warehouse'::text, 'packing'::text, 'pos'::text, 'billing'::text])));

CREATE POLICY lots_write_warehouse ON public.lots AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth_role() = ANY (ARRAY['admin'::text, 'warehouse'::text])))
  WITH CHECK ((auth_role() = ANY (ARRAY['admin'::text, 'warehouse'::text])));

CREATE POLICY order_items_delete_scoped ON public.order_items AS PERMISSIVE FOR DELETE TO authenticated
  USING ((auth_role() = 'admin'::text));

CREATE POLICY order_items_insert_scoped ON public.order_items AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((auth_role() = ANY (ARRAY['admin'::text, 'pos'::text])));

CREATE POLICY order_items_select_scoped ON public.order_items AS PERMISSIVE FOR SELECT TO authenticated
  USING (((auth_role() = ANY (ARRAY['admin'::text, 'warehouse'::text, 'packing'::text, 'billing'::text, 'pos'::text])) OR (EXISTS ( SELECT 1
   FROM orders o
  WHERE ((o.id = order_items.order_id) AND (o.doctor_id = auth.uid()))))));

CREATE POLICY order_items_update_scoped ON public.order_items AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((auth_role() = ANY (ARRAY['admin'::text, 'warehouse'::text, 'packing'::text])))
  WITH CHECK ((auth_role() = ANY (ARRAY['admin'::text, 'warehouse'::text, 'packing'::text])));

CREATE POLICY orders_delete_admin ON public.orders AS PERMISSIVE FOR DELETE TO authenticated
  USING ((auth_role() = 'admin'::text));

CREATE POLICY orders_insert_scoped ON public.orders AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((auth_role() = ANY (ARRAY['admin'::text, 'pos'::text])));

CREATE POLICY orders_select_scoped ON public.orders AS PERMISSIVE FOR SELECT TO authenticated
  USING (((auth_role() = 'admin'::text) OR (doctor_id = auth.uid()) OR (auth_role() = ANY (ARRAY['warehouse'::text, 'packing'::text, 'billing'::text])) OR ((auth_role() = 'pos'::text) AND ((order_vendor_email(id) = (auth.jwt() ->> 'email'::text)) OR ((shipping_meta ->> 'seller'::text) = (auth.jwt() ->> 'email'::text)))) OR ((auth_role() = 'driver'::text) AND is_order_driver(id))));

CREATE POLICY orders_update_scoped ON public.orders AS PERMISSIVE FOR UPDATE TO authenticated
  USING (((auth_role() = 'admin'::text) OR ((auth_role() = 'doctor'::text) AND (doctor_id = auth.uid())) OR (auth_role() = ANY (ARRAY['warehouse'::text, 'packing'::text, 'billing'::text]))))
  WITH CHECK (((auth_role() = 'admin'::text) OR ((auth_role() = 'doctor'::text) AND (doctor_id = auth.uid())) OR (auth_role() = ANY (ARRAY['warehouse'::text, 'packing'::text, 'billing'::text]))));

CREATE POLICY refunds_select ON public.refunds AS PERMISSIVE FOR SELECT TO authenticated
  USING ((auth_role() = ANY (ARRAY['admin'::text, 'billing'::text, 'pos'::text])));

CREATE POLICY replenishments_insert ON public.replenishments AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((auth_role() = ANY (ARRAY['admin'::text, 'billing'::text])));

CREATE POLICY replenishments_select ON public.replenishments AS PERMISSIVE FOR SELECT TO authenticated
  USING ((auth_role() = ANY (ARRAY['admin'::text, 'warehouse'::text, 'packing'::text, 'billing'::text])));

CREATE POLICY replenishments_update ON public.replenishments AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((auth_role() = ANY (ARRAY['admin'::text, 'warehouse'::text, 'billing'::text])))
  WITH CHECK ((auth_role() = ANY (ARRAY['admin'::text, 'warehouse'::text, 'billing'::text])));

CREATE POLICY shipping_attempts_select_ops ON public.shipping_attempts AS PERMISSIVE FOR SELECT TO authenticated
  USING ((auth_role() = ANY (ARRAY['admin'::text, 'warehouse'::text, 'packing'::text])));

-- ===== GRANTS DE TABLA (anon/authenticated/service_role) =====
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.inventory_movements TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.inventory_movements TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.inventory_movements TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.lots TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.lots TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.lots TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.order_items TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.order_items TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.order_items TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.orders TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.orders TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.orders TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.refunds TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.refunds TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.refunds TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.replenishments TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.replenishments TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.replenishments TO service_role;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.shipping_attempts TO anon;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.shipping_attempts TO authenticated;
GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON public.shipping_attempts TO service_role;

-- ===== TRIGGERS =====
-- inventory_movements.trg_freeze_movement_cost
CREATE TRIGGER trg_freeze_movement_cost BEFORE INSERT ON public.inventory_movements FOR EACH ROW EXECUTE FUNCTION freeze_movement_cost();
-- inventory_movements.trg_inventory_movements_append_only
CREATE TRIGGER trg_inventory_movements_append_only BEFORE DELETE OR UPDATE ON public.inventory_movements FOR EACH ROW EXECUTE FUNCTION ledger_append_only();
-- orders.orders_audit_trigger
CREATE TRIGGER orders_audit_trigger AFTER INSERT OR UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION log_audit();
-- orders.orders_guard_trg
CREATE TRIGGER orders_guard_trg BEFORE UPDATE ON public.orders FOR EACH ROW EXECUTE FUNCTION orders_guard();
-- orders.trg_orders_estado_terminal
CREATE TRIGGER trg_orders_estado_terminal BEFORE UPDATE OF status ON public.orders FOR EACH ROW EXECUTE FUNCTION orders_estado_terminal();
-- refunds.trg_refunds_append_only
CREATE TRIGGER trg_refunds_append_only BEFORE DELETE OR UPDATE ON public.refunds FOR EACH ROW EXECUTE FUNCTION refunds_append_only();

-- ===== CONSTRAINTS =====
-- inventory_movements.inventory_movements_created_by_fkey (validated=True): FOREIGN KEY (created_by) REFERENCES auth.users(id)
-- inventory_movements.inventory_movements_lot_id_fkey (validated=True): FOREIGN KEY (lot_id) REFERENCES lots(id)
-- lots.lots_product_id_fkey (validated=True): FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
-- lots.lots_quantity_nonneg (validated=False): CHECK ((quantity >= 0)) NOT VALID
-- order_items.order_items_lot_id_fkey (validated=True): FOREIGN KEY (lot_id) REFERENCES lots(id)
-- order_items.order_items_order_id_fkey (validated=True): FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
-- order_items.order_items_product_id_fkey (validated=True): FOREIGN KEY (product_id) REFERENCES products(id)
-- orders.orders_customer_id_fkey (validated=True): FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE SET NULL
-- orders.orders_doctor_id_fkey (validated=True): FOREIGN KEY (doctor_id) REFERENCES profiles(id)
-- refunds.refunds_created_by_fkey (validated=True): FOREIGN KEY (created_by) REFERENCES auth.users(id)
-- refunds.refunds_monto_check (validated=True): CHECK ((monto > (0)::numeric))
-- refunds.refunds_order_id_fkey (validated=True): FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE RESTRICT
-- refunds.refunds_tipo_check (validated=True): CHECK ((tipo = ANY (ARRAY['devolucion'::text, 'correccion'::text, 'cortesia'::text])))
-- replenishments.replenishments_created_by_fkey (validated=True): FOREIGN KEY (created_by) REFERENCES auth.users(id)
-- replenishments.replenishments_product_id_fkey (validated=True): FOREIGN KEY (product_id) REFERENCES products(id)
-- shipping_attempts.ck_shipping_attempts_status (validated=True): CHECK ((status = ANY (ARRAY['pending'::text, 'succeeded'::text, 'failed_safe_to_retry'::text, 'unknown_requires_reconciliation'::text])))
-- shipping_attempts.shipping_attempts_order_id_fkey (validated=True): FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE

-- ===== COLUMNAS =====
-- inventory_movements:
--   id uuid NOT NULL DEFAULT gen_random_uuid()
--   lot_id uuid
--   change integer NOT NULL
--   reason text
--   reference text
--   created_by uuid
--   created_at timestamp with time zone DEFAULT now()
--   unit_cost numeric
-- lots:
--   id uuid NOT NULL DEFAULT gen_random_uuid()
--   product_id uuid
--   lot_code text NOT NULL
--   manufacture_date date
--   expiry_date date
--   quantity integer NOT NULL DEFAULT 0
--   location text
--   metadata jsonb
--   caducidad_avisada_at timestamp with time zone
--   unit_cost numeric
-- order_items:
--   id uuid NOT NULL DEFAULT gen_random_uuid()
--   order_id uuid
--   product_id uuid
--   lot_id uuid
--   qty integer NOT NULL
--   unit_price numeric
--   created_at timestamp with time zone DEFAULT now()
-- orders:
--   id uuid NOT NULL DEFAULT gen_random_uuid()
--   external_ref text
--   doctor_id uuid
--   total numeric
--   currency text DEFAULT 'MXN'::text
--   status text DEFAULT 'draft'::text
--   payment_method text
--   payment_ref text
--   payment_status text DEFAULT 'pending'::text
--   stripe_payment_id text
--   invoice_requested boolean DEFAULT false
--   invoice_meta jsonb
--   shipping_meta jsonb
--   created_at timestamp with time zone DEFAULT now()
--   cobranza_avisada_at timestamp with time zone
--   customer_id uuid
-- refunds:
--   id uuid NOT NULL DEFAULT gen_random_uuid()
--   order_id uuid NOT NULL
--   tipo text NOT NULL
--   monto numeric NOT NULL
--   motivo text NOT NULL
--   metodo text
--   usuario text
--   created_by uuid
--   created_at timestamp with time zone DEFAULT now()
--   items jsonb
-- replenishments:
--   id uuid NOT NULL DEFAULT gen_random_uuid()
--   product_id uuid
--   product_name text
--   qty integer NOT NULL
--   unit_cost numeric NOT NULL
--   kind text NOT NULL
--   supplier text
--   status text NOT NULL DEFAULT 'pendiente'::text
--   paid boolean NOT NULL DEFAULT false
--   created_by uuid
--   created_at timestamp with time zone DEFAULT now()
-- shipping_attempts:
--   id uuid NOT NULL DEFAULT gen_random_uuid()
--   order_id uuid NOT NULL
--   provider text NOT NULL DEFAULT 'dhl'::text
--   idempotency_key text NOT NULL
--   service_code text
--   request_fingerprint text
--   status text NOT NULL DEFAULT 'pending'::text
--   external_reference text
--   tracking_number text
--   provider_cost numeric
--   currency text
--   quote_ref text
--   error text
--   created_at timestamp with time zone NOT NULL DEFAULT now()
--   updated_at timestamp with time zone NOT NULL DEFAULT now()
