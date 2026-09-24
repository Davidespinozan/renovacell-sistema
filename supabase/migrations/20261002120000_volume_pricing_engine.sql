-- ============================================================================
-- FASE 1 · Motor de PRECIOS POR VOLUMEN (promo universal por SKU, desde N unidades).
-- Universal (no depende de price_list), por SKU individual, servidor autoridad.
-- BACKWARD-COMPATIBLE: tabla vacía + min_quantity>=2 + wrapper qty=1 ⇒ mismo precio
-- que hoy. NO inserta reglas, NO borra Mayoreo, NO cambia General/sellable/costos.
-- ============================================================================

-- 0) GUARDA previa: la política interim tier-vs-volume (LEAST) asume 0 clientes Mayoreo.
do $mig$
begin
  if (select count(*) from public.profiles where price_list_id is not null) <> 0 then
    raise exception 'ABORT: existen asignaciones price_list_id (tier); resolver tier-vs-volume antes';
  end if;
end $mig$;

-- 1) Tabla dedicada (separada de product_prices = tier de cliente).
create table if not exists public.product_volume_prices (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.products(id) on delete cascade,
  min_quantity int not null check (min_quantity >= 2),
  price numeric not null check (price >= 0),      -- precio UNITARIO autoritativo desde min_quantity
  discount_percent numeric,                        -- provenance/auditoría (nullable)
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, min_quantity)
);
create index if not exists idx_pvp_product on public.product_volume_prices (product_id);

alter table public.product_volume_prices enable row level security;
drop policy if exists pvp_read on public.product_volume_prices;
create policy pvp_read on public.product_volume_prices
  for select to authenticated using (true);
drop policy if exists pvp_write on public.product_volume_prices;
create policy pvp_write on public.product_volume_prices
  for all to authenticated
  using (public.auth_role() = any (array['admin','billing']))
  with check (public.auth_role() = any (array['admin','billing']));

-- 2) precio_de con cantidad (3 args). base = override de lista ∥ General; volumen = mejor
--    regla activa con min_quantity <= qty; resultado = LEAST(base, volumen) [interim].
create or replace function public.precio_de(p_product uuid, p_list uuid, p_qty int)
returns numeric language sql security definer set search_path = public stable as $fn$
  with b as (
    select coalesce(
      (select pp.price from public.product_prices pp where pp.product_id = p_product and pp.list_id = p_list),
      (select pr.price from public.products pr where pr.id = p_product)
    ) as base
  ), v as (
    select (
      select pv.price from public.product_volume_prices pv
      where pv.product_id = p_product and pv.active and pv.min_quantity <= p_qty
      order by pv.min_quantity desc limit 1
    ) as vol
  )
  select case when v.vol is null then b.base else least(b.base, v.vol) end from b, v;
$fn$;
revoke all on function public.precio_de(uuid, uuid, int) from public, anon;
grant execute on function public.precio_de(uuid, uuid, int) to authenticated;

-- 3) Wrapper backward-compatible (2 args) = qty 1 (no alcanza min_quantity>=2 ⇒ base).
create or replace function public.precio_de(p_product uuid, p_list uuid)
returns numeric language sql security definer set search_path = public stable as $fn$
  select public.precio_de(p_product, p_list, 1);
$fn$;
revoke all on function public.precio_de(uuid, uuid) from public, anon;
grant execute on function public.precio_de(uuid, uuid) to authenticated;

-- 4) crear_pedido (firma 7-args IDÉNTICA a 20260923) — único cambio: precio_de(pid,list,q).
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
  v_cname text; v_cphone text; v_meta jsonb;
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
$fn$;
revoke all on function public.crear_pedido(uuid, text, uuid, jsonb, jsonb, boolean, uuid) from public, anon;
grant execute on function public.crear_pedido(uuid, text, uuid, jsonb, jsonb, boolean, uuid) to authenticated;

-- 5) vender_pos (firma 11-args IDÉNTICA a 20260923) — único cambio: precio_de(pid,null,qty).
create or replace function public.vender_pos(
  p_order_id      uuid,
  p_folio         text,
  p_total         numeric,
  p_payment_method text,
  p_doctor_id     uuid,
  p_shipping_meta jsonb,
  p_lines         jsonb,
  p_allocations   jsonb,
  p_invoice_requested boolean default false,
  p_invoice_meta  jsonb default null,
  p_customer_id   uuid default null
) returns boolean language plpgsql security definer set search_path = public as $fn$
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
$fn$;
revoke all on function public.vender_pos(uuid, text, numeric, text, uuid, jsonb, jsonb, jsonb, boolean, jsonb, uuid) from public, anon;
grant execute on function public.vender_pos(uuid, text, numeric, text, uuid, jsonb, jsonb, jsonb, boolean, jsonb, uuid) to authenticated;

-- 6) SELF-TEST / POSTCHECK estructural.
do $mig$
declare n int;
begin
  if not exists (select 1 from information_schema.tables where table_schema='public' and table_name='product_volume_prices') then
    raise exception 'falta product_volume_prices'; end if;
  select count(*) into n from public.product_volume_prices;
  if n <> 0 then raise exception 'product_volume_prices debe iniciar vacía, hay %', n; end if;
  if not exists (select 1 from pg_proc where proname='precio_de' and pronargs=3) then raise exception 'falta precio_de/3'; end if;
  if not exists (select 1 from pg_proc where proname='precio_de' and pronargs=2) then raise exception 'falta wrapper precio_de/2'; end if;
  if not exists (select 1 from pg_proc where proname='crear_pedido' and pronargs=7) then raise exception 'falta crear_pedido/7'; end if;
  if not exists (select 1 from pg_proc where proname='vender_pos' and pronargs=11) then raise exception 'falta vender_pos/11'; end if;
  -- backward-compat: sin reglas, wrapper y qty grande dan el MISMO base
  raise notice 'OK Fase 1: motor de volumen creado; tabla vacía; precio_de/2 y /3 activos';
end $mig$;
