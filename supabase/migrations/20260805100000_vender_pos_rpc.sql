-- VENTA POS ATÓMICA (auditoría C2).
--
-- Antes la Caja hacía DOS escrituras sueltas fire-and-forget: crear la orden pagada
-- y, por separado, descontar el inventario. Si el descuento fallaba (otra caja vendió
-- lo mismo), la venta quedaba cobrada y registrada pero el inventario NUNCA bajaba —
-- y el cajero veía el modal verde de éxito. Esta RPC mete orden + renglones + salidas
-- de inventario en UNA sola transacción: si algún lote no alcanza, se levanta excepción
-- y NADA se crea (ni orden ni movimientos). El cajero recibe el error real.
create or replace function public.vender_pos(
  p_order_id      uuid,
  p_folio         text,
  p_total         numeric,
  p_payment_method text,
  p_doctor_id     uuid,
  p_shipping_meta jsonb,
  p_lines         jsonb,   -- [{product_id, lot_id, qty, unit_price}]
  p_allocations   jsonb    -- [{lot_id, qty}]
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare a jsonb; ln jsonb; lot uuid; qty int;
begin
  if not (public.auth_role() = any (array['admin','pos'])) then
    raise exception 'No autorizado';
  end if;
  -- Idempotencia: si esa orden ya existe (reintento por doble-click/red), no duplica.
  if exists (select 1 from public.orders where id = p_order_id) then
    return false;
  end if;

  -- 1) Descuenta cada lote (falla si dejaría negativo → anti-sobreventa) y registra la
  --    salida 'venta'. Se hace PRIMERO para fallar antes de crear la orden.
  for a in select * from jsonb_array_elements(p_allocations) loop
    lot := (a ->> 'lot_id')::uuid; qty := (a ->> 'qty')::int;
    update public.lots set quantity = quantity - qty where id = lot and quantity - qty >= 0;
    if not found then
      raise exception 'Inventario insuficiente en el lote %', lot;
    end if;
    insert into public.inventory_movements(lot_id, change, reason, reference, created_by)
    values (lot, -qty, 'venta', p_folio, auth.uid());
  end loop;

  -- 2) Crea la orden POS (pagada/entregada) y sus renglones — misma transacción.
  insert into public.orders (id, external_ref, doctor_id, total, currency, status, payment_method, payment_status, invoice_requested, shipping_meta)
  values (p_order_id, p_folio, p_doctor_id, p_total, 'MXN', 'delivered', p_payment_method, 'paid', false, p_shipping_meta);

  for ln in select * from jsonb_array_elements(p_lines) loop
    insert into public.order_items (order_id, product_id, lot_id, qty, unit_price)
    values (
      p_order_id,
      nullif(ln ->> 'product_id','')::uuid,
      nullif(ln ->> 'lot_id','')::uuid,
      (ln ->> 'qty')::int,
      (ln ->> 'unit_price')::numeric
    );
  end loop;

  return true;
end;
$$;

revoke all on function public.vender_pos(uuid, text, numeric, text, uuid, jsonb, jsonb, jsonb) from public, anon;
grant execute on function public.vender_pos(uuid, text, numeric, text, uuid, jsonb, jsonb, jsonb) to authenticated;

do $$
begin
  assert exists (select 1 from pg_proc where proname = 'vender_pos'), 'falta la RPC vender_pos';
  assert not has_function_privilege('anon', 'public.vender_pos(uuid, text, numeric, text, uuid, jsonb, jsonb, jsonb)', 'EXECUTE'), 'anon NO debe ejecutar vender_pos';
end $$;