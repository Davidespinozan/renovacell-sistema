-- ============================================================================
-- MAYOREO POR 50 CAJAS DEL PEDIDO (24 nov 2026, Ventas: «la regla debe ser 50 cajas de producto en general; no entran
-- las agujas H36, H24 y HR (nano) ni nada de metabólico: Mounjaro, Wegovy y Saxenda»).
--   · Nueva vía al mayoreo: si el pedido suma 50 CAJAS o más entre los productos que SÍ juntan, todos esos productos
--     van a su mejor precio por cantidad (como cuando uno llega a su mayoreo). Una media caja cuenta como 1/2 caja.
--   · products.junta_mayoreo = false (agujas H24/H36/HR y Mounjaro/Wegovy/Saxenda): no suman a las 50 cajas y no
--     bajan a mayoreo por el pedido; solo con SU propia cantidad (su escalón de siempre).
--   · Se conservan las reglas del 30 oct: un producto que llega a su mayoreo pasa a mayoreo a los demás (ahora solo a
--     los que juntan) y el medio en 10 se sigue juntando igual.
-- Rollback: supabase/rollback/mayoreo_50_cajas/99_down.sql
-- ============================================================================
do $pre$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'products' and column_name = 'junta_mayoreo') then
    raise exception 'MAYOREO-50: ya aplicada'; end if;
  if position('coalesce(bool_or(q >= t_mayoreo), false) mayoreo' in pg_get_functiondef('public._qty_volumen(jsonb)'::regprocedure)) = 0 then
    raise exception 'MAYOREO-50: _qty_volumen cambió; revisar'; end if;
end $pre$;

alter table public.products add column junta_mayoreo boolean not null default true;
comment on column public.products.junta_mayoreo is 'false = no suma a las 50 cajas del mayoreo del pedido ni baja a mayoreo por el pedido (agujas H24/H36/HR, Mounjaro, Wegovy, Saxenda)';

update public.products set junta_mayoreo = false
 where sku in ('APA-003', 'APA-004', 'APA-005')
    or (category = 'Metabólicos' and (name ilike 'MOUNJARO%' or name ilike 'WEGOVY%' or name ilike 'SAXENDA%'));

do $chk$ declare n int; begin
  select count(*) into n from public.products where not junta_mayoreo;
  if n <> 17 then raise exception 'MAYOREO-50: se esperaban 17 productos fuera de la regla y son %', n; end if;
  if exists (select 1 from public.products where sku = 'MET-001' and not junta_mayoreo) then raise exception 'MAYOREO-50: Stoplip no debe quedar fuera'; end if;
end $chk$;

-- La app lee el catálogo por products_safe: se agrega la columna al final (mismo contenido de siempre).
create or replace view public.products_safe as
 SELECT id, sku, name, line, category, description,
        CASE WHEN ((auth_role() <> 'doctor'::text) OR is_verified()) THEN price ELSE NULL::numeric END AS price,
        unit, image_url, active, show_landing, show_portal, family, parent_product_id, sellable,
        junta_mayoreo
   FROM products
  WHERE (auth.uid() IS NOT NULL);

create or replace function public._qty_volumen(p_lines jsonb)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with l as (
    select (x ->> 'product_id')::uuid pid, sum((x ->> 'qty')::int) q
      from jsonb_array_elements(case when jsonb_typeof(p_lines) = 'array' then p_lines else '[]'::jsonb end) x
     where nullif(x ->> 'product_id', '') is not null and (x ->> 'qty') ~ '^[0-9]+$'
     group by 1),
  t as (
    select l.pid, l.q,
           (select max(v.min_quantity) from public.product_volume_prices v where v.product_id = l.pid and v.active) t_max,
           (select min(v.min_quantity) from public.product_volume_prices v where v.product_id = l.pid and v.active and v.nivel = 'medio') t_medio,
           (select min(v.min_quantity) from public.product_volume_prices v where v.product_id = l.pid and v.active and v.nivel = 'mayoreo') t_mayoreo,
           coalesce((select bool_and(v.junta) from public.product_volume_prices v where v.product_id = l.pid and v.active and v.nivel = 'medio'), true) t_junta,   -- ULT-MEDIA
           coalesce(pr.junta_mayoreo, true) jm,                                                     -- MAYOREO-50 · agujas y metabólicos no
           case when pr.unit ilike 'media caja%' then l.q / 2.0 else l.q end cajas                  -- MAYOREO-50 · media caja = 1/2
      from l left join public.products pr on pr.id = l.pid),
  r as (select coalesce(bool_or(q >= t_mayoreo and jm), false)
               or coalesce(sum(cajas) filter (where jm), 0) >= 50 mayoreo,                           -- regla 1 + 50 cajas
               coalesce(sum(q) filter (where t_medio = 10 and t_junta), 0) junta10 from t)
  select coalesce(jsonb_object_agg(t.pid, greatest(t.q,
           case when r.mayoreo and t.jm then coalesce(t.t_max, 0) else 0 end,                      -- regla 1 (solo los que juntan)
           case when t.t_medio = 10 and t.t_junta and r.junta10 >= 10 then 10 else 0 end)), '{}'::jsonb)   -- regla 2
    from t, r;
$function$;
revoke all on function public._qty_volumen(jsonb) from public, anon, authenticated;

create or replace function public._cc_reglas_pedido_texto()
 returns text
 language sql
 immutable
as $function$ select 'Reglas de precio por cantidad del pedido: 1) si el pedido suma 50 cajas o más (de cualquier producto, juntando distintos), TODO el pedido se cobra a mayoreo (cada producto a su propio mejor precio por cantidad); también si un solo producto llega a su escalón de mayoreo; las microagujas H24, H36 y HR (nano) y los metabólicos Mounjaro, Wegovy y Saxenda NO cuentan para las 50 cajas ni bajan a mayoreo por el pedido (solo por su propia cantidad); 2) los productos cuyo medio mayoreo empieza en 10 piezas se pueden juntar entre sí, aunque sean distintos (5 de uno + 5 de otro = 10), y cada uno queda a su medio mayoreo; los de medio mayoreo en 5 no se juntan. Una promoción vigente con mejor precio siempre manda.' $function$;

do $post$ begin
  if position('MAYOREO-50' in pg_get_functiondef('public._qty_volumen(jsonb)'::regprocedure)) = 0 then raise exception 'MAYOREO-50: _qty_volumen no quedó'; end if;
end $post$;
