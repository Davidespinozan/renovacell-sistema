-- ============================================================================
-- CHV2-A · (124) Forward fix: agendar el evaluador de atención en pg_cron por firma exacta
--
-- Defecto del rollout de 123: su guarda usaba to_regproc('cron.schedule'), que devuelve NULL cuando la
-- función está sobrecargada (pg_cron 1.6.4 expone cron.schedule(text,text) y (text,text,text)), así que
-- interpretó "no hay pg_cron" y se saltó el agendado en silencio. Mismo defecto que ya corrigió W6-A3
-- (20261024120100_w6a3_cron_fix.sql); aquí se aplica la misma receta: detección por FIRMA EXACTA
-- (to_regprocedure) y verificación del estado final. La historia de 123 no se reescribe.
--
-- Invariante al terminar: EXACTAMENTE un job 'renovacell-atencion-comercial', activo, cada minuto, que llama
-- a public.cc_atencion_evaluar(). Instalar el job no muta nada comercial: con el horario sin configurar el
-- evaluador devuelve `omitido: horario_sin_configurar` (fail-closed). Ningún otro job se toca.
-- Rollback: supabase/rollback/chv2a_cron/99_down.sql
-- ============================================================================
do $$
declare v_n int; v_job record; r record;
begin
  -- 1) Capacidad de pg_cron, por firma exacta (nunca to_regproc: ambiguo con sobrecargas).
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise exception 'CHV2A_FIX: no existe cron.schedule(text,text,text); pg_cron no disponible o con otra firma';
  end if;
  if to_regprocedure('cron.unschedule(text)') is null then
    raise exception 'CHV2A_FIX: no existe cron.unschedule(text)';
  end if;
  if to_regprocedure('public.cc_atencion_evaluar()') is null then
    raise exception 'CHV2A_FIX: falta public.cc_atencion_evaluar() (aplica 20261106120000 primero)';
  end if;

  -- 2) Reconciliación determinista del job con ESE nombre (y solo ese).
  select count(*) into v_n from cron.job where jobname = 'renovacell-atencion-comercial';
  if v_n = 1 then
    select * into v_job from cron.job where jobname = 'renovacell-atencion-comercial';
    if v_job.schedule = '* * * * *' and v_job.command = 'select public.cc_atencion_evaluar();' and v_job.active then
      raise notice 'CHV2A_FIX: el job ya existe correctamente; sin cambios.';
    else
      raise notice 'CHV2A_FIX: job mal configurado (% | % | activo=%): se re-agenda.', v_job.schedule, v_job.command, v_job.active;
      perform cron.unschedule('renovacell-atencion-comercial'::text);
      perform cron.schedule('renovacell-atencion-comercial'::text, '* * * * *'::text, 'select public.cc_atencion_evaluar();'::text);
    end if;
  elsif v_n > 1 then
    raise notice 'CHV2A_FIX: % jobs duplicados con el mismo nombre: se retiran y se agenda uno.', v_n;
    for r in select jobid from cron.job where jobname = 'renovacell-atencion-comercial' loop
      perform cron.unschedule(r.jobid);
    end loop;
    perform cron.schedule('renovacell-atencion-comercial'::text, '* * * * *'::text, 'select public.cc_atencion_evaluar();'::text);
  else
    perform cron.schedule('renovacell-atencion-comercial'::text, '* * * * *'::text, 'select public.cc_atencion_evaluar();'::text);
  end if;

  -- 3) Verificación del estado final.
  select count(*) into v_n from cron.job where jobname = 'renovacell-atencion-comercial';
  if v_n <> 1 then raise exception 'CHV2A_FIX: se esperaba 1 job renovacell-atencion-comercial, hay %', v_n; end if;
  select * into v_job from cron.job where jobname = 'renovacell-atencion-comercial';
  if v_job.schedule <> '* * * * *' then raise exception 'CHV2A_FIX: cadencia inesperada %', v_job.schedule; end if;
  if v_job.command <> 'select public.cc_atencion_evaluar();' then raise exception 'CHV2A_FIX: comando inesperado %', v_job.command; end if;
  if not v_job.active then raise exception 'CHV2A_FIX: el job quedó inactivo'; end if;
end $$;
