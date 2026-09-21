-- FASE 2 customers — soporte transaccional customer-only en crear_pedido y vender_pos.
-- ADITIVO: la rama legacy (doctor_id) queda idéntica. Se agrega p_customer_id, se valida el
-- customer server-side (existe + active), se persiste orders.customer_id y se hace snapshot mínimo
-- del nombre/teléfono en shipping_meta.customer (historial estable). El precio SIGUE server-side.

-- ── crear_pedido (nueva firma con p_customer_id) ──────────────────────────────
drop function if exists public.crear_pedido(uuid, text, uuid, jsonb, jsonb, boolean);
create or replace function public.crear_pedido(
  p_order_id          uuid,
  p_folio             text,
  p_doctor_id         uuid,
  p_lines             jsonb,               -- [{product_id, qty}]  SIN precio
  p_shipping_meta     jsonb    default null,
  p_invoice_requested boolean  default false,
  p_customer_id       uuid     default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  ln jsonb; pid uuid; q int; up numeric; tot numeric := 0;
  list uuid; act boolean; out_items jsonb := '[]'::jsonb;
  v_cname text; v_cphone text; v_meta jsonb;
begin
  -- Identidad: al menos doctor O customer (contra pedido siempre tiene destinatario).
  if p_doctor_id is null and p_customer_id is null then
    raise exception 'FALTA_IDENTIDAD: el pedido requiere doctor_id o customer_id';
  end if;
  -- Autorización SIN cambios: el doctor solo como sí mismo (verificado); staff admin/pos "a nombre de".
  -- customer-only ⇒ doctor_id null ⇒ la rama doctor es falsa ⇒ exige admin/pos.
  if not (
    (public.auth_role() = 'doctor' and p_doctor_id = auth.uid() and public.is_verified())
    or public.auth_role() = any (array['admin','pos'])
  ) then
    raise exception 'No autorizado';
  end if;
  -- customer_id no sustituye autorización: se valida existencia/active, no da permisos.
  if p_customer_id is not null then
    select full_name, phone into v_cname, v_cphone from public.customers where id = p_customer_id and active = true;
    if not found then raise exception 'CUSTOMER_INEXISTENTE: customer inexistente o inactivo'; end if;
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'El pedido no tiene renglones';
  end if;
  if exists (select 1 from public.orders where id = p_order_id) then
    return (select jsonb_build_object('order_id', o.id, 'total', o.total, 'idempotent', true)
            from public.orders o where o.id = p_order_id);
  end if;

  -- Lista de precios: del PERFIL del doctor (server-side). customer-only ⇒ sin doctor ⇒ list NULL
  -- ⇒ precio_de(pid, NULL) = precio base/General. El cliente nunca elige lista ni precio.
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
    up := public.precio_de(pid, list);
    if up is null then raise exception 'Producto % sin precio válido', pid; end if;
    tot := tot + up * q;
    out_items := out_items || jsonb_build_array(jsonb_build_object('product_id', pid, 'qty', q, 'unit_price', up));
  end loop;

  -- Snapshot mínimo del customer (nombre/teléfono) para que el historial no cambie si se edita.
  v_meta := p_shipping_meta;
  if p_customer_id is not null then
    v_meta := jsonb_set(coalesce(v_meta, '{}'::jsonb), '{customer}', jsonb_build_object('id', p_customer_id, 'name', v_cname, 'phone', v_cphone), true);
  end if;

  insert into public.orders (id, external_ref, doctor_id, customer_id, total, currency, status, payment_method, payment_status, invoice_requested, shipping_meta)
  values (p_order_id, p_folio, p_doctor_id, p_customer_id, tot, 'MXN', 'pending_payment', 'contra_pedido', 'pending', coalesce(p_invoice_requested, false), v_meta);

  insert into public.order_items (order_id, product_id, qty, unit_price)
  select p_order_id, (i->>'product_id')::uuid, (i->>'qty')::int, (i->>'unit_price')::numeric
  from jsonb_array_elements(out_items) i;

  return jsonb_build_object('order_id', p_order_id, 'total', tot, 'items', out_items);
end;
$$;
revoke all on function public.crear_pedido(uuid, text, uuid, jsonb, jsonb, boolean, uuid) from public, anon;
grant execute on function public.crear_pedido(uuid, text, uuid, jsonb, jsonb, boolean, uuid) to authenticated;

-- ── vender_pos (nueva firma con p_customer_id) ────────────────────────────────
drop function if exists public.vender_pos(uuid, text, numeric, text, uuid, jsonb, jsonb, jsonb, boolean, jsonb);
create or replace function public.vender_pos(
  p_order_id      uuid,
  p_folio         text,
  p_total         numeric,   -- IGNORADO
  p_payment_method text,
  p_doctor_id     uuid,
  p_shipping_meta jsonb,
  p_lines         jsonb,
  p_allocations   jsonb,
  p_invoice_requested boolean default false,
  p_invoice_meta  jsonb default null,
  p_customer_id   uuid default null
) returns boolean language plpgsql security definer set search_path = public as $$
declare a jsonb; ln jsonb; lot uuid; qty int; pid uuid; up numeric; tot numeric := 0; computed jsonb := '[]'::jsonb;
  v_cname text; v_cphone text; v_meta jsonb;
begin
  if not (public.auth_role() = any (array['admin','pos'])) then
    raise exception 'No autorizado';
  end if;
  -- Mostrador anónimo (doctor y customer NULL) SIGUE permitido. Solo si viene customer, se valida.
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
    up := public.precio_de(pid, null);
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
$$;
revoke all on function public.vender_pos(uuid, text, numeric, text, uuid, jsonb, jsonb, jsonb, boolean, jsonb, uuid) from public, anon;
grant execute on function public.vender_pos(uuid, text, numeric, text, uuid, jsonb, jsonb, jsonb, boolean, jsonb, uuid) to authenticated;

-- ── SELF-TEST estructural ─────────────────────────────────────────────────────
do $$
declare v_cp oid; v_vp oid;
begin
  select oid into v_cp from pg_proc where proname='crear_pedido' and pronargs=7;
  if v_cp is null then raise exception 'crear_pedido: falta la firma de 7 args (p_customer_id)'; end if;
  if not ('p_customer_id' = any (select unnest(proargnames) from pg_proc where oid=v_cp)) then
    raise exception 'crear_pedido: falta el argumento p_customer_id'; end if;
  select oid into v_vp from pg_proc where proname='vender_pos' and pronargs=11;
  if v_vp is null then raise exception 'vender_pos: falta la firma de 11 args (p_customer_id)'; end if;
  if not ('p_customer_id' = any (select unnest(proargnames) from pg_proc where oid=v_vp)) then
    raise exception 'vender_pos: falta el argumento p_customer_id'; end if;
  -- no debe quedar la firma vieja (evita overload ambiguo)
  if exists (select 1 from pg_proc where proname='crear_pedido' and pronargs=6) then
    raise exception 'crear_pedido: firma vieja de 6 args sigue presente (overload ambiguo)'; end if;
  if exists (select 1 from pg_proc where proname='vender_pos' and pronargs=10) then
    raise exception 'vender_pos: firma vieja de 10 args sigue presente (overload ambiguo)'; end if;
  -- anon no ejecuta
  if has_function_privilege('anon', v_cp, 'EXECUTE') then raise exception 'anon NO debe ejecutar crear_pedido'; end if;
  if has_function_privilege('anon', v_vp, 'EXECUTE') then raise exception 'anon NO debe ejecutar vender_pos'; end if;
end $$;
