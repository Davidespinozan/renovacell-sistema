-- IA-VENDEDORA (20270223) · down: el precio de un producto vuelve a su definición exacta de MAYOREO-REGLAS (sin nivel ni reglas);
-- fuera cotizar, oportunidades, perfil comercial, recomendaciones, especialidades por producto y la actividad del catálogo.
create or replace function public._cc_precio_vol(p_profile uuid, p_product uuid, p_qty integer, p_qty_vol integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ctx jsonb; v_list uuid; v_qty int := least(greatest(coalesce(p_qty, 1), 1), 999); v_unit numeric; v_base numeric; prod record; v_normal numeric; v_promo jsonb; v_promo_unit numeric;
begin
  ctx := public.cc_ia_contexto_actor(p_profile);
  if not (ctx ->> 'puede_precio')::boolean then
    return jsonb_build_object('autorizado', false, 'motivo', 'PRICE_REQUIRES_VERIFICATION');
  end if;
  select p.id, p.name, p.sellable into prod from public.products p where p.id = p_product and p.active and (p.show_portal or p.show_landing);
  if prod.id is null then return jsonb_build_object('autorizado', false, 'motivo', 'PRODUCTO_NO_DISPONIBLE'); end if;
  if not prod.sellable then return jsonb_build_object('autorizado', false, 'motivo', 'PRODUCTO_NO_VENDIBLE', 'nombre', prod.name); end if;
  select price_list_id into v_list from public.profiles where id = p_profile;
  v_unit := public.precio_de(p_product, v_list, v_qty, greatest(v_qty, coalesce(p_qty_vol, v_qty)));
  v_base := public.precio_de(p_product, v_list, 1);
  if v_unit is null then return jsonb_build_object('autorizado', false, 'motivo', 'SIN_PRECIO', 'nombre', prod.name); end if;
  select coalesce((select pp.price from public.product_prices pp where pp.product_id = p_product and pp.list_id = v_list), (select pr.price from public.products pr where pr.id = p_product)) into v_normal;
  v_promo := public._promo_info(p_product, v_list);
  v_promo_unit := public._promo_precio(p_product, v_list, v_qty);
  return jsonb_build_object('autorizado', true, 'product_id', prod.id, 'nombre', prod.name, 'cantidad', v_qty, 'precio_unitario', v_unit, 'total', round(v_unit * v_qty, 2), 'moneda', 'MXN',
    'por_volumen', v_unit < v_base,
    'lista', (select l.name from public.price_lists l where l.id = v_list),
    'escalas', (select coalesce(jsonb_agg(jsonb_build_object('desde', pv.min_quantity, 'precio', pv.price) order by pv.min_quantity), '[]'::jsonb) from public.product_volume_prices pv where pv.product_id = p_product and pv.active),
    'precio_normal', v_normal,
    'en_promocion', v_promo is not null and v_promo_unit is not null and v_unit = v_promo_unit and v_unit < coalesce(v_normal, v_unit + 1),
    'promocion', v_promo);
end;
$function$
;
drop function if exists public.cc_ia_recomendaciones(uuid, uuid, int);
drop function if exists public.cc_ia_perfil_comercial(uuid);
drop function if exists public.cc_ia_cotizar(uuid, jsonb);
drop function if exists public._cc_oportunidades(jsonb, uuid);
drop function if exists public._cc_lineas_total(jsonb, uuid, jsonb);
drop function if exists public.cc_registrar_actividad(text, uuid, text);
drop function if exists public.producto_especialidades_guardar(uuid, text[]);
drop function if exists public.producto_especialidades();
drop function if exists public._cc_reglas_pedido_texto();
drop table if exists public.cc_actividad_catalogo;
drop table if exists public.cc_producto_especialidad;
