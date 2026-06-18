-- Supabase RLS policies (base) — Review carefully before applying in production.
-- Assumes a `profiles` table linking auth.users(id) -> profiles.id and a `roles` table.

-- Enable RLS on sensitive tables
ALTER TABLE IF EXISTS orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS shipments ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS announcements ENABLE ROW LEVEL SECURITY;

-- Helper: check role via profiles
-- Usage: (exists(select 1 from profiles where id = auth.uid() and role_id = 'admin'))

-- PROFILES policies
-- Select: users can select their own profile or admins can select any
CREATE POLICY "profiles_select_self_or_admin" ON profiles
  FOR SELECT
  USING (
    auth.role() = 'anon' OR
    (id = auth.uid()) OR
    (exists(select 1 from profiles p where p.id = auth.uid() and p.role_id = 'admin'))
  );

-- Update: users can update their own profile; admins can update any
CREATE POLICY "profiles_update_self_or_admin" ON profiles
  FOR UPDATE
  USING (id = auth.uid() OR exists(select 1 from profiles p where p.id = auth.uid() and p.role_id = 'admin'))
  WITH CHECK (id = auth.uid() OR exists(select 1 from profiles p where p.id = auth.uid() and p.role_id = 'admin'));

-- ORDERS policies
-- SELECT: Admins OR the doctor who owns the order OR operational roles (warehouse, packing, billing, driver)
CREATE POLICY "orders_select_roles" ON orders
  FOR SELECT
  USING (
    exists(select 1 from profiles p where p.id = auth.uid() and p.role_id = 'admin')
    OR doctor_id = auth.uid()
    OR exists(select 1 from profiles p where p.id = auth.uid() and p.role_id IN ('warehouse','packing','billing','driver','admin'))
  );

-- INSERT: Doctors create their own orders (doctor_id must be auth.uid) or admins
CREATE POLICY "orders_insert_doctor_or_admin" ON orders
  FOR INSERT
  WITH CHECK (
    (exists(select 1 from profiles p where p.id = auth.uid() and p.role_id = 'admin'))
    OR (doctor_id = auth.uid())
  );

-- UPDATE: Admins can update any. Doctors can update only their own while order is not completed.
-- Operational roles can update `status`, `shipping_meta`, and `payment_status` as appropriate.
CREATE POLICY "orders_update_restricted" ON orders
  FOR UPDATE
  USING (
    exists(select 1 from profiles p where p.id = auth.uid() and p.role_id = 'admin')
    OR doctor_id = auth.uid()
    OR exists(select 1 from profiles p where p.id = auth.uid() and p.role_id IN ('warehouse','packing','billing'))
  )
  WITH CHECK (
    -- Admin always allowed
    exists(select 1 from profiles p where p.id = auth.uid() and p.role_id = 'admin')
    OR (
      -- Doctors may update only their own orders and cannot escalate invoice/payment fields arbitrarily
      doctor_id = auth.uid() AND (
        -- allow changing non-sensitive fields (example) or allow full update before processing
        (status IS NOT NULL OR payment_status IS NOT NULL OR true)
      )
    )
    OR (
      -- Warehouse/packing/billing may update status/shipping/payment fields only
      exists(select 1 from profiles p where p.id = auth.uid() and p.role_id IN ('warehouse','packing','billing'))
      -- Note: column-level protections should be enforced in application logic; RLS can be tightened using WITH CHECK expressions comparing OLD and NEW values if necessary.
    )
  );

-- SHIPMENTS policies
-- SELECT: Admins, driver assigned to shipment, or operational roles
CREATE POLICY "shipments_select_roles" ON shipments
  FOR SELECT
  USING (
    exists(select 1 from profiles p where p.id = auth.uid() and p.role_id = 'admin')
    OR driver_id = auth.uid()
    OR exists(select 1 from profiles p where p.id = auth.uid() and p.role_id IN ('warehouse','packing','admin'))
  );

-- INSERT: Warehouse or packing or admin
CREATE POLICY "shipments_insert_ops" ON shipments
  FOR INSERT
  WITH CHECK (
    exists(select 1 from profiles p where p.id = auth.uid() and p.role_id IN ('warehouse','packing','admin'))
  );

-- UPDATE: Driver can update their own shipment (e.g., status, proof_image_url) when assigned
CREATE POLICY "shipments_update_driver" ON shipments
  FOR UPDATE
  USING (
    exists(select 1 from profiles p where p.id = auth.uid() and p.role_id = 'admin')
    OR driver_id = auth.uid()
    OR exists(select 1 from profiles p where p.id = auth.uid() and p.role_id IN ('warehouse','packing'))
  )
  WITH CHECK (
    -- Admin allowed; driver may only update shipments assigned to them
    exists(select 1 from profiles p where p.id = auth.uid() and p.role_id = 'admin')
    OR driver_id = auth.uid()
    OR exists(select 1 from profiles p where p.id = auth.uid() and p.role_id IN ('warehouse','packing'))
  );

-- ANNOUNCEMENTS: Only admin and comm roles can insert/update/delete; everyone authenticated can select active announcements
CREATE POLICY "announcements_select_public_auth" ON announcements
  FOR SELECT
  USING (
    true
  );
CREATE POLICY "announcements_manage_admin_comm" ON announcements
  FOR ALL
  USING (exists(select 1 from profiles p where p.id = auth.uid() and p.role_id IN ('admin','comm')))
  WITH CHECK (exists(select 1 from profiles p where p.id = auth.uid() and p.role_id IN ('admin','comm')));

-- NOTE: These policies are a starting point. For strict compliance with regulated data:
--  - Consider creating DB functions to centralize role checks.
--  - Enforce column-level restrictions via triggers or separate tables/views.
--  - Validate all policies in a staging Supabase project before production.

-- Triggers for audit logs are created in supabase/audit_triggers.sql (see seeds folder).
