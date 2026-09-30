-- ============================================================================
-- W2 · N1 — ESQUEMA (aditivo). Verdad de pago / crédito.
--
--  · Registro de idempotencia del dinero                money_operations
--  · Declaración de pago (reportado → verificado)       payment_claims
--  · EL LIBRO: asientos de dinero (append-only)         payment_entries
--  · Autorización de crédito por pedido                 credit_grants
--  · Corte de caja: anulación por compensación          cash_closings.voids_*
--  · Definición ÚNICA de dinero por pedido              v_order_money
--
-- Principios (diseño congelado):
--   F-1 el dinero solo existe como asiento; F-2 append-only; F-3 reportar ≠ cobrar;
--   F-5 cobrado_neto = Σin − Σout, saldo = total − cobrado_neto;
--   F-7 liberado = cobro suficiente OR crédito vigente (DERIVADO, sin columna);
--   F-8 payment_status describe SOLO lo financiero.
--
-- No cambia comportamiento: las constraints van en N2, los comandos en N3 y el
-- cierre de autoridad en N4. W1 no se toca aquí. Custodia (W2-C) fuera.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Registro de operaciones de dinero (gemelo de inventory_operations de W1)
--    Se mantiene separado a propósito: W1 queda intacto. La consolidación en un
--    registro único de operaciones de negocio queda para W5.
-- ---------------------------------------------------------------------------
create table public.money_operations (
  op_id        uuid primary key,
  kind         text not null check (kind in (
                 'reporte_pago','revision_pago','cobro','reembolso_autorizado','reembolso_pagado',
                 'credito_autorizado','credito_revocado','reversa_asiento','corte_caja','anulacion_corte','venta_pos')),
  actor        uuid,
  actor_role   text not null,
  request_hash text not null,
  result       jsonb not null,
  created_at   timestamptz not null default now()
);
create index idx_money_operations_kind on public.money_operations(kind, created_at);

-- ---------------------------------------------------------------------------
-- 2) Declaración de pago — sustituye a orders.shipping_meta.transfer
--    El cliente (o el staff) DECLARA; alguien autorizado VERIFICA. La resolución
--    se escribe una sola vez (mismo patrón que stock_return_lines en W1).
-- ---------------------------------------------------------------------------
create table public.payment_claims (
  id              uuid primary key,                 -- = op_id del reporte
  order_id        uuid not null references public.orders(id) on delete restrict,
  method          text not null,
  amount_declared numeric not null,
  reference       text,
  bank_account_id uuid references public.company_bank_accounts(id) on delete restrict,
  proof_path      text,
  declared_by     uuid,
  declared_at     timestamptz not null default now(),
  status          text not null default 'reportado',
  resolved_by     uuid,
  resolved_at     timestamptz,
  reject_reason   text,
  entry_id        uuid,                             -- asiento generado al verificar (FK en N2)
  created_at      timestamptz not null default now()
);
create index idx_payment_claims_order on public.payment_claims(order_id, declared_at desc);

-- ---------------------------------------------------------------------------
-- 3) EL LIBRO — verdad canónica del dinero. Append-only estricto.
--    direction 'in'  = entró dinero (cobro)
--    direction 'out' = salió dinero (reembolso pagado); SIEMPRE nace de una
--                      autorización en `refunds` (F-6).
--    value_date = día local del negocio (hoy_local(), America/Mazatlan · F-11).
-- ---------------------------------------------------------------------------
create table public.payment_entries (
  id              uuid primary key,                 -- = op_id
  order_id        uuid not null references public.orders(id) on delete restrict,
  claim_id        uuid references public.payment_claims(id) on delete restrict,
  refund_id       uuid references public.refunds(id) on delete restrict,
  direction       text not null,
  method          text not null,
  amount          numeric not null,
  currency        text not null default 'MXN',
  value_date      date not null default public.hoy_local(),
  external_ref    text,                             -- id del proveedor (Stripe): idempotencia
  bank_account_id uuid references public.company_bank_accounts(id) on delete restrict,
  evidence_ref    text,
  reversal_of     uuid references public.payment_entries(id) on delete restrict,
  notes           text,
  recorded_by     uuid,
  actor_role      text not null,
  -- clock_timestamp(), no now(): el corte de caja cierra TRAMOS por este instante
  -- (D-W2-CASH-CUTOFF) y dos asientos de la misma transacción deben poder caer en
  -- tramos distintos. `now()` es constante dentro de una transacción y los volvería
  -- indistinguibles. `value_date` sigue siendo la fecha CONTABLE del movimiento.
  created_at      timestamptz not null default clock_timestamp()
);
create index idx_payment_entries_order on public.payment_entries(order_id, value_date);
create index idx_payment_entries_refund on public.payment_entries(refund_id) where refund_id is not null;
create index idx_payment_entries_claim on public.payment_entries(claim_id) where claim_id is not null;
-- El arqueo cierra TRAMOS por created_at (D-W2-CASH-CUTOFF), no por fecha contable.
create index idx_payment_entries_efectivo on public.payment_entries(created_at) where method = 'efectivo';

alter table public.payment_claims
  add constraint payment_claims_entry_fkey foreign key (entry_id) references public.payment_entries(id) on delete restrict;

-- ---------------------------------------------------------------------------
-- 4) Autorización de crédito (D-W2-1): actor, timestamp, motivo y due_date
--    EXPLÍCITA por autorización. Nada se guarda en `customers`.
-- ---------------------------------------------------------------------------
create table public.credit_grants (
  id            uuid primary key,                   -- = op_id
  order_id      uuid not null references public.orders(id) on delete restrict,
  due_date      date not null,
  reason        text not null,
  granted_by    uuid,
  granted_at    timestamptz not null default now(),
  revoked_by    uuid,
  revoked_at    timestamptz,
  revoke_reason text
);
create index idx_credit_grants_order on public.credit_grants(order_id);

-- ---------------------------------------------------------------------------
-- 4b) Reembolso autorizado: se conserva `refunds` (append-only, sano desde antes)
--     y se le agrega la traza de la operación y el enlace OPCIONAL a la devolución
--     física de W1. Devolución física y reembolso siguen siendo hechos separados.
-- ---------------------------------------------------------------------------
alter table public.refunds
  add column op_id     uuid,
  add column return_id uuid references public.stock_returns(id) on delete restrict;

-- ---------------------------------------------------------------------------
-- 5) Corte de caja: anulación por COMPENSACIÓN, nunca DELETE (D-W2-7) y
--    TRAMO ECONÓMICO EXPLÍCITO (D-W2-CASH-CUTOFF).
--
--    Un corte cerrado establece un límite: el siguiente corte del mismo alcance
--    arquea SOLO el efectivo posterior. Por eso cada corte guarda el tramo que
--    reclama —(corte_desde, corte_hasta]— y a quién CONTINÚA (prev_closing_id).
--    Los cortes de un alcance forman así una CADENA: cada renglón tiene a lo más
--    un sucesor, y por eso dos cortes legítimos no pueden reclamar el mismo tramo.
--    Una anulación es otro renglón de la misma cadena: al entrar, el tramo del
--    corte anulado vuelve a quedar libre sin editar ni borrar nada.
--    El tramo lo calcula SIEMPRE el servidor; el cliente no manda fechas ni montos.
-- ---------------------------------------------------------------------------
alter table public.cash_closings
  add column op_id            uuid,
  add column voids_closing_id uuid references public.cash_closings(id) on delete restrict,
  add column void_reason      text,
  -- cajero del alcance 'cajero' (NULL en 'dia'): define la cadena a la que pertenece.
  add column cajero           uuid references auth.users(id) on delete restrict,
  add column corte_desde      timestamptz,
  add column corte_hasta      timestamptz,
  add column prev_closing_id  uuid references public.cash_closings(id) on delete restrict;

comment on column public.cash_closings.corte_desde is
  'Inicio EXCLUSIVO del tramo arqueado. Lo calcula el servidor: fin del último corte válido del alcance, o el inicio del día local si es el primero.';
comment on column public.cash_closings.corte_hasta is
  'Fin INCLUSIVO del tramo arqueado (momento del corte, reloj del servidor).';
comment on column public.cash_closings.prev_closing_id is
  'Renglón de la cadena que este corte continúa. Único por renglón: dos cortes no pueden arrancar donde terminó el mismo corte.';

-- ---------------------------------------------------------------------------
-- 6) v_order_money — DEFINICIÓN ÚNICA del dinero de un pedido (F-5).
--    Sustituye a las 4 definiciones paralelas de cuentas por cobrar.
--    `liberado` es DERIVADO: no existe columna que mantener ni conciliar (F-7).
-- ---------------------------------------------------------------------------
create view public.v_order_money as
select
  o.id                                        as order_id,
  o.external_ref,
  o.status                                    as order_status,
  o.payment_status,
  coalesce(o.total, 0)                        as total,
  coalesce(e.cobrado, 0)                      as cobrado,
  coalesce(e.reembolsado, 0)                  as reembolsado,
  coalesce(e.cobrado, 0) - coalesce(e.reembolsado, 0)                        as cobrado_neto,
  coalesce(o.total, 0) - (coalesce(e.cobrado, 0) - coalesce(e.reembolsado, 0)) as saldo,
  case
    when coalesce(e.reembolsado, 0) > 0
         and coalesce(e.cobrado, 0) - coalesce(e.reembolsado, 0) <= 0            then 'refunded'
    when coalesce(e.cobrado, 0) - coalesce(e.reembolsado, 0) >= coalesce(o.total, 0)
         and coalesce(e.cobrado, 0) > 0                                          then 'paid'
    when coalesce(e.cobrado, 0) - coalesce(e.reembolsado, 0) > 0                 then 'parcial'
    else 'pending'
  end                                         as estado_pago,
  (coalesce(e.cobrado, 0) - coalesce(e.reembolsado, 0)) > coalesce(o.total, 0)  as sobrepago,
  coalesce(rf.pendiente, 0)                   as reembolso_pendiente,
  (cg.id is not null)                         as credito_autorizado,
  cg.due_date,
  (cg.id is not null and cg.due_date < public.hoy_local())                     as vencido,
  -- F-7: liberado para surtir = cobro suficiente OR crédito autorizado vigente.
  ((coalesce(e.cobrado, 0) - coalesce(e.reembolsado, 0)) >= coalesce(o.total, 0)
     and coalesce(o.total, 0) > 0)
    or cg.id is not null                      as liberado
from public.orders o
left join lateral (
  select sum(amount) filter (where direction = 'in')  as cobrado,
         sum(amount) filter (where direction = 'out') as reembolsado
    from public.payment_entries pe where pe.order_id = o.id
) e on true
left join lateral (
  -- Autorizado − pagado NETO (una reversa de un egreso vuelve a dejar el reembolso pendiente).
  select coalesce(sum(r.monto), 0) - coalesce((
           select sum(case when pe.direction = 'out' then pe.amount else -pe.amount end)
             from public.payment_entries pe
            where pe.order_id = o.id and pe.refund_id is not null
         ), 0) as pendiente
    from public.refunds r where r.order_id = o.id
) rf on true
left join lateral (
  select cgx.id, cgx.due_date from public.credit_grants cgx
   where cgx.order_id = o.id and cgx.revoked_at is null limit 1
) cg on true;

comment on view public.v_order_money is
  'W2 · definición ÚNICA del dinero por pedido. cobrado_neto = Σin − Σout; saldo = total − cobrado_neto; '
  'liberado = cobro suficiente OR crédito autorizado vigente (derivado, sin columna cacheada).';

-- ---------------------------------------------------------------------------
-- 7) Protecciones append-only (se REUTILIZA ledger_append_only de W1, sin
--    modificarla) + guardas de escritura única para las resoluciones.
-- ---------------------------------------------------------------------------
create trigger trg_money_operations_append_only before update or delete on public.money_operations
  for each row execute function public.ledger_append_only();
create trigger trg_payment_entries_append_only before update or delete on public.payment_entries
  for each row execute function public.ledger_append_only();

create trigger trg_money_operations_no_truncate before truncate on public.money_operations
  for each statement execute function public.ledger_append_only();
create trigger trg_payment_entries_no_truncate before truncate on public.payment_entries
  for each statement execute function public.ledger_append_only();
create trigger trg_payment_claims_no_truncate before truncate on public.payment_claims
  for each statement execute function public.ledger_append_only();
create trigger trg_credit_grants_no_truncate before truncate on public.credit_grants
  for each statement execute function public.ledger_append_only();
create trigger trg_cash_closings_no_truncate before truncate on public.cash_closings
  for each statement execute function public.ledger_append_only();

-- Declaración: la identidad es inmutable; la resolución se escribe UNA vez.
create or replace function public.payment_claims_guard() returns trigger
  language plpgsql set search_path = public as
$$
begin
  if current_setting('renovacell.purge', true) = 'on' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    raise exception 'LEDGER_APPEND_ONLY: payment_claims es inmutable; registra una declaración nueva.'
      using errcode = 'check_violation';
  end if;
  if (new.id, new.order_id, new.method, new.amount_declared, new.reference, new.bank_account_id,
      new.proof_path, new.declared_by, new.declared_at, new.created_at)
     is distinct from
     (old.id, old.order_id, old.method, old.amount_declared, old.reference, old.bank_account_id,
      old.proof_path, old.declared_by, old.declared_at, old.created_at) then
    raise exception 'LEDGER_APPEND_ONLY: payment_claims solo admite registrar su resolución.'
      using errcode = 'check_violation';
  end if;
  if old.status <> 'reportado' then
    raise exception 'DECLARACION_YA_RESUELTA: la declaración ya está %.', old.status using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger trg_payment_claims_guard before update or delete on public.payment_claims
  for each row execute function public.payment_claims_guard();

-- Crédito: la concesión es inmutable; la revocación se escribe UNA vez.
create or replace function public.credit_grants_guard() returns trigger
  language plpgsql set search_path = public as
$$
begin
  if current_setting('renovacell.purge', true) = 'on' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    raise exception 'LEDGER_APPEND_ONLY: credit_grants es inmutable; revoca en vez de borrar.'
      using errcode = 'check_violation';
  end if;
  if (new.id, new.order_id, new.due_date, new.reason, new.granted_by, new.granted_at)
     is distinct from
     (old.id, old.order_id, old.due_date, old.reason, old.granted_by, old.granted_at) then
    raise exception 'LEDGER_APPEND_ONLY: credit_grants solo admite registrar la revocación.'
      using errcode = 'check_violation';
  end if;
  if old.revoked_at is not null then
    raise exception 'CREDITO_YA_REVOCADO' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger trg_credit_grants_guard before update or delete on public.credit_grants
  for each row execute function public.credit_grants_guard();

-- Corte de caja: append-only (la anulación es una fila compensatoria · D-W2-7).
create or replace function public.cash_closings_guard() returns trigger
  language plpgsql set search_path = public as
$$
begin
  if current_setting('renovacell.purge', true) = 'on' then return coalesce(new, old); end if;
  raise exception 'LEDGER_APPEND_ONLY: un corte de caja no se edita ni se borra; regístra una anulación compensatoria.'
    using errcode = 'check_violation';
end;
$$;
create trigger trg_cash_closings_guard before update or delete on public.cash_closings
  for each row execute function public.cash_closings_guard();

-- ---------------------------------------------------------------------------
-- 8) RLS: las tablas nuevas nacen de SOLO LECTURA para los clientes.
--    Escriben ÚNICAMENTE los comandos SECURITY DEFINER de N3.
-- ---------------------------------------------------------------------------
alter table public.money_operations enable row level security;
alter table public.payment_claims   enable row level security;
alter table public.payment_entries  enable row level security;
alter table public.credit_grants    enable row level security;

revoke insert, update, delete, truncate on
  public.money_operations, public.payment_claims, public.payment_entries, public.credit_grants
  from anon, authenticated;
revoke all on public.money_operations, public.payment_claims, public.payment_entries, public.credit_grants from anon;

create policy money_operations_select_admin on public.money_operations
  for select to authenticated using (public.auth_role() = 'admin');
create policy payment_entries_select_finanzas on public.payment_entries
  for select to authenticated using (public.auth_role() = any (array['admin','billing','pos']));
create policy credit_grants_select_ops on public.credit_grants
  for select to authenticated using (
    public.auth_role() = any (array['admin','billing','warehouse','packing'])
    or exists (select 1 from public.orders o where o.id = order_id and o.doctor_id = auth.uid()));
-- El doctor ve SUS declaraciones (necesita saber si su transferencia fue aceptada).
create policy payment_claims_select_scoped on public.payment_claims
  for select to authenticated using (
    public.auth_role() = any (array['admin','billing','pos'])
    or exists (select 1 from public.orders o where o.id = order_id and o.doctor_id = auth.uid()));

grant select on public.v_order_money to authenticated;
