-- ============================================================================
-- W4 · COMUNICACIONES · ROLLBACK. Quita el buzón de salida y sus disparadores.
--
-- ABORTA si algún mensaje ya fue confirmado por el proveedor: esa fila es la
-- evidencia de qué se le dijo a un cliente y cuándo. No se descarta.
-- Lo primero que baja son los disparadores sobre orders y payment_entries, para
-- que las operaciones de negocio dejen de encolar antes de que la tabla desaparezca.
-- Ejecutar en UNA transacción:  psql -1 -v ON_ERROR_STOP=1 -f 99_down.sql
-- ============================================================================
do $$
declare v_env int;
begin
  if to_regclass('public.comm_outbox') is null then
    raise notice 'W4 comunicaciones no está aplicado: nada que bajar.';
    return;
  end if;
  select count(*) into v_env from public.comm_outbox where status = 'enviado';
  if v_env > 0 then
    raise exception 'ROLLBACK_ABORTADO: hay % mensaje(s) confirmados por el proveedor. Son evidencia de lo comunicado al cliente.', v_env;
  end if;
end $$;

drop trigger if exists trg_comm_payment_entries on public.payment_entries;
drop trigger if exists trg_comm_orders_upd on public.orders;
drop trigger if exists trg_comm_orders_ins on public.orders;
drop function if exists public.comm_reintentar(uuid, boolean);
drop function if exists public.comm_resolver(uuid, uuid, text, text, text, text);
drop function if exists public.comm_reclamar(int);
drop function if exists public._comm_tr_payment_entries();
drop function if exists public._comm_tr_orders();
drop function if exists public._comm_encolar(text, text, uuid, jsonb);
drop function if exists public._comm_autorizar();
drop table    if exists public.comm_outbox;
drop function if exists public.comm_outbox_guard();
drop function if exists public._comm_reclamo_caduco();
drop function if exists public._comm_max_intentos();
drop function if exists public._comm_ventana_idempotencia();
