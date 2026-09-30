-- ============================================================================
-- W2 · N2 — CONSTRAINTS (todas VÁLIDAS, sin excepciones históricas).
--
-- PRECONDICIÓN: no puede existir un pedido que se declare pagado sin asientos que
-- lo respalden (F-1). Producción se activa con 0 pedidos (D-W2-0), así que pasa
-- trivialmente y las constraints se validan de inmediato, sin backfill.
-- Si alguien operó antes de W2, esta migración ABORTA y hay que reconstruir la
-- historia de pagos primero.
-- ============================================================================

do $pre$
declare n int;
begin
  select count(*) into n from public.orders o
   where o.payment_status = 'paid'
     and not exists (select 1 from public.payment_entries e where e.order_id = o.id and e.direction = 'in');
  if n > 0 then
    raise exception 'W2_N2_PRECONDICION: % pedido(s) marcados como pagados SIN asiento en el libro. Reconstruye la historia de pagos antes de W2.', n;
  end if;
  select count(*) into n from public.orders where payment_status is not null
     and payment_status not in ('pending','parcial','paid','refunded','failed');
  if n > 0 then
    raise exception 'W2_N2_PRECONDICION: % pedido(s) con payment_status fuera del vocabulario.', n;
  end if;
  select count(*) into n from public.cash_closings;
  if n > 0 then
    raise exception 'W2_N2_PRECONDICION: % corte(s) de caja previos con esperado calculado en el cliente.', n;
  end if;
end
$pre$;

-- ---------------------------------------------------------------------------
-- DECLARACIONES DE PAGO
-- ---------------------------------------------------------------------------
alter table public.payment_claims add constraint ck_claim_status
  check (status in ('reportado','verificado','rechazado'));
alter table public.payment_claims add constraint ck_claim_method
  check (method in ('transferencia','efectivo','tarjeta','stripe','otro'));
alter table public.payment_claims add constraint ck_claim_amount
  check (amount_declared > 0);
alter table public.payment_claims add constraint ck_claim_resolucion
  check ((status = 'reportado') = (resolved_at is null));
alter table public.payment_claims add constraint ck_claim_rechazo
  check (status <> 'rechazado' or nullif(btrim(reject_reason), '') is not null);
alter table public.payment_claims add constraint ck_claim_verificado
  check ((status = 'verificado') = (entry_id is not null));
-- Una sola declaración ABIERTA por pedido: evita dos comprobantes en cola.
create unique index uq_claim_abierta on public.payment_claims(order_id) where status = 'reportado';

-- ---------------------------------------------------------------------------
-- EL LIBRO
-- ---------------------------------------------------------------------------
alter table public.payment_entries add constraint ck_entry_direction
  check (direction in ('in','out'));
alter table public.payment_entries add constraint ck_entry_method
  check (method in ('transferencia','efectivo','tarjeta','stripe','otro'));
alter table public.payment_entries add constraint ck_entry_amount
  check (amount > 0);
alter table public.payment_entries add constraint ck_entry_currency
  check (currency = 'MXN');
-- F-6: todo EGRESO real nace de un reembolso autorizado.
alter table public.payment_entries add constraint ck_entry_egreso_autorizado
  check (direction <> 'out' or reversal_of is not null or refund_id is not null);
-- Un INGRESO real (cobro) no se cuelga de un reembolso.
alter table public.payment_entries add constraint ck_entry_ingreso_sin_refund
  check (direction <> 'in' or reversal_of is not null or refund_id is null);
-- Una reversa siempre lleva motivo.
alter table public.payment_entries add constraint ck_entry_reversa_motivo
  check (reversal_of is null or nullif(btrim(notes), '') is not null);
-- Idempotencia frente al proveedor (Stripe): un evento se registra UNA vez.
create unique index uq_entry_external_ref on public.payment_entries(external_ref) where external_ref is not null;
-- F-6: un reembolso autorizado se paga UNA sola vez (las reversas no cuentan).
create unique index uq_entry_refund_pagado on public.payment_entries(refund_id)
  where refund_id is not null and reversal_of is null;
-- Una reversa por asiento.
create unique index uq_entry_reversa on public.payment_entries(reversal_of) where reversal_of is not null;

-- ---------------------------------------------------------------------------
-- CRÉDITO
-- ---------------------------------------------------------------------------
-- F-11: se compara contra el DÍA LOCAL del negocio. Con granted_at::date (UTC) un crédito
-- autorizado la tarde/noche de Culiacán quedaba rechazado por "vencer ayer".
alter table public.credit_grants add constraint ck_credit_due_date
  check (due_date >= (granted_at at time zone 'America/Mazatlan')::date);
alter table public.credit_grants add constraint ck_credit_motivo
  check (nullif(btrim(reason), '') is not null);
alter table public.credit_grants add constraint ck_credit_revocacion
  check ((revoked_at is null) = (revoke_reason is null));
-- Una autorización VIGENTE por pedido.
create unique index uq_credit_vigente on public.credit_grants(order_id) where revoked_at is null;

-- ---------------------------------------------------------------------------
-- CORTE DE CAJA
-- ---------------------------------------------------------------------------
alter table public.cash_closings add constraint ck_cierre_alcance
  check (alcance in ('dia','cajero'));
-- Una anulación SIEMPRE lleva motivo; un corte normal nunca lleva motivo de anulación.
alter table public.cash_closings add constraint ck_cierre_anulacion
  check ((voids_closing_id is null) = (nullif(btrim(void_reason), '') is null));
create unique index uq_cierre_anulacion on public.cash_closings(voids_closing_id) where voids_closing_id is not null;
-- El alcance 'dia' no tiene cajero; el alcance 'cajero' SIEMPRE lo tiene (define su cadena).
alter table public.cash_closings add constraint ck_cierre_cajero
  check ((alcance = 'cajero') = (cajero is not null));

-- D-W2-CASH-CUTOFF: el TRAMO económico.
-- Un tramo siempre avanza en el tiempo (nunca vacío ni invertido).
alter table public.cash_closings add constraint ck_cierre_tramo
  check (corte_desde is null or corte_hasta is null or corte_hasta > corte_desde);
-- Un corte real declara su tramo; una anulación no arquea nada, hereda el del anulado.
alter table public.cash_closings add constraint ck_cierre_tramo_presente
  check (voids_closing_id is not null or (corte_desde is not null and corte_hasta is not null));
-- NADIE puede reclamar dos veces el mismo tramo: cada renglón de la cadena tiene a lo
-- más UN sucesor. Dos cortes simultáneos que intenten continuar el mismo corte ⇒ uno falla.
create unique index uq_cierre_cadena on public.cash_closings(prev_closing_id) where prev_closing_id is not null;
-- ...y a lo más UN arranque de cadena por alcance/cajero (el primer corte, sin predecesor).
create unique index uq_cierre_cadena_inicio
  on public.cash_closings(alcance, coalesce(cajero, '00000000-0000-0000-0000-000000000000'::uuid))
  where prev_closing_id is null;

-- ---------------------------------------------------------------------------
-- PEDIDOS — payment_status pasa a vocabulario cerrado y SOLO financiero (F-8).
--   pending  · sin cobro          parcial · cobro incompleto
--   paid     · cobro suficiente   refunded · devuelto íntegramente
--   failed   · se conserva por compatibilidad; ningún comando lo escribe.
-- ---------------------------------------------------------------------------
alter table public.orders add constraint ck_orders_payment_status
  check (payment_status is null or payment_status in ('pending','parcial','paid','refunded','failed'));
