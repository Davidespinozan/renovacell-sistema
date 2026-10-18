-- PROMOCIONES PRO · rollback de la migración 174: cc_ia_precio vuelve a la CC-4, promos_vigentes y _promo_json a la 173;
-- se retiran _promo_info y _promo_ventas. No toca datos.
drop function public._promo_info(uuid, uuid);
CREATE OR REPLACE FUNCTION public.cc_ia_precio(p_profile uuid, p_product uuid, p_qty integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ctx jsonb; v_list uuid; v_qty int := least(greatest(coalesce(p_qty, 1), 1), 999); v_unit numeric; v_base numeric; prod record;
begin
  ctx := public.cc_ia_contexto_actor(p_profile);
  if not (ctx ->> 'puede_precio')::boolean then
    return jsonb_build_object('autorizado', false, 'motivo', 'PRICE_REQUIRES_VERIFICATION');
  end if;
  select p.id, p.name, p.sellable into prod from public.products p where p.id = p_product and p.active and (p.show_portal or p.show_landing);
  if prod.id is null then return jsonb_build_object('autorizado', false, 'motivo', 'PRODUCTO_NO_DISPONIBLE'); end if;
  if not prod.sellable then return jsonb_build_object('autorizado', false, 'motivo', 'PRODUCTO_NO_VENDIBLE', 'nombre', prod.name); end if;
  select price_list_id into v_list from public.profiles where id = p_profile;
  v_unit := public.precio_de(p_product, v_list, v_qty);
  v_base := public.precio_de(p_product, v_list, 1);
  if v_unit is null then return jsonb_build_object('autorizado', false, 'motivo', 'SIN_PRECIO', 'nombre', prod.name); end if;
  return jsonb_build_object('autorizado', true, 'product_id', prod.id, 'nombre', prod.name, 'cantidad', v_qty, 'precio_unitario', v_unit, 'total', round(v_unit * v_qty, 2), 'moneda', 'MXN',
    'por_volumen', v_unit < v_base,
    'lista', (select l.name from public.price_lists l where l.id = v_list),
    'escalas', (select coalesce(jsonb_agg(jsonb_build_object('desde', pv.min_quantity, 'precio', pv.price) order by pv.min_quantity), '[]'::jsonb) from public.product_volume_prices pv where pv.product_id = p_product and pv.active));
end;
$function$

;
CREATE OR REPLACE FUNCTION public.promos_vigentes()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce(jsonb_agg(jsonb_build_object('promocion_id', p.id, 'nombre', p.nombre, 'desde', p.desde, 'hasta', p.hasta, 'listas', p.listas,
                                               'product_id', l.product_id, 'min_qty', l.min_qty, 'precio', l.precio)
                            order by p.hasta, p.nombre, l.product_id, l.min_qty), '[]'::jsonb)
    from public.promociones p join public.promocion_lineas l on l.promocion_id = p.id
   where auth.uid() is not null and public.puede_ver_precio()
     and p.activa and public._promo_hoy() between p.desde and p.hasta
$function$

;
CREATE OR REPLACE FUNCTION public._promo_json(p_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object('id', p.id, 'nombre', p.nombre, 'descripcion', p.descripcion, 'desde', p.desde, 'hasta', p.hasta, 'activa', p.activa, 'listas', p.listas,
           'estado', case when not p.activa then 'inactiva' when public._promo_hoy() < p.desde then 'proxima' when public._promo_hoy() > p.hasta then 'vencida' else 'vigente' end,
           'lineas', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'product_id', l.product_id, 'producto', pr.name, 'precio_normal', pr.price, 'min_qty', l.min_qty, 'precio', l.precio) order by pr.name, l.min_qty)
                                from public.promocion_lineas l join public.products pr on pr.id = l.product_id where l.promocion_id = p.id), '[]'::jsonb),
           'updated_at', p.updated_at)
    from public.promociones p where p.id = p_id
$function$

;
drop function public._promo_ventas(uuid);
revoke all on function public.cc_ia_precio(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.cc_ia_precio(uuid, uuid, int) to service_role;
revoke all on function public.promos_vigentes() from public, anon;
grant execute on function public.promos_vigentes() to authenticated, service_role;
do $post$ begin
  if md5(pg_get_functiondef('public.cc_ia_precio(uuid,uuid,integer)'::regprocedure)) <> '55d2416f8167b7b7b20ee6bbdb49eba6'
     or md5(pg_get_functiondef('public.promos_vigentes()'::regprocedure)) <> 'e1ad7cefc3dfd0142666c902f1192726'
     or md5(pg_get_functiondef('public._promo_json(uuid)'::regprocedure)) <> '009b2b0878c4a7f649397f6b3dafb521' then
    raise exception 'PROMO-PRO down: las funciones no quedaron como antes de la 174';
  end if;
end $post$;
