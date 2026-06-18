-- ============================================================================
-- Renovacell — Row Level Security (RLS), helpers y triggers de seguridad
-- Ejecutar DESPUÉS de schema.sql y ANTES de audit_triggers.sql.
--
-- Modelo "una base, varias puertas": default-deny en TODAS las tablas; cada rol
-- ve y modifica únicamente lo que le corresponde. El rol `anon` (clave pública
-- de Supabase) NO tiene acceso a ningún dato — ni siquiera de solo lectura.
--
-- El rol `service_role` (clave secreta, solo backend/migraciones/seeds) ignora
-- RLS por diseño; nunca debe exponerse al cliente.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 0) Helpers de rol (SECURITY DEFINER para evitar recursión en policies de
--    profiles: la función lee profiles como owner, saltándose RLS).
-- ----------------------------------------------------------------------------

-- Rol del usuario autenticado actual (NULL si anónimo o sin perfil).
CREATE OR REPLACE FUNCTION public.auth_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role_id FROM public.profiles WHERE id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.auth_role() FROM public;
GRANT EXECUTE ON FUNCTION public.auth_role() TO authenticated;

-- ----------------------------------------------------------------------------
-- 1) Alta automática de perfil al registrarse (rol 'doctor', NO verificado).
--    El acceso real al portal se habilita cuando un admin pone verified = true.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role_id, verified)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    'doctor',
    false
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ----------------------------------------------------------------------------
-- 2) Habilitar RLS en TODAS las tablas del esquema public
-- ----------------------------------------------------------------------------
ALTER TABLE roles                ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles             ENABLE ROW LEVEL SECURITY;
ALTER TABLE products             ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_costs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE lots                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_movements  ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders               ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE shipments            ENABLE ROW LEVEL SECURITY;
ALTER TABLE prospects            ENABLE ROW LEVEL SECURITY;
ALTER TABLE announcements        ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets               ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs           ENABLE ROW LEVEL SECURITY;

-- ============================================================================
-- 3) POLÍTICAS POR TABLA
--    Convención: lo no permitido explícitamente queda denegado.
-- ============================================================================

-- ---------- ROLES (catálogo de referencia) ----------------------------------
DROP POLICY IF EXISTS roles_select_auth ON roles;
CREATE POLICY roles_select_auth ON roles
  FOR SELECT TO authenticated
  USING (true);
-- Escritura: solo service_role (sin policy de write -> denegado a clientes).

-- ---------- PROFILES (PII: email, nombre, organización) ---------------------
-- SELECT: el propio usuario o un admin. NADA de anon. Staff no lee PII de otros.
DROP POLICY IF EXISTS profiles_select_self_or_admin ON profiles;
CREATE POLICY profiles_select_self_or_admin ON profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.auth_role() = 'admin');

-- INSERT: cada quien crea su propio perfil (respaldo al trigger); admin cualquiera.
DROP POLICY IF EXISTS profiles_insert_self_or_admin ON profiles;
CREATE POLICY profiles_insert_self_or_admin ON profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid() OR public.auth_role() = 'admin');

-- UPDATE: el propio usuario o admin. La inmutabilidad de role_id/verified para
-- no-admins la garantiza el trigger profiles_guard (ver más abajo).
DROP POLICY IF EXISTS profiles_update_self_or_admin ON profiles;
CREATE POLICY profiles_update_self_or_admin ON profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.auth_role() = 'admin')
  WITH CHECK (id = auth.uid() OR public.auth_role() = 'admin');

-- DELETE: solo admin.
DROP POLICY IF EXISTS profiles_delete_admin ON profiles;
CREATE POLICY profiles_delete_admin ON profiles
  FOR DELETE TO authenticated
  USING (public.auth_role() = 'admin');

-- ---------- PRODUCTS (catálogo) ---------------------------------------------
-- Lectura para cualquier usuario autenticado (doctores y staff lo necesitan).
-- NOTA: la landing pública NO lee esta tabla directo; cuando se construya el
-- Módulo 1 se expondrá un catálogo público vía vista/Edge Function con solo
-- las columnas seguras. Por ahora: sin acceso anon.
DROP POLICY IF EXISTS products_select_auth ON products;
CREATE POLICY products_select_auth ON products
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS products_write_admin ON products;
CREATE POLICY products_write_admin ON products
  FOR ALL TO authenticated
  USING (public.auth_role() = 'admin')
  WITH CHECK (public.auth_role() = 'admin');

-- ---------- PRODUCT_COSTS (costo/margen — CONFIDENCIAL) ----------------------
-- Solo admin y facturación. Un doctor o staff operativo NUNCA lee el costo.
DROP POLICY IF EXISTS product_costs_admin_billing ON product_costs;
CREATE POLICY product_costs_admin_billing ON product_costs
  FOR ALL TO authenticated
  USING (public.auth_role() = ANY (ARRAY['admin','billing']))
  WITH CHECK (public.auth_role() = ANY (ARRAY['admin','billing']));

-- ---------- LOTS (inventario por lote / FEFO) -------------------------------
DROP POLICY IF EXISTS lots_select_ops ON lots;
CREATE POLICY lots_select_ops ON lots
  FOR SELECT TO authenticated
  USING (public.auth_role() = ANY (ARRAY['admin','warehouse','packing','pos','billing']));

DROP POLICY IF EXISTS lots_write_warehouse ON lots;
CREATE POLICY lots_write_warehouse ON lots
  FOR ALL TO authenticated
  USING (public.auth_role() = ANY (ARRAY['admin','warehouse']))
  WITH CHECK (public.auth_role() = ANY (ARRAY['admin','warehouse']));

-- ---------- INVENTORY_MOVEMENTS (entradas/salidas, idealmente append-only) ---
DROP POLICY IF EXISTS invmov_select_ops ON inventory_movements;
CREATE POLICY invmov_select_ops ON inventory_movements
  FOR SELECT TO authenticated
  USING (public.auth_role() = ANY (ARRAY['admin','warehouse','packing','pos']));

DROP POLICY IF EXISTS invmov_insert_ops ON inventory_movements;
CREATE POLICY invmov_insert_ops ON inventory_movements
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_role() = ANY (ARRAY['admin','warehouse','packing','pos']));
-- Sin UPDATE/DELETE para clientes (movimientos inmutables; correcciones por admin vía service_role).

-- ---------- ORDERS (pedidos) ------------------------------------------------
-- SELECT: admin (todo); el doctor dueño; staff operativo; el chofer SOLO los
-- pedidos con un envío asignado a él.
DROP POLICY IF EXISTS orders_select_scoped ON orders;
CREATE POLICY orders_select_scoped ON orders
  FOR SELECT TO authenticated
  USING (
    public.auth_role() = 'admin'
    OR doctor_id = auth.uid()
    OR public.auth_role() = ANY (ARRAY['warehouse','packing','billing','pos'])
    OR (
      public.auth_role() = 'driver'
      AND EXISTS (
        SELECT 1 FROM shipments s
        WHERE s.order_id = orders.id AND s.driver_id = auth.uid()
      )
    )
  );

-- INSERT: el doctor crea SU pedido (doctor_id = auth.uid()); admin/pos también.
DROP POLICY IF EXISTS orders_insert_scoped ON orders;
CREATE POLICY orders_insert_scoped ON orders
  FOR INSERT TO authenticated
  WITH CHECK (
    public.auth_role() = 'admin'
    OR (public.auth_role() = 'doctor' AND doctor_id = auth.uid())
    OR public.auth_role() = 'pos'
  );

-- UPDATE: admin; el doctor solo su pedido en etapa temprana; staff operativo.
-- La protección a nivel de COLUMNA (que el doctor no marque pagado, etc.) la
-- impone el trigger orders_guard.
DROP POLICY IF EXISTS orders_update_scoped ON orders;
CREATE POLICY orders_update_scoped ON orders
  FOR UPDATE TO authenticated
  USING (
    public.auth_role() = 'admin'
    OR (public.auth_role() = 'doctor' AND doctor_id = auth.uid())
    OR public.auth_role() = ANY (ARRAY['warehouse','packing','billing'])
  )
  WITH CHECK (
    public.auth_role() = 'admin'
    OR (public.auth_role() = 'doctor' AND doctor_id = auth.uid())
    OR public.auth_role() = ANY (ARRAY['warehouse','packing','billing'])
  );

-- DELETE: solo admin.
DROP POLICY IF EXISTS orders_delete_admin ON orders;
CREATE POLICY orders_delete_admin ON orders
  FOR DELETE TO authenticated
  USING (public.auth_role() = 'admin');

-- ---------- ORDER_ITEMS (renglones; heredan el alcance de su pedido) --------
DROP POLICY IF EXISTS order_items_select_scoped ON order_items;
CREATE POLICY order_items_select_scoped ON order_items
  FOR SELECT TO authenticated
  USING (
    public.auth_role() = ANY (ARRAY['admin','warehouse','packing','billing','pos'])
    OR EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id AND o.doctor_id = auth.uid()
    )
  );

-- INSERT: admin/pos, o el doctor sobre un pedido propio.
DROP POLICY IF EXISTS order_items_insert_scoped ON order_items;
CREATE POLICY order_items_insert_scoped ON order_items
  FOR INSERT TO authenticated
  WITH CHECK (
    public.auth_role() = ANY (ARRAY['admin','pos'])
    OR EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id
        AND o.doctor_id = auth.uid()
        AND public.auth_role() = 'doctor'
    )
  );

-- UPDATE: admin; almacén/empaque (asignar lot_id en surtido FEFO); el doctor
-- solo sobre pedido propio (su capacidad real la acota el trigger orders_guard
-- a través del estado del pedido).
DROP POLICY IF EXISTS order_items_update_scoped ON order_items;
CREATE POLICY order_items_update_scoped ON order_items
  FOR UPDATE TO authenticated
  USING (
    public.auth_role() = ANY (ARRAY['admin','warehouse','packing'])
    OR EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id AND o.doctor_id = auth.uid()
    )
  )
  WITH CHECK (
    public.auth_role() = ANY (ARRAY['admin','warehouse','packing'])
    OR EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id AND o.doctor_id = auth.uid()
    )
  );

-- DELETE: admin, o el doctor sobre su pedido.
DROP POLICY IF EXISTS order_items_delete_scoped ON order_items;
CREATE POLICY order_items_delete_scoped ON order_items
  FOR DELETE TO authenticated
  USING (
    public.auth_role() = 'admin'
    OR EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = order_items.order_id AND o.doctor_id = auth.uid()
    )
  );

-- ---------- SHIPMENTS (envíos) ----------------------------------------------
-- SELECT: admin; chofer asignado; almacén/empaque; y el doctor dueño del pedido
-- (para rastrear su envío).
DROP POLICY IF EXISTS shipments_select_scoped ON shipments;
CREATE POLICY shipments_select_scoped ON shipments
  FOR SELECT TO authenticated
  USING (
    public.auth_role() = ANY (ARRAY['admin','warehouse','packing'])
    OR driver_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM orders o
      WHERE o.id = shipments.order_id AND o.doctor_id = auth.uid()
    )
  );

-- INSERT: almacén/empaque/admin.
DROP POLICY IF EXISTS shipments_insert_ops ON shipments;
CREATE POLICY shipments_insert_ops ON shipments
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_role() = ANY (ARRAY['admin','warehouse','packing']));

-- UPDATE: admin; almacén/empaque; chofer SOLO su envío. La restricción de
-- columnas para el chofer (solo estado/entrega/prueba) la impone shipments_guard.
DROP POLICY IF EXISTS shipments_update_scoped ON shipments;
CREATE POLICY shipments_update_scoped ON shipments
  FOR UPDATE TO authenticated
  USING (
    public.auth_role() = ANY (ARRAY['admin','warehouse','packing'])
    OR driver_id = auth.uid()
  )
  WITH CHECK (
    public.auth_role() = ANY (ARRAY['admin','warehouse','packing'])
    OR driver_id = auth.uid()
  );

-- DELETE: solo admin.
DROP POLICY IF EXISTS shipments_delete_admin ON shipments;
CREATE POLICY shipments_delete_admin ON shipments
  FOR DELETE TO authenticated
  USING (public.auth_role() = 'admin');

-- ---------- PROSPECTS (PII sensible: cédula, teléfono, email) ----------------
-- Solo admin/comm gestionan; un usuario asignado ve los suyos. SIN acceso anon.
-- La captación pública (landing + agente IA) NO escribirá aquí en directo:
-- se hará vía Edge Function / RPC SECURITY DEFINER con validación y rate-limit
-- cuando se construya el Módulo 1. Hoy queda cerrado a clientes anónimos.
DROP POLICY IF EXISTS prospects_select_scoped ON prospects;
CREATE POLICY prospects_select_scoped ON prospects
  FOR SELECT TO authenticated
  USING (
    public.auth_role() = ANY (ARRAY['admin','comm'])
    OR assigned_to = auth.uid()
  );

DROP POLICY IF EXISTS prospects_insert_staff ON prospects;
CREATE POLICY prospects_insert_staff ON prospects
  FOR INSERT TO authenticated
  WITH CHECK (public.auth_role() = ANY (ARRAY['admin','comm']));

DROP POLICY IF EXISTS prospects_update_scoped ON prospects;
CREATE POLICY prospects_update_scoped ON prospects
  FOR UPDATE TO authenticated
  USING (public.auth_role() = ANY (ARRAY['admin','comm']) OR assigned_to = auth.uid())
  WITH CHECK (public.auth_role() = ANY (ARRAY['admin','comm']) OR assigned_to = auth.uid());

DROP POLICY IF EXISTS prospects_delete_admin ON prospects;
CREATE POLICY prospects_delete_admin ON prospects
  FOR DELETE TO authenticated
  USING (public.auth_role() = 'admin');

-- ---------- ANNOUNCEMENTS (lobby interno) -----------------------------------
-- SELECT: cualquier usuario autenticado (staff). NO anon. Gestión: admin/comm.
DROP POLICY IF EXISTS announcements_select_auth ON announcements;
CREATE POLICY announcements_select_auth ON announcements
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS announcements_manage_admin_comm ON announcements;
CREATE POLICY announcements_manage_admin_comm ON announcements
  FOR ALL TO authenticated
  USING (public.auth_role() = ANY (ARRAY['admin','comm']))
  WITH CHECK (public.auth_role() = ANY (ARRAY['admin','comm']));

-- ---------- ASSETS (biblioteca de logos/imágenes internas) -------------------
DROP POLICY IF EXISTS assets_select_auth ON assets;
CREATE POLICY assets_select_auth ON assets
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS assets_manage_admin_comm ON assets;
CREATE POLICY assets_manage_admin_comm ON assets
  FOR ALL TO authenticated
  USING (public.auth_role() = ANY (ARRAY['admin','comm']))
  WITH CHECK (public.auth_role() = ANY (ARRAY['admin','comm']));

-- ---------- AUDIT_LOGS (bitácora inmutable) ---------------------------------
-- Lectura solo admin. La escritura ocurre vía trigger SECURITY DEFINER
-- (audit_triggers.sql), que ignora RLS; por eso NO hay policy de INSERT
-- (los clientes no pueden escribir directo). Sin UPDATE/DELETE: inmutable.
DROP POLICY IF EXISTS audit_logs_select_admin ON audit_logs;
CREATE POLICY audit_logs_select_admin ON audit_logs
  FOR SELECT TO authenticated
  USING (public.auth_role() = 'admin');

-- ============================================================================
-- 4) TRIGGERS DE PROTECCIÓN A NIVEL DE COLUMNA
--    RLS gobierna filas; estos triggers gobiernan QUÉ campos puede tocar cada
--    rol dentro de una fila a la que sí tiene acceso.
-- ============================================================================

-- ---------- profiles: anti escalación de privilegios ------------------------
-- Un no-admin no puede cambiar su propio role_id ni su verified.
CREATE OR REPLACE FUNCTION public.profiles_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.auth_role() = 'admin' THEN
    RETURN NEW;
  END IF;
  IF NEW.role_id IS DISTINCT FROM OLD.role_id
     OR NEW.verified IS DISTINCT FROM OLD.verified THEN
    RAISE EXCEPTION 'No autorizado: no puedes modificar role_id ni verified';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_guard_trg ON profiles;
CREATE TRIGGER profiles_guard_trg
BEFORE UPDATE ON profiles
FOR EACH ROW EXECUTE FUNCTION public.profiles_guard();

-- ---------- orders: protección de campos financieros y de estado -------------
CREATE OR REPLACE FUNCTION public.orders_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r text := public.auth_role();
BEGIN
  IF r = 'admin' THEN
    RETURN NEW;
  END IF;

  -- DOCTOR: solo su pedido, solo en etapa temprana, sin tocar dinero/identidad.
  IF r = 'doctor' AND OLD.doctor_id = auth.uid() THEN
    IF OLD.status IS NOT NULL AND OLD.status NOT IN ('draft','pending_payment') THEN
      RAISE EXCEPTION 'No autorizado: el pedido ya está en proceso';
    END IF;
    IF NEW.doctor_id        IS DISTINCT FROM OLD.doctor_id
       OR NEW.total         IS DISTINCT FROM OLD.total
       OR NEW.currency      IS DISTINCT FROM OLD.currency
       OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
       OR NEW.payment_ref   IS DISTINCT FROM OLD.payment_ref
       OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
       OR NEW.stripe_payment_id IS DISTINCT FROM OLD.stripe_payment_id
       OR NEW.invoice_meta  IS DISTINCT FROM OLD.invoice_meta THEN
      RAISE EXCEPTION 'No autorizado: no puedes modificar campos financieros del pedido';
    END IF;
    RETURN NEW;
  END IF;

  -- ALMACÉN / EMPAQUE: solo logística (estado, shipping_meta). Nada de dinero.
  IF r IN ('warehouse','packing') THEN
    IF NEW.doctor_id        IS DISTINCT FROM OLD.doctor_id
       OR NEW.total         IS DISTINCT FROM OLD.total
       OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
       OR NEW.payment_ref   IS DISTINCT FROM OLD.payment_ref
       OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
       OR NEW.stripe_payment_id IS DISTINCT FROM OLD.stripe_payment_id
       OR NEW.invoice_meta  IS DISTINCT FROM OLD.invoice_meta THEN
      RAISE EXCEPTION 'No autorizado: almacén/empaque solo actualiza estado y envío';
    END IF;
    RETURN NEW;
  END IF;

  -- FACTURACIÓN: campos de pago/factura, nunca doctor ni total.
  IF r = 'billing' THEN
    IF NEW.doctor_id IS DISTINCT FROM OLD.doctor_id
       OR NEW.total  IS DISTINCT FROM OLD.total THEN
      RAISE EXCEPTION 'No autorizado: facturación no modifica doctor ni total';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'No autorizado';
END;
$$;

DROP TRIGGER IF EXISTS orders_guard_trg ON orders;
CREATE TRIGGER orders_guard_trg
BEFORE UPDATE ON orders
FOR EACH ROW EXECUTE FUNCTION public.orders_guard();

-- ---------- shipments: el chofer solo estado/entrega/prueba ------------------
CREATE OR REPLACE FUNCTION public.shipments_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r text := public.auth_role();
BEGIN
  IF r = 'admin' OR r IN ('warehouse','packing') THEN
    RETURN NEW;
  END IF;

  IF r = 'driver' AND OLD.driver_id = auth.uid() THEN
    IF NEW.order_id        IS DISTINCT FROM OLD.order_id
       OR NEW.driver_id    IS DISTINCT FROM OLD.driver_id
       OR NEW.carrier      IS DISTINCT FROM OLD.carrier
       OR NEW.tracking_number IS DISTINCT FROM OLD.tracking_number THEN
      RAISE EXCEPTION 'No autorizado: el chofer solo actualiza estado, entrega y prueba';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'No autorizado';
END;
$$;

DROP TRIGGER IF EXISTS shipments_guard_trg ON shipments;
CREATE TRIGGER shipments_guard_trg
BEFORE UPDATE ON shipments
FOR EACH ROW EXECUTE FUNCTION public.shipments_guard();

-- ============================================================================
-- NOTAS
--  - service_role (clave secreta) ignora RLS: úsalo SOLO en backend/seeds.
--  - Captación pública de prospectos y catálogo público: pendientes para el
--    Módulo 1 vía Edge Function / vista con columnas seguras (sin abrir anon).
--  - Validar todas las políticas en un proyecto Supabase de staging antes de
--    producción (probar cada rol: doctor, warehouse, packing, pos, billing,
--    driver, comm, admin).
-- ============================================================================
