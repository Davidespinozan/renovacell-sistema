-- Afina el alcance de pos en pedidos: ve SOLO los de su cartera (dueño del doctor
-- = su correo) y sus ventas POS (seller=su correo). Se quita la cláusula amplia de
-- placed_by que dejaba ver cualquier pedido levantado a nombre de otros.
DROP POLICY IF EXISTS orders_select_scoped ON public.orders;
CREATE POLICY orders_select_scoped ON public.orders FOR SELECT TO authenticated USING (
  public.auth_role() = 'admin'
  OR doctor_id = auth.uid()
  OR public.auth_role() = ANY (ARRAY['warehouse','packing','billing'])
  OR (public.auth_role() = 'pos' AND (
      public.order_vendor_email(orders.id) = (auth.jwt() ->> 'email')
      OR (shipping_meta ->> 'seller') = (auth.jwt() ->> 'email')
  ))
  OR (public.auth_role() = 'driver' AND public.is_order_driver(orders.id))
);
