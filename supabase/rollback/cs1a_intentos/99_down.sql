-- CS-1A.1a (184) · rollback: retira la tarea de expiración, la vista, las RPC, los helpers y las dos tablas de intentos.
-- No toca el ledger W2 ni registrar_cobro. Los asientos ya contabilizados por intentos se conservan (son dinero real).
-- Ejecutar en UNA transacción: psql -1 -v ON_ERROR_STOP=1 -f 99_down.sql
do $$ begin
  if exists (select 1 from cron.job where jobname = 'renovacell-cs-intentos') then perform cron.unschedule('renovacell-cs-intentos'); end if;
exception when others then raise notice 'pg_cron no disponible al retirar el job (%).', sqlerrm; end $$;
drop view if exists public.v_order_disponible;
drop function if exists public.cs_intentos_expirar();
drop function if exists public.cs_intento_contabilizar(uuid);
drop function if exists public.cs_intento_avanzar(uuid, text, jsonb);
drop function if exists public.cs_intento_abrir(uuid, text);
drop function if exists public.saldo_disponible(uuid);
drop function if exists public.cs_reservas_activas(uuid);
drop function if exists public._cs_op_id(text);
drop function if exists public._cs_texto_seguro(text);
drop function if exists public._cs_es_servidor();
drop function if exists public._cs_evento(uuid, text, text, jsonb);
drop function if exists public._cs_transicion_valida(text, text);
drop table if exists public.card_payment_attempt_events;
drop table if exists public.card_payment_attempts;
drop function if exists public._cs_append_only();
drop function if exists public._cs_estado_activo(text);
