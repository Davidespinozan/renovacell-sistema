-- ALERTAS AUTOMÁTICAS (aprendido de sala-studio): avisar SOLO se hacía al abrir la
-- pantalla (pull). Un lote caducado (dinero perdido) o una cuenta por cobrar vencida
-- podían pasar desapercibidos si nadie entraba. Aquí: funciones set-based e
-- IDEMPOTENTES (columna-sello para no repetir el aviso a diario) + agendado por pg_cron.
-- Corre como service_role (no llamable por usuarios). Si pg_cron no está disponible en
-- el proyecto, las funciones quedan listas y el agendado se hace aparte (Edge/manual).

-- Sellos de "ya avisado" (evitan spam diario del mismo lote/pedido).
ALTER TABLE public.lots   ADD COLUMN IF NOT EXISTS caducidad_avisada_at timestamptz;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS cobranza_avisada_at  timestamptz;

-- 1) Lotes por caducar / caducados con existencia → avisa a Almacén y Dirección.
CREATE OR REPLACE FUNCTION public.avisar_lotes_por_caducar()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int := 0; r record;
BEGIN
  FOR r IN
    SELECT l.id, l.lot_code, l.quantity, p.name AS producto,
           (l.expiry_date - CURRENT_DATE) AS dias
    FROM public.lots l JOIN public.products p ON p.id = l.product_id
    WHERE l.quantity > 0
      AND l.expiry_date IS NOT NULL
      AND l.expiry_date <= CURRENT_DATE + 60          -- por vencer (≤60d) o ya caducado
      AND (l.caducidad_avisada_at IS NULL OR l.caducidad_avisada_at < now() - interval '14 days')
  LOOP
    INSERT INTO public.notifications (body, roles, screen)
    VALUES (
      CASE WHEN r.dias < 0
        THEN format('Lote CADUCADO: %s (%s) · %s u — dar de baja', r.producto, r.lot_code, r.quantity)
        ELSE format('Lote por caducar en %s días: %s (%s) · %s u', r.dias, r.producto, r.lot_code, r.quantity)
      END,
      ARRAY['warehouse','admin'], 'caduc');
    UPDATE public.lots SET caducidad_avisada_at = now() WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END; $$;

-- 2) Cuentas por cobrar vencidas (contra pedido no pagado, >7 días) → avisa a Dirección.
CREATE OR REPLACE FUNCTION public.avisar_cuentas_por_cobrar()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_count int := 0; r record;
BEGIN
  FOR r IN
    SELECT o.id, o.external_ref, o.total,
           EXTRACT(day FROM now() - o.created_at)::int AS dias
    FROM public.orders o
    WHERE o.payment_status IS DISTINCT FROM 'paid'
      AND o.status NOT IN ('cancelled', 'draft')
      AND o.created_at < now() - interval '7 days'    -- POS se cobra al momento (siempre paid), no entra
      AND (o.cobranza_avisada_at IS NULL OR o.cobranza_avisada_at < now() - interval '7 days')
  LOOP
    INSERT INTO public.notifications (body, roles, screen)
    VALUES (
      format('Cuenta por cobrar vencida: pedido %s · $%s — %s días sin pagar',
             r.external_ref, to_char(COALESCE(r.total,0), 'FM999999999.00'), r.dias),
      ARRAY['admin'], 'av_fin');
    UPDATE public.orders SET cobranza_avisada_at = now() WHERE id = r.id;
    v_count := v_count + 1;
  END LOOP;
  RETURN v_count;
END; $$;

-- Seguridad (lección de sala): funciones internas NO llamables por usuarios finales.
REVOKE ALL ON FUNCTION public.avisar_lotes_por_caducar()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.avisar_cuentas_por_cobrar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.avisar_lotes_por_caducar()  TO service_role;
GRANT EXECUTE ON FUNCTION public.avisar_cuentas_por_cobrar() TO service_role;

-- Agendado diario (best-effort: si pg_cron no está, no rompe la migración).
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'renovacell-alertas-diarias') THEN
    PERFORM cron.unschedule('renovacell-alertas-diarias');
  END IF;
  PERFORM cron.schedule('renovacell-alertas-diarias', '0 15 * * *',  -- 15:00 UTC ≈ 9am Culiacán
    'SELECT public.avisar_lotes_por_caducar(); SELECT public.avisar_cuentas_por_cobrar();');
  RAISE NOTICE 'pg_cron OK: alertas diarias agendadas.';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron no disponible (%). Las funciones quedan listas; agéndalas por Edge Function o manualmente.', SQLERRM;
END $$;
