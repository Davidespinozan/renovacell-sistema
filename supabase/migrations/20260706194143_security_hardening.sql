-- ============ ENDURECIMIENTO DE SEGURIDAD (revisión adversaria) ============

-- #7 · El guard de profiles impide que un NO-admin cambie sus capabilities
-- (evita auto-otorgarse 'anuncios', etc.). Sigue bloqueando role_id/verified.
CREATE OR REPLACE FUNCTION public.profiles_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role'
     OR public.auth_role() = 'admin' THEN
    RETURN NEW;
  END IF;
  IF NEW.role_id IS DISTINCT FROM OLD.role_id
     OR NEW.verified IS DISTINCT FROM OLD.verified
     OR (COALESCE(NEW.meta -> 'capabilities', 'null'::jsonb) IS DISTINCT FROM COALESCE(OLD.meta -> 'capabilities', 'null'::jsonb)) THEN
    RAISE EXCEPTION 'No autorizado: no puedes modificar role_id, verified ni capacidades';
  END IF;
  RETURN NEW;
END; $$;

-- #8 · Gate de verificación: helper + solo el DOCTOR VERIFICADO ve catálogo/precios
-- y puede crear pedidos ("solo médicos verificados").
CREATE OR REPLACE FUNCTION public.is_verified()
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT COALESCE((SELECT verified FROM public.profiles WHERE id = auth.uid()), false);
$$;
GRANT EXECUTE ON FUNCTION public.is_verified() TO authenticated;

-- Catálogo y disponibilidad: el doctor NO verificado ve VACÍO (precios solo a verificados).
DROP VIEW IF EXISTS public.products_safe;
CREATE VIEW public.products_safe AS
  SELECT id, sku, name, line, category, description, price, unit, image_url, active
  FROM public.products
  WHERE public.auth_role() <> 'doctor' OR public.is_verified();
REVOKE ALL ON public.products_safe FROM anon, public;
GRANT SELECT ON public.products_safe TO authenticated;

CREATE OR REPLACE VIEW public.product_stock AS
  SELECT product_id, COALESCE(SUM(quantity), 0)::int AS available
  FROM public.lots
  WHERE product_id IS NOT NULL
    AND (expiry_date IS NULL OR expiry_date >= current_date)
    AND (public.auth_role() <> 'doctor' OR public.is_verified())
  GROUP BY product_id;
REVOKE ALL ON public.product_stock FROM anon, public;
GRANT SELECT ON public.product_stock TO authenticated;

-- El doctor debe estar verificado para crear su pedido.
DROP POLICY IF EXISTS orders_insert_scoped ON public.orders;
CREATE POLICY orders_insert_scoped ON public.orders FOR INSERT TO authenticated
  WITH CHECK (
    public.auth_role() = 'admin'
    OR (public.auth_role() = 'doctor' AND doctor_id = auth.uid() AND public.is_verified())
    OR public.auth_role() = 'pos'
  );

-- Mi hallazgo · el vendedor (pos) veía TODOS los pedidos. Se acota: pos ve los de
-- SU cartera (doctor cuyo dueño es su correo) + los que él creó/POS. order_vendor()
-- lee el dueño del doctor del pedido sin recursión (SECURITY DEFINER).
CREATE OR REPLACE FUNCTION public.order_vendor_email(o_id uuid)
RETURNS text LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT p.meta ->> 'owner' FROM public.orders o JOIN public.profiles p ON p.id = o.doctor_id WHERE o.id = o_id;
$$;
GRANT EXECUTE ON FUNCTION public.order_vendor_email(uuid) TO authenticated;

DROP POLICY IF EXISTS orders_select_scoped ON public.orders;
CREATE POLICY orders_select_scoped ON public.orders FOR SELECT TO authenticated USING (
  public.auth_role() = 'admin'
  OR doctor_id = auth.uid()
  OR public.auth_role() = ANY (ARRAY['warehouse','packing','billing'])
  OR (public.auth_role() = 'pos' AND (
      public.order_vendor_email(orders.id) = (auth.jwt() ->> 'email')
      OR (shipping_meta ->> 'seller') = (auth.jwt() ->> 'email')
      OR (shipping_meta ->> 'placed_by') IS NOT NULL
  ))
  OR (public.auth_role() = 'driver' AND public.is_order_driver(orders.id))
);

-- #13 · log_audit no confía en el actor declarado: registra el NOMBRE REAL del
-- usuario en sesión (deja el rótulo del área como referencia).
CREATE OR REPLACE FUNCTION public.log_audit(p_action text, p_resource text, p_detail text, p_actor_name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE real_name text;
BEGIN
  SELECT COALESCE(meta ->> 'name', full_name, email) INTO real_name FROM public.profiles WHERE id = auth.uid();
  INSERT INTO public.audit_logs(actor, action, resource_type, resource_id, payload)
  VALUES (auth.uid(), p_action, 'app', p_resource,
    jsonb_build_object('actor_name', COALESCE(real_name, p_actor_name), 'area', p_actor_name, 'detail', p_detail));
END; $$;

-- #6 · Movimiento de inventario ATÓMICO (evita lost update del read-modify-write):
-- actualiza la cantidad y registra el movimiento en una sola operación. Autoriza
-- a quien mueve inventario (incluye pos para ventas). Reutilizable.
CREATE OR REPLACE FUNCTION public.apply_lot_movement(p_lot uuid, p_change int, p_reason text, p_reference text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT (public.auth_role() = ANY (ARRAY['admin','warehouse','packing','pos'])) THEN
    RAISE EXCEPTION 'No autorizado para mover inventario';
  END IF;
  UPDATE public.lots SET quantity = GREATEST(0, quantity + p_change) WHERE id = p_lot;
  INSERT INTO public.inventory_movements(lot_id, change, reason, reference, created_by)
  VALUES (p_lot, p_change, p_reason, p_reference, auth.uid());
END; $$;
GRANT EXECUTE ON FUNCTION public.apply_lot_movement(uuid, int, text, text) TO authenticated;
