-- W6-A3.1 · Regresión del defecto del rollout: to_regproc() es ambiguo con sobrecargas y
-- por eso se saltó el re-agendado. El fix detecta por firma exacta y verifica el final.
begin;
do $t$
declare r jsonb;
begin
  -- El shim reproduce las sobrecargas de producción: la guarda vieja NO sirve.
  perform tests.ok(to_regproc('cron.schedule') is null, 'to_regproc(''cron.schedule'') devuelve NULL con sobrecargas (la guarda que falló)');
  perform tests.ok(to_regproc('cron.unschedule') is null, 'to_regproc(''cron.unschedule'') también es NULL');
  perform tests.ok(to_regprocedure('cron.schedule(text,text,text)') is not null and to_regprocedure('cron.unschedule(text)') is not null,
    'las firmas exactas que usa el fix sí se resuelven');

  -- Estado tras 107 + fix (ambas aplicadas por el arnés).
  perform tests.eq((select count(*)::int from cron.job where jobname = 'renovacell-alertas-diarias'), 1, 'exactamente un job');
  perform tests.eq((select schedule from cron.job where jobname = 'renovacell-alertas-diarias'), '0 15 * * *', 'horario intacto');
  perform tests.eq((select command from cron.job where jobname = 'renovacell-alertas-diarias'), 'select public.correr_alertas_diarias();', 'comando exacto');
  perform tests.ok((select active from cron.job where jobname = 'renovacell-alertas-diarias'), 'job activo');
  perform tests.eq((select count(*)::int from cron.job where command ilike '%avisar_cuentas_por_cobrar%'), 0, 'ningún job llama a la cobranza eliminada');
  perform tests.ok(to_regproc('public.avisar_cuentas_por_cobrar') is null, 'y la función sigue sin existir');

  -- El fix es idempotente y verificable: volver a correrlo deja el mismo estado.
  perform cron.unschedule('renovacell-alertas-diarias'::text);
  perform cron.schedule('renovacell-alertas-diarias'::text, '0 15 * * *'::text, 'select public.correr_alertas_diarias();'::text);
  perform tests.eq((select count(*)::int from cron.job where jobname = 'renovacell-alertas-diarias'), 1, 're-agendar no duplica');

  -- Simulación del defecto: con la guarda vieja, el bloque se saltaría.
  perform tests.ok(not (to_regproc('cron.schedule') is not null), 'la guarda to_regproc() habría saltado el agendado (defecto reproducido)');

  -- El comando del job corre de verdad como dueño y deja latido.
  r := public.correr_alertas_diarias();
  perform tests.eq(r ->> 'estado', 'ok', 'el comando agendado se ejecuta');
  perform tests.eq((select count(*)::int from public.sistema_latidos where fuente = 'alertas_diarias' and ultimo_ok is not null), 1, 'y deja su latido');
end $t$;
rollback;
