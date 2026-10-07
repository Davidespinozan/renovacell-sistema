-- CHV2-A · (124) El evaluador queda agendado en pg_cron por firma exacta: exactamente UN job, idempotente,
-- reconcilia un job mal configurado o duplicado, respeta los demás jobs y no muta nada comercial.
begin;
do $t$
declare n_notifs int; n_convs int; n_cartera int; n_orders int; r jsonb;
begin
  -- El shim reproduce las sobrecargas de producción: la guarda vieja de 123 NO sirve; la exacta sí.
  perform tests.ok(to_regproc('cron.schedule') is null, 'defecto reproducido: to_regproc(''cron.schedule'') es NULL con sobrecargas');
  perform tests.ok(to_regprocedure('cron.schedule(text,text,text)') is not null and to_regprocedure('cron.unschedule(text)') is not null, 'las firmas exactas sí se resuelven');

  -- A · Estado tras 123 + 124 (ambas aplicadas por el arnés): exactamente un job correcto.
  perform tests.eq((select count(*)::int from cron.job where jobname = 'renovacell-atencion-comercial'), 1, 'A · exactamente un job');
  perform tests.eq((select schedule from cron.job where jobname = 'renovacell-atencion-comercial'), '* * * * *', 'A · cadencia por minuto');
  perform tests.eq((select command from cron.job where jobname = 'renovacell-atencion-comercial'), 'select public.cc_atencion_evaluar();', 'A · comando canónico');
  perform tests.ok((select active from cron.job where jobname = 'renovacell-atencion-comercial'), 'A · activo');
  -- D · El job de W6-A3 sobrevive intacto.
  perform tests.eq((select count(*)::int from cron.job where jobname = 'renovacell-alertas-diarias'), 1, 'D · renovacell-alertas-diarias sigue');
  perform tests.eq((select schedule from cron.job where jobname = 'renovacell-alertas-diarias'), '0 15 * * *', 'D · su horario intacto');

  select count(*) into n_notifs from public.notifications; select count(*) into n_convs from public.cc_conversations;
  select count(*) into n_cartera from public.cc_cartera; select count(*) into n_orders from public.orders;
  perform tests.act_as_owner();
  create temp table cron_antes on commit drop as select n_notifs notifs, n_convs convs, n_cartera cartera, n_orders orders;
end $t$;

-- B/C · Replay del fix con el job ya correcto: sin duplicar (misma migración REAL, no una copia).
\ir ../../../migrations/20261107120000_chv2a_cron_fix.sql
do $t$
begin
  perform tests.eq((select count(*)::int from cron.job where jobname = 'renovacell-atencion-comercial'), 1, 'B/C · replay con job correcto: sigue UNO');
end $t$;

-- A' · Sin job → el fix lo agenda exactamente una vez.
select cron.unschedule('renovacell-atencion-comercial'::text);
\ir ../../../migrations/20261107120000_chv2a_cron_fix.sql
do $t$
begin
  perform tests.eq((select count(*)::int from cron.job where jobname = 'renovacell-atencion-comercial'), 1, 'A'' · sin job → uno');
end $t$;

-- B' · Job mal configurado (otra cadencia, otro comando, inactivo) → se reconcilia a uno correcto.
select cron.unschedule('renovacell-atencion-comercial'::text);
select cron.schedule('renovacell-atencion-comercial'::text, '0 3 * * *'::text, 'select 1;'::text);
update cron.job set active = false where jobname = 'renovacell-atencion-comercial';
\ir ../../../migrations/20261107120000_chv2a_cron_fix.sql
do $t$
begin
  perform tests.ok((select count(*) = 1 and bool_and(schedule = '* * * * *' and command = 'select public.cc_atencion_evaluar();' and active) from cron.job where jobname = 'renovacell-atencion-comercial'), 'B'' · mal configurado → reconciliado a uno correcto');
end $t$;

-- C' · Duplicados con el mismo nombre no pueden existir: pg_cron (y el shim) imponen jobname único por usuario; la rama
--      de reconciliación de >1 del fix es defensiva y no se ejercita aquí.
do $t$
declare a record;
begin
  perform tests.eq((select count(*)::int from cron.job where jobname = 'renovacell-atencion-comercial'), 1, 'C'' · estado final: exactamente uno');
  perform tests.eq((select count(*)::int from cron.job where jobname = 'renovacell-alertas-diarias'), 1, 'D · el job de W6-A3 nunca se tocó');

  -- G · Horario sin configurar: el evaluador (lo que corre el job) no materializa nada.
  perform tests.eq((public._cc_horario_estado(now()) ->> 'configurado')::boolean, false, 'G · horario sin configurar (premisa)');
  perform tests.act_as_service();
  perform tests.eq(public.cc_atencion_evaluar() ->> 'omitido', 'horario_sin_configurar', 'G · evaluador: omitido, fail-closed');
  perform tests.act_as_owner();
  -- H · Instalar/replayar el job no mutó nada comercial.
  select * into a from cron_antes;
  perform tests.eq((select count(*) from public.notifications), a.notifs, 'H · notificaciones intactas');
  perform tests.eq((select count(*) from public.cc_conversations), a.convs, 'H · conversaciones intactas');
  perform tests.eq((select count(*) from public.cc_cartera), a.cartera, 'H · cartera intacta');
  perform tests.eq((select count(*) from public.orders), a.orders, 'H · pedidos intactos');
end $t$;
rollback;
