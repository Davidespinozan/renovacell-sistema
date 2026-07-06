-- Rompe la recursión infinita de RLS orders<->shipments: sus políticas se
-- referenciaban mutuamente (el chofer ve pedidos de sus envíos; el doctor ve
-- envíos de sus pedidos). Se resuelve con funciones SECURITY DEFINER que
-- consultan la otra tabla SIN re-disparar su política.
CREATE OR REPLACE FUNCTION public.is_order_driver(o_id uuid)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM shipments WHERE order_id = o_id AND driver_id = auth.uid());
$$;
CREATE OR REPLACE FUNCTION public.order_owner(o_id uuid)
RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT doctor_id FROM orders WHERE id = o_id;
$$;
GRANT EXECUTE ON FUNCTION public.is_order_driver(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.order_owner(uuid) TO authenticated;

DROP POLICY IF EXISTS orders_select_scoped ON orders;
CREATE POLICY orders_select_scoped ON orders FOR SELECT TO authenticated USING (
  public.auth_role() = 'admin'
  OR doctor_id = auth.uid()
  OR public.auth_role() = ANY (ARRAY['warehouse','packing','billing','pos'])
  OR (public.auth_role() = 'driver' AND public.is_order_driver(orders.id))
);

DROP POLICY IF EXISTS shipments_select_scoped ON shipments;
CREATE POLICY shipments_select_scoped ON shipments FOR SELECT TO authenticated USING (
  public.auth_role() = ANY (ARRAY['admin','warehouse','packing'])
  OR driver_id = auth.uid()
  OR public.order_owner(shipments.order_id) = auth.uid()
);
