-- ============================================================================
-- W1 · ROLLBACK (M4 → M1). Restaura EXACTAMENTE las definiciones de producción
-- capturadas en 00_prod_snapshot.sql (cuerpos copiados de ahí, no reescritos).
--
-- USO: solo con autorización, y SOLO ANTES de la primera operación real con el
-- esquema W1 (borra las tablas/columnas nuevas y lo que contengan). Después de
-- operar en real, la estrategia es corregir hacia adelante.
-- Ejecutar en UNA transacción:  psql -1 -v ON_ERROR_STOP=1 -f 99_down.sql
-- Verificado en local: supabase/tests/db/rollback/w1_rollback.sql
-- lots_quantity_nonneg vuelve a su estado de producción: CHECK (quantity >= 0) NOT VALID
-- (PostgreSQL no permite "des-validar": se elimina y se recrea NOT VALID).
-- ============================================================================

-- ------------------------------------------------------------------ revierte M4
drop trigger if exists trg_shipping_attempts_guard on public.shipping_attempts;
drop trigger if exists trg_replenishments_guard on public.replenishments;
drop function if exists public.shipping_attempts_guard();
drop function if exists public.replenishments_guard();
drop policy if exists replenishments_update_paid on public.replenishments;
revoke update (paid) on public.replenishments from authenticated;
grant all on public.lots, public.inventory_movements, public.order_items, public.replenishments, public.orders
  to anon, authenticated;

CREATE POLICY lots_write_warehouse ON public.lots AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth_role() = ANY (ARRAY['admin'::text, 'warehouse'::text])))
  WITH CHECK ((auth_role() = ANY (ARRAY['admin'::text, 'warehouse'::text])));

CREATE POLICY invmov_insert_ops ON public.inventory_movements AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((auth_role() = ANY (ARRAY['admin'::text, 'warehouse'::text, 'packing'::text, 'pos'::text])));

CREATE POLICY order_items_insert_scoped ON public.order_items AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((auth_role() = ANY (ARRAY['admin'::text, 'pos'::text])));

CREATE POLICY order_items_update_scoped ON public.order_items AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((auth_role() = ANY (ARRAY['admin'::text, 'warehouse'::text, 'packing'::text])))
  WITH CHECK ((auth_role() = ANY (ARRAY['admin'::text, 'warehouse'::text, 'packing'::text])));

CREATE POLICY order_items_delete_scoped ON public.order_items AS PERMISSIVE FOR DELETE TO authenticated
  USING ((auth_role() = 'admin'::text));

CREATE POLICY replenishments_update ON public.replenishments AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((auth_role() = ANY (ARRAY['admin'::text, 'warehouse'::text, 'billing'::text])))
  WITH CHECK ((auth_role() = ANY (ARRAY['admin'::text, 'warehouse'::text, 'billing'::text])));

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

grant execute on function public.apply_lot_movement(uuid, integer, text, text) to public, anon, authenticated;


-- ------------------------------------------------------------------ revierte M3
drop function if exists public.recibir_lote(uuid, uuid, text, date, integer, uuid, text, numeric, text, text);
drop function if exists public.importar_lote(uuid, text, text, text, integer);
drop function if exists public.surtir_pedido(uuid, uuid, jsonb);
drop function if exists public.cerrar_orden_compra(uuid, uuid, text);
drop function if exists public.ajustar_lote(uuid, uuid, integer, text, text, uuid);
drop function if exists public.cancelar_pedido(uuid, uuid, text);
drop function if exists public.confirmar_reingreso(uuid, uuid, jsonb);
drop function if exists public.recibir_devolucion(uuid, uuid, jsonb, text);
drop function if exists public.disponer_devolucion(uuid, jsonb);
drop function if exists public.anular_guia_manual(uuid, uuid, text, text);
drop function if exists public.inv_estado_operacion(uuid);
drop function if exists public.conciliar_inventario();
drop function if exists public.auditoria_bajas(timestamptz, timestamptz);
drop function if exists public._w1_op_begin(uuid, text, jsonb);
drop function if exists public._w1_op_finish(uuid, text, jsonb, jsonb);
drop function if exists public._w1_trusted(boolean);

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

-- ACL originales (prod): recibir_lote / importar_lote sin PUBLIC ni anon; surtir_pedido con PUBLIC.
revoke all on function public.recibir_lote(uuid, text, text, integer, text, numeric, text, text, uuid) from public, anon;
grant execute on function public.recibir_lote(uuid, text, text, integer, text, numeric, text, text, uuid) to authenticated, service_role;
revoke all on function public.importar_lote(text, text, text, integer, text) from public, anon;
grant execute on function public.importar_lote(text, text, text, integer, text) to authenticated, service_role;
grant execute on function public.surtir_pedido(uuid, text, jsonb, jsonb) to public, anon, authenticated, service_role;

-- ------------------------------------------------------------------ revierte M2
alter table public.shipping_attempts drop constraint if exists ck_shipping_attempts_void;
alter table public.shipping_attempts drop constraint if exists ck_shipping_attempts_status;
alter table public.shipping_attempts add constraint ck_shipping_attempts_status check (status = any (array['pending'::text, 'succeeded'::text, 'failed_safe_to_retry'::text, 'unknown_requires_reconciliation'::text]));
alter table public.replenishments drop constraint if exists ck_repl_coherencia;
alter table public.replenishments drop constraint if exists ck_repl_status;
alter table public.replenishments drop constraint if exists ck_repl_received;
alter table public.replenishments drop constraint if exists ck_repl_kind;
alter table public.replenishments drop constraint if exists ck_repl_qty;
alter table public.orders drop constraint if exists ck_orders_status;
alter table public.inventory_movements drop constraint if exists ck_invmov_referencia;
alter table public.inventory_movements drop constraint if exists ck_invmov_reason;
alter table public.inventory_movements drop constraint if exists ck_invmov_change_nonzero;
alter table public.inventory_movements alter column lot_id drop not null;
alter table public.lots drop constraint if exists lots_product_id_fkey;
alter table public.lots add constraint lots_product_id_fkey foreign key (product_id) references public.products(id) on delete cascade;
drop index if exists public.uq_lots_product_code;
alter table public.lots drop constraint if exists ck_lots_code_not_blank;
alter table public.lots alter column location drop default;
alter table public.lots alter column expiry_date drop not null;
alter table public.lots alter column product_id drop not null;
alter table public.lots drop constraint if exists lots_quantity_nonneg;
alter table public.lots add constraint lots_quantity_nonneg check (quantity >= 0) not valid;

-- ------------------------------------------------------------------ revierte M1
drop index if exists public.idx_invmov_lot_created;
alter table public.inventory_movements
  drop column if exists op_id, drop column if exists order_id, drop column if exists order_item_id,
  drop column if exists receipt_id, drop column if exists return_line_id;
alter table public.shipping_attempts
  drop column if exists voided_by, drop column if exists voided_at, drop column if exists void_reference, drop column if exists void_evidence;
alter table public.lots drop column if exists lot_code_norm;
alter table public.replenishments
  drop column if exists received_qty, drop column if exists closed_by, drop column if exists closed_at, drop column if exists close_reason;
drop table if exists public.order_cancellations;
drop table if exists public.stock_return_lines;
drop table if exists public.stock_returns;
drop table if exists public.purchase_receipts;
drop table if exists public.inventory_operations;
drop function if exists public.stock_return_lines_guard();
drop function if exists public.lote_code_norm(text);
drop function if exists public.lote_caducado(date);
drop function if exists public.hoy_local();
