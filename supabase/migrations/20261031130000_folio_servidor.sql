-- ============================================================================
-- FOLIO DE PEDIDO DEL SERVIDOR (D-CC6-11 / M-folio). Un solo modelo canónico para TODO crear_pedido.
--
-- Hallazgo: el folio (`orders.external_ref`) lo generaba el CLIENTE (`S` + 6 últimos dígitos de
-- Date.now(): se repite cada ~16.7 min y no tiene índice único) y `crear_pedido` lo aceptaba tal
-- cual. Aquí, sin tocar la firma ni el flujo de nadie:
--   · `external_ref` pasa a ser ÚNICO (índice parcial; producción hoy no tiene duplicados: 0 pedidos);
--   · `siguiente_folio()` genera `S` + 6 dígitos desde una secuencia (mismo formato legacy, sin
--     reciclar, seguro ante concurrencia, salta cualquier valor ya usado);
--   · `crear_pedido` (texto W1/volume-pricing ÍNTEGRO salvo el folio) genera el folio cuando el
--     cliente no lo manda o cuando el que manda ya existe; el folio efectivo vuelve en la respuesta
--     (`folio`). El checkout canónico (CC-6) manda null → folio del servidor.
--   · El ORIGEN del pedido vive en `shipping_meta.placed_by`/`source`, no en el folio.
-- POS (`vender_pos`, folio `POS-…`) no cambia: queda bajo el mismo índice único (colisión = error, no
-- pedido duplicado).
-- Rollback: supabase/rollback/folio/99_down.sql.
-- ============================================================================
do $pre$
begin
  if to_regprocedure('public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)') is null then raise exception 'FOLIO: falta crear_pedido'; end if;
  if to_regprocedure('public.precio_de(uuid,uuid,int)') is null then raise exception 'FOLIO: falta precio_de(uuid,uuid,int)'; end if;
  if exists (select 1 from public.orders where external_ref is not null group by external_ref having count(*) > 1) then raise exception 'FOLIO: hay folios duplicados en orders; resolver antes de aplicar'; end if;
  if to_regclass('public.orders_folio_seq') is not null then raise exception 'FOLIO: ya aplicada'; end if;
end $pre$;

create sequence public.orders_folio_seq;
-- Arranca por encima del mayor folio numérico `S<n>` existente (evita cruzarse con folios históricos del cliente).
do $seed$
declare v_max bigint;
begin
  select coalesce(max(substring(external_ref from '^S([0-9]{6,})$')::bigint), 100000) into v_max from public.orders where external_ref ~ '^S[0-9]{6,}$';
  perform setval('public.orders_folio_seq', greatest(v_max, 100000));
end $seed$;

create unique index uq_orders_external_ref on public.orders (external_ref) where external_ref is not null;

create or replace function public.siguiente_folio() returns text
  language plpgsql set search_path = public as
$$
declare f text; i int := 0;
begin
  loop
    f := 'S' || lpad(nextval('public.orders_folio_seq')::text, 6, '0');
    exit when not exists (select 1 from public.orders where external_ref = f);
    i := i + 1; if i > 1000 then raise exception 'FOLIO_AGOTADO'; end if;
  end loop;
  return f;
end;
$$;
revoke all on function public.siguiente_folio() from public, anon, authenticated;
revoke all on sequence public.orders_folio_seq from public, anon, authenticated;

-- crear_pedido: texto de 20261002120000 (volume pricing) + folio del servidor. Misma firma, mismos errores, mismo payload (+ 'folio').
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

  v_meta := p_shipping_meta;
  if p_customer_id is not null then
    v_meta := jsonb_set(coalesce(v_meta, '{}'::jsonb), '{customer}', jsonb_build_object('id', p_customer_id, 'name', v_cname, 'phone', v_cphone), true);
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
      values (p_order_id, v_folio, p_doctor_id, p_customer_id, tot, 'MXN', 'pending_payment', 'contra_pedido', 'pending', coalesce(p_invoice_requested, false), v_meta);
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
revoke all on function public.crear_pedido(uuid, text, uuid, jsonb, jsonb, boolean, uuid) from public, anon;
grant execute on function public.crear_pedido(uuid, text, uuid, jsonb, jsonb, boolean, uuid) to authenticated;

do $post$
begin
  if not exists (select 1 from pg_indexes where indexname = 'uq_orders_external_ref') then raise exception 'FOLIO: falta el índice único'; end if;
  if has_function_privilege('anon', 'public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)', 'EXECUTE') then raise exception 'FOLIO: anon puede crear pedidos'; end if;
  if pg_get_functiondef('public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)'::regprocedure) !~ 'precio_de\(pid, list, q\)' then raise exception 'FOLIO: crear_pedido perdió el precio por volumen'; end if;
end $post$;
