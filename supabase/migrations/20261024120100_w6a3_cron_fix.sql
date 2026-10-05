-- ============================================================================
-- W6-A3.1 · FORWARD-FIX DEL AGENDADO DE pg_cron
--
-- En el rollout de 20261024120000 los bloques que re-agendaban el job se saltaron en
-- silencio: su guarda usaba to_regproc('cron.schedule'), que devuelve NULL cuando la
-- función está SOBRECARGADA (pg_cron tiene schedule(text,text) y schedule(text,text,text);
-- unschedule(bigint) y unschedule(text)), y el EXCEPTION … RAISE NOTICE escondió el salto.
-- Resultado: el job siguió apuntando a avisar_cuentas_por_cobrar(), ya eliminada.
--
-- Este archivo hace SOLO el agendado, con detección por firma exacta, sin tragarse
-- errores, y verifica el estado final. Si algo no cuadra, aborta: mejor una migración
-- fallida visible que un job roto invisible.
-- ============================================================================
do $$
declare v_n int; v_cmd text; v_sched text; v_active boolean;
begin
  -- 1) Firmas requeridas, por firma exacta.
  if to_regprocedure('cron.schedule(text,text,text)') is null then
    raise exception 'W6A3_FIX: no existe cron.schedule(text,text,text); pg_cron no disponible o con otra firma';
  end if;
  if to_regprocedure('cron.unschedule(text)') is null then
    raise exception 'W6A3_FIX: no existe cron.unschedule(text)';
  end if;
  if to_regprocedure('public.correr_alertas_diarias()') is null then
    raise exception 'W6A3_FIX: falta public.correr_alertas_diarias() (aplica 20261024120000 primero)';
  end if;

  -- 2) Retirar el job legacy (idempotente) y agendar el nuevo.
  if exists (select 1 from cron.job where jobname = 'renovacell-alertas-diarias') then
    perform cron.unschedule('renovacell-alertas-diarias'::text);
  end if;
  perform cron.schedule('renovacell-alertas-diarias'::text, '0 15 * * *'::text, 'select public.correr_alertas_diarias();'::text);

  -- 3) Verificación del estado final: exactamente un job, con este horario y este comando.
  select count(*) into v_n from cron.job where jobname = 'renovacell-alertas-diarias';
  if v_n <> 1 then raise exception 'W6A3_FIX: se esperaba 1 job renovacell-alertas-diarias, hay %', v_n; end if;
  select schedule, command, active into v_sched, v_cmd, v_active from cron.job where jobname = 'renovacell-alertas-diarias';
  if v_sched <> '0 15 * * *' then raise exception 'W6A3_FIX: horario inesperado %', v_sched; end if;
  if v_cmd <> 'select public.correr_alertas_diarias();' then raise exception 'W6A3_FIX: comando inesperado %', v_cmd; end if;
  if not v_active then raise exception 'W6A3_FIX: el job quedó inactivo'; end if;
  if exists (select 1 from cron.job where command ilike '%avisar_cuentas_por_cobrar%') then
    raise exception 'W6A3_FIX: algún job sigue llamando a avisar_cuentas_por_cobrar()';
  end if;
end $$;
