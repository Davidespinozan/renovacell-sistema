-- ============================================================================
-- W6-A3.1 · ROLLBACK. Restaura las dos funciones de alertas con su texto ORIGINAL
-- (idéntico a producción pre-A3.1, verificado por md5), el job anterior y el SELECT
-- de PUBLIC sobre cron.*; retira los objetos de A3.1. No hay datos de negocio en juego:
-- `sistema_latidos` solo guarda el último latido.
-- Ejecutar en UNA transacción:  psql -1 -v ON_ERROR_STOP=1 -f 99_down.sql
-- ============================================================================
drop function if exists public.salud_sistema();
drop function if exists public._salud_umbral_stale();
drop function if exists public._salud_umbral_running();
drop function if exists public.correr_alertas_diarias();
drop table if exists public.sistema_latidos;

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
REVOKE ALL ON FUNCTION public.avisar_lotes_por_caducar()  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.avisar_cuentas_por_cobrar() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.avisar_lotes_por_caducar()  TO service_role;
GRANT EXECUTE ON FUNCTION public.avisar_cuentas_por_cobrar() TO service_role;

-- Job anterior, por firma exacta (to_regproc es ambiguo con las sobrecargas de pg_cron).
-- El GRANT a PUBLIC sobre cron.* no se toca: lo gobierna supabase_admin (gate externo).
do $$
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise notice 'pg_cron no disponible: agendar el job anterior aparte.';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'renovacell-alertas-diarias') then
    perform cron.unschedule('renovacell-alertas-diarias'::text);
  end if;
  perform cron.schedule('renovacell-alertas-diarias'::text, '0 15 * * *'::text,
    'SELECT public.avisar_lotes_por_caducar(); SELECT public.avisar_cuentas_por_cobrar();'::text);
  if (select count(*) from cron.job where jobname = 'renovacell-alertas-diarias') <> 1 then
    raise exception 'ROLLBACK_W6A3: no se pudo restaurar el job anterior';
  end if;
end $$;
