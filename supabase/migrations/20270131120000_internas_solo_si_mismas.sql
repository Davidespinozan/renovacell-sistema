-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- CUENTAS INTERNAS · SOLO SE VEN A SÍ MISMAS · pedido del dueño (28 oct 2026): las cuentas @renovacell.mx no deben
--   aparecer tampoco cuando él entra con una de ellas; así ve el sistema exactamente como lo ve el equipo.
--   · RLS de profiles: una cuenta interna solo se ve (y se edita) a sí misma; nadie más la lista, la edita ni la borra.
--   · cc_vendedores y comisiones_equipo: nunca listan cuentas internas ni sus pedidos, sea quien sea quien pregunte.
--   Administrarlas (contraseña, rol) queda para SQL de servidor. _es_interna() sigue existiendo (sin uso en políticas).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public.comisiones_equipo(date,date)') is null or to_regprocedure('public._es_interna()') is null then raise exception 'INTERNAS-2: faltan las migraciones anteriores'; end if;
end $pre$;

alter policy profiles_select_self_or_admin on public.profiles
  using ((id = auth.uid()) or (not interna and ((auth_role() = 'admin'::text) or ((role_id = 'driver'::text) and (auth_role() = any (array['warehouse'::text, 'packing'::text, 'pos'::text, 'billing'::text, 'comm'::text, 'driver'::text]))))));
alter policy profiles_update_self_or_admin on public.profiles
  using ((id = auth.uid()) or (not interna and (auth_role() = 'admin'::text)));
alter policy profiles_delete_admin on public.profiles
  using (not interna and (auth_role() = 'admin'::text));

CREATE OR REPLACE FUNCTION public.cc_vendedores()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public._cc7_direccion();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'nombre', coalesce(p.meta ->> 'name', p.full_name, p.email), 'activo', p.active,
      'conversaciones', coalesce(p.meta -> 'capabilities', '[]'::jsonb) ? 'conversaciones',
      'nuevos_clientes', coalesce(p.meta -> 'capabilities', '[]'::jsonb) ? 'nuevos_clientes',
      'elegible', public._cc_vendedor_elegible(p.id, false), 'elegible_nuevos', public._cc_vendedor_elegible(p.id, true),
      'clientes', (select count(*) from public.cc_cartera k where k.seller_profile_id = p.id) + (select count(*) from public.cc_cartera_clientes kk where kk.seller_profile_id = p.id)) order by coalesce(p.meta ->> 'name', p.full_name, p.email))
    from public.profiles p where p.role_id = 'pos' and not p.interna), '[]'::jsonb);
end;
$function$;

create or replace function public.comisiones_equipo(p_desde date, p_hasta date) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_ocultos uuid[]; v_ids uuid[];
begin
  if auth.uid() is null or not public._jefe_ventas() then raise exception 'NO_AUTORIZADO: metas y comisiones son de Dirección y del jefe de ventas' using errcode = 'insufficient_privilege'; end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 400 then raise exception 'PERIODO_INVALIDO' using errcode = 'check_violation'; end if;
  v_ocultos := coalesce((select array_agg(id) from public.profiles where interna), '{}');   -- sin excepción: tampoco para las internas
  -- pedidos levantados en el periodo (con un día de holgura por zona horaria; la pantalla corta por día del negocio)
  -- y pedidos con cobros en el periodo (un pedido anterior cobrado ahora cuenta en lo cobrado)
  select coalesce(array_agg(o.id), '{}') into v_ids from public.orders o
   where (o.created_at >= p_desde - 1 and o.created_at < p_hasta + 2
          or exists (select 1 from public.payment_entries e where e.order_id = o.id and e.value_date between p_desde and p_hasta))
     and not coalesce((o.shipping_meta ->> 'seller_profile_id')::uuid = any (v_ocultos), false);
  return jsonb_build_object(
    'vendedores', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'email', p.email, 'name', coalesce(p.meta ->> 'name', p.full_name, p.email)) order by coalesce(p.meta ->> 'name', p.full_name, p.email))
                              from public.profiles p where p.role_id = 'pos' and p.active and not p.interna), '[]'::jsonb),
    'pedidos', coalesce((select jsonb_agg(jsonb_build_object(
                  'id', o.id, 'status', o.status, 'created_at', o.created_at, 'total', o.total, 'external_ref', o.external_ref,
                  'shipping_meta', jsonb_strip_nulls(jsonb_build_object('seller', o.shipping_meta ->> 'seller', 'seller_profile_id', o.shipping_meta ->> 'seller_profile_id')),
                  'items', coalesce((select jsonb_agg(jsonb_build_object('product_id', i.product_id, 'qty', i.qty, 'unit_price', i.unit_price, 'linea', case when pr.line = 'prof' then 'prof' else 'cosm' end) order by i.created_at, i.id)
                                       from public.order_items i left join public.products pr on pr.id = i.product_id where i.order_id = o.id), '[]'::jsonb)) order by o.created_at)
                  from public.orders o where o.id = any (v_ids)), '[]'::jsonb),
    'asientos', coalesce((select jsonb_agg(jsonb_build_object('order_id', e.order_id, 'direction', e.direction, 'amount', e.amount, 'value_date', e.value_date) order by e.value_date, e.id)
                  from public.payment_entries e where e.order_id = any (v_ids) and e.value_date between p_desde and p_hasta), '[]'::jsonb),
    'metas', coalesce((select jsonb_agg(jsonb_build_object('seller', t.seller, 'target', t.target, 'commission_rate', t.commission_rate)) from public.sales_targets t), '[]'::jsonb),
    'puede_editar', public.auth_role() = 'admin');
end;
$$;
