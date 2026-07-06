-- GASTOS (egresos operativos, solo Dirección/Finanzas).
CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  fecha date NOT NULL,
  categoria text NOT NULL,
  concepto text NOT NULL,
  monto numeric NOT NULL,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS expenses_all_finanzas ON public.expenses;
CREATE POLICY expenses_all_finanzas ON public.expenses FOR ALL TO authenticated
  USING (public.auth_role() = ANY (ARRAY['admin','billing']))
  WITH CHECK (public.auth_role() = ANY (ARRAY['admin','billing']));

-- CIERRES DE CAJA (arqueo).
CREATE TABLE IF NOT EXISTS public.cash_closings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  fecha date NOT NULL,
  alcance text NOT NULL,
  esperado numeric NOT NULL,
  contado numeric NOT NULL,
  diferencia numeric NOT NULL,
  motivo text,
  usuario text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.cash_closings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cash_closings_all ON public.cash_closings;
CREATE POLICY cash_closings_all ON public.cash_closings FOR ALL TO authenticated
  USING (public.auth_role() = ANY (ARRAY['admin','billing','pos']))
  WITH CHECK (public.auth_role() = ANY (ARRAY['admin','billing','pos']));

-- REABASTECIMIENTOS (compras/producción).
CREATE TABLE IF NOT EXISTS public.replenishments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  product_id uuid REFERENCES public.products(id),
  product_name text,
  qty integer NOT NULL,
  unit_cost numeric NOT NULL,
  kind text NOT NULL,
  supplier text,
  status text NOT NULL DEFAULT 'pendiente',
  paid boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE public.replenishments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS replenishments_select ON public.replenishments;
CREATE POLICY replenishments_select ON public.replenishments FOR SELECT TO authenticated
  USING (public.auth_role() = ANY (ARRAY['admin','warehouse','packing','billing']));
DROP POLICY IF EXISTS replenishments_insert ON public.replenishments;
CREATE POLICY replenishments_insert ON public.replenishments FOR INSERT TO authenticated
  WITH CHECK (public.auth_role() = ANY (ARRAY['admin','billing']));
DROP POLICY IF EXISTS replenishments_update ON public.replenishments;
CREATE POLICY replenishments_update ON public.replenishments FOR UPDATE TO authenticated
  USING (public.auth_role() = ANY (ARRAY['admin','warehouse','billing']))
  WITH CHECK (public.auth_role() = ANY (ARRAY['admin','warehouse','billing']));
