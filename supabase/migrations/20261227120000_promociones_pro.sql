-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- PROMOCIONES PRO (migración 174) · PROMO-3: la promoción se ve donde se decide y se mide.
--   Dueño (18 oct 2026): "dale con todo, el chiste es que quede lo más pro".
--   · cc_ia_precio          la IA del chat sabe si el precio viene de una promoción (nombre, hasta cuándo, escalones) y
--                           cuál era el precio normal; sigue siendo la misma autoridad (precio_de/3).
--   · promos_vigentes       un doctor ve SOLO las promociones que aplican a SU lista (el personal, todas): la etiqueta del
--                           portal coincide con lo que se cobra.
--   · promociones_lista     cada promoción trae lo vendido con su precio durante su vigencia (pedidos, piezas, importe).
--   Depende de la 173. Aplicar en UNA transacción. Rollback: supabase/rollback/promociones_pro/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.promociones') is null then raise exception 'PROMO-PRO: falta la 173'; end if;
  if to_regprocedure('public._promo_info(uuid,uuid)') is not null then raise exception 'PROMO-PRO: ya aplicada'; end if;
  if md5(pg_get_functiondef('public.cc_ia_precio(uuid,uuid,integer)'::regprocedure)) <> '55d2416f8167b7b7b20ee6bbdb49eba6' then raise exception 'PROMO-PRO: cc_ia_precio no es la versión de la CC-4'; end if;
end $pre$;

-- La promoción vigente que aplica a un producto para una lista: nombre, hasta y escalones (la de precio más bajo en 1 pza).
create function public._promo_info(p_product uuid, p_list uuid) returns jsonb
  language sql stable set search_path = public as
$$
  select jsonb_build_object('promocion_id', p.id, 'nombre', p.nombre, 'desde', p.desde, 'hasta', p.hasta,
           'escalones', (select jsonb_agg(jsonb_build_object('desde', l2.min_qty, 'precio', l2.precio) order by l2.min_qty) from public.promocion_lineas l2 where l2.promocion_id = p.id and l2.product_id = p_product))
    from public.promociones p
   where p.activa and public._promo_hoy() between p.desde and p.hasta
     and (p.listas is null or (p_list is not null and p_list = any (p.listas)))
     and exists (select 1 from public.promocion_lineas l where l.promocion_id = p.id and l.product_id = p_product)
   order by (select min(l.precio) from public.promocion_lineas l where l.promocion_id = p.id and l.product_id = p_product and l.min_qty <= 1), p.hasta
   limit 1
$$;

-- cc_ia_precio · texto de la CC-4 + promoción. 'precio_normal' = lista/base sin promoción ni volumen; 'promocion' solo si hay
-- una vigente para ese producto y esa lista; 'en_promocion' = el unitario cobrado es el de la promo.
create or replace function public.cc_ia_precio(p_profile uuid, p_product uuid, p_qty int default 1) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
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
  v_unit := public.precio_de(p_product, v_list, v_qty);
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
$$;

-- promos_vigentes · el doctor solo ve las de su lista; el personal, todas (con sus listas para filtrar en pantalla).
create or replace function public.promos_vigentes() returns jsonb
  language sql stable security definer set search_path = public as
$$
  select coalesce(jsonb_agg(jsonb_build_object('promocion_id', p.id, 'nombre', p.nombre, 'desde', p.desde, 'hasta', p.hasta, 'listas', p.listas,
                                               'product_id', l.product_id, 'min_qty', l.min_qty, 'precio', l.precio)
                            order by p.hasta, p.nombre, l.product_id, l.min_qty), '[]'::jsonb)
    from public.promociones p join public.promocion_lineas l on l.promocion_id = p.id
   where auth.uid() is not null and public.puede_ver_precio()
     and p.activa and public._promo_hoy() between p.desde and p.hasta
     and (public.auth_role() <> 'doctor' or p.listas is null
          or exists (select 1 from public.profiles pr where pr.id = auth.uid() and pr.price_list_id = any (p.listas)))
$$;

-- Lo vendido con la promoción: renglones de pedidos no cancelados creados dentro de su vigencia (día del negocio) cuyo
-- precio unitario es exactamente uno de sus escalones para ese producto. Es una lectura, no un cierre contable.
create function public._promo_ventas(p_id uuid) returns jsonb
  language sql stable set search_path = public as
$$
  select jsonb_build_object('pedidos', count(distinct o.id), 'piezas', coalesce(sum(i.qty), 0), 'importe', coalesce(sum(i.qty * i.unit_price), 0))
    from public.promociones p
    join public.promocion_lineas l on l.promocion_id = p.id
    join public.order_items i on i.product_id = l.product_id and i.unit_price = l.precio
    join public.orders o on o.id = i.order_id and coalesce(o.status, '') not in ('cancelled', 'canceled', 'cancelado')
   where p.id = p_id
     and (o.created_at at time zone coalesce((select zona from public.cc_horario_config where id = 1), 'America/Mazatlan'))::date between p.desde and p.hasta
$$;

create or replace function public._promo_json(p_id uuid) returns jsonb
  language sql stable set search_path = public as
$$
  select jsonb_build_object('id', p.id, 'nombre', p.nombre, 'descripcion', p.descripcion, 'desde', p.desde, 'hasta', p.hasta, 'activa', p.activa, 'listas', p.listas,
           'estado', case when not p.activa then 'inactiva' when public._promo_hoy() < p.desde then 'proxima' when public._promo_hoy() > p.hasta then 'vencida' else 'vigente' end,
           'lineas', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'product_id', l.product_id, 'producto', pr.name, 'precio_normal', pr.price, 'min_qty', l.min_qty, 'precio', l.precio) order by pr.name, l.min_qty)
                                from public.promocion_lineas l join public.products pr on pr.id = l.product_id where l.promocion_id = p.id), '[]'::jsonb),
           'ventas', public._promo_ventas(p.id),
           'updated_at', p.updated_at)
    from public.promociones p where p.id = p_id
$$;

alter function public._promo_info(uuid, uuid) owner to postgres;
alter function public._promo_ventas(uuid) owner to postgres;
revoke all on function public._promo_info(uuid, uuid), public._promo_ventas(uuid) from public, anon, authenticated, service_role;
revoke all on function public.cc_ia_precio(uuid, uuid, int) from public, anon, authenticated;
grant execute on function public.cc_ia_precio(uuid, uuid, int) to service_role;
revoke all on function public.promos_vigentes() from public, anon;
grant execute on function public.promos_vigentes() to authenticated, service_role;

do $post$ begin
  if has_function_privilege('authenticated', 'public.cc_ia_precio(uuid,uuid,integer)', 'execute') or has_function_privilege('anon', 'public.promos_vigentes()', 'execute')
     or has_function_privilege('authenticated', 'public._promo_info(uuid,uuid)', 'execute') then
    raise exception 'PROMO-PRO: permisos inesperados';
  end if;
end $post$;
