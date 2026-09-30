-- ============================================================================
-- W2-C · SNAPSHOT previo a C1–C4. Restaura VERBATIM lo que W2-C extendió y recrea
-- la custodia legacy. Se ejecuta ANTES de 99_down.sql.
--
-- Contenido:
--   · ajustar_lote   (W1 M3, sin piso de custodia)
--   · surtir_pedido  (W2 N3, sin piso de custodia)
--   · vender_pos     (W2 N3, 12 argumentos, sin custodia)
--   · product_stock  (vista previa: Σ lots.quantity con current_date)
--   · events / consignment_stock / event_sell + sus políticas originales
-- ============================================================================

-- ─────────────────────────── ajustar_lote (previo)
create or replace function public.ajustar_lote(
  p_op_id      uuid,
  p_lot        uuid,
  p_delta      integer,
  p_kind       text,              -- merma | ajuste | correccion_recepcion
  p_reason     text,
  p_receipt_id uuid default null
) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_role text := public.auth_role(); v_uid uuid := auth.uid();
  v_req jsonb; v_prev jsonb; v_res jsonb;
  v_lot record; v_rc record; v_rep record; v_corr int; v_new_rec int; v_new_status text;
begin
  if p_kind is null or p_kind not in ('merma','ajuste','correccion_recepcion') then
    raise exception 'TIPO_AJUSTE_INVALIDO: usa merma, ajuste o correccion_recepcion';
  end if;
  if p_delta is null or p_delta = 0 then raise exception 'CANTIDAD_INVALIDA: el ajuste no puede ser cero'; end if;
  if p_kind = 'merma' and p_delta > 0 then raise exception 'MERMA_DEBE_SER_NEGATIVA: una merma solo da de baja'; end if;
  if p_kind = 'correccion_recepcion' and p_delta > 0 then
    raise exception 'CORRECCION_DEBE_SER_NEGATIVA: si faltó capturar, registra otra recepción';
  end if;
  if p_delta > 0 or p_kind = 'correccion_recepcion' then
    if v_role <> 'admin' then
      raise exception 'NO_AUTORIZADO: % positivo/corrección de recepción requiere Dirección', p_kind;
    end if;
  elsif not (v_role = any (array['admin','warehouse','packing'])) then
    raise exception 'NO_AUTORIZADO: sin permiso para dar de baja inventario';
  end if;

  v_req := jsonb_build_object('lot', p_lot, 'delta', p_delta, 'kind', p_kind, 'reason', p_reason, 'receipt', p_receipt_id);
  v_prev := public._w1_op_begin(p_op_id, 'ajuste', v_req);
  if v_prev is not null then return v_prev; end if;

  if nullif(btrim(p_reason), '') is null then raise exception 'MOTIVO_REQUERIDO: toda baja/ajuste requiere motivo'; end if;
  if p_lot is null then raise exception 'LOTE_REQUERIDO'; end if;
  select * into v_lot from public.lots where id = p_lot for update;
  if not found then raise exception 'LOTE_INEXISTENTE'; end if;

  if p_kind = 'correccion_recepcion' then
    if p_receipt_id is null then raise exception 'RECEPCION_REQUERIDA: la corrección se liga a su recepción'; end if;
    select * into v_rc from public.purchase_receipts where id = p_receipt_id;
    if not found then raise exception 'RECEPCION_INEXISTENTE'; end if;
    if v_rc.lot_id <> p_lot then raise exception 'RECEPCION_DE_OTRO_LOTE'; end if;
    select coalesce(sum(-change), 0) into v_corr from public.inventory_movements
     where receipt_id = p_receipt_id and reason = 'correccion_recepcion';
    if v_corr + (-p_delta) > v_rc.qty then
      raise exception 'CORRECCION_EXCEDE_RECEPCION: recibido %, ya corregido %, solicitado %', v_rc.qty, v_corr, -p_delta;
    end if;
    if v_rc.kind = 'orden' then
      select * into v_rep from public.replenishments where id = v_rc.replenishment_id for update;
      v_new_rec := v_rep.received_qty - (-p_delta);
      v_new_status := case
        when v_rep.status in ('recibida','cerrada_incompleta') then 'cerrada_incompleta'  -- nunca se reabre
        when v_new_rec = 0 then 'pendiente'
        else 'parcial' end;
      perform public._w1_trusted(true);
      update public.replenishments
         set received_qty = v_new_rec,
             status       = v_new_status,
             closed_by    = case when v_rep.status = 'recibida' then v_uid else closed_by end,
             closed_at    = case when v_rep.status = 'recibida' then now() else closed_at end,
             close_reason = case when v_rep.status = 'recibida' then 'Corrección de recepción: ' || btrim(p_reason) else close_reason end
       where id = v_rep.id;
      perform public._w1_trusted(false);
    end if;
  elsif p_receipt_id is not null then
    raise exception 'RECEPCION_NO_APLICA: solo la corrección de recepción referencia una recepción';
  end if;

  if p_delta < 0 then
    update public.lots set quantity = quantity + p_delta where id = p_lot and quantity + p_delta >= 0;
    if not found then
      raise exception 'INVENTARIO_INSUFICIENTE: el lote % tiene % y la baja es de %', v_lot.lot_code, v_lot.quantity, -p_delta;
    end if;
  else
    update public.lots set quantity = quantity + p_delta where id = p_lot;
  end if;

  insert into public.inventory_movements (lot_id, change, reason, reference, created_by, op_id, receipt_id)
  values (p_lot, p_delta, p_kind, btrim(p_reason), v_uid, p_op_id, p_receipt_id);

  v_res := jsonb_build_object('status', 'applied', 'lot_id', p_lot, 'delta', p_delta, 'kind', p_kind,
             'quantity', v_lot.quantity + p_delta);
  return public._w1_op_finish(p_op_id, 'ajuste', v_req, v_res);
end;
$$;
-- ─────────────────────────── surtir_pedido (previo)
create or replace function public.surtir_pedido(p_op_id uuid, p_order uuid, p_allocations jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$
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
  -- W2 · F-7: se surte lo LIBERADO, no lo "marcado como pagado". Un pedido a crédito
  -- se surte con payment_status='pending' y sin tocar orders.status.
  if not public.pedido_liberado_para_surtir(p_order) then
    raise exception 'PEDIDO_NO_LIBERADO: el pedido no tiene cobro suficiente ni crédito autorizado';
  end if;
  if v_ord.status not in ('pending_payment','paid','picking') then
    raise exception 'PEDIDO_NO_SURTIBLE: el pedido está %', v_ord.status;
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
$$;
-- ─────────────────────────── vender_pos (previo, 12 argumentos)
drop function if exists public.vender_pos(uuid, text, numeric, text, uuid, jsonb, jsonb, jsonb, boolean, jsonb, uuid, numeric, uuid);
create or replace function public.vender_pos(p_order_id uuid, p_folio text, p_total numeric, p_payment_method text,
  p_doctor_id uuid, p_shipping_meta jsonb, p_lines jsonb, p_allocations jsonb,
  p_invoice_requested boolean default false, p_invoice_meta jsonb default null::jsonb, p_customer_id uuid default null::uuid,
  p_efectivo_recibido numeric default null)
returns boolean
  language plpgsql security definer set search_path = public as
$$
declare
  v_uid uuid := auth.uid();
  v_req jsonb; v_prev jsonb;
  a record; ln record; v_nlines int; qty int; pid uuid; up numeric; tot numeric := 0;
  v_items uuid[] := '{}'; v_item uuid; v_bad int;
  v_cname text; v_cphone text; v_meta jsonb; v_metodo text;
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

  if p_efectivo_recibido is not null and v_metodo = 'efectivo' and p_efectivo_recibido < tot then
    raise exception 'EFECTIVO_INSUFICIENTE: recibido % para un total de %', p_efectivo_recibido, tot;
  end if;

  v_meta := p_shipping_meta;
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

  for a in select x.line_index, x.lot_id, x.qty from jsonb_to_recordset(p_allocations) as x(line_index int, lot_id uuid, qty int) loop
    update public.lots set quantity = quantity - a.qty where id = a.lot_id and quantity - a.qty >= 0;
    if not found then raise exception 'Inventario insuficiente en el lote %', a.lot_id; end if;
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
$$;grant execute on function public.vender_pos(uuid, text, numeric, text, uuid, jsonb, jsonb, jsonb, boolean, jsonb, uuid, numeric)
  to authenticated, service_role;

-- ─────────────────────────── product_stock (vista previa)
create or replace view public.product_stock as
  select product_id, coalesce(sum(quantity), 0)::int as available
    from public.lots
   where product_id is not null
     and (expiry_date is null or expiry_date >= current_date)
     and (public.auth_role() <> 'doctor' or public.is_verified())
   group by product_id;
revoke all on public.product_stock from anon, public;
grant select on public.product_stock to authenticated;

-- ─────────────────────────── custodia LEGACY (recreada tal como estaba)
create table if not exists public.events (
  id uuid default gen_random_uuid() primary key,
  name text not null,
  venue text,
  date text,
  status text not null default 'activo',
  members jsonb not null default '[]'::jsonb,
  items jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz default now()
);
alter table public.events enable row level security;
grant all on public.events to anon, authenticated, service_role;
drop policy if exists events_all on public.events;
create policy events_all on public.events for all to authenticated
  using (public.auth_role() = 'admin' or (members ? (auth.jwt() ->> 'email')))
  with check (public.auth_role() = 'admin' or (members ? (auth.jwt() ->> 'email')));

create table if not exists public.consignment_stock (
  id uuid default gen_random_uuid() primary key,
  vendor text not null,
  product_id uuid references public.products(id),
  assigned integer not null default 0,
  sold integer not null default 0,
  updated_at timestamptz default now(),
  lots jsonb not null default '[]'::jsonb,
  unique (vendor, product_id)
);
alter table public.consignment_stock enable row level security;
grant all on public.consignment_stock to anon, authenticated, service_role;
drop policy if exists consignment_all on public.consignment_stock;
create policy consignment_all on public.consignment_stock for all to authenticated
  using (public.auth_role() = any (array['admin','warehouse','packing']) or vendor = (auth.jwt() ->> 'email'))
  with check (public.auth_role() = any (array['admin','warehouse','packing']) or vendor = (auth.jwt() ->> 'email'));

CREATE OR REPLACE FUNCTION public.event_sell(p_event uuid, p_sales jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_items jsonb; sale jsonb; i int; it jsonb; assigned int; sold int; qty int; pid text; found boolean;
BEGIN
  IF NOT (public.auth_role() = ANY (ARRAY['admin','pos'])) THEN RAISE EXCEPTION 'No autorizado'; END IF;
  SELECT e.items INTO v_items FROM public.events e WHERE e.id = p_event FOR UPDATE;
  IF v_items IS NULL THEN RETURN false; END IF;
  -- Verifica TODO primero (todo-o-nada).
  FOR sale IN SELECT * FROM jsonb_array_elements(p_sales) LOOP
    pid := sale ->> 'product_id'; qty := (sale ->> 'qty')::int; found := false;
    FOR i IN 0 .. jsonb_array_length(v_items) - 1 LOOP
      it := v_items -> i;
      IF (it ->> 'product_id') = pid THEN
        assigned := COALESCE((it ->> 'assigned')::int, 0); sold := COALESCE((it ->> 'sold')::int, 0);
        IF sold + qty > assigned THEN RETURN false; END IF;
        found := true;
      END IF;
    END LOOP;
    IF NOT found THEN RETURN false; END IF;
  END LOOP;
  -- Aplica.
  FOR sale IN SELECT * FROM jsonb_array_elements(p_sales) LOOP
    pid := sale ->> 'product_id'; qty := (sale ->> 'qty')::int;
    FOR i IN 0 .. jsonb_array_length(v_items) - 1 LOOP
      it := v_items -> i;
      IF (it ->> 'product_id') = pid THEN
        sold := COALESCE((it ->> 'sold')::int, 0);
        v_items := jsonb_set(v_items, ARRAY[i::text, 'sold'], to_jsonb(sold + qty));
      END IF;
    END LOOP;
  END LOOP;
  UPDATE public.events SET items = v_items WHERE id = p_event;
  RETURN true;
END; $$;
grant execute on function public.event_sell(uuid, jsonb) to authenticated;
