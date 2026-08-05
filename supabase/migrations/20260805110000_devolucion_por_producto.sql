-- DEVOLUCIÓN POR PRODUCTO (auditoría H5).
--
-- Antes la devolución era solo por MONTO: no reingresaba el producto al inventario
-- (fuga de stock) ni revertía su costo en el P&L (doble castigo: bajaba la venta pero
-- dejaba el costo). Ahora una 'devolucion' puede traer los RENGLONES que regresan
-- ({item_id, lot_id, qty}): se reingresan a su lote y se registra un movimiento
-- 'devolucion' (+qty) que cuenta como REVERSA de costo de ventas. La 'correccion'
-- (nunca entró producto) NO reingresa nada — misma contabilidad de dinero, distinta de
-- inventario.

alter table public.refunds add column if not exists items jsonb;

-- Se reemplaza la firma (5 args → 6 con p_items). Drop explícito para no dejar overload.
drop function if exists public.registrar_devolucion(uuid, text, numeric, text, text);

create or replace function public.registrar_devolucion(
  p_order_id uuid,
  p_tipo     text,
  p_monto    numeric,
  p_motivo   text,
  p_usuario  text  default null,
  p_items    jsonb default '[]'::jsonb   -- [{item_id?, lot_id, qty}] — solo para 'devolucion'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
  if p_tipo is null or p_tipo <> all (array['devolucion','correccion']) then
    raise exception 'TIPO_INVALIDO: usa devolucion o correccion';
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

  -- Solo 'devolucion' reingresa producto: sube el lote y registra el movimiento
  -- (reference = folio, para que la trazabilidad del pedido lo muestre).
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
$$;

revoke all on function public.registrar_devolucion(uuid, text, numeric, text, text, jsonb) from public, anon;
grant execute on function public.registrar_devolucion(uuid, text, numeric, text, text, jsonb) to authenticated;

do $$
begin
  assert exists (select 1 from information_schema.columns where table_name='refunds' and column_name='items'), 'falta refunds.items';
  assert exists (select 1 from pg_proc where proname='registrar_devolucion'
    and pg_get_function_arguments(oid) like '%p_items%'), 'registrar_devolucion no tiene p_items';
end $$;