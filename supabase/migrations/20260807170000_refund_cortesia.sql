-- 'CORTESÍA' como 3ª intención de devolución (aprendido de sala-studio).
-- Devolución: producto regresa → reingresa inventario. Corrección: error del operador
-- (nunca entró producto) → dinero de vuelta, sin reingreso. Cortesía: se cobró pero NO
-- debía (comp/buena voluntad) → dinero de vuelta, sin reingreso. Mecánica idéntica a
-- 'correccion'; distinta ETIQUETA para la contabilidad y la bitácora.

ALTER TABLE public.refunds DROP CONSTRAINT IF EXISTS refunds_tipo_check;
ALTER TABLE public.refunds ADD  CONSTRAINT refunds_tipo_check
  CHECK (tipo IN ('devolucion', 'correccion', 'cortesia'));

CREATE OR REPLACE FUNCTION public.registrar_devolucion(
  p_order_id uuid,
  p_tipo     text,
  p_monto    numeric,
  p_motivo   text,
  p_usuario  text  default null,
  p_items    jsonb default '[]'::jsonb
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
$$;

revoke all on function public.registrar_devolucion(uuid, text, numeric, text, text, jsonb) from public, anon;
grant execute on function public.registrar_devolucion(uuid, text, numeric, text, text, jsonb) to authenticated;

do $$
begin
  assert exists (select 1 from pg_constraint where conname='refunds_tipo_check'), 'falta el CHECK de tipo';
  raise notice 'Cortesía habilitada como 3ª intención de devolución.';
end $$;
