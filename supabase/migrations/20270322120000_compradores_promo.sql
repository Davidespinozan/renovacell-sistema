-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- COMPRADORES × PROMOCIÓN (3 nov 2026, dueño: "lista de historial de compras por producto en la vista del vendedor para
-- poder tomar decisiones de hablarle a un cliente diciéndole que tal producto que compró una vez ahora tiene promoción").
--   · Arreglo: "Productos" listaba familias y contaba solo ventas del id de la familia; lo vendido es la PRESENTACIÓN
--     (117 de 191 productos activos son presentaciones), así que esas compras no aparecían. Ahora se agrupa por familia
--     (coalesce(parent_product_id, id)) y el detalle dice qué presentación compró cada cliente.
--   · Cada producto trae la promoción VIGENTE que tiene (él o una presentación de su familia).
--   · cc_oportunidades_promo(): los clientes de mi cartera (jefe de ventas y Dirección: todos) que compraron algo que
--     HOY está en promoción para su lista de precios, con lo que compró, cuándo y la promoción: a quién hablarle hoy.
-- Mismo alcance que el bloque A (_alcance_compradores); venta = la misma de _ventas_cliente_producto. Solo lectura.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public.cc_oportunidades_promo()') is not null then raise exception 'COMPRADORES-PROMO: ya aplicada'; end if;
  if to_regprocedure('public._ventas_cliente_producto()') is null or to_regprocedure('public._alcance_compradores()') is null or to_regclass('public.promocion_lineas') is null then
    raise exception 'COMPRADORES-PROMO: faltan BLOQUE-A o PROMOCIONES'; end if;
end $pre$;

-- Lista de precios con la que se le cobra a un cliente: la de su cuenta o, sin cuenta, la predeterminada.
create function public._cc_lista_de_cliente(p_customer uuid) returns uuid language sql stable security definer set search_path = public as
$$
  select coalesce((select pr.price_list_id from public.customers c join public.profiles pr on pr.id = c.profile_id where c.id = p_customer),
                  (select l.id from public.price_lists l order by l.is_default desc, l.sort nulls last, l.created_at limit 1))
$$;

-- Promociones vigentes de una familia (la familia o cualquiera de sus presentaciones), una entrada por promoción y
-- producto con sus escalones. p_list null = sin filtrar por lista (la vista por producto); con lista, solo las que le aplican.
create function public._cc_promo_familia(p_familia uuid, p_list uuid) returns jsonb language sql stable security definer set search_path = public as
$$
  select coalesce(jsonb_agg(x.j order by x.precio_min, x.hasta), '[]'::jsonb) from (
    select jsonb_build_object('promocion_id', pm.id, 'nombre', pm.nombre, 'hasta', pm.hasta, 'product_id', pr.id, 'producto', pr.name,
                              'precio_normal', pr.price,
                              'escalones', jsonb_agg(jsonb_build_object('desde', l.min_qty, 'precio', l.precio) order by l.min_qty)) j,
           min(l.precio) precio_min, pm.hasta
      from public.promociones pm join public.promocion_lineas l on l.promocion_id = pm.id join public.products pr on pr.id = l.product_id
     where coalesce(pr.parent_product_id, pr.id) = p_familia and pr.active
       and pm.activa and public._promo_hoy() between pm.desde and pm.hasta
       and (p_list is null or pm.listas is null or p_list = any (pm.listas))
     group by pm.id, pm.nombre, pm.hasta, pr.id, pr.name, pr.price) x
$$;

create or replace function public.cc_productos_compradores() returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare a record;
begin
  select * into a from public._alcance_compradores();
  return coalesce((
    select jsonb_agg(jsonb_build_object('product_id', p.id, 'nombre', p.name, 'sku', p.sku, 'categoria', p.category, 'activo', p.active,
                                        'clientes', coalesce(v.clientes, 0), 'ultima', v.ultima, 'promos', public._cc_promo_familia(p.id, null))
                     order by coalesce(v.clientes, 0) desc, p.name)
      from public.products p
      left join (select coalesce(pp.parent_product_id, pp.id) familia, count(distinct s.customer_id) clientes, max(s.created_at) ultima
                   from public._ventas_cliente_producto() s join public.products pp on pp.id = s.product_id
                  where s.customer_id is not null and (a.todos or public._cc_vendedor_de_cliente(s.customer_id) = a.uid)
                  group by 1) v on v.familia = p.id
     where p.parent_product_id is null and (p.active or v.clientes > 0)), '[]'::jsonb);
end;
$$;

-- Quién compró un producto (o cualquier presentación de su familia; se acepta el id de la familia o de una presentación).
create or replace function public.cc_compradores_producto(p_product uuid) returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare a record; v_fam uuid;
begin
  select * into a from public._alcance_compradores();
  select coalesce(parent_product_id, id) into v_fam from public.products where id = p_product;
  if v_fam is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('customer_id', c.id, 'nombre', c.full_name, 'telefono', c.phone, 'email', c.email, 'tiene_cuenta', c.profile_id is not null,
                                        'veces', v.veces, 'unidades', v.unidades, 'ultima', v.ultima, 'ultimo_folio', v.ultimo_folio, 'presentaciones', v.presentaciones,
                                        'promo_aplica', jsonb_array_length(public._cc_promo_familia(v_fam, public._cc_lista_de_cliente(c.id))) > 0,
                                        'vendedor', case when a.todos then public._cc_nombre_personal(public._cc_vendedor_de_cliente(c.id)) end) order by v.ultima desc)
      from (select s.customer_id, count(distinct s.order_id) veces, sum(s.qty) unidades, max(s.created_at) ultima,
                   (array_agg(s.folio order by s.created_at desc))[1] ultimo_folio,
                   jsonb_agg(distinct pp.name) filter (where pp.parent_product_id is not null) presentaciones
              from public._ventas_cliente_producto() s join public.products pp on pp.id = s.product_id
             where coalesce(pp.parent_product_id, pp.id) = v_fam and s.customer_id is not null
             group by s.customer_id) v
      join public.customers c on c.id = v.customer_id
     where a.todos or public._cc_vendedor_de_cliente(c.id) = a.uid), '[]'::jsonb);
end;
$$;

-- A quién hablarle hoy: clientes que compraron algo que AHORA está en promoción para su lista. Uno por cliente, con cada
-- familia que compró y su promoción; primero los que compraron más recientemente.
create function public.cc_oportunidades_promo() returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare a record;
begin
  select * into a from public._alcance_compradores();
  if not exists (select 1 from public.promociones pm where pm.activa and public._promo_hoy() between pm.desde and pm.hasta) then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('customer_id', c.id, 'nombre', c.full_name, 'telefono', c.phone, 'email', c.email, 'tiene_cuenta', c.profile_id is not null,
                                        'vendedor', case when a.todos then public._cc_nombre_personal(public._cc_vendedor_de_cliente(c.id)) end,
                                        'ultima', o.ultima, 'ofertas', o.ofertas) order by o.ultima desc)
      from (select f.customer_id, max(f.ultima) ultima,
                   jsonb_agg(jsonb_build_object('familia_id', f.familia, 'familia', f.nombre, 'veces', f.veces, 'unidades', f.unidades, 'ultima', f.ultima,
                                                'presentaciones', f.presentaciones, 'promos', f.promos) order by f.ultima desc) ofertas
              from (select s.customer_id, coalesce(pp.parent_product_id, pp.id) familia, max(fa.name) nombre, count(distinct s.order_id) veces, sum(s.qty) unidades,
                           max(s.created_at) ultima, jsonb_agg(distinct pp.name) presentaciones,
                           public._cc_promo_familia(coalesce(pp.parent_product_id, pp.id), public._cc_lista_de_cliente(s.customer_id)) promos
                      from public._ventas_cliente_producto() s
                      join public.products pp on pp.id = s.product_id
                      join public.products fa on fa.id = coalesce(pp.parent_product_id, pp.id)
                     where s.customer_id is not null and (a.todos or public._cc_vendedor_de_cliente(s.customer_id) = a.uid)
                     group by s.customer_id, coalesce(pp.parent_product_id, pp.id)) f
             where jsonb_array_length(f.promos) > 0
             group by f.customer_id
             order by max(f.ultima) desc
             limit 300) o
      join public.customers c on c.id = o.customer_id and c.active), '[]'::jsonb);
end;
$$;

revoke all on function public._cc_lista_de_cliente(uuid), public._cc_promo_familia(uuid, uuid) from public, anon, authenticated;
revoke all on function public.cc_oportunidades_promo() from public, anon;
grant execute on function public.cc_oportunidades_promo() to authenticated;

do $post$ begin
  if to_regprocedure('public.cc_oportunidades_promo()') is null or to_regprocedure('public._cc_promo_familia(uuid,uuid)') is null then
    raise exception 'COMPRADORES-PROMO: no quedó aplicada'; end if;
end $post$;
