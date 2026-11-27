-- ============================================================================
-- NIVELES DE INVENTARIO POR PRODUCTO (27 nov 2026, dueño: «Dirección no puede ajustar el inventario sugerido, y si el
-- stock es suficiente le impide comprar más; eso está mal»).
--   Hasta hoy el sistema usaba los mismos dos números para TODOS los productos: «Bajo» cuando quedan 20 o menos, y
--   sugería comprar hasta completar 60. Un producto que se vende 200 al mes y otro que se vende 2 no pueden compartirlos.
--   Ahora Dirección fija, por producto, el MÍNIMO (cuándo avisar) y el IDEAL (hasta cuánto reponer). Sin valor propio,
--   el producto sigue con 20 y 60.
--   · Se guardan en `product_costs.metadata` (llaves `stock_min` y `stock_ideal`, en unidades internas). Esa tabla es
--     privada (solo Dirección y Facturación) y no sale en ninguna vista. NO van en `products.metadata`: esa columna se
--     publica en el catálogo del sitio (`catalog_public`) y los niveles quedarían a la vista de cualquiera.
--   · `stock_nivel_guardar`: solo Dirección; valida, escribe las dos llaves sin tocar costo ni proveedor, y deja rastro
--     en la bitácora. Con los dos valores vacíos el producto regresa al nivel general.
--   · `stock_niveles`: los lee el personal que ve inventario (Dirección, Facturación, Almacén, Empaque), para que
--     «Bajo» signifique lo mismo en todas sus pantallas. Solo devuelve los productos con nivel propio y solo esos dos
--     números (nunca el costo).
-- Solo crea dos funciones (sin tablas, columnas ni índices). El bloqueo de «comprar con stock suficiente» era solo de
-- pantalla: `crear_orden_compra` nunca lo tuvo.
-- Rollback: drop function public.stock_nivel_guardar(uuid, integer, integer); drop function public.stock_niveles();
--           update public.product_costs set metadata = metadata - 'stock_min' - 'stock_ideal' where metadata ?| array['stock_min','stock_ideal'];
-- ============================================================================
do $pre$ begin
  if to_regprocedure('public.stock_niveles()') is not null then raise exception 'STOCK-NIVELES: ya aplicada'; end if;
  if to_regprocedure('public.log_audit(text, text, text, text)') is null then raise exception 'STOCK-NIVELES: falta la bitácora'; end if;
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'product_costs' and column_name = 'metadata' and data_type = 'jsonb') then
    raise exception 'STOCK-NIVELES: product_costs.metadata no existe o cambió'; end if;
  if exists (select 1 from pg_views where schemaname = 'public' and definition ilike '%product_costs%') then
    raise exception 'STOCK-NIVELES: hay una vista que publica product_costs; revisar antes de guardar niveles ahí'; end if;
end $pre$;

create function public.stock_niveles()
 returns table (product_id uuid, minimo integer, ideal integer)
 language sql stable security definer set search_path to 'public'
as $function$
  select c.product_id, (c.metadata ->> 'stock_min')::integer, (c.metadata ->> 'stock_ideal')::integer
    from public.product_costs c
   where auth.uid() is not null and public.auth_role() in ('admin', 'billing', 'warehouse', 'packing')
     and (c.metadata ->> 'stock_min') ~ '^\d{1,7}$' and (c.metadata ->> 'stock_ideal') ~ '^\d{1,7}$';
$function$;

create function public.stock_nivel_guardar(p_product uuid, p_minimo integer, p_ideal integer)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_nombre text; v_antes jsonb;
begin
  if auth.uid() is null or public.auth_role() is distinct from 'admin' then raise exception 'NO_AUTORIZADO: solo Dirección ajusta los niveles de inventario'; end if;
  select name into v_nombre from public.products where id = p_product;
  if v_nombre is null then raise exception 'PRODUCTO_INEXISTENTE'; end if;
  select jsonb_build_object('minimo', metadata ->> 'stock_min', 'ideal', metadata ->> 'stock_ideal') into v_antes from public.product_costs where product_id = p_product;

  if p_minimo is null and p_ideal is null then
    -- Sin valores: el producto regresa al nivel general. El costo y el proveedor no se tocan.
    update public.product_costs set metadata = (coalesce(metadata, '{}'::jsonb) - 'stock_min' - 'stock_ideal'), updated_at = now() where product_id = p_product;
  else
    if p_minimo is null or p_ideal is null then raise exception 'NIVEL_INVALIDO: escribe los dos valores, el mínimo y el ideal'; end if;
    if p_minimo < 0 or p_ideal < 1 or p_ideal > 1000000 then raise exception 'NIVEL_INVALIDO: el mínimo no puede ser negativo y el ideal debe ser de 1 a 1,000,000'; end if;
    if p_ideal < p_minimo then raise exception 'NIVEL_INVALIDO: el ideal no puede ser menor que el mínimo'; end if;
    insert into public.product_costs (product_id, metadata) values (p_product, jsonb_build_object('stock_min', p_minimo, 'stock_ideal', p_ideal))
    on conflict (product_id) do update
      set metadata = coalesce(public.product_costs.metadata, '{}'::jsonb) || jsonb_build_object('stock_min', p_minimo, 'stock_ideal', p_ideal), updated_at = now();
  end if;

  perform public.log_audit('Niveles de inventario', v_nombre,
    jsonb_build_object('antes', coalesce(v_antes, '{}'::jsonb), 'ahora', jsonb_build_object('minimo', p_minimo, 'ideal', p_ideal))::text, null);
  return jsonb_build_object('product_id', p_product, 'minimo', p_minimo, 'ideal', p_ideal);
end;
$function$;

revoke all on function public.stock_niveles() from public, anon;
revoke all on function public.stock_nivel_guardar(uuid, integer, integer) from public, anon;
grant execute on function public.stock_niveles() to authenticated, service_role;
grant execute on function public.stock_nivel_guardar(uuid, integer, integer) to authenticated, service_role;
comment on function public.stock_niveles() is 'Mínimo e ideal de inventario por producto (solo los que tienen nivel propio). Lo lee el personal de inventario.';
comment on function public.stock_nivel_guardar(uuid, integer, integer) is 'Dirección fija el mínimo (cuándo avisar) y el ideal (hasta cuánto reponer) de un producto; ambos NULL = nivel general.';
