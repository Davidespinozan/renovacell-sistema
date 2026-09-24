-- ============================================================================
-- CUENTAS BANCARIAS de Renovacell (varias, con CLABEs distintas). Reemplaza el
-- modelo 1:1 de company_settings.{banco,titular,clabe,cuenta} por una tabla
-- normalizada. Las columnas legacy quedan DEPRECATED (no se borran en esta fase).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.company_bank_accounts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_name        text NOT NULL,
  beneficiary_name text NOT NULL,
  clabe            text,
  account_number   text,
  active           boolean NOT NULL DEFAULT true,
  is_default       boolean NOT NULL DEFAULT false,
  display_order    integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  -- CLABE de 18 dígitos cuando exista (nullable permitido).
  CONSTRAINT ck_bank_clabe_18 CHECK (clabe IS NULL OR clabe ~ '^[0-9]{18}$')
);

-- Solo UNA cuenta puede ser principal/default.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bank_one_default
  ON public.company_bank_accounts ((is_default)) WHERE is_default;

ALTER TABLE public.company_bank_accounts ENABLE ROW LEVEL SECURITY;

-- Lectura: cualquier autenticado ve las ACTIVAS (el doctor las necesita para
-- transferir); las inactivas solo Dirección (auditoría/historial).
DROP POLICY IF EXISTS company_bank_read ON public.company_bank_accounts;
CREATE POLICY company_bank_read ON public.company_bank_accounts
  FOR SELECT TO authenticated
  USING (active OR public.auth_role() = 'admin');

-- Mutación: solo Dirección (admin).
DROP POLICY IF EXISTS company_bank_write ON public.company_bank_accounts;
CREATE POLICY company_bank_write ON public.company_bank_accounts
  FOR ALL TO authenticated
  USING (public.auth_role() = 'admin')
  WITH CHECK (public.auth_role() = 'admin');

-- Migración de la cuenta legacy (si company_settings tiene datos reales). No crea
-- registros ficticios; solo si hay CLABE o banco. Queda ACTIVA y como principal.
DO $$
DECLARE c record;
BEGIN
  SELECT banco, titular, clabe, cuenta INTO c FROM public.company_settings WHERE id = 'default';
  IF c IS NOT NULL AND (coalesce(c.clabe,'') <> '' OR coalesce(c.banco,'') <> '') THEN
    IF NOT EXISTS (SELECT 1 FROM public.company_bank_accounts) THEN
      INSERT INTO public.company_bank_accounts (bank_name, beneficiary_name, clabe, account_number, active, is_default, display_order)
      VALUES (
        coalesce(nullif(c.banco,''), 'Banco'),
        coalesce(nullif(c.titular,''), 'Renovacell'),
        nullif(c.clabe,''),
        nullif(c.cuenta,''),
        true, true, 0
      );
    END IF;
  END IF;
END $$;
