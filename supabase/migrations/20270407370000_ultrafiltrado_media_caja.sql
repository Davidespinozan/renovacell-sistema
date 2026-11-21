-- ULTRAFILTRADOS POR MEDIA CAJA (21 nov 2026, dueño: «la caja es de 20 viales y se pueden vender 10»).
-- La unidad de venta e inventario de los ultrafiltrados de 2.5 ml pasa a ser la MEDIA CAJA (10 viales):
--   precio ÷ 2 (2 medias = la caja de siempre), escalones de volumen con el doble de unidades y la mitad de precio
--   (mismo dinero: 5 cajas = 10 medias), costos ÷ 2, promociones igual. El inventario se ajusta aparte (×2).
-- Los ultrafiltrados NO entran a la regla «se juntan 10 piezas para medio mayoreo»: su medio en 10 medias equivale al
-- medio en 5 cajas de antes, que nunca se juntaba (columna product_volume_prices.junta).
do $pre$ begin
  if (select count(*) from public.products where sku like 'ULT-%' or sku = 'PEP-001') <> 20
     or exists (select 1 from public.products where (sku like 'ULT-%' or sku = 'PEP-001') and unit ilike 'media caja%') then
    raise exception 'ULT-MEDIA: el catálogo no es el esperado o ya se aplicó';
  end if;
  if position('coalesce(sum(q) filter (where t_medio = 10), 0) junta10' in pg_get_functiondef('public._qty_volumen(jsonb)'::regprocedure)) = 0 then
    raise exception 'ULT-MEDIA: cambió _qty_volumen; revisar el parche';
  end if;
end $pre$;

alter table public.product_volume_prices add column if not exists junta boolean not null default true;
comment on column public.product_volume_prices.junta is 'false = este producto no se junta con otros para el medio mayoreo en 10 (ultrafiltrados por media caja)';

create temp table _ult on commit drop as select id from public.products where sku like 'ULT-%' or sku = 'PEP-001';

update public.products set price = round(price / 2, 2), unit = 'Media caja/10 viales' where id in (select id from _ult);
-- en dos pasos: 5→10 chocaría con el 10 que aún no pasa a 20 (único por producto y cantidad)
update public.product_volume_prices set min_quantity = min_quantity * 2 + 1000000, price = round(price / 2, 2), junta = false, updated_at = now()
 where product_id in (select id from _ult);
update public.product_volume_prices set min_quantity = min_quantity - 1000000 where product_id in (select id from _ult) and min_quantity > 1000000;
update public.product_costs set unit_cost = round(unit_cost / 2, 2), updated_at = now() where product_id in (select id from _ult) and unit_cost is not null;
update public.lots set unit_cost = round(unit_cost / 2, 2) where product_id in (select id from _ult) and unit_cost is not null;
update public.promocion_lineas set min_qty = min_qty * 2, precio = round(precio / 2, 2) where product_id in (select id from _ult);
-- (La ficha de conocimiento «Caja con 20 viales» sigue siendo cierta y es inmutable por versión: no se toca; la IA lee la
--  unidad «Media caja/10 viales» y el precio del producto.)

do $patch$
declare d text;
begin
  d := pg_get_functiondef('public._qty_volumen(jsonb)'::regprocedure);
  d := replace(d, '           (select min(v.min_quantity) from public.product_volume_prices v where v.product_id = l.pid and v.active and v.nivel = ''mayoreo'') t_mayoreo',
                  '           (select min(v.min_quantity) from public.product_volume_prices v where v.product_id = l.pid and v.active and v.nivel = ''mayoreo'') t_mayoreo,
           coalesce((select bool_and(v.junta) from public.product_volume_prices v where v.product_id = l.pid and v.active and v.nivel = ''medio''), true) t_junta   -- ULT-MEDIA');
  d := replace(d, 'coalesce(sum(q) filter (where t_medio = 10), 0) junta10', 'coalesce(sum(q) filter (where t_medio = 10 and t_junta), 0) junta10');
  d := replace(d, 'case when t.t_medio = 10 and r.junta10 >= 10 then 10 else 0 end', 'case when t.t_medio = 10 and t.t_junta and r.junta10 >= 10 then 10 else 0 end');
  execute d;
end $patch$;

do $post$ begin
  if position('ULT-MEDIA' in pg_get_functiondef('public._qty_volumen(jsonb)'::regprocedure)) = 0
     or position('t.t_junta and' in pg_get_functiondef('public._qty_volumen(jsonb)'::regprocedure)) = 0
     or (select count(*) from public.products where unit = 'Media caja/10 viales') <> 20 then
    raise exception 'ULT-MEDIA: no quedó aplicada';
  end if;
end $post$;
