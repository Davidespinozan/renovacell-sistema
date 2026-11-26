-- ============================================================================
-- TRAZABILIDAD DE LA VENTA PARA DIRECCIÓN Y VENTAS (26 nov 2026, dueño: «¿hay manera de ver trazabilidad de la venta en
-- Dirección y Ventas, de dónde va la venta, como estado de la venta?»).
--   · seguimiento_ventas(ids): para cada pedido que el usuario PUEDE ver, cuándo se empacó, salió del almacén y se
--     entregó (mismo cálculo que Ventas del equipo: shipments + bitácora). Solo lectura.
--   · La visibilidad repite la regla de orders_select_scoped (Dirección/Almacén/Facturación todo; jefe de ventas todo;
--     vendedor solo lo suyo). Hasta 500 pedidos por llamada.
-- Rollback: drop function public.seguimiento_ventas(uuid[]);
-- ============================================================================
create function public.seguimiento_ventas(p_ids uuid[])
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(jsonb_object_agg(o.id, public._ventas_equipo_seguimiento(o.id)), '{}'::jsonb)
    from public.orders o
   where auth.uid() is not null
     and o.id = any ((p_ids)[1:500])
     and (public.auth_role() in ('admin', 'warehouse', 'packing', 'billing')
          or public._jefe_ventas()
          or (public.auth_role() = 'pos' and (
                (o.shipping_meta ->> 'seller_profile_id') = auth.uid()::text
             or ((o.shipping_meta ->> 'seller_profile_id') is null and (o.shipping_meta ->> 'seller') = (auth.jwt() ->> 'email'))
             or public.order_vendor_email(o.id) = (auth.jwt() ->> 'email')
             or public._cx0c_venta_pos_propia(o.id)
             or (o.shipping_meta ->> 'placed_by_id') = auth.uid()::text)));
$function$;
revoke all on function public.seguimiento_ventas(uuid[]) from public, anon;
grant execute on function public.seguimiento_ventas(uuid[]) to authenticated, service_role;
