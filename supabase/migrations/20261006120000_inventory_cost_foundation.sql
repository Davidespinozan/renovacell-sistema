-- ============================================================================
-- FASE 1 · Fundación de COSTO DE INVENTARIO + recepción atómica.
-- ADITIVA. NO toca vender_pos/surtir_pedido/crear_pedido/COGS/reportes (eso es Fase 2).
-- NO backfill de históricos (costos desconocidos permanecen NULL, no se inventan).
--   lots.unit_cost              = costo de adquisición conocido del inventario del lote.
--   inventory_movements.unit_cost = costo unitario congelado del inventario de ESE movimiento.
-- ============================================================================

-- 1) Columnas de costo (nullable, sin default, sin backfill).
alter table public.lots                add column if not exists unit_cost numeric;
alter table public.inventory_movements add column if not exists unit_cost numeric;

-- 2) RPC de recepción/entrada ATÓMICA (reemplaza el patrón inseguro insert+apply del cliente).
--    NO es idempotente (a diferencia de importar_lote): recibir de nuevo el mismo lote SUMA.
--    Política de costo del lote = promedio ponderado SOLO si ambos costos son conocidos
--    (ver blendedLotCost en el frontend). El movimiento congela el costo entrante.
--    Opcional p_replenishment_id: marca la compra 'recibida' en la MISMA transacción.
create or replace function public.recibir_lote(
  p_product uuid,
  p_lote text,
  p_caducidad text,
  p_cantidad int,
  p_ubicacion text,
  p_unit_cost numeric default null,
  p_reason text default 'entrada',
  p_reference text default null,
  p_replenishment_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
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
$fn$;

revoke all on function public.recibir_lote(uuid, text, text, int, text, numeric, text, text, uuid) from public, anon;
grant execute on function public.recibir_lote(uuid, text, text, int, text, numeric, text, text, uuid) to authenticated;
