-- ============================================================================
-- W2 · ROLLBACK (N4 → N1). Devuelve la base al estado que dejó W1.
--
-- USO: solo con autorización y SOLO ANTES del primer asiento real (borra el libro
-- y todo lo que contenga). Después de que exista dinero registrado, se corrige
-- hacia adelante. Si también se va a bajar W1, este archivo va PRIMERO.
-- Ejecutar en UNA transacción:  psql -1 -v ON_ERROR_STOP=1 -f 99_down.sql
-- Verificado en local: supabase/tests/db/rollback/w2_rollback.sql
-- ============================================================================

-- ------------------------------------------------------------------ revierte N4
drop policy if exists cash_closings_select_finanzas on public.cash_closings;
grant insert, update, delete, truncate on public.cash_closings to anon, authenticated;
create policy cash_closings_all on public.cash_closings
  for all to authenticated
  using (auth_role() = any (array['admin'::text, 'billing'::text, 'pos'::text]))
  with check (auth_role() = any (array['admin'::text, 'billing'::text, 'pos'::text]));
grant execute on function public.pay_order(uuid, text, text) to authenticated, service_role;

-- ------------------------------------------------------------------ revierte N3
drop function if exists public.reportar_pago(uuid, uuid, text, numeric, text, uuid, text);
drop function if exists public.revisar_pago(uuid, uuid, text, numeric, date, text);
drop function if exists public.registrar_cobro(uuid, uuid, text, numeric, date, text, uuid, text);
drop function if exists public.autorizar_reembolso(uuid, uuid, text, numeric, text, uuid, text);
drop function if exists public.pagar_reembolso(uuid, uuid, text, date, text, text);
drop function if exists public.autorizar_credito(uuid, uuid, date, text);
drop function if exists public.revocar_credito(uuid, uuid, text);
drop function if exists public.reversar_asiento(uuid, uuid, text);
drop function if exists public.registrar_corte_caja(uuid, date, text, numeric, numeric, text, uuid);
drop function if exists public.anular_corte_caja(uuid, uuid, text);
drop function if exists public.efectivo_esperado(date, text, uuid);
drop function if exists public.tramo_corte_caja(date, text, uuid);
drop function if exists public._w2_corte_cola(text, uuid);
drop function if exists public._w2_corte_desde(date, text, uuid);
drop function if exists public._w2_efectivo_tramo(timestamptz, timestamptz, text, uuid);
drop function if exists public.estado_dinero_pedido(uuid);
drop function if exists public.estado_operacion_dinero(uuid);
drop function if exists public.conciliar_dinero();
drop function if exists public.pedido_liberado_para_surtir(uuid);
drop function if exists public._w2_op_begin(uuid, text, jsonb);
drop function if exists public._w2_op_finish(uuid, text, jsonb, jsonb);
drop function if exists public._w2_trusted(boolean);
drop function if exists public._w2_recalc_payment_status(uuid);
drop function if exists public._w2_asiento(uuid, uuid, text, text, numeric, date, uuid, uuid, text, uuid, text, uuid, text);
-- La firma AMPLIADA de vender_pos se elimina; el snapshot recrea la de W1.
drop function if exists public.vender_pos(uuid, text, numeric, text, uuid, jsonb, jsonb, jsonb, boolean, jsonb, uuid, numeric);

-- Restaura las definiciones EXACTAS que dejó W1 (surtir_pedido, cancelar_pedido,
-- orders_guard, registrar_devolucion, review_transfer_payment, vender_pos).
\ir 00_w1_snapshot.sql

revoke all on function public.registrar_devolucion(uuid, text, numeric, text, text, jsonb) from public, anon;
grant execute on function public.registrar_devolucion(uuid, text, numeric, text, text, jsonb) to authenticated, service_role;
revoke all on function public.review_transfer_payment(uuid, text, text) from public, anon;
grant execute on function public.review_transfer_payment(uuid, text, text) to authenticated, service_role;
revoke all on function public.vender_pos(uuid, text, numeric, text, uuid, jsonb, jsonb, jsonb, boolean, jsonb, uuid) from public, anon;
grant execute on function public.vender_pos(uuid, text, numeric, text, uuid, jsonb, jsonb, jsonb, boolean, jsonb, uuid) to authenticated, service_role;
grant execute on function public.surtir_pedido(uuid, uuid, jsonb) to authenticated, service_role;
grant execute on function public.cancelar_pedido(uuid, uuid, text) to authenticated, service_role;

-- ------------------------------------------------------------------ revierte N2
alter table public.orders drop constraint if exists ck_orders_payment_status;
alter table public.cash_closings drop constraint if exists ck_cierre_anulacion;
alter table public.cash_closings drop constraint if exists ck_cierre_alcance;
alter table public.cash_closings drop constraint if exists ck_cierre_cajero;
alter table public.cash_closings drop constraint if exists ck_cierre_tramo;
alter table public.cash_closings drop constraint if exists ck_cierre_tramo_presente;
drop index if exists public.uq_cierre_anulacion;
drop index if exists public.uq_cierre_cadena;
drop index if exists public.uq_cierre_cadena_inicio;

-- ------------------------------------------------------------------ revierte N1
drop view if exists public.v_order_money;
drop trigger if exists trg_cash_closings_guard on public.cash_closings;
drop trigger if exists trg_cash_closings_no_truncate on public.cash_closings;
drop function if exists public.cash_closings_guard();
alter table public.cash_closings drop column if exists void_reason,
                                 drop column if exists voids_closing_id,
                                 drop column if exists prev_closing_id,
                                 drop column if exists corte_hasta,
                                 drop column if exists corte_desde,
                                 drop column if exists cajero,
                                 drop column if exists op_id;
alter table public.refunds drop column if exists return_id, drop column if exists op_id;
-- FK circular (claims.entry_id ↔ entries.claim_id): se suelta antes de soltar las tablas.
alter table public.payment_claims drop constraint if exists payment_claims_entry_fkey;
drop trigger if exists trg_payment_claims_guard on public.payment_claims;
drop trigger if exists trg_payment_claims_no_truncate on public.payment_claims;
drop trigger if exists trg_credit_grants_guard on public.credit_grants;
drop trigger if exists trg_credit_grants_no_truncate on public.credit_grants;
drop table if exists public.payment_entries;
drop table if exists public.payment_claims;
drop table if exists public.credit_grants;
drop table if exists public.money_operations;
drop function if exists public.payment_claims_guard();
drop function if exists public.credit_grants_guard();
