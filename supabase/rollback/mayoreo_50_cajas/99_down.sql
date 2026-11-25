-- Rollback de 20270407900000_mayoreo_50_cajas.sql: regresa _qty_volumen y el texto de reglas a como estaban (regla 1
-- por producto). La columna products.junta_mayoreo y la vista products_safe con esa columna se quedan: sin la función
-- nueva no afectan ningún precio.
CREATE OR REPLACE FUNCTION public._qty_volumen(p_lines jsonb)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
           coalesce((select bool_and(v.junta) from public.product_volume_prices v where v.product_id = l.pid and v.active and v.nivel = 'medio'), true) t_junta   -- ULT-MEDIA
      from l),
  r as (select coalesce(bool_or(q >= t_mayoreo), false) mayoreo, coalesce(sum(q) filter (where t_medio = 10 and t_junta), 0) junta10 from t)
  select coalesce(jsonb_object_agg(t.pid, greatest(t.q,
           case when r.mayoreo then coalesce(t.t_max, 0) else 0 end,                 -- regla 1
           case when t.t_medio = 10 and t.t_junta and r.junta10 >= 10 then 10 else 0 end)), '{}'::jsonb)   -- regla 2
    from t, r;
$function$;
revoke all on function public._qty_volumen(jsonb) from public, anon, authenticated;
CREATE OR REPLACE FUNCTION public._cc_reglas_pedido_texto()
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$ select 'Reglas de precio por cantidad del pedido: 1) si un producto llega a su escalón de mayoreo, TODO el pedido se cobra a mayoreo (cada producto a su propio mejor precio por cantidad); 2) los productos cuyo medio mayoreo empieza en 10 piezas se pueden juntar entre sí, aunque sean distintos (5 de uno + 5 de otro = 10), y cada uno queda a su medio mayoreo; juntar piezas solo alcanza el medio mayoreo, nunca el mayoreo; los de medio mayoreo en 5 no se juntan. Una promoción vigente con mejor precio siempre manda.' $function$;
