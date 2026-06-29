-- Supabase schema (propuesta inicial)
-- Run as migration in supabase SQL editor. Ajustar nombres de esquemas/schemas según convención.
-- Orden de ejecución: schema.sql -> rls.sql -> audit_triggers.sql -> seeds/

-- gen_random_uuid() vive en pgcrypto (algunos proyectos lo requieren explícito)
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Roles table (managed by auth but useful for RBAC mapping)
CREATE TABLE IF NOT EXISTS roles (
  id text PRIMARY KEY,
  description text
);

-- Catálogo de roles del sistema (RBAC: "una base, varias puertas")
INSERT INTO roles (id, description) VALUES
  ('admin',     'Dirección / administración — acceso total'),
  ('doctor',    'Médico cliente — portal de pedidos'),
  ('warehouse', 'Almacén — existencias, FEFO, entradas'),
  ('packing',   'Empaque — cola, guías, recibos'),
  ('pos',       'Punto de venta — caja en eventos'),
  ('billing',   'Facturación / finanzas — CFDI y pagos'),
  ('driver',    'Chofer — entregas y prueba de entrega'),
  ('comm',      'Comunicación interna — anuncios y prospectos')
ON CONFLICT (id) DO NOTHING;

-- Users (supabase auth stores users; keep profile data here)
CREATE TABLE IF NOT EXISTS profiles (
  id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  email text,
  full_name text,
  role_id text REFERENCES roles(id),
  verified boolean DEFAULT false,
  organization text,
  meta jsonb,
  PRIMARY KEY (id)
);

-- Products and lots (trazabilidad / FEFO)
CREATE TABLE IF NOT EXISTS products (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  sku text UNIQUE NOT NULL,
  name text NOT NULL,
  line text,
  category text,
  description text,
  price numeric,
  unit text,
  image_url text,
  metadata jsonb
);

-- Costos / margen: SEPARADO de products a propósito. products es el catálogo
-- VENDIBLE (precio de venta); los costos viven aquí y solo los ve admin/billing.
-- Así un doctor (o cualquier autenticado) nunca puede leer el costo, ni aunque
-- se agreguen columnas nuevas — la barrera es la tabla, no la columna.
CREATE TABLE IF NOT EXISTS product_costs (
  product_id uuid PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  unit_cost numeric,
  supplier text,
  notes text,
  metadata jsonb,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lots (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id uuid REFERENCES products(id) ON DELETE CASCADE,
  lot_code text NOT NULL,
  manufacture_date date,
  expiry_date date,
  quantity integer NOT NULL DEFAULT 0,
  location text,
  metadata jsonb
);

-- Inventory movement (FEFO, entradas/salidas)
CREATE TABLE IF NOT EXISTS inventory_movements (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  lot_id uuid REFERENCES lots(id),
  change integer NOT NULL,
  reason text,
  reference text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);

-- Orders and order items (pedidos contra pedido)
CREATE TABLE IF NOT EXISTS orders (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  external_ref text,
  doctor_id uuid REFERENCES profiles(id),
  total numeric,
  currency text DEFAULT 'MXN',
  status text DEFAULT 'draft',
  payment_method text,
  payment_ref text,
  payment_status text DEFAULT 'pending',
  stripe_payment_id text,
  invoice_requested boolean DEFAULT false,
  invoice_meta jsonb,
  shipping_meta jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  product_id uuid REFERENCES products(id),
  lot_id uuid REFERENCES lots(id),
  qty integer NOT NULL,
  unit_price numeric,
  created_at timestamptz DEFAULT now()
);

-- Shipments / expeditions
CREATE TABLE IF NOT EXISTS shipments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id uuid REFERENCES orders(id) ON DELETE CASCADE,
  carrier text,
  tracking_number text,
  driver_id uuid REFERENCES profiles(id),
  status text,
  estimated_delivery_at timestamptz,
  delivered_at timestamptz,
  proof_image_url text,
  received_by text,
  incident jsonb,
  created_at timestamptz DEFAULT now()
);

-- Prospects captured by the landing / AI agent
CREATE TABLE IF NOT EXISTS prospects (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text,
  email text,
  phone text,
  cedula text,
  source text,
  status text,
  assigned_to uuid REFERENCES profiles(id),
  meta jsonb,
  created_at timestamptz DEFAULT now()
);

-- Announcements for lobby
CREATE TABLE IF NOT EXISTS announcements (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  body text,
  start_at timestamptz,
  end_at timestamptz,
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  metadata jsonb
);

-- Assets (images, logos) stored in Supabase Storage but track references
CREATE TABLE IF NOT EXISTS assets (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  key text UNIQUE,
  url text,
  uploaded_by uuid REFERENCES profiles(id),
  tags text[],
  metadata jsonb,
  created_at timestamptz DEFAULT now()
);

-- Audit log (immutable append)
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  actor uuid REFERENCES auth.users(id),
  action text,
  resource_type text,
  resource_id text,
  payload jsonb,
  created_at timestamptz DEFAULT now()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_lots_expiry ON lots(expiry_date);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);

-- Las políticas RLS, funciones helper y triggers de seguridad viven en
-- rls.sql (este paquete; ejecutar DESPUÉS de este archivo). No definir políticas aquí.
