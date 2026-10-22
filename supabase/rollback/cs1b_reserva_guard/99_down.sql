-- CS-1A.1b (185) · rollback: retira la guarda universal de reservas. CS-1A.1a (intentos, RPC, vista) queda intacto;
-- el ledger vuelve a aceptar cobros sin consultar reservas (comportamiento previo a 185).
-- Ejecutar en UNA transacción: psql -1 -v ON_ERROR_STOP=1 -f 99_down.sql
drop trigger if exists trg_cs_reserva_guard on public.payment_entries;
drop function if exists public._cs_reserva_guard();
