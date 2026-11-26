-- ============================================================================
-- VENTAS DEL EQUIPO · SEGUIMIENTO DE ENTREGA (26 nov 2026, Roberto: «ver todas las entregas de los vendedores, cuándo
-- lo entrega el repartidor y cuándo le dan salida a los productos de almacén»).
--   · Cada pedido de ventas_equipo trae `seguimiento`: cuándo se empacó, cuándo salió del almacén (despacho al chofer
--     o envío por paquetería), cuándo se entregó, quién lo despachó, el chofer, quién recibió, guía y si hay foto.
--   · Las horas salen de lo que el sistema ya registra (shipments + bitácora de cambios del pedido); nada nuevo se
--     escribe. Sigue siendo SOLO LECTURA y solo para Dirección o el jefe de ventas.
-- Rollback: supabase/rollback/ventas_equipo_seguimiento/99_down.sql
-- ============================================================================
create function public._ventas_equipo_seguimiento(p_order uuid)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with est as (
    select payload ->> 'status' st, min(created_at) at
      from public.audit_logs
     where resource_type = 'orders' and resource_id = p_order::text and payload ->> 'status' in ('packed', 'shipped', 'delivered')
     group by 1),
  env as (
    select s.* from public.shipments s where s.order_id = p_order order by s.created_at desc limit 1)
  select jsonb_build_object(
    'empacado_at', (select at from est where st = 'packed'),
    'salio_at', coalesce((select dispatched_at from env), (select at from est where st = 'shipped')),
    'entregado_at', coalesce((select delivered_at from env), (select at from est where st = 'delivered')),
    'despacho_por', (select dispatched_by from env),
    'chofer', (select coalesce(p.meta ->> 'name', p.full_name, p.email) from env join public.profiles p on p.id = env.driver_id),
    'carga_recibida_at', (select load_confirmed_at from env),
    'recibio', (select received_by from env),
    'con_foto', coalesce((select proof_image_url is not null from env), false),
    'guia', (select tracking_number from env),
    'paqueteria', (select coalesce(carrier, provider) from env),
    'incidente', (select incident from env));
$function$;
revoke all on function public._ventas_equipo_seguimiento(uuid) from public, anon, authenticated;

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
               'seguimiento', public._ventas_equipo_seguimiento(o.id),
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
