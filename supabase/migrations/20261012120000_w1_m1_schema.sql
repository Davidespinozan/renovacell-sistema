-- ============================================================================
-- W1 · M1 — ESQUEMA (aditivo). Integridad de mutaciones de inventario y pedido.
--
--  · Registro de operaciones (idempotencia por op_id)            inventory_operations
--  · Recepciones durables (parcial / sin orden / excedente)      purchase_receipts
--  · Cancelación como hecho auditable                            order_cancellations
--  · Entrada física en dos pasos (devolución / reingreso)        stock_returns + stock_return_lines
--  · Referencias de negocio en el kardex (op/pedido/renglón/recepción/devolución)
--  · Acumulado recibido y cierre en compras                      replenishments.*
--  · Identidad canónica del lote (producto + código normalizado) lots.lot_code_norm
--  · Anulación manual de guía (frontera W3)                      shipping_attempts.void_*
--  · Fecha local única (America/Mazatlan) para caducidad
--
-- Tablas nuevas: nacen con RLS, SOLO lectura para clientes (escriben los comandos
-- SECURITY DEFINER de M3) y protegidas append-only. No cambia comportamiento
-- existente: las constraints van en M2, los comandos en M3 y el cierre de
-- escrituras directas en M4.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Fecha local y caducidad (una sola definición para todo W1)
-- ---------------------------------------------------------------------------
create or replace function public.hoy_local() returns date
  language sql stable set search_path = public as
$$ select (now() at time zone 'America/Mazatlan')::date $$;

-- Vigente hasta el día de caducidad inclusive. Sin fecha = no vendible (falla cerrado).
create or replace function public.lote_caducado(p_expiry date) returns boolean
  language sql stable set search_path = public as
$$ select p_expiry is null or p_expiry < public.hoy_local() $$;

-- Normalización del código de lote: espacios de borde fuera, espacios internos
-- repetidos colapsados, sin distinguir mayúsculas. Guiones/ceros se conservan.
create or replace function public.lote_code_norm(p_code text) returns text
  language sql immutable set search_path = public as
$$ select lower(regexp_replace(btrim(p_code), '\s+', ' ', 'g')) $$;

-- ---------------------------------------------------------------------------
-- 1) Registro de operaciones (idempotencia)
-- ---------------------------------------------------------------------------
create table public.inventory_operations (
  op_id        uuid primary key,
  kind         text not null check (kind in (
                 'recepcion','carga_inicial','cierre_compra','ajuste','surtido','venta_pos',
                 'cancelacion','reingreso_cancelacion','recepcion_devolucion',
                 'disposicion_devolucion','anulacion_guia')),
  actor        uuid,
  actor_role   text not null,
  request_hash text not null,
  result       jsonb not null,
  created_at   timestamptz not null default now()
);
create index idx_inventory_operations_kind on public.inventory_operations(kind, created_at);

-- ---------------------------------------------------------------------------
-- 2) Recepciones (una fila por recepción física; id = op_id)
-- ---------------------------------------------------------------------------
create table public.purchase_receipts (
  id               uuid primary key,
  kind             text not null check (kind in ('orden','sin_orden','excedente','carga_inicial')),
  replenishment_id uuid references public.replenishments(id) on delete restrict,
  product_id       uuid not null references public.products(id) on delete restrict,
  lot_id           uuid not null references public.lots(id) on delete restrict,
  qty              integer not null check (qty > 0),
  unit_cost        numeric,
  reason           text,
  evidence_ref     text,
  received_by      uuid,
  authorized_by    uuid,
  created_at       timestamptz not null default now(),
  constraint ck_receipt_orden      check (kind not in ('orden','excedente') or replenishment_id is not null),
  constraint ck_receipt_autorizada check (kind = 'orden'
                                          or (nullif(btrim(reason), '') is not null and authorized_by is not null))
);
create index idx_purchase_receipts_repl on public.purchase_receipts(replenishment_id);
create index idx_purchase_receipts_lot  on public.purchase_receipts(lot_id);

-- ---------------------------------------------------------------------------
-- 3) Entrada física en dos pasos
--    origin='devolucion'  : Almacén recibe + inspecciona → Dirección dispone.
--    origin='cancelacion' : se crea al cancelar un pedido EMPACADO con los lotes
--                           realmente consumidos → Almacén confirma el reacomodo.
-- ---------------------------------------------------------------------------
create table public.stock_returns (
  id         uuid primary key,
  order_id   uuid not null references public.orders(id) on delete restrict,
  origin     text not null check (origin in ('devolucion','cancelacion')),
  notes      text,
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index uq_stock_returns_cancelacion on public.stock_returns(order_id) where origin = 'cancelacion';
create index idx_stock_returns_order on public.stock_returns(order_id);

create table public.stock_return_lines (
  id                 uuid primary key default gen_random_uuid(),
  return_id          uuid not null references public.stock_returns(id) on delete restrict,
  order_id           uuid not null references public.orders(id) on delete restrict,
  order_item_id      uuid references public.order_items(id) on delete restrict,
  product_id         uuid not null references public.products(id) on delete restrict,
  lot_id             uuid not null references public.lots(id) on delete restrict,
  qty                integer not null check (qty > 0),
  inspection         text check (inspection in ('ok','dañado','caducado')),   -- NULL = reingreso por confirmar
  inspected_by       uuid,
  inspected_at       timestamptz,
  notes              text,
  disposition        text check (disposition in ('vendible','merma')),        -- NULL = pendiente
  disposed_by        uuid,
  disposed_at        timestamptz,
  disposition_op_id  uuid,
  created_at         timestamptz not null default now(),
  constraint ck_vendible_ok           check (disposition is distinct from 'vendible' or inspection = 'ok'),
  constraint ck_inspeccion_completa   check ((inspection is null) = (inspected_at is null)),
  constraint ck_disposicion_completa  check ((disposition is null) = (disposed_at is null)
                                            and (disposition is null) = (disposition_op_id is null))
);
create index idx_stock_return_lines_order_lot on public.stock_return_lines(order_id, lot_id);
create index idx_stock_return_lines_return    on public.stock_return_lines(return_id);

-- ---------------------------------------------------------------------------
-- 4) Cancelación (una por pedido: la PK es la idempotencia natural)
-- ---------------------------------------------------------------------------
create table public.order_cancellations (
  order_id      uuid primary key references public.orders(id) on delete restrict,
  op_id         uuid not null unique,
  prior_status  text not null,
  reason        text,
  cancelled_by  uuid,
  actor_role    text not null,
  money_signal  text,   -- evidencia de dinero que forzó la ruta Dirección (pago/transferencia/stripe)
  refund_review text not null check (refund_review in ('no_aplica','pendiente_revision')),
  return_id     uuid references public.stock_returns(id) on delete restrict,
  created_at    timestamptz not null default now(),
  constraint ck_cancel_motivo check (actor_role = 'doctor' or nullif(btrim(reason), '') is not null)
);

-- ---------------------------------------------------------------------------
-- 5) Kardex: referencias de negocio (las exige M2 por motivo)
--    op_id es DEFERRABLE: el comando escribe los movimientos y registra la
--    operación al final de la MISMA transacción.
-- ---------------------------------------------------------------------------
alter table public.inventory_movements
  add column op_id          uuid references public.inventory_operations(op_id) on delete restrict
                              deferrable initially deferred,
  add column order_id       uuid references public.orders(id) on delete restrict,
  add column order_item_id  uuid references public.order_items(id) on delete restrict,
  add column receipt_id     uuid references public.purchase_receipts(id) on delete restrict,
  add column return_line_id uuid references public.stock_return_lines(id) on delete restrict;

create index idx_invmov_lot_created on public.inventory_movements(lot_id, created_at);
create index idx_invmov_order       on public.inventory_movements(order_id) where order_id is not null;
create index idx_invmov_order_item  on public.inventory_movements(order_item_id) where order_item_id is not null;
create index idx_invmov_receipt     on public.inventory_movements(receipt_id) where receipt_id is not null;
create index idx_invmov_return_line on public.inventory_movements(return_line_id) where return_line_id is not null;
create index idx_invmov_op          on public.inventory_movements(op_id);

-- ---------------------------------------------------------------------------
-- 6) Compras: acumulado recibido + cierre incompleto
-- ---------------------------------------------------------------------------
alter table public.replenishments
  add column received_qty integer not null default 0,
  add column closed_by    uuid,
  add column closed_at    timestamptz,
  add column close_reason text;

-- ---------------------------------------------------------------------------
-- 7) Lote: identidad canónica (UNIQUE en M2)
-- ---------------------------------------------------------------------------
alter table public.lots
  add column lot_code_norm text generated always as (lower(regexp_replace(btrim(lot_code), '\s+', ' ', 'g'))) stored;

-- ---------------------------------------------------------------------------
-- 8) Guía: anulación manual registrada por Dirección (frontera W3, sin proveedor)
-- ---------------------------------------------------------------------------
alter table public.shipping_attempts
  add column voided_by      uuid,
  add column voided_at      timestamptz,
  add column void_reference text,
  add column void_evidence  text;

-- ---------------------------------------------------------------------------
-- 9) Protección append-only de las tablas nuevas
--    ledger_append_only() es genérica (usa TG_TABLE_NAME y respeta el mismo
--    escape administrativo renovacell.purge) → se REUTILIZA sin modificarla.
--    También como trigger de SENTENCIA para TRUNCATE (que no dispara triggers
--    de fila). stock_return_lines necesita llenado único de inspección y
--    disposición → guarda específica mínima.
-- ---------------------------------------------------------------------------
create trigger trg_inventory_operations_append_only before update or delete on public.inventory_operations
  for each row execute function public.ledger_append_only();
create trigger trg_purchase_receipts_append_only before update or delete on public.purchase_receipts
  for each row execute function public.ledger_append_only();
create trigger trg_order_cancellations_append_only before update or delete on public.order_cancellations
  for each row execute function public.ledger_append_only();
create trigger trg_stock_returns_append_only before update or delete on public.stock_returns
  for each row execute function public.ledger_append_only();

create trigger trg_inventory_operations_no_truncate before truncate on public.inventory_operations
  for each statement execute function public.ledger_append_only();
create trigger trg_purchase_receipts_no_truncate before truncate on public.purchase_receipts
  for each statement execute function public.ledger_append_only();
create trigger trg_order_cancellations_no_truncate before truncate on public.order_cancellations
  for each statement execute function public.ledger_append_only();
create trigger trg_stock_returns_no_truncate before truncate on public.stock_returns
  for each statement execute function public.ledger_append_only();
create trigger trg_stock_return_lines_no_truncate before truncate on public.stock_return_lines
  for each statement execute function public.ledger_append_only();

create or replace function public.stock_return_lines_guard() returns trigger
  language plpgsql set search_path = public as
$$
begin
  if current_setting('renovacell.purge', true) = 'on' then
    return coalesce(new, old);  -- mismo escape administrativo que ledger_append_only
  end if;
  if tg_op = 'DELETE' then
    raise exception 'LEDGER_APPEND_ONLY: stock_return_lines es inmutable; registra un asiento nuevo.'
      using errcode = 'check_violation';
  end if;
  -- Identidad y cantidad: inmutables.
  if (new.id, new.return_id, new.order_id, new.order_item_id, new.product_id, new.lot_id, new.qty, new.created_at)
     is distinct from
     (old.id, old.return_id, old.order_id, old.order_item_id, old.product_id, old.lot_id, old.qty, old.created_at) then
    raise exception 'LEDGER_APPEND_ONLY: stock_return_lines solo admite registrar inspección y disposición.'
      using errcode = 'check_violation';
  end if;
  -- Inspección: se escribe UNA vez.
  if old.inspection is not null
     and (new.inspection, new.inspected_by, new.inspected_at, new.notes)
         is distinct from (old.inspection, old.inspected_by, old.inspected_at, old.notes) then
    raise exception 'LINEA_YA_INSPECCIONADA: la inspección ya se registró.' using errcode = 'check_violation';
  end if;
  -- Disposición: se escribe UNA vez.
  if old.disposition is not null
     and (new.disposition, new.disposed_by, new.disposed_at, new.disposition_op_id)
         is distinct from (old.disposition, old.disposed_by, old.disposed_at, old.disposition_op_id) then
    raise exception 'LINEA_YA_DISPUESTA: la disposición ya se registró.' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger trg_stock_return_lines_guard before update or delete on public.stock_return_lines
  for each row execute function public.stock_return_lines_guard();

-- ---------------------------------------------------------------------------
-- 10) RLS + privilegios de las tablas nuevas: SOLO lectura para clientes
-- ---------------------------------------------------------------------------
alter table public.inventory_operations enable row level security;
alter table public.purchase_receipts    enable row level security;
alter table public.stock_returns        enable row level security;
alter table public.stock_return_lines   enable row level security;
alter table public.order_cancellations  enable row level security;

revoke insert, update, delete, truncate on
  public.inventory_operations, public.purchase_receipts, public.stock_returns,
  public.stock_return_lines, public.order_cancellations
  from anon, authenticated;
revoke all on public.inventory_operations, public.purchase_receipts, public.stock_returns,
  public.stock_return_lines, public.order_cancellations from anon;

create policy inventory_operations_select_admin on public.inventory_operations
  for select to authenticated using (public.auth_role() = 'admin');
create policy purchase_receipts_select_ops on public.purchase_receipts
  for select to authenticated using (public.auth_role() = any (array['admin','warehouse','packing','billing']));
create policy stock_returns_select_ops on public.stock_returns
  for select to authenticated using (public.auth_role() = any (array['admin','warehouse','packing','billing']));
create policy stock_return_lines_select_ops on public.stock_return_lines
  for select to authenticated using (public.auth_role() = any (array['admin','warehouse','packing','billing']));
create policy order_cancellations_select_ops on public.order_cancellations
  for select to authenticated using (
    public.auth_role() = any (array['admin','warehouse','packing','billing'])
    or exists (select 1 from public.orders o where o.id = order_id and o.doctor_id = auth.uid()));
