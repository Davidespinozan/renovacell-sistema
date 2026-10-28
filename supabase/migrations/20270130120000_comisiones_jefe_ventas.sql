-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- METAS Y COMISIONES PARA EL JEFE DE VENTAS · pedido del dueño (28 oct 2026): "Roberto es el jefe de ventas, él también
--   tiene que ver eso para poder tomar decisiones".
--   · comisiones_equipo(desde, hasta)  LECTURA de lo que necesita la pantalla Metas y comisiones: vendedores, pedidos del
--     periodo (y los cobrados en él) con su vendedor registrado y la línea de cada renglón, cobros del periodo y metas.
--     Autoridad: Dirección, o un vendedor activo con la capacidad 'jefe_ventas' (la asigna Dirección en Equipo).
--     El jefe NO lee tablas de pedidos, cobros ni metas: solo este resumen. Editar metas y tasas sigue siendo de Dirección.
--   · Cuentas internas: ni sus perfiles ni sus pedidos de prueba aparecen para quien no es interno.
--   NO cambia: RLS de orders / payment_entries / sales_targets, ni el cálculo (lo hace la pantalla, el mismo para todos).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public.comisiones_equipo(date,date)') is not null then raise exception 'COMISIONES-JEFE: ya aplicada'; end if;
  if to_regprocedure('public._es_interna()') is null then raise exception 'COMISIONES-JEFE: falta la migración de cuentas internas'; end if;
end $pre$;

create function public._jefe_ventas() returns boolean
  language sql stable security definer set search_path = public as
$$
  select coalesce((select p.active and (p.role_id = 'admin' or (p.role_id = 'pos' and coalesce(p.meta -> 'capabilities', '[]'::jsonb) ? 'jefe_ventas'))
                     from public.profiles p where p.id = auth.uid()), false)
$$;

create function public.comisiones_equipo(p_desde date, p_hasta date) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_int boolean := public._es_interna(); v_ocultos uuid[]; v_ids uuid[];
begin
  if auth.uid() is null or not public._jefe_ventas() then raise exception 'NO_AUTORIZADO: metas y comisiones son de Dirección y del jefe de ventas' using errcode = 'insufficient_privilege'; end if;
  if p_desde is null or p_hasta is null or p_hasta < p_desde or p_hasta - p_desde > 400 then raise exception 'PERIODO_INVALIDO' using errcode = 'check_violation'; end if;
  v_ocultos := case when v_int then '{}'::uuid[] else coalesce((select array_agg(id) from public.profiles where interna), '{}') end;
  -- pedidos levantados en el periodo (con un día de holgura por zona horaria; la pantalla corta por día del negocio)
  -- y pedidos con cobros en el periodo (un pedido anterior cobrado ahora cuenta en lo cobrado)
  select coalesce(array_agg(o.id), '{}') into v_ids from public.orders o
   where (o.created_at >= p_desde - 1 and o.created_at < p_hasta + 2
          or exists (select 1 from public.payment_entries e where e.order_id = o.id and e.value_date between p_desde and p_hasta))
     and not coalesce((o.shipping_meta ->> 'seller_profile_id')::uuid = any (v_ocultos), false);
  return jsonb_build_object(
    'vendedores', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'email', p.email, 'name', coalesce(p.meta ->> 'name', p.full_name, p.email)) order by coalesce(p.meta ->> 'name', p.full_name, p.email))
                              from public.profiles p where p.role_id = 'pos' and p.active and (not p.interna or v_int)), '[]'::jsonb),
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

alter function public._jefe_ventas() owner to postgres;
alter function public.comisiones_equipo(date, date) owner to postgres;
revoke all on function public._jefe_ventas(), public.comisiones_equipo(date, date) from public, anon;
grant execute on function public._jefe_ventas(), public.comisiones_equipo(date, date) to authenticated;
comment on function public.comisiones_equipo(date, date) is 'Metas y comisiones (lectura) para Dirección y el jefe de ventas (capacidad jefe_ventas); sin cuentas internas.';

do $post$ begin
  if has_function_privilege('anon', 'public.comisiones_equipo(date,date)', 'execute') then raise exception 'COMISIONES-JEFE: permisos inesperados'; end if;
end $post$;
