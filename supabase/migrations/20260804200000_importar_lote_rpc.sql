-- IMPORTAR LOTE (migración de inventario) — ATÓMICO e IDEMPOTENTE.
--
-- Antes, el import creaba el lote y su movimiento de entrada en DOS inserts sueltos
-- desde el cliente: si el segundo fallaba, quedaba un lote SIN movimiento (rompe la
-- trazabilidad COFEPRIS) y al reintentar se "omitía" por dedup, así que el movimiento
-- nunca se creaba. Esta RPC los mete en UNA transacción: o entran los dos, o ninguno.
-- Idempotente: si el lote ya existe para ese producto, no duplica (devuelve 'skipped').
create or replace function public.importar_lote(
  p_sku       text,
  p_lote      text,
  p_caducidad text,      -- 'AAAA-MM-DD' o vacío; se castea con tolerancia
  p_cantidad  integer,
  p_ubicacion text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_product uuid;
  v_lot     uuid;
  v_exp     date;
begin
  if public.auth_role() <> all (array['admin','warehouse']) then
    raise exception 'NO_AUTORIZADO: no tienes permiso para importar inventario';
  end if;
  if coalesce(btrim(p_lote), '') = '' then
    raise exception 'LOTE_REQUERIDO: falta el código de lote';
  end if;
  if p_cantidad is null or p_cantidad <= 0 then
    raise exception 'CANTIDAD_INVALIDA: la cantidad debe ser mayor a cero';
  end if;

  select id into v_product from public.products where lower(btrim(sku)) = lower(btrim(p_sku));
  if v_product is null then
    raise exception 'SKU_INEXISTENTE: no existe un producto con SKU %', p_sku;
  end if;

  -- Idempotencia: mismo producto + mismo código de lote ⇒ ya está, no se duplica.
  select id into v_lot from public.lots
   where product_id = v_product and lower(btrim(lot_code)) = lower(btrim(p_lote));
  if v_lot is not null then
    return jsonb_build_object('result', 'skipped');
  end if;

  -- Caducidad tolerante: lo que no parezca fecha entra como NULL (no rompe la fila).
  begin
    v_exp := nullif(btrim(p_caducidad), '')::date;
  exception when others then
    v_exp := null;
  end;

  -- Atómico: el lote y su movimiento de entrada, juntos.
  insert into public.lots (product_id, lot_code, expiry_date, quantity, location)
  values (v_product, btrim(p_lote), v_exp, p_cantidad, coalesce(nullif(btrim(p_ubicacion), ''), 'Bodega central'))
  returning id into v_lot;

  insert into public.inventory_movements (lot_id, change, reason, reference, created_by)
  values (v_lot, p_cantidad, 'entrada', 'MIGRACION', auth.uid());

  return jsonb_build_object('result', 'created', 'lot_id', v_lot);
end;
$$;

revoke all on function public.importar_lote(text, text, text, integer, text) from public, anon;
grant execute on function public.importar_lote(text, text, text, integer, text) to authenticated;

-- Auto-pruebas de la migración.
do $$
begin
  assert exists (select 1 from pg_proc where proname = 'importar_lote'), 'falta la RPC importar_lote';
  assert not has_function_privilege('anon', 'public.importar_lote(text, text, text, integer, text)', 'EXECUTE'), 'anon NO debe ejecutar importar_lote';
  assert has_function_privilege('authenticated', 'public.importar_lote(text, text, text, integer, text)', 'EXECUTE'), 'authenticated SÍ debe ejecutar importar_lote';
end $$;