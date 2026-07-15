-- LISTAS DE PRECIOS (niveles) por cliente — Portal del Doctor "precios por cliente".
-- Modelo: la lista "General" (is_default) usa el precio BASE del producto (products.price);
-- las demás listas (Mayoreo, VIP…) guardan overrides por producto en `product_prices`.
-- Cada doctor se asigna a una lista (profiles.price_list_id); si no tiene, ve el base.

CREATE TABLE IF NOT EXISTS price_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  sort int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);
ALTER TABLE price_lists ENABLE ROW LEVEL SECURITY;

-- Lista base "General" (infraestructura; renombrable/gestionable por Dirección).
INSERT INTO price_lists (id, name, is_default, sort)
VALUES ('00000000-0000-4000-c000-000000000001', 'General', true, 0)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS product_prices (
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  list_id uuid NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  price numeric NOT NULL,
  updated_at timestamptz DEFAULT now(),
  PRIMARY KEY (product_id, list_id)
);
ALTER TABLE product_prices ENABLE ROW LEVEL SECURITY;

-- Lista asignada al doctor.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS price_list_id uuid REFERENCES price_lists(id);

-- ---- RLS ----
-- price_lists: todos los autenticados leen los nombres; Dirección/Facturación gestionan.
DROP POLICY IF EXISTS price_lists_read ON price_lists;
CREATE POLICY price_lists_read ON price_lists FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS price_lists_write ON price_lists;
CREATE POLICY price_lists_write ON price_lists FOR ALL TO authenticated
  USING (public.auth_role() = ANY (ARRAY['admin','billing']))
  WITH CHECK (public.auth_role() = ANY (ARRAY['admin','billing']));

-- product_prices: el staff ve todo; el DOCTOR solo ve los precios de SU lista (no espía
-- otras listas). Dirección/Facturación escriben.
DROP POLICY IF EXISTS product_prices_read ON product_prices;
CREATE POLICY product_prices_read ON product_prices FOR SELECT TO authenticated USING (
  public.auth_role() = ANY (ARRAY['admin','billing','pos','warehouse','packing','comm'])
  OR list_id = (SELECT price_list_id FROM public.profiles WHERE id = auth.uid())
);
DROP POLICY IF EXISTS product_prices_write ON product_prices;
CREATE POLICY product_prices_write ON product_prices FOR ALL TO authenticated
  USING (public.auth_role() = ANY (ARRAY['admin','billing']))
  WITH CHECK (public.auth_role() = ANY (ARRAY['admin','billing']));
