-- P0 (auditoría de cierre) — EL FRONTEND NUNCA ES AUTORIDAD DEL PRECIO.
-- Antes el pedido del doctor se insertaba directo desde el navegador con `total`/`unit_price`
-- del cliente, y Stripe cobraba ese `total`. Aquí:
--   1) `precio_de(product,list)` resuelve el precio AUTORIZADO desde la BD (override de la
--      lista del doctor, o precio base). Único origen de verdad del precio.
--   2) `crear_pedido(...)` calcula unit_price/total en el servidor a partir de {product_id, qty}
--      — NO recibe ningún precio del cliente (imposible por firma) — valida producto activo,
--      cantidad>0, autorización y lista (tomada del PERFIL del doctor, no del cliente), e
--      inserta orden+renglones atómicamente.
--   3) `vender_pos(...)` (POS/Caja) recalcula unit_price/total desde precio base autorizado
--      e IGNORA el p_total/unit_price que manda el cliente.
--   4) RLS: el doctor YA NO puede insertar orders/order_items directo — solo vía el RPC
--      SECURITY DEFINER. Cierra el bypass externo.

-- ── 1) Precio autorizado (única fuente de verdad) ─────────────────────────────
create or replace function public.precio_de(p_product uuid, p_list uuid)
returns numeric language sql security definer set search_path = public stable as $$
  select coalesce(
    (select pp.price from public.product_prices pp where pp.product_id = p_product and pp.list_id = p_list),
    (select pr.price from public.products  pr where pr.id = p_product)
  );
$$;
revoke all on function public.precio_de(uuid, uuid) from public, anon;
grant execute on function public.precio_de(uuid, uuid) to authenticated;

-- ── 2) Alta de pedido con precio calculado en servidor ────────────────────────
create or replace function public.crear_pedido(
  p_order_id          uuid,
  p_folio             text,
  p_doctor_id         uuid,
  p_lines             jsonb,               -- [{product_id, qty}]  SIN precio
  p_shipping_meta     jsonb    default null,
  p_invoice_requested boolean  default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ln jsonb; pid uuid; q int; up numeric; tot numeric := 0;
  list uuid; act boolean; out_items jsonb := '[]'::jsonb;
begin
  -- Autorización: doctor VERIFICADO sobre su propio pedido, o staff admin/pos ("a nombre de").
  if not (
    (public.auth_role() = 'doctor' and p_doctor_id = auth.uid() and public.is_verified())
    or public.auth_role() = any (array['admin','pos'])
  ) then
    raise exception 'No autorizado';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'El pedido no tiene renglones';
  end if;
  -- Idempotencia (reintento por doble-click/red): no duplica.
  if exists (select 1 from public.orders where id = p_order_id) then
    return (select jsonb_build_object('order_id', o.id, 'total', o.total, 'idempotent', true)
            from public.orders o where o.id = p_order_id);
  end if;

  -- La lista de precios se toma del PERFIL del doctor (server-side). El cliente NO la elige.
  select price_list_id into list from public.profiles where id = p_doctor_id;

  for ln in select * from jsonb_array_elements(p_lines) loop
    pid := nullif(ln ->> 'product_id','')::uuid;
    q   := (ln ->> 'qty')::int;
    if pid is null then raise exception 'Producto inválido'; end if;
    if q is null or q <= 0 then raise exception 'Cantidad inválida (debe ser > 0)'; end if;
    select active into act from public.products where id = pid;
    if not found then raise exception 'Producto % no existe', pid; end if;
    if act is not true then raise exception 'Producto % no está activo', pid; end if;
    up := public.precio_de(pid, list);   -- precio AUTORIZADO desde la BD
    if up is null then raise exception 'Producto % sin precio válido', pid; end if;
    tot := tot + up * q;
    out_items := out_items || jsonb_build_array(jsonb_build_object('product_id', pid, 'qty', q, 'unit_price', up));
  end loop;

  insert into public.orders (id, external_ref, doctor_id, total, currency, status, payment_method, payment_status, invoice_requested, shipping_meta)
  values (p_order_id, p_folio, p_doctor_id, tot, 'MXN', 'pending_payment', 'contra_pedido', 'pending', coalesce(p_invoice_requested, false), p_shipping_meta);

  insert into public.order_items (order_id, product_id, qty, unit_price)
  select p_order_id, (i->>'product_id')::uuid, (i->>'qty')::int, (i->>'unit_price')::numeric
  from jsonb_array_elements(out_items) i;

  return jsonb_build_object('order_id', p_order_id, 'total', tot, 'items', out_items);
end;
$$;
revoke all on function public.crear_pedido(uuid, text, uuid, jsonb, jsonb, boolean) from public, anon;
grant execute on function public.crear_pedido(uuid, text, uuid, jsonb, jsonb, boolean) to authenticated;

-- ── 3) POS: recalcular precio/total en servidor (ignora p_total y unit_price del cliente) ──
create or replace function public.vender_pos(
  p_order_id      uuid,
  p_folio         text,
  p_total         numeric,   -- IGNORADO (se conserva por compatibilidad de firma)
  p_payment_method text,
  p_doctor_id     uuid,
  p_shipping_meta jsonb,
  p_lines         jsonb,     -- [{product_id, lot_id, qty, unit_price}]  (unit_price IGNORADO)
  p_allocations   jsonb,     -- [{lot_id, qty}]
  p_invoice_requested boolean default false,
  p_invoice_meta  jsonb default null
) returns boolean language plpgsql security definer set search_path = public as $$
declare a jsonb; ln jsonb; lot uuid; qty int; pid uuid; up numeric; tot numeric := 0; computed jsonb := '[]'::jsonb;
begin
  if not (public.auth_role() = any (array['admin','pos'])) then
    raise exception 'No autorizado';
  end if;
  if exists (select 1 from public.orders where id = p_order_id) then
    return false;  -- idempotencia
  end if;

  -- 1) Descuenta inventario (anti-sobreventa) — primero para fallar antes de crear la orden.
  for a in select * from jsonb_array_elements(p_allocations) loop
    lot := (a ->> 'lot_id')::uuid; qty := (a ->> 'qty')::int;
    update public.lots set quantity = quantity - qty where id = lot and quantity - qty >= 0;
    if not found then raise exception 'Inventario insuficiente en el lote %', lot; end if;
    insert into public.inventory_movements(lot_id, change, reason, reference, created_by)
    values (lot, -qty, 'venta', p_folio, auth.uid());
  end loop;

  -- 2) Recalcula precio/total SERVER-SIDE (precio base autorizado; ignora lo que mande el cliente).
  for ln in select * from jsonb_array_elements(p_lines) loop
    pid := nullif(ln ->> 'product_id','')::uuid; qty := (ln ->> 'qty')::int;
    if pid is null then raise exception 'Producto inválido'; end if;
    if qty is null or qty <= 0 then raise exception 'Cantidad inválida'; end if;
    up := public.precio_de(pid, null);   -- POS/mostrador = precio base autorizado
    if up is null then raise exception 'Producto % sin precio válido', pid; end if;
    tot := tot + up * qty;
    computed := computed || jsonb_build_array(jsonb_build_object('product_id', pid, 'lot_id', ln ->> 'lot_id', 'qty', qty, 'unit_price', up));
  end loop;

  -- 3) Crea orden POS pagada + renglones con el total/precio calculados en servidor.
  insert into public.orders (id, external_ref, doctor_id, total, currency, status, payment_method, payment_status, invoice_requested, invoice_meta, shipping_meta)
  values (p_order_id, p_folio, p_doctor_id, tot, 'MXN', 'delivered', p_payment_method, 'paid', coalesce(p_invoice_requested, false), p_invoice_meta, p_shipping_meta);

  for ln in select * from jsonb_array_elements(computed) loop
    insert into public.order_items (order_id, product_id, lot_id, qty, unit_price)
    values (p_order_id, (ln ->> 'product_id')::uuid, nullif(ln ->> 'lot_id','')::uuid, (ln ->> 'qty')::int, (ln ->> 'unit_price')::numeric);
  end loop;

  return true;
end;
$$;
revoke all on function public.vender_pos(uuid, text, numeric, text, uuid, jsonb, jsonb, jsonb, boolean, jsonb) from public, anon;
grant execute on function public.vender_pos(uuid, text, numeric, text, uuid, jsonb, jsonb, jsonb, boolean, jsonb) to authenticated;

-- ── 4) RLS: el DOCTOR ya no inserta orders/order_items directo (solo vía crear_pedido) ─────
-- admin/pos conservan el INSERT directo para la venta en eventos (createPosOrder) y flujos de staff.
drop policy if exists orders_insert_scoped on public.orders;
create policy orders_insert_scoped on public.orders for insert to authenticated
  with check ( public.auth_role() = any (array['admin','pos']) );

drop policy if exists order_items_insert_scoped on public.order_items;
create policy order_items_insert_scoped on public.order_items for insert to authenticated
  with check ( public.auth_role() = any (array['admin','pos']) );

-- ── 5) Cierre de hueco adyacente: el doctor NO puede auto-asignarse una lista más barata ──
-- crear_pedido toma la lista del PERFIL del doctor; sin esto, un doctor podía hacer
-- UPDATE profiles SET price_list_id = <lista mayoreo> sobre su propia fila y bajar su precio.
-- profiles_guard ya bloqueaba role_id/verified/capabilities para no-admin; se añade price_list_id.
create or replace function public.profiles_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
     or public.auth_role() = 'admin' then
    return new;
  end if;
  if new.role_id is distinct from old.role_id
     or new.verified is distinct from old.verified
     or new.price_list_id is distinct from old.price_list_id
     or (coalesce(new.meta -> 'capabilities', 'null'::jsonb) is distinct from coalesce(old.meta -> 'capabilities', 'null'::jsonb)) then
    raise exception 'No autorizado: no puedes modificar role_id, verified, price_list_id ni capacidades';
  end if;
  return new;
end; $$;

-- ── Self-test ADVERSARIAL (aborta el deploy si el precio no lo manda la BD) ────────────────
do $$
declare v_pid uuid; v_list uuid; v_base numeric; v_over numeric;
begin
  assert exists (select 1 from pg_proc where proname = 'crear_pedido'), 'falta crear_pedido';
  assert exists (select 1 from pg_proc where proname = 'precio_de'), 'falta precio_de';
  assert not has_function_privilege('anon', 'public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean)', 'EXECUTE'), 'anon NO debe ejecutar crear_pedido';

  -- Producto de $13,500; una lista distinta con override de $1,000.
  v_pid := gen_random_uuid(); v_list := gen_random_uuid();
  insert into public.products (id, sku, name, price, active) values (v_pid, 'ZZ_TEST_'||v_pid, 'ZZ_TEST_PRICE', 13500, true);
  insert into public.price_lists (id, name, is_default, sort) values (v_list, 'ZZ_TEST_LIST', false, 999);
  insert into public.product_prices (product_id, list_id, price) values (v_pid, v_list, 1000);

  v_base := public.precio_de(v_pid, null);
  v_over := public.precio_de(v_pid, v_list);
  -- El precio SIEMPRE viene de la BD, jamás del cliente:
  assert v_base = 13500, 'precio base debe ser 13500, fue '||coalesce(v_base::text,'null');
  assert v_over = 1000,  'precio de lista debe ser 1000, fue '||coalesce(v_over::text,'null');
  assert public.precio_de(gen_random_uuid(), null) is null, 'producto inexistente debe dar precio null (rechazable)';

  -- limpiar datos de prueba
  delete from public.product_prices where product_id = v_pid;
  delete from public.price_lists where id = v_list;
  delete from public.products where id = v_pid;
end $$;
