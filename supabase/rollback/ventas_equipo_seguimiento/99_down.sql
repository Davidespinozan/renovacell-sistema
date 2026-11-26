-- Regresa ventas_equipo a la versión sin seguimiento (20270407920000) y quita el auxiliar.
create or replace function public.ventas_equipo(p_dias integer default 120)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public'
as $function$
declare v_desde timestamptz := now() - make_interval(days => least(greatest(coalesce(p_dias, 120), 1), 400));
  v_ocultos uuid[];
begin
  if auth.uid() is null or not public._jefe_ventas() then
    raise exception 'NO_AUTORIZADO: las ventas del equipo son de Dirección y del jefe de ventas' using errcode = 'insufficient_privilege';
  end if;
  -- Como Metas y comisiones: las ventas de cuentas internas (pruebas) no se ven, salvo para una cuenta interna.
  v_ocultos := case when coalesce((select interna from public.profiles where id = auth.uid()), false) then '{}'::uuid[]
                    else coalesce((select array_agg(id) from public.profiles where interna), '{}') end;
  return jsonb_build_object(
    'vendedores', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'email', p.email, 'name', coalesce(p.meta ->> 'name', p.full_name, p.email)) order by coalesce(p.meta ->> 'name', p.full_name, p.email))
                              from public.profiles p where public._es_vendedor_rol(p.role_id, p.meta) and not p.interna), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', o.id, 'external_ref', o.external_ref, 'doctor_id', o.doctor_id, 'customer_id', o.customer_id, 'total', o.total,
               'currency', o.currency, 'status', o.status, 'payment_method', o.payment_method, 'payment_status', o.payment_status,
               'invoice_requested', o.invoice_requested, 'shipping_meta', o.shipping_meta, 'shipping_cost', o.shipping_cost, 'created_at', o.created_at,
               'items', coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'order_id', i.order_id, 'product_id', i.product_id, 'qty', i.qty, 'unit_price', i.unit_price, 'created_at', i.created_at) order by i.created_at)
                                    from public.order_items i where i.order_id = o.id), '[]'::jsonb))
             order by o.created_at desc)
        from public.orders o where o.created_at >= v_desde and o.status <> 'draft'
         and not coalesce((o.shipping_meta ->> 'seller_profile_id')::uuid = any (v_ocultos), false)), '[]'::jsonb),
    'money', coalesce((
      select jsonb_agg(to_jsonb(m))
        from public.v_order_money m join public.orders o on o.id = m.order_id
       where o.created_at >= v_desde and o.status <> 'draft'
         and not coalesce((o.shipping_meta ->> 'seller_profile_id')::uuid = any (v_ocultos), false)), '[]'::jsonb));
end;
$function$;
revoke all on function public.ventas_equipo(integer) from public, anon;
grant execute on function public.ventas_equipo(integer) to authenticated, service_role;
drop function if exists public._ventas_equipo_seguimiento(uuid);
