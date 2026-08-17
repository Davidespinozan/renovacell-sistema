-- CFDI en la venta POS (auditoría): la Caja ya puede solicitar factura y capturar datos
-- fiscales de mostrador. La RPC atómica vender_pos ahora acepta y persiste
-- `invoice_requested` + `invoice_meta` en la orden, en vez de forzarlos a false/null.
-- Se agrega la firma de 10 args (los 2 nuevos con default para no romper llamadas viejas);
-- se dropea la de 8 para no dejar dos overloads ambiguos.
drop function if exists public.vender_pos(uuid, text, numeric, text, uuid, jsonb, jsonb, jsonb);

create or replace function public.vender_pos(
  p_order_id      uuid,
  p_folio         text,
  p_total         numeric,
  p_payment_method text,
  p_doctor_id     uuid,
  p_shipping_meta jsonb,
  p_lines         jsonb,   -- [{product_id, lot_id, qty, unit_price}]
  p_allocations   jsonb,   -- [{lot_id, qty}]
  p_invoice_requested boolean default false,
  p_invoice_meta  jsonb default null
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
  if exists (select 1 from public.orders where id = p_order_id) then
    return false;
  end if;

  for a in select * from jsonb_array_elements(p_allocations) loop
    lot := (a ->> 'lot_id')::uuid; qty := (a ->> 'qty')::int;
    update public.lots set quantity = quantity - qty where id = lot and quantity - qty >= 0;
    if not found then
      raise exception 'Inventario insuficiente en el lote %', lot;
    end if;
    insert into public.inventory_movements(lot_id, change, reason, reference, created_by)
    values (lot, -qty, 'venta', p_folio, auth.uid());
  end loop;

  insert into public.orders (id, external_ref, doctor_id, total, currency, status, payment_method, payment_status, invoice_requested, invoice_meta, shipping_meta)
  values (p_order_id, p_folio, p_doctor_id, p_total, 'MXN', 'delivered', p_payment_method, 'paid', coalesce(p_invoice_requested, false), p_invoice_meta, p_shipping_meta);

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

revoke all on function public.vender_pos(uuid, text, numeric, text, uuid, jsonb, jsonb, jsonb, boolean, jsonb) from public, anon;
grant execute on function public.vender_pos(uuid, text, numeric, text, uuid, jsonb, jsonb, jsonb, boolean, jsonb) to authenticated;

do $$
begin
  assert exists (select 1 from pg_proc where proname = 'vender_pos'), 'falta la RPC vender_pos';
  assert not has_function_privilege('anon', 'public.vender_pos(uuid, text, numeric, text, uuid, jsonb, jsonb, jsonb, boolean, jsonb)', 'EXECUTE'), 'anon NO debe ejecutar vender_pos';
end $$;
