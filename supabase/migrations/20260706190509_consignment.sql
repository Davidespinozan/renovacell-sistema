-- CONSIGNACIÓN por vendedor (saldo permanente). vendor = correo del vendedor;
-- el RLS lo acota con el email del JWT (el vendedor ve/gestiona lo suyo; almacén
-- y admin todo). El descuento/reingreso de lotes vive en inventory_movements.
CREATE TABLE IF NOT EXISTS public.consignment_stock (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor text NOT NULL,
  product_id uuid REFERENCES public.products(id),
  assigned integer NOT NULL DEFAULT 0,
  sold integer NOT NULL DEFAULT 0,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (vendor, product_id)
);
ALTER TABLE public.consignment_stock ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS consignment_all ON public.consignment_stock;
CREATE POLICY consignment_all ON public.consignment_stock FOR ALL TO authenticated
  USING (public.auth_role() = ANY (ARRAY['admin','warehouse','packing']) OR vendor = (auth.jwt() ->> 'email'))
  WITH CHECK (public.auth_role() = ANY (ARRAY['admin','warehouse','packing']) OR vendor = (auth.jwt() ->> 'email'));
