-- ============================================================================
-- CHV2-A (124) · ROLLBACK. Retira ÚNICAMENTE el job 'renovacell-atencion-comercial' (detección por firma
-- exacta). No toca 'renovacell-alertas-diarias' ni ningún otro job, ni el esquema de 123.
-- Ejecutar en UNA transacción:  psql -1 -v ON_ERROR_STOP=1 -f 99_down.sql
-- ============================================================================
do $$
begin
  if to_regprocedure('cron.unschedule(text)') is null then
    raise notice 'pg_cron no disponible: retirar renovacell-atencion-comercial aparte.';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'renovacell-atencion-comercial') then
    perform cron.unschedule('renovacell-atencion-comercial'::text);
  end if;
  if (select count(*) from cron.job where jobname = 'renovacell-atencion-comercial') <> 0 then
    raise exception 'ROLLBACK_CHV2A_CRON: el job sigue agendado';
  end if;
end $$;
