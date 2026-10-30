-- ============================================================================
-- Retira la lista de precios "Mayoreo" por cliente (decisión del dueño, 30 oct 2026): el mayoreo ahora es el
-- 2º nivel de "Descuentos por cantidad" (20270218). Nadie tenía la lista asignada, ninguna promoción la usa y
-- su único precio (Botox 100 a $3,900) ya existe como escalón de 10 piezas. El motor de listas (precio_de con
-- lista) se queda intacto; solo queda la lista General. Guardas: si alguien la tiene asignada o una promoción
-- la usa, aborta sin tocar nada.
-- ============================================================================
do $mig$
declare v_lista uuid; n int;
begin
  select id into v_lista from public.price_lists where name = 'Mayoreo' and not is_default;
  if v_lista is null then raise notice 'LISTA_MAYOREO: ya no existe'; return; end if;
  select count(*) into n from public.profiles where price_list_id = v_lista;
  if n > 0 then raise exception 'LISTA_MAYOREO: % perfiles la tienen asignada', n; end if;
  select count(*) into n from public.promociones where listas is not null and v_lista = any(listas);
  if n > 0 then raise exception 'LISTA_MAYOREO: % promociones la usan', n; end if;
  delete from public.product_prices where list_id = v_lista;
  delete from public.price_lists where id = v_lista;
  raise notice 'LISTA_MAYOREO: retirada';
end $mig$;
