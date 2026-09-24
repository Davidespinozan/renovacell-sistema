-- ============================================================================
-- FASE 3 · Limpieza de overrides LEGACY de Mayoreo en product_prices.
-- Esas 58 filas se usaron históricamente para codificar promos por cantidad;
-- las promos reales ahora viven en product_volume_prices (173). Se ELIMINAN solo
-- esos overrides. La LISTA price_lists.Mayoreo SE CONSERVA (para precios
-- contractuales por cliente futuros). Idempotente. Guardas abortan ante cualquier
-- discrepancia. NO toca price_lists/products/product_volume_prices/costos/etc.
-- ============================================================================
do $mig$
declare
  v_may uuid := '65c04d8a-a53e-4408-8c4f-3f2bd283c49f';  -- lista Mayoreo (id exacto)
  n int;
begin
  -- G1: la lista Mayoreo existe y NO se borrará.
  if not exists (select 1 from public.price_lists where id = v_may) then
    raise exception 'G1 lista Mayoreo no existe (id inesperado)'; end if;
  -- G2: 0 asignaciones a Mayoreo (nadie la usa como tier hoy).
  if (select count(*) from public.profiles where price_list_id = v_may) <> 0 then
    raise exception 'G2 hay perfiles asignados a Mayoreo'; end if;
  -- G3: promos reales presentes (no borrar legacy si el motor nuevo no está cargado).
  select count(*) into n from public.product_volume_prices;
  if n <> 173 then raise exception 'G3 product_volume_prices <> 173 (%)', n; end if;
  -- G4: cardinalidad EXACTA de overrides Mayoreo = 0 (idempotente) o 58.
  select count(*) into n from public.product_prices where list_id = v_may;
  if n not in (0, 58) then raise exception 'G4 overrides Mayoreo inesperados: %', n; end if;

  if n = 58 then
    delete from public.product_prices where list_id = v_may;
    get diagnostics n = row_count;
    if n <> 58 then raise exception 'G5 se borraron % filas (esperado 58)', n; end if;
  end if;

  -- POSTCHECK: 0 overrides Mayoreo; lista intacta; 173 reglas intactas.
  select count(*) into n from public.product_prices where list_id = v_may;
  if n <> 0 then raise exception 'POST overrides Mayoreo <> 0 (%)', n; end if;
  if not exists (select 1 from public.price_lists where id = v_may) then
    raise exception 'POST la lista Mayoreo fue eliminada (no debía)'; end if;
  select count(*) into n from public.product_volume_prices;
  if n <> 173 then raise exception 'POST product_volume_prices alterado (%)', n; end if;
  raise notice 'OK Fase 3: overrides Mayoreo legacy eliminados; lista Mayoreo conservada';
end $mig$;
