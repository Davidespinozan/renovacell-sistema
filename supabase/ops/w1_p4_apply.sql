-- GENERADO por supabase/ops/build_w1_p4_bundle.sh — NO EDITAR A MANO.
-- W1 · P4: M1→M4 + historial en UNA transacción. Ejecutar SOLO con autorización de David,
-- DESPUÉS de w1_base_limpia.sql. Uso: psql -X -v ON_ERROR_STOP=1 -f supabase/ops/w1_p4_apply.sql
-- sha256 20261012120000_w1_m1_schema.sql d1a2aab9b3138487b446733b0530633dc0f9c7c47e03da09a9e624e3ca6cec11
-- sha256 20261012120100_w1_m2_constraints.sql e9af0f5ee6e7ddf6a5bf09d3481bdad51d5e0db25a0a2013d9b4b4c62cad9f1c
-- sha256 20261012120200_w1_m3_commands.sql ec7dd133ac266e2cf2164d62bfc5a36aef023c4a45951bf8f3a7bade2a14e210
-- sha256 20261012120300_w1_m4_authority.sql 1db8dc3545a87954696aed2af151b1cd79a83dce4c00184320a55a56f4efaac2
begin;
set local lock_timeout = '10s';

-- >>>>>>>>>>>>>>>> 20261012120000_w1_m1_schema.sql
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

-- >>>>>>>>>>>>>>>> 20261012120100_w1_m2_constraints.sql
-- ============================================================================
-- W1 · M2 — CONSTRAINTS E ÍNDICES (todas VÁLIDAS, sin excepciones históricas).
--
-- PRECONDICIÓN: base limpia transaccional. Si el kardex, los lotes o los pedidos
-- contienen filas que no cumplen las reglas nuevas, esta migración ABORTA sin
-- aplicar nada (así nunca se "grandfatherean" datos de prueba). En producción
-- debe correr DESPUÉS de supabase/ops/w1_base_limpia.sql (autorización aparte).
-- ============================================================================

do $pre$
declare n int;
begin
  select count(*) into n from public.inventory_movements;
  if n > 0 then
    raise exception 'W1_M2_PRECONDICION: inventory_movements tiene % filas previas a W1 (sin op_id/referencias). Ejecuta primero la base limpia autorizada.', n;
  end if;
  select count(*) into n from public.lots where product_id is null or expiry_date is null or public.lote_code_norm(lot_code) = '';
  if n > 0 then
    raise exception 'W1_M2_PRECONDICION: % lotes sin producto/caducidad/código.', n;
  end if;
  select count(*) into n from (select 1 from public.lots group by product_id, lot_code_norm having count(*) > 1) d;
  if n > 0 then
    raise exception 'W1_M2_PRECONDICION: % identidades de lote duplicadas (producto + código normalizado).', n;
  end if;
  select count(*) into n from public.replenishments where status not in ('pendiente','parcial','recibida','cerrada_incompleta')
                                                       or kind not in ('compra','produccion') or qty <= 0;
  if n > 0 then
    raise exception 'W1_M2_PRECONDICION: % compras con estado/tipo/cantidad inválidos.', n;
  end if;
end
$pre$;

-- ---------------------------------------------------------------------------
-- LOTES — identidad canónica (Modelo A) y no-negatividad
-- ---------------------------------------------------------------------------
alter table public.lots alter column product_id set not null;
alter table public.lots alter column expiry_date set not null;
alter table public.lots alter column location set default 'Culiacán';
alter table public.lots add constraint ck_lots_code_not_blank check (lot_code_norm <> '');
create unique index uq_lots_product_code on public.lots(product_id, lot_code_norm);
alter table public.lots validate constraint lots_quantity_nonneg;

-- Borrar un producto nunca debe borrar sus lotes (antes: ON DELETE CASCADE).
alter table public.lots drop constraint lots_product_id_fkey;
alter table public.lots add constraint lots_product_id_fkey
  foreign key (product_id) references public.products(id) on delete restrict;

-- ---------------------------------------------------------------------------
-- KARDEX — todo movimiento nace de un comando y carga su referencia de negocio
-- ---------------------------------------------------------------------------
alter table public.inventory_movements alter column op_id set not null;
alter table public.inventory_movements alter column lot_id set not null;
alter table public.inventory_movements add constraint ck_invmov_change_nonzero check (change <> 0);
alter table public.inventory_movements add constraint ck_invmov_reason check (reason in (
  'entrada','carga_inicial','surtido','venta','devolucion','cancelacion','merma','ajuste','correccion_recepcion'));
alter table public.inventory_movements add constraint ck_invmov_referencia check (
     (reason in ('surtido','venta')        and change < 0 and order_id is not null and order_item_id is not null)
  or (reason in ('entrada','carga_inicial') and change > 0 and receipt_id is not null)
  or (reason in ('devolucion','cancelacion') and change > 0 and order_id is not null and return_line_id is not null)
  or (reason = 'merma'                     and change < 0 and nullif(btrim(reference), '') is not null)
  or (reason = 'ajuste'                    and nullif(btrim(reference), '') is not null)
  or (reason = 'correccion_recepcion'      and change < 0 and receipt_id is not null
                                           and nullif(btrim(reference), '') is not null));

-- ---------------------------------------------------------------------------
-- PEDIDOS — estados válidos (la guarda de transiciones va en M4)
-- ---------------------------------------------------------------------------
alter table public.orders add constraint ck_orders_status check (status in (
  'draft','pending_payment','paid','picking','packed','shipped','delivered','fulfilled','cancelled'));

-- ---------------------------------------------------------------------------
-- COMPRAS — acumulado y estados coherentes
-- ---------------------------------------------------------------------------
alter table public.replenishments add constraint ck_repl_qty       check (qty > 0);
alter table public.replenishments add constraint ck_repl_kind      check (kind in ('compra','produccion'));
alter table public.replenishments add constraint ck_repl_received  check (received_qty >= 0 and received_qty <= qty);
alter table public.replenishments add constraint ck_repl_status    check (status in ('pendiente','parcial','recibida','cerrada_incompleta'));
alter table public.replenishments add constraint ck_repl_coherencia check (
     (status = 'pendiente'          and received_qty = 0)
  or (status = 'parcial'            and received_qty > 0 and received_qty < qty)
  or (status = 'recibida'           and received_qty = qty)
  or (status = 'cerrada_incompleta' and received_qty < qty and closed_at is not null
                                    and nullif(btrim(close_reason), '') is not null));

-- ---------------------------------------------------------------------------
-- GUÍAS — nuevo estado terminal de anulación manual (frontera W3)
-- ---------------------------------------------------------------------------
alter table public.shipping_attempts drop constraint ck_shipping_attempts_status;
alter table public.shipping_attempts add constraint ck_shipping_attempts_status check (status in (
  'pending','succeeded','failed_safe_to_retry','unknown_requires_reconciliation','voided_manual'));
alter table public.shipping_attempts add constraint ck_shipping_attempts_void check (
  (status = 'voided_manual') = (voided_at is not null and nullif(btrim(void_reference), '') is not null));

-- >>>>>>>>>>>>>>>> 20261012120200_w1_m3_commands.sql
-- ============================================================================
-- W1 · M3 — COMANDOS DEL SERVIDOR (único camino de escritura de inventario).
--
-- Protocolo común (todos SECURITY DEFINER + search_path=public):
--   1) rol con auth_role()   2) lock consultivo por op_id + consulta del registro
--   (mismo op_id + mismo contenido ⇒ devuelve el resultado guardado, efecto CERO;
--   mismo op_id + otro contenido ⇒ OP_ID_REUTILIZADO)   3) locks de filas
--   (pedido → compra → lotes por id)   4) validaciones   5) kardex con referencia
--   de negocio   6) registro de la operación   7) resultado canónico.
--
-- Firmas que CAMBIAN (la vieja se elimina → el frontend viejo falla cerrado):
--   recibir_lote, importar_lote, surtir_pedido.
-- Misma firma, reglas nuevas: vender_pos, registrar_devolucion (sin inventario).
-- Preservado tal cual dentro de recibir_lote: el cálculo de costo del lote.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Registro de operaciones (interno; no ejecutable por clientes)
-- ---------------------------------------------------------------------------
create or replace function public._w1_op_begin(p_op uuid, p_kind text, p_req jsonb) returns jsonb
  language plpgsql set search_path = public as
$$
declare r record;
begin
  if p_op is null then
    raise exception 'OP_ID_REQUERIDO: la operación requiere un op_id estable (reintentos con el mismo op_id no duplican)';
  end if;
  -- Serializa llamadas con el MISMO op_id: la segunda espera y, en READ COMMITTED,
  -- su siguiente sentencia ya ve el registro confirmado por la primera.
  perform pg_advisory_xact_lock(hashtextextended('w1-op:' || p_op::text, 0));
  select kind, request_hash, result into r from public.inventory_operations where op_id = p_op;
  if not found then
    return null;
  end if;
  if r.kind <> p_kind or r.request_hash <> md5(p_kind || ':' || p_req::text) then
    raise exception 'OP_ID_REUTILIZADO: el op_id % ya se usó para otra operación distinta', p_op;
  end if;
  return r.result || jsonb_build_object('status', 'already_applied');
end;
$$;

create or replace function public._w1_op_finish(p_op uuid, p_kind text, p_req jsonb, p_result jsonb) returns jsonb
  language plpgsql set search_path = public as
$$
begin
  insert into public.inventory_operations (op_id, kind, actor, actor_role, request_hash, result)
  values (p_op, p_kind, auth.uid(), coalesce(public.auth_role(), ''), md5(p_kind || ':' || p_req::text), p_result);
  return p_result;
end;
$$;

create or replace function public._w1_trusted(p_on boolean) returns void
  language sql set search_path = public as
$$ select set_config('app.trusted', case when p_on then 'on' else 'off' end, true); $$;

revoke all on function public._w1_op_begin(uuid, text, jsonb), public._w1_op_finish(uuid, text, jsonb, jsonb),
  public._w1_trusted(boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1) RECEPCIÓN — parcial, acumulada, idempotente (D-04) + identidad de lote (D-05)
-- ---------------------------------------------------------------------------
drop function if exists public.recibir_lote(uuid, text, text, integer, text, numeric, text, text, uuid);

create function public.recibir_lote(
  p_op_id            uuid,
  p_product          uuid,
  p_lote             text,
  p_caducidad        date,
  p_cantidad         integer,
  p_replenishment_id uuid    default null,
  p_kind             text    default 'orden',   -- orden | sin_orden | excedente
  p_unit_cost        numeric default null,
  p_reason           text    default null,
  p_evidence         text    default null
) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_role text := public.auth_role();
  v_uid  uuid := auth.uid();
  v_req  jsonb; v_prev jsonb; v_res jsonb;
  v_rep  record;
  v_norm text; v_lot uuid; v_oldq int; v_oldc numeric; v_exp date;
  v_inc  numeric; v_newc numeric; v_created boolean := false;
  v_rec_status text; v_rec_qty int; v_rec_pend int;
begin
  if p_kind is null or p_kind not in ('orden','sin_orden','excedente') then
    raise exception 'TIPO_RECEPCION_INVALIDO: usa orden, sin_orden o excedente';
  end if;
  if p_kind = 'orden' then
    if not (v_role = any (array['admin','warehouse','packing'])) then
      raise exception 'NO_AUTORIZADO: sin permiso para recibir inventario';
    end if;
  elsif v_role <> 'admin' then
    raise exception 'NO_AUTORIZADO: una entrada % requiere autorización de Dirección', p_kind;
  end if;

  v_req := jsonb_build_object('product', p_product, 'lote', p_lote, 'caducidad', p_caducidad,
             'cantidad', p_cantidad, 'replenishment', p_replenishment_id, 'kind', p_kind,
             'unit_cost', p_unit_cost, 'reason', p_reason, 'evidence', p_evidence);
  v_prev := public._w1_op_begin(p_op_id, 'recepcion', v_req);
  if v_prev is not null then return v_prev; end if;

  if p_product is null or not exists (select 1 from public.products where id = p_product) then
    raise exception 'PRODUCTO_INEXISTENTE';
  end if;
  if coalesce(public.lote_code_norm(p_lote), '') = '' then raise exception 'LOTE_REQUERIDO'; end if;
  if p_cantidad is null or p_cantidad <= 0 then raise exception 'CANTIDAD_INVALIDA: la cantidad debe ser mayor a cero'; end if;
  if p_caducidad is null then raise exception 'CADUCIDAD_REQUERIDA: toda recepción requiere fecha de caducidad'; end if;
  if public.lote_caducado(p_caducidad) then
    raise exception 'CADUCADO_NO_RECIBIBLE: el producto caducó el % (hoy %); no entra como stock', p_caducidad, public.hoy_local();
  end if;
  if p_kind <> 'orden' and nullif(btrim(p_reason), '') is null then
    raise exception 'MOTIVO_REQUERIDO: una entrada % requiere motivo', p_kind;
  end if;

  if p_kind in ('orden','excedente') then
    if p_replenishment_id is null then raise exception 'ORDEN_REQUERIDA: indica la orden de compra/producción'; end if;
    select * into v_rep from public.replenishments where id = p_replenishment_id for update;
    if not found then raise exception 'ORDEN_INEXISTENTE'; end if;
    if v_rep.product_id is distinct from p_product then
      raise exception 'ORDEN_PRODUCTO_DISTINTO: la orden es de otro producto';
    end if;
    if p_kind = 'orden' then
      if v_rep.status not in ('pendiente','parcial') then
        raise exception 'ORDEN_CERRADA: la orden está % y no se reabre; genera una nueva', v_rep.status;
      end if;
      if p_cantidad > v_rep.qty - v_rep.received_qty then
        raise exception 'RECEPCION_EXCEDE_PENDIENTE: pendiente de recibir % (pedido %, recibido %). El excedente va como entrada separada con autorización de Dirección.',
          v_rep.qty - v_rep.received_qty, v_rep.qty, v_rep.received_qty;
      end if;
    end if;
  elsif p_replenishment_id is not null then
    raise exception 'SIN_ORDEN_CON_ORDEN: una entrada sin orden no referencia una orden';
  end if;

  -- Costo de ESTA entrada (misma semántica previa): orden → costo de la orden; si no,
  -- costo explícito o costo de referencia; si tampoco hay → NULL (desconocido, no se fabrica).
  if p_kind = 'orden' then
    v_inc := v_rep.unit_cost;
  elsif p_kind = 'excedente' then
    v_inc := coalesce(p_unit_cost, v_rep.unit_cost);
  else
    v_inc := coalesce(p_unit_cost, (select unit_cost from public.product_costs where product_id = p_product));
  end if;

  -- Identidad canónica: producto + código normalizado (UNIQUE). Crear si no existe.
  v_norm := public.lote_code_norm(p_lote);
  insert into public.lots (product_id, lot_code, expiry_date, quantity, unit_cost)
  values (p_product, regexp_replace(btrim(p_lote), '\s+', ' ', 'g'), p_caducidad, 0, v_inc)
  on conflict (product_id, lot_code_norm) do nothing
  returning id into v_lot;
  v_created := v_lot is not null;

  select id, quantity, unit_cost, expiry_date into v_lot, v_oldq, v_oldc, v_exp
    from public.lots where product_id = p_product and lot_code_norm = v_norm for update;
  if v_exp is distinct from p_caducidad then
    raise exception 'LOTE_CADUCIDAD_DISTINTA: el lote % ya existe con caducidad % (recibida %). No se fusiona ni se sustituye.',
      p_lote, v_exp, p_caducidad;
  end if;
  if v_created then v_oldq := 0; v_oldc := null; end if;

  -- Costo del LOTE (preservado): promedio ponderado solo con ambos conocidos; nunca fabrica costo.
  v_newc := case
    when v_inc is null then v_oldc
    when coalesce(v_oldq, 0) <= 0 then v_inc
    when v_oldc is null then null
    else round((v_oldq * v_oldc + p_cantidad * v_inc) / (v_oldq + p_cantidad), 4)
  end;

  update public.lots set quantity = quantity + p_cantidad, unit_cost = v_newc where id = v_lot;

  insert into public.purchase_receipts (id, kind, replenishment_id, product_id, lot_id, qty, unit_cost,
                                        reason, evidence_ref, received_by, authorized_by)
  values (p_op_id, p_kind, p_replenishment_id, p_product, v_lot, p_cantidad, v_inc,
          nullif(btrim(p_reason), ''), nullif(btrim(p_evidence), ''), v_uid,
          case when p_kind <> 'orden' then v_uid end);

  insert into public.inventory_movements (lot_id, change, reason, reference, created_by, unit_cost, op_id, receipt_id)
  values (v_lot, p_cantidad, 'entrada',
          case when p_kind = 'orden' then 'OC ' || p_replenishment_id::text else p_kind || ': ' || btrim(p_reason) end,
          v_uid, v_inc, p_op_id, p_op_id);

  if p_kind = 'orden' then
    perform public._w1_trusted(true);
    update public.replenishments
       set received_qty = received_qty + p_cantidad,
           status = case when received_qty + p_cantidad = qty then 'recibida' else 'parcial' end
     where id = p_replenishment_id
     returning status, received_qty, qty - received_qty into v_rec_status, v_rec_qty, v_rec_pend;
    perform public._w1_trusted(false);
  end if;

  v_res := jsonb_build_object('status', 'applied', 'op_id', p_op_id, 'receipt_id', p_op_id, 'kind', p_kind,
             'lot_id', v_lot, 'lot_created', v_created, 'lot_unit_cost', v_newc,
             'replenishment_id', p_replenishment_id, 'replenishment_status', v_rec_status,
             'received_qty', v_rec_qty, 'pending_qty', v_rec_pend);
  return public._w1_op_finish(p_op_id, 'recepcion', v_req, v_res);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2) CARGA INICIAL (importación) — solo Dirección; caducidad estricta; idempotente
--    por lote existente (misma semántica "skipped" previa). Costo: no se fabrica.
-- ---------------------------------------------------------------------------
drop function if exists public.importar_lote(text, text, text, integer, text);

create function public.importar_lote(
  p_op_id     uuid,
  p_sku       text,
  p_lote      text,
  p_caducidad text,
  p_cantidad  integer
) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_uid uuid := auth.uid();
  v_req jsonb; v_prev jsonb; v_res jsonb;
  v_product uuid; v_lot uuid; v_exp date; v_have date;
begin
  if public.auth_role() <> 'admin' then
    raise exception 'NO_AUTORIZADO: la carga inicial requiere autorización de Dirección';
  end if;
  v_req := jsonb_build_object('sku', p_sku, 'lote', p_lote, 'caducidad', p_caducidad, 'cantidad', p_cantidad);
  v_prev := public._w1_op_begin(p_op_id, 'carga_inicial', v_req);
  if v_prev is not null then return v_prev; end if;

  if coalesce(public.lote_code_norm(p_lote), '') = '' then raise exception 'LOTE_REQUERIDO: falta el código de lote'; end if;
  if p_cantidad is null or p_cantidad <= 0 then raise exception 'CANTIDAD_INVALIDA: la cantidad debe ser mayor a cero'; end if;
  select id into v_product from public.products where lower(btrim(sku)) = lower(btrim(p_sku));
  if v_product is null then raise exception 'SKU_INEXISTENTE: no existe un producto con SKU %', p_sku; end if;
  if nullif(btrim(p_caducidad), '') is null then raise exception 'CADUCIDAD_REQUERIDA: el lote % no trae caducidad', p_lote; end if;
  begin
    v_exp := btrim(p_caducidad)::date;
  exception when others then
    raise exception 'CADUCIDAD_INVALIDA: "%" no es una fecha válida', p_caducidad;
  end;
  if public.lote_caducado(v_exp) then
    raise exception 'CADUCADO_NO_RECIBIBLE: el lote % caducó el %', p_lote, v_exp;
  end if;

  insert into public.lots (product_id, lot_code, expiry_date, quantity)
  values (v_product, regexp_replace(btrim(p_lote), '\s+', ' ', 'g'), v_exp, 0)
  on conflict (product_id, lot_code_norm) do nothing
  returning id into v_lot;

  if v_lot is null then
    select id, expiry_date into v_lot, v_have from public.lots
     where product_id = v_product and lot_code_norm = public.lote_code_norm(p_lote);
    if v_have is distinct from v_exp then
      raise exception 'LOTE_CADUCIDAD_DISTINTA: el lote % ya existe con caducidad % (archivo %)', p_lote, v_have, v_exp;
    end if;
    v_res := jsonb_build_object('status', 'applied', 'result', 'skipped', 'lot_id', v_lot);
    return public._w1_op_finish(p_op_id, 'carga_inicial', v_req, v_res);
  end if;

  update public.lots set quantity = quantity + p_cantidad where id = v_lot;
  insert into public.purchase_receipts (id, kind, product_id, lot_id, qty, reason, received_by, authorized_by)
  values (p_op_id, 'carga_inicial', v_product, v_lot, p_cantidad, 'carga inicial', v_uid, v_uid);
  insert into public.inventory_movements (lot_id, change, reason, reference, created_by, op_id, receipt_id)
  values (v_lot, p_cantidad, 'carga_inicial', 'MIGRACION', v_uid, p_op_id, p_op_id);

  v_res := jsonb_build_object('status', 'applied', 'result', 'created', 'lot_id', v_lot);
  return public._w1_op_finish(p_op_id, 'carga_inicial', v_req, v_res);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) CIERRE DE COMPRA INCOMPLETA — solo Dirección; terminal (no se reabre)
-- ---------------------------------------------------------------------------
create function public.cerrar_orden_compra(p_op_id uuid, p_replenishment uuid, p_reason text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_req jsonb; v_prev jsonb; v_res jsonb; v_rep record;
begin
  if public.auth_role() <> 'admin' then raise exception 'NO_AUTORIZADO: solo Dirección cierra órdenes incompletas'; end if;
  v_req := jsonb_build_object('replenishment', p_replenishment, 'reason', p_reason);
  v_prev := public._w1_op_begin(p_op_id, 'cierre_compra', v_req);
  if v_prev is not null then return v_prev; end if;
  if nullif(btrim(p_reason), '') is null then raise exception 'MOTIVO_REQUERIDO'; end if;

  select * into v_rep from public.replenishments where id = p_replenishment for update;
  if not found then raise exception 'ORDEN_INEXISTENTE'; end if;
  if v_rep.status not in ('pendiente','parcial') then
    raise exception 'ORDEN_NO_ABIERTA: la orden está %', v_rep.status;
  end if;

  perform public._w1_trusted(true);
  update public.replenishments
     set status = 'cerrada_incompleta', closed_by = auth.uid(), closed_at = now(), close_reason = btrim(p_reason)
   where id = p_replenishment;
  perform public._w1_trusted(false);

  v_res := jsonb_build_object('status', 'applied', 'replenishment_id', p_replenishment,
             'received_qty', v_rep.received_qty, 'faltante', v_rep.qty - v_rep.received_qty);
  return public._w1_op_finish(p_op_id, 'cierre_compra', v_req, v_res);
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) AJUSTE / MERMA / CORRECCIÓN DE RECEPCIÓN (D-06 + D-04 §8)
--    merma y ajuste negativo: Almacén (warehouse/packing) o admin, efecto inmediato.
--    ajuste positivo: solo Dirección. corrección de recepción: solo Dirección,
--    negativa, ligada a la recepción; nunca reabre la orden.
-- ---------------------------------------------------------------------------
create function public.ajustar_lote(
  p_op_id      uuid,
  p_lot        uuid,
  p_delta      integer,
  p_kind       text,              -- merma | ajuste | correccion_recepcion
  p_reason     text,
  p_receipt_id uuid default null
) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_role text := public.auth_role(); v_uid uuid := auth.uid();
  v_req jsonb; v_prev jsonb; v_res jsonb;
  v_lot record; v_rc record; v_rep record; v_corr int; v_new_rec int; v_new_status text;
begin
  if p_kind is null or p_kind not in ('merma','ajuste','correccion_recepcion') then
    raise exception 'TIPO_AJUSTE_INVALIDO: usa merma, ajuste o correccion_recepcion';
  end if;
  if p_delta is null or p_delta = 0 then raise exception 'CANTIDAD_INVALIDA: el ajuste no puede ser cero'; end if;
  if p_kind = 'merma' and p_delta > 0 then raise exception 'MERMA_DEBE_SER_NEGATIVA: una merma solo da de baja'; end if;
  if p_kind = 'correccion_recepcion' and p_delta > 0 then
    raise exception 'CORRECCION_DEBE_SER_NEGATIVA: si faltó capturar, registra otra recepción';
  end if;
  if p_delta > 0 or p_kind = 'correccion_recepcion' then
    if v_role <> 'admin' then
      raise exception 'NO_AUTORIZADO: % positivo/corrección de recepción requiere Dirección', p_kind;
    end if;
  elsif not (v_role = any (array['admin','warehouse','packing'])) then
    raise exception 'NO_AUTORIZADO: sin permiso para dar de baja inventario';
  end if;

  v_req := jsonb_build_object('lot', p_lot, 'delta', p_delta, 'kind', p_kind, 'reason', p_reason, 'receipt', p_receipt_id);
  v_prev := public._w1_op_begin(p_op_id, 'ajuste', v_req);
  if v_prev is not null then return v_prev; end if;

  if nullif(btrim(p_reason), '') is null then raise exception 'MOTIVO_REQUERIDO: toda baja/ajuste requiere motivo'; end if;
  if p_lot is null then raise exception 'LOTE_REQUERIDO'; end if;
  select * into v_lot from public.lots where id = p_lot for update;
  if not found then raise exception 'LOTE_INEXISTENTE'; end if;

  if p_kind = 'correccion_recepcion' then
    if p_receipt_id is null then raise exception 'RECEPCION_REQUERIDA: la corrección se liga a su recepción'; end if;
    select * into v_rc from public.purchase_receipts where id = p_receipt_id;
    if not found then raise exception 'RECEPCION_INEXISTENTE'; end if;
    if v_rc.lot_id <> p_lot then raise exception 'RECEPCION_DE_OTRO_LOTE'; end if;
    select coalesce(sum(-change), 0) into v_corr from public.inventory_movements
     where receipt_id = p_receipt_id and reason = 'correccion_recepcion';
    if v_corr + (-p_delta) > v_rc.qty then
      raise exception 'CORRECCION_EXCEDE_RECEPCION: recibido %, ya corregido %, solicitado %', v_rc.qty, v_corr, -p_delta;
    end if;
    if v_rc.kind = 'orden' then
      select * into v_rep from public.replenishments where id = v_rc.replenishment_id for update;
      v_new_rec := v_rep.received_qty - (-p_delta);
      v_new_status := case
        when v_rep.status in ('recibida','cerrada_incompleta') then 'cerrada_incompleta'  -- nunca se reabre
        when v_new_rec = 0 then 'pendiente'
        else 'parcial' end;
      perform public._w1_trusted(true);
      update public.replenishments
         set received_qty = v_new_rec,
             status       = v_new_status,
             closed_by    = case when v_rep.status = 'recibida' then v_uid else closed_by end,
             closed_at    = case when v_rep.status = 'recibida' then now() else closed_at end,
             close_reason = case when v_rep.status = 'recibida' then 'Corrección de recepción: ' || btrim(p_reason) else close_reason end
       where id = v_rep.id;
      perform public._w1_trusted(false);
    end if;
  elsif p_receipt_id is not null then
    raise exception 'RECEPCION_NO_APLICA: solo la corrección de recepción referencia una recepción';
  end if;

  if p_delta < 0 then
    update public.lots set quantity = quantity + p_delta where id = p_lot and quantity + p_delta >= 0;
    if not found then
      raise exception 'INVENTARIO_INSUFICIENTE: el lote % tiene % y la baja es de %', v_lot.lot_code, v_lot.quantity, -p_delta;
    end if;
  else
    update public.lots set quantity = quantity + p_delta where id = p_lot;
  end if;

  insert into public.inventory_movements (lot_id, change, reason, reference, created_by, op_id, receipt_id)
  values (p_lot, p_delta, p_kind, btrim(p_reason), v_uid, p_op_id, p_receipt_id);

  v_res := jsonb_build_object('status', 'applied', 'lot_id', p_lot, 'delta', p_delta, 'kind', p_kind,
             'quantity', v_lot.quantity + p_delta);
  return public._w1_op_finish(p_op_id, 'ajuste', v_req, v_res);
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) SURTIDO — asignaciones validadas contra los renglones del pedido
-- ---------------------------------------------------------------------------
drop function if exists public.surtir_pedido(uuid, text, jsonb, jsonb);

create function public.surtir_pedido(p_op_id uuid, p_order uuid, p_allocations jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_uid uuid := auth.uid();
  v_req jsonb; v_prev jsonb; v_res jsonb;
  v_ord record; a record; v_bad int; v_items int;
begin
  if not (public.auth_role() = any (array['admin','warehouse','packing'])) then
    raise exception 'NO_AUTORIZADO: sin permiso para surtir';
  end if;
  v_req := jsonb_build_object('order', p_order, 'allocations', p_allocations);
  v_prev := public._w1_op_begin(p_op_id, 'surtido', v_req);
  if v_prev is not null then return v_prev; end if;

  select id, status, external_ref into v_ord from public.orders where id = p_order for update;
  if not found then raise exception 'PEDIDO_INEXISTENTE'; end if;
  if v_ord.status = 'cancelled' or exists (select 1 from public.order_cancellations where order_id = p_order) then
    raise exception 'PEDIDO_CANCELADO: no se surte un pedido cancelado';
  end if;
  if v_ord.status in ('packed','shipped','delivered','fulfilled') then
    raise exception 'PEDIDO_YA_SURTIDO: el pedido ya está %', v_ord.status;
  end if;
  if v_ord.status not in ('paid','picking') then
    raise exception 'PEDIDO_NO_SURTIBLE: el pedido está %; solo se surte un pedido pagado', v_ord.status;
  end if;
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) = 0 then
    raise exception 'ASIGNACIONES_REQUERIDAS';
  end if;
  select count(*) into v_items from public.order_items where order_id = p_order;
  if v_items = 0 then raise exception 'PEDIDO_SIN_RENGLONES: no hay nada que surtir'; end if;

  -- a) cada asignación: renglón del pedido, qty > 0, lote del mismo producto, vigente
  for a in
    select x.order_item_id, x.lot_id, x.qty, oi.product_id as item_product, l.product_id as lot_product, l.expiry_date
      from jsonb_to_recordset(p_allocations) as x(order_item_id uuid, lot_id uuid, qty int)
      left join public.order_items oi on oi.id = x.order_item_id and oi.order_id = p_order
      left join public.lots l on l.id = x.lot_id
  loop
    if a.item_product is null then raise exception 'ASIGNACION_INVALIDA: el renglón % no pertenece al pedido', a.order_item_id; end if;
    if a.qty is null or a.qty <= 0 then raise exception 'CANTIDAD_INVALIDA: cada asignación debe ser mayor a cero'; end if;
    if a.lot_product is null then raise exception 'LOTE_INEXISTENTE: %', a.lot_id; end if;
    if a.lot_product <> a.item_product then raise exception 'LOTE_DE_OTRO_PRODUCTO: el lote % no es del producto del renglón', a.lot_id; end if;
    if public.lote_caducado(a.expiry_date) then raise exception 'LOTE_CADUCADO: el lote % caducó el %', a.lot_id, a.expiry_date; end if;
  end loop;

  -- b) cobertura exacta: Σ asignado por renglón = cantidad del renglón (todo o nada)
  select count(*) into v_bad
    from public.order_items oi
    left join (select x.order_item_id, sum(x.qty) s
                 from jsonb_to_recordset(p_allocations) as x(order_item_id uuid, lot_id uuid, qty int)
                group by 1) s on s.order_item_id = oi.id
   where oi.order_id = p_order and coalesce(s.s, 0) <> oi.qty;
  if v_bad > 0 then
    raise exception 'ASIGNACION_INCOMPLETA: % renglón(es) no cuadran con la cantidad pedida', v_bad;
  end if;

  -- c) locks de lotes en orden determinista (evita deadlocks entre surtidos)
  perform 1 from public.lots
   where id in (select x.lot_id from jsonb_to_recordset(p_allocations) as x(order_item_id uuid, lot_id uuid, qty int))
   order by id for update;

  -- d) descuento condicional + kardex con referencia de negocio
  for a in select x.order_item_id, x.lot_id, x.qty
             from jsonb_to_recordset(p_allocations) as x(order_item_id uuid, lot_id uuid, qty int)
  loop
    update public.lots set quantity = quantity - a.qty where id = a.lot_id and quantity - a.qty >= 0;
    if not found then raise exception 'INVENTARIO_INSUFICIENTE: el lote % no alcanza', a.lot_id; end if;
    insert into public.inventory_movements (lot_id, change, reason, reference, created_by, op_id, order_id, order_item_id)
    values (a.lot_id, -a.qty, 'surtido', coalesce(v_ord.external_ref, p_order::text), v_uid, p_op_id, p_order, a.order_item_id);
  end loop;

  -- e) empacado (solo por comando) + lote de referencia por renglón (dato de pantalla)
  perform public._w1_trusted(true);
  update public.orders set status = 'packed' where id = p_order;
  perform public._w1_trusted(false);
  update public.order_items oi set lot_id = f.lot_id
    from (select distinct on ((e.j ->> 'order_item_id')::uuid)
                 (e.j ->> 'order_item_id')::uuid as order_item_id, (e.j ->> 'lot_id')::uuid as lot_id
            from jsonb_array_elements(p_allocations) with ordinality as e(j, n)
           order by (e.j ->> 'order_item_id')::uuid, e.n) f
   where oi.id = f.order_item_id;

  v_res := jsonb_build_object('status', 'applied', 'order_id', p_order, 'order_status', 'packed',
             'allocations', jsonb_array_length(p_allocations));
  return public._w1_op_finish(p_op_id, 'surtido', v_req, v_res);
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) VENTA POS — misma firma; op_id = p_order_id; asignaciones por renglón.
--    Reintento con el mismo payload ⇒ true (éxito) sin duplicar. Precio, cliente,
--    pago y factura: SIN CAMBIOS (W2/CFDI).
-- ---------------------------------------------------------------------------
create or replace function public.vender_pos(p_order_id uuid, p_folio text, p_total numeric, p_payment_method text,
  p_doctor_id uuid, p_shipping_meta jsonb, p_lines jsonb, p_allocations jsonb,
  p_invoice_requested boolean default false, p_invoice_meta jsonb default null::jsonb, p_customer_id uuid default null::uuid)
returns boolean
  language plpgsql security definer set search_path = public as
$$
declare
  v_uid uuid := auth.uid();
  v_req jsonb; v_prev jsonb;
  a record; ln record; v_nlines int; qty int; pid uuid; up numeric; tot numeric := 0;
  v_items uuid[] := '{}'; v_prods uuid[] := '{}'; v_item uuid; v_bad int;
  v_cname text; v_cphone text; v_meta jsonb;
begin
  if not (public.auth_role() = any (array['admin','pos'])) then
    raise exception 'No autorizado';
  end if;
  v_req := jsonb_build_object('folio', p_folio, 'total', p_total, 'payment_method', p_payment_method,
             'doctor', p_doctor_id, 'shipping_meta', p_shipping_meta, 'lines', p_lines, 'allocations', p_allocations,
             'invoice_requested', p_invoice_requested, 'invoice_meta', p_invoice_meta, 'customer', p_customer_id);
  v_prev := public._w1_op_begin(p_order_id, 'venta_pos', v_req);
  if v_prev is not null then return true; end if;  -- ya aplicada: éxito idempotente

  if p_customer_id is not null then
    select full_name, phone into v_cname, v_cphone from public.customers where id = p_customer_id and active = true;
    if not found then raise exception 'CUSTOMER_INEXISTENTE: customer inexistente o inactivo'; end if;
  end if;
  if exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'PEDIDO_EXISTENTE: el id % ya pertenece a otro pedido', p_order_id;
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'VENTA_SIN_RENGLONES';
  end if;
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'ASIGNACIONES_REQUERIDAS';
  end if;
  v_nlines := jsonb_array_length(p_lines);

  -- Renglones: validación + precio autorizado (mostrador: base + volumen con CANTIDAD)
  for ln in select value as j, ordinality as n from jsonb_array_elements(p_lines) with ordinality loop
    pid := nullif(ln.j ->> 'product_id', '')::uuid; qty := (ln.j ->> 'qty')::int;
    if pid is null then raise exception 'Producto inválido'; end if;
    if qty is null or qty <= 0 then raise exception 'Cantidad inválida'; end if;
    up := public.precio_de(pid, null, qty);
    if up is null then raise exception 'Producto % sin precio válido', pid; end if;
    tot := tot + up * qty;
  end loop;

  -- Asignaciones: por renglón (line_index base 0), qty > 0, lote del producto, vigente
  for a in
    select x.line_index, x.lot_id, x.qty, l.product_id as lot_product, l.expiry_date,
           nullif(p_lines -> x.line_index ->> 'product_id', '')::uuid as line_product
      from jsonb_to_recordset(p_allocations) as x(line_index int, lot_id uuid, qty int)
      left join public.lots l on l.id = x.lot_id
  loop
    if a.line_index is null or a.line_index < 0 or a.line_index >= v_nlines then
      raise exception 'ASIGNACION_INVALIDA: renglón % inexistente', a.line_index;
    end if;
    if a.qty is null or a.qty <= 0 then raise exception 'CANTIDAD_INVALIDA: cada asignación debe ser mayor a cero'; end if;
    if a.lot_product is null then raise exception 'LOTE_INEXISTENTE: %', a.lot_id; end if;
    if a.lot_product <> a.line_product then raise exception 'LOTE_DE_OTRO_PRODUCTO: el lote % no es del producto del renglón', a.lot_id; end if;
    if public.lote_caducado(a.expiry_date) then raise exception 'LOTE_CADUCADO: el lote % caducó el %', a.lot_id, a.expiry_date; end if;
  end loop;
  select count(*) into v_bad
    from generate_series(0, v_nlines - 1) g(i)
    left join (select x.line_index, sum(x.qty) s from jsonb_to_recordset(p_allocations) as x(line_index int, lot_id uuid, qty int)
                group by 1) s on s.line_index = g.i
   where coalesce(s.s, 0) <> (p_lines -> g.i ->> 'qty')::int;
  if v_bad > 0 then raise exception 'ASIGNACION_INCOMPLETA: % renglón(es) no cuadran con la cantidad vendida', v_bad; end if;

  v_meta := p_shipping_meta;
  if p_customer_id is not null then
    v_meta := jsonb_set(coalesce(v_meta, '{}'::jsonb), '{customer}', jsonb_build_object('id', p_customer_id, 'name', v_cname, 'phone', v_cphone), true);
  end if;

  insert into public.orders (id, external_ref, doctor_id, customer_id, total, currency, status, payment_method, payment_status, invoice_requested, invoice_meta, shipping_meta)
  values (p_order_id, p_folio, p_doctor_id, p_customer_id, tot, 'MXN', 'delivered', p_payment_method, 'paid', coalesce(p_invoice_requested, false), p_invoice_meta, v_meta);

  for ln in select value as j, ordinality as n from jsonb_array_elements(p_lines) with ordinality loop
    pid := (ln.j ->> 'product_id')::uuid; qty := (ln.j ->> 'qty')::int;
    insert into public.order_items (order_id, product_id, lot_id, qty, unit_price)
    values (p_order_id, pid,
            (select (e.j ->> 'lot_id')::uuid from jsonb_array_elements(p_allocations) with ordinality as e(j, k)
              where (e.j ->> 'line_index')::int = ln.n - 1 order by e.k limit 1),
            qty, public.precio_de(pid, null, qty))
    returning id into v_item;
    v_items := v_items || v_item;
  end loop;

  perform 1 from public.lots
   where id in (select x.lot_id from jsonb_to_recordset(p_allocations) as x(line_index int, lot_id uuid, qty int))
   order by id for update;

  for a in select x.line_index, x.lot_id, x.qty from jsonb_to_recordset(p_allocations) as x(line_index int, lot_id uuid, qty int) loop
    update public.lots set quantity = quantity - a.qty where id = a.lot_id and quantity - a.qty >= 0;
    if not found then raise exception 'Inventario insuficiente en el lote %', a.lot_id; end if;
    insert into public.inventory_movements (lot_id, change, reason, reference, created_by, op_id, order_id, order_item_id)
    values (a.lot_id, -a.qty, 'venta', p_folio, v_uid, p_order_id, p_order_id, v_items[a.line_index + 1]);
  end loop;

  perform public._w1_op_finish(p_order_id, 'venta_pos', v_req,
    jsonb_build_object('status', 'applied', 'order_id', p_order_id, 'total', tot));
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- 7) CANCELACIÓN — atómica, idempotente, reglas por etapa (D-03 + frontera B)
-- ---------------------------------------------------------------------------
create function public.cancelar_pedido(p_op_id uuid, p_order uuid, p_reason text default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_role text := public.auth_role(); v_uid uuid := auth.uid();
  v_req jsonb; v_prev jsonb; v_res jsonb;
  v_o record; v_c record; v_money text; v_review text; v_ret uuid; v_attempt text;
begin
  if not (v_role = any (array['admin','billing','doctor'])) then
    raise exception 'NO_AUTORIZADO: tu rol no cancela pedidos';
  end if;
  v_req := jsonb_build_object('order', p_order, 'reason', p_reason);
  v_prev := public._w1_op_begin(p_op_id, 'cancelacion', v_req);
  if v_prev is not null then return v_prev; end if;

  select * into v_o from public.orders where id = p_order for update;
  if not found or (v_role = 'doctor' and v_o.doctor_id is distinct from v_uid) then
    raise exception 'PEDIDO_INEXISTENTE';
  end if;

  -- Ya cancelado ⇒ CERO efecto adicional (idempotencia natural por pedido).
  select * into v_c from public.order_cancellations where order_id = p_order;
  if found then
    v_res := jsonb_build_object('status', 'already_cancelled', 'order_id', p_order, 'prior_status', v_c.prior_status,
               'refund_review', v_c.refund_review, 'return_id', v_c.return_id);
    return public._w1_op_finish(p_op_id, 'cancelacion', v_req, v_res);
  end if;
  if v_o.status = 'cancelled' then
    v_res := jsonb_build_object('status', 'already_cancelled', 'order_id', p_order);
    return public._w1_op_finish(p_op_id, 'cancelacion', v_req, v_res);
  end if;

  if v_o.status in ('shipped','delivered','fulfilled') then
    raise exception 'USAR_DEVOLUCION: el pedido ya salió o se entregó (%); registra una devolución', v_o.status;
  end if;
  if v_o.status not in ('draft','pending_payment','paid','picking','packed') then
    raise exception 'ESTADO_INVALIDO: %', v_o.status;
  end if;

  -- Frontera B: evidencia de dinero ⇒ ruta Dirección + posible reembolso (sin fingir devolución).
  v_money := case
    when v_o.payment_status = 'paid' then 'pago_registrado'
    when (v_o.shipping_meta -> 'transfer' ->> 'reported') = 'true'
         and coalesce(v_o.shipping_meta -> 'transfer' -> 'review' ->> 'status', 'pending') in ('pending','confirmed')
      then 'transferencia_en_revision'
    when v_o.stripe_payment_id is not null then 'stripe'
    else null end;

  if v_o.status in ('draft','pending_payment') and v_money is null then
    null;  -- antes de pagar: doctor (su pedido) o staff autorizado (admin/billing)
  elsif v_role <> 'admin' then
    raise exception 'CANCELACION_REQUIERE_DIRECCION: pedido % (%)%: solo Dirección puede cancelarlo',
      coalesce(v_o.external_ref, p_order::text), v_o.status,
      case when v_money is not null then ' con evidencia de pago' else '' end;
  end if;
  if v_role <> 'doctor' and nullif(btrim(p_reason), '') is null then
    raise exception 'MOTIVO_REQUERIDO: la cancelación requiere motivo';
  end if;
  v_review := case when v_money is not null then 'pendiente_revision' else 'no_aplica' end;

  if v_o.status = 'packed' then
    -- Frontera A: guía activa (o desconocida) bloquea; se anula manualmente antes.
    select status into v_attempt from public.shipping_attempts
     where order_id = p_order and status in ('pending','succeeded','unknown_requires_reconciliation') limit 1;
    if found then
      raise exception 'GUIA_ACTIVA: el pedido tiene una guía en estado %; %', v_attempt,
        case when v_attempt = 'unknown_requires_reconciliation' then 'requiere reconciliación con la paquetería antes de cancelar'
             when v_attempt = 'pending' then 'hay una guía en proceso'
             else 'Dirección debe registrar su anulación manual antes de cancelar' end;
    end if;
    if exists (select 1 from public.shipments
                where order_id = p_order
                  and (dispatched_at is not null or status in ('despachado','out_for_delivery','delivered','incident'))) then
      raise exception 'USAR_DEVOLUCION: el pedido ya salió con el chofer/paquetería';
    end if;

    -- Reingreso PENDIENTE de confirmación física, desde los movimientos reales del pedido.
    if exists (select 1 from public.inventory_movements where order_id = p_order and reason in ('surtido','venta')) then
      v_ret := gen_random_uuid();
      insert into public.stock_returns (id, order_id, origin, notes, created_by)
      values (v_ret, p_order, 'cancelacion', btrim(p_reason), v_uid);
      insert into public.stock_return_lines (return_id, order_id, order_item_id, product_id, lot_id, qty)
      select v_ret, p_order, m.order_item_id, l.product_id, m.lot_id, sum(-m.change)
        from public.inventory_movements m join public.lots l on l.id = m.lot_id
       where m.order_id = p_order and m.reason in ('surtido','venta')
       group by m.order_item_id, l.product_id, m.lot_id
      having sum(-m.change) > 0;
    end if;

    update public.shipments set status = 'cancelado'
     where order_id = p_order and dispatched_at is null
       and coalesce(status, '') not in ('despachado','out_for_delivery','delivered','incident');
  end if;

  perform public._w1_trusted(true);
  update public.orders set status = 'cancelled' where id = p_order;
  perform public._w1_trusted(false);

  insert into public.order_cancellations (order_id, op_id, prior_status, reason, cancelled_by, actor_role,
                                          money_signal, refund_review, return_id)
  values (p_order, p_op_id, v_o.status, nullif(btrim(p_reason), ''), v_uid, v_role, v_money, v_review, v_ret);

  v_res := jsonb_build_object('status', 'applied', 'order_id', p_order, 'prior_status', v_o.status,
             'refund_review', v_review, 'money_signal', v_money, 'return_id', v_ret,
             'reingreso_pendiente', v_ret is not null);
  return public._w1_op_finish(p_op_id, 'cancelacion', v_req, v_res);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8) CONFIRMACIÓN FÍSICA DEL REINGRESO (cancelación de empacado) — Almacén
--    ok + lote vigente → reingreso al MISMO lote consumido, una sola vez.
--    dañado / lote caducado → queda para disposición de Dirección.
-- ---------------------------------------------------------------------------
create function public.confirmar_reingreso(p_op_id uuid, p_return_id uuid, p_lines jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_uid uuid := auth.uid();
  v_req jsonb; v_prev jsonb; v_res jsonb;
  v_ret record; r record; v_insp text; v_pending int; v_given int; v_match int; v_ok int := 0; v_okq int := 0; v_dir int := 0;
begin
  if not (public.auth_role() = any (array['admin','warehouse','packing'])) then
    raise exception 'NO_AUTORIZADO: sin permiso para confirmar reingresos';
  end if;
  v_req := jsonb_build_object('return', p_return_id, 'lines', p_lines);
  v_prev := public._w1_op_begin(p_op_id, 'reingreso_cancelacion', v_req);
  if v_prev is not null then return v_prev; end if;

  select sr.*, o.external_ref into v_ret from public.stock_returns sr join public.orders o on o.id = sr.order_id
   where sr.id = p_return_id and sr.origin = 'cancelacion' for update of sr;
  if not found then raise exception 'REINGRESO_INEXISTENTE'; end if;
  select count(*) into v_pending from public.stock_return_lines where return_id = p_return_id and inspection is null;
  if v_pending = 0 then raise exception 'REINGRESO_YA_CONFIRMADO'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then raise exception 'RENGLONES_REQUERIDOS'; end if;

  select count(*), count(distinct x.line_id) filter (where x.estado in ('ok','dañado')),
         count(rl.id)
    into v_given, v_match, v_pending
    from jsonb_to_recordset(p_lines) as x(line_id uuid, estado text)
    left join public.stock_return_lines rl on rl.id = x.line_id and rl.return_id = p_return_id and rl.inspection is null;
  if v_given <> v_match or v_given <> v_pending
     or v_given <> (select count(*) from public.stock_return_lines where return_id = p_return_id and inspection is null) then
    raise exception 'REINGRESO_INCOMPLETO: confirma cada renglón pendiente exactamente una vez con estado ok o dañado';
  end if;

  for r in
    select rl.id, rl.lot_id, rl.qty, rl.order_item_id, l.expiry_date, x.estado
      from jsonb_to_recordset(p_lines) as x(line_id uuid, estado text)
      join public.stock_return_lines rl on rl.id = x.line_id
      join public.lots l on l.id = rl.lot_id
     order by rl.lot_id
       for update of rl, l
  loop
    v_insp := case when public.lote_caducado(r.expiry_date) then 'caducado' else r.estado end;
    if v_insp = 'ok' then
      update public.lots set quantity = quantity + r.qty where id = r.lot_id;
      update public.stock_return_lines
         set inspection = 'ok', inspected_by = v_uid, inspected_at = now(),
             disposition = 'vendible', disposed_by = v_uid, disposed_at = now(), disposition_op_id = p_op_id
       where id = r.id;
      insert into public.inventory_movements (lot_id, change, reason, reference, created_by, op_id, order_id, order_item_id, return_line_id)
      values (r.lot_id, r.qty, 'cancelacion', coalesce(v_ret.external_ref, v_ret.order_id::text), v_uid, p_op_id,
              v_ret.order_id, r.order_item_id, r.id);
      v_ok := v_ok + 1; v_okq := v_okq + r.qty;
    else
      update public.stock_return_lines set inspection = v_insp, inspected_by = v_uid, inspected_at = now() where id = r.id;
      v_dir := v_dir + 1;
    end if;
  end loop;

  v_res := jsonb_build_object('status', 'applied', 'return_id', p_return_id, 'reingresados', v_ok,
             'cantidad_reingresada', v_okq, 'pendientes_direccion', v_dir);
  return public._w1_op_finish(p_op_id, 'reingreso_cancelacion', v_req, v_res);
end;
$$;

-- ---------------------------------------------------------------------------
-- 9) DEVOLUCIÓN — paso 1: Almacén recibe e inspecciona (sin mover stock)
--    Tope: Σ devuelto (previo + actual, cualquier origen) ≤ Σ salidas reales,
--    por pedido + lote (⇒ por producto), desde el kardex.
-- ---------------------------------------------------------------------------
create function public.recibir_devolucion(p_op_id uuid, p_order uuid, p_lines jsonb, p_notes text default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_uid uuid := auth.uid();
  v_req jsonb; v_prev jsonb; v_res jsonb;
  v_o record; r record; v_out int; v_prev_ret int; v_item uuid; v_n int := 0; v_q int := 0;
begin
  if not (public.auth_role() = any (array['admin','warehouse','packing'])) then
    raise exception 'NO_AUTORIZADO: sin permiso para recibir devoluciones';
  end if;
  v_req := jsonb_build_object('order', p_order, 'lines', p_lines, 'notes', p_notes);
  v_prev := public._w1_op_begin(p_op_id, 'recepcion_devolucion', v_req);
  if v_prev is not null then return v_prev; end if;

  select id, status into v_o from public.orders where id = p_order for update;
  if not found then raise exception 'PEDIDO_INEXISTENTE: no hay devolución sin pedido previo'; end if;
  if v_o.status = 'cancelled' or exists (select 1 from public.order_cancellations where order_id = p_order) then
    raise exception 'DEVOLUCION_NO_PERMITIDA: el pedido está cancelado';
  end if;
  if v_o.status not in ('shipped','delivered','fulfilled') then
    raise exception 'DEVOLUCION_NO_PERMITIDA: el pedido está % %', v_o.status,
      case when v_o.status = 'packed' then ' (si no ha salido, cancélalo)' else '' end;
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'RENGLONES_REQUERIDOS';
  end if;

  for r in select x.lot_id, x.qty, x.inspection from jsonb_to_recordset(p_lines) as x(lot_id uuid, qty int, inspection text) loop
    if r.qty is null or r.qty <= 0 then raise exception 'CANTIDAD_INVALIDA: cada renglón debe ser mayor a cero'; end if;
    if r.inspection is null or r.inspection not in ('ok','dañado') then
      raise exception 'INSPECCION_REQUERIDA: indica ok o dañado por renglón';
    end if;
    if r.lot_id is null or not exists (select 1 from public.lots where id = r.lot_id) then raise exception 'LOTE_INEXISTENTE'; end if;
  end loop;

  for r in select x.lot_id, sum(x.qty) as q from jsonb_to_recordset(p_lines) as x(lot_id uuid, qty int, inspection text) group by x.lot_id loop
    select coalesce(sum(-change), 0) into v_out from public.inventory_movements
     where order_id = p_order and lot_id = r.lot_id and reason in ('surtido','venta');
    if v_out = 0 then raise exception 'LOTE_NO_SURTIDO_EN_PEDIDO: el lote % no salió en este pedido', r.lot_id; end if;
    select coalesce(sum(qty), 0) into v_prev_ret from public.stock_return_lines where order_id = p_order and lot_id = r.lot_id;
    if r.q + v_prev_ret > v_out then
      raise exception 'DEVOLUCION_EXCEDE_SURTIDO: lote %: surtido %, ya devuelto %, solicitado %', r.lot_id, v_out, v_prev_ret, r.q;
    end if;
  end loop;

  insert into public.stock_returns (id, order_id, origin, notes, created_by)
  values (p_op_id, p_order, 'devolucion', nullif(btrim(p_notes), ''), v_uid);

  for r in
    select x.lot_id, x.qty, x.inspection, x.notes, l.product_id, l.expiry_date
      from jsonb_to_recordset(p_lines) as x(lot_id uuid, qty int, inspection text, notes text)
      join public.lots l on l.id = x.lot_id
  loop
    select case when count(distinct m.order_item_id) = 1 then min(m.order_item_id::text)::uuid end into v_item
      from public.inventory_movements m
     where m.order_id = p_order and m.lot_id = r.lot_id and m.reason in ('surtido','venta');
    insert into public.stock_return_lines (return_id, order_id, order_item_id, product_id, lot_id, qty,
                                           inspection, inspected_by, inspected_at, notes)
    values (p_op_id, p_order, v_item, r.product_id, r.lot_id, r.qty,
            case when public.lote_caducado(r.expiry_date) then 'caducado' else r.inspection end,
            v_uid, now(), nullif(btrim(r.notes), ''));
    v_n := v_n + 1; v_q := v_q + r.qty;
  end loop;

  v_res := jsonb_build_object('status', 'applied', 'return_id', p_op_id, 'order_id', p_order, 'renglones', v_n, 'cantidad', v_q);
  return public._w1_op_finish(p_op_id, 'recepcion_devolucion', v_req, v_res);
end;
$$;

-- ---------------------------------------------------------------------------
-- 10) DEVOLUCIÓN — paso 2: Dirección dispone (VENDIBLE | MERMA)
--     vendible: solo inspección ok y lote vigente → reingreso al lote, una vez.
--     merma: sin movimiento (el stock ya había salido); el renglón es la evidencia.
-- ---------------------------------------------------------------------------
create function public.disponer_devolucion(p_op_id uuid, p_lines jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_uid uuid := auth.uid();
  v_req jsonb; v_prev jsonb; v_res jsonb;
  r record; v_given int; v_distinct int; v_found int; v_v int := 0; v_m int := 0;
begin
  if public.auth_role() <> 'admin' then raise exception 'NO_AUTORIZADO: solo Dirección dispone devoluciones'; end if;
  v_req := jsonb_build_object('lines', p_lines);
  v_prev := public._w1_op_begin(p_op_id, 'disposicion_devolucion', v_req);
  if v_prev is not null then return v_prev; end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'RENGLONES_REQUERIDOS';
  end if;
  select count(*), count(distinct x.line_id), count(rl.id) into v_given, v_distinct, v_found
    from jsonb_to_recordset(p_lines) as x(line_id uuid, disposition text)
    left join public.stock_return_lines rl on rl.id = x.line_id;
  if v_given <> v_distinct then raise exception 'RENGLON_DUPLICADO'; end if;
  if v_given <> v_found then raise exception 'RENGLON_INEXISTENTE'; end if;

  for r in
    select rl.id, rl.lot_id, rl.qty, rl.order_id, rl.order_item_id, rl.inspection, rl.disposition,
           sr.origin, l.expiry_date, o.external_ref, x.disposition as d
      from jsonb_to_recordset(p_lines) as x(line_id uuid, disposition text)
      join public.stock_return_lines rl on rl.id = x.line_id
      join public.stock_returns sr on sr.id = rl.return_id
      join public.lots l on l.id = rl.lot_id
      join public.orders o on o.id = rl.order_id
     order by rl.lot_id, rl.id
       for update of rl, l
  loop
    if r.d is null or r.d not in ('vendible','merma') then raise exception 'DISPOSICION_INVALIDA: usa vendible o merma'; end if;
    if r.inspection is null then raise exception 'LINEA_SIN_INSPECCION: Almacén aún no confirma el reingreso'; end if;
    if r.disposition is not null then raise exception 'LINEA_YA_DISPUESTA'; end if;
    if r.d = 'vendible' then
      if r.inspection <> 'ok' then
        raise exception 'VENDIBLE_NO_PERMITIDO: la inspección fue %; solo puede ir a merma', r.inspection;
      end if;
      if public.lote_caducado(r.expiry_date) then
        raise exception 'VENDIBLE_NO_PERMITIDO: el lote caducó el %; solo puede ir a merma', r.expiry_date;
      end if;
      update public.lots set quantity = quantity + r.qty where id = r.lot_id;
      insert into public.inventory_movements (lot_id, change, reason, reference, created_by, op_id, order_id, order_item_id, return_line_id)
      values (r.lot_id, r.qty, case when r.origin = 'cancelacion' then 'cancelacion' else 'devolucion' end,
              coalesce(r.external_ref, r.order_id::text), v_uid, p_op_id, r.order_id, r.order_item_id, r.id);
      v_v := v_v + 1;
    else
      v_m := v_m + 1;
    end if;
    update public.stock_return_lines
       set disposition = r.d, disposed_by = v_uid, disposed_at = now(), disposition_op_id = p_op_id
     where id = r.id;
  end loop;

  v_res := jsonb_build_object('status', 'applied', 'vendible', v_v, 'merma', v_m);
  return public._w1_op_finish(p_op_id, 'disposicion_devolucion', v_req, v_res);
end;
$$;

-- ---------------------------------------------------------------------------
-- 11) ANULACIÓN MANUAL DE GUÍA (frontera A) — Dirección, con referencia
--     Solo desde 'succeeded'. 'unknown_requires_reconciliation' NO se anula aquí.
-- ---------------------------------------------------------------------------
create function public.anular_guia_manual(p_op_id uuid, p_attempt_id uuid, p_reference text, p_evidence text default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_req jsonb; v_prev jsonb; v_res jsonb; v_a record;
begin
  if public.auth_role() <> 'admin' then raise exception 'NO_AUTORIZADO: solo Dirección registra la anulación manual de una guía'; end if;
  v_req := jsonb_build_object('attempt', p_attempt_id, 'reference', p_reference, 'evidence', p_evidence);
  v_prev := public._w1_op_begin(p_op_id, 'anulacion_guia', v_req);
  if v_prev is not null then return v_prev; end if;
  if nullif(btrim(p_reference), '') is null then
    raise exception 'REFERENCIA_REQUERIDA: indica la referencia/folio de la anulación en el portal del proveedor';
  end if;

  select * into v_a from public.shipping_attempts where id = p_attempt_id for update;
  if not found then raise exception 'GUIA_INEXISTENTE'; end if;
  if v_a.status = 'unknown_requires_reconciliation' then
    raise exception 'GUIA_EN_RECONCILIACION: una guía en estado desconocido no se anula manualmente; requiere reconciliación (W3)';
  elsif v_a.status = 'pending' then
    raise exception 'GUIA_EN_PROCESO: espera a que termine la creación de la guía';
  elsif v_a.status <> 'succeeded' then
    raise exception 'GUIA_NO_ANULABLE: la guía está %', v_a.status;
  end if;

  update public.shipping_attempts
     set status = 'voided_manual', voided_by = auth.uid(), voided_at = now(),
         void_reference = btrim(p_reference), void_evidence = nullif(btrim(p_evidence), ''), updated_at = now()
   where id = p_attempt_id;

  v_res := jsonb_build_object('status', 'applied', 'attempt_id', p_attempt_id, 'order_id', v_a.order_id);
  return public._w1_op_finish(p_op_id, 'anulacion_guia', v_req, v_res);
end;
$$;

-- ---------------------------------------------------------------------------
-- 12) ESTADO DE UNA OPERACIÓN (reintento tras respuesta ambigua)
-- ---------------------------------------------------------------------------
create function public.inv_estado_operacion(p_op_id uuid) returns jsonb
  language sql stable security definer set search_path = public as
$$
  select result || jsonb_build_object('status', 'already_applied')
    from public.inventory_operations
   where op_id = p_op_id and (actor = auth.uid() or public.auth_role() = 'admin');
$$;

-- ---------------------------------------------------------------------------
-- 13) CONCILIACIÓN lote ↔ kardex (+ compras, renglones, devoluciones, alertas)
--     severidad: error (debe ser 0) · alerta (W2) · info (pendientes/visibilidad)
-- ---------------------------------------------------------------------------
create function public.conciliar_inventario()
returns table (check_id text, severidad text, entidad text, entidad_id uuid, detalle text, esperado numeric, obtenido numeric)
  language plpgsql stable security definer set search_path = public as
$$
begin
  if public.auth_role() <> 'admin' then raise exception 'NO_AUTORIZADO: solo Dirección'; end if;
  return query
  -- C1: existencia del lote = Σ kardex
  select 'C1_lote_kardex', 'error', 'lot', l.id, l.lot_code, coalesce(m.s, 0)::numeric, l.quantity::numeric
    from public.lots l
    left join (select lot_id, sum(change) s from public.inventory_movements group by 1) m on m.lot_id = l.id
   where l.quantity <> coalesce(m.s, 0)
  union all
  -- C2: acumulado de compra = Σ recepciones de orden − correcciones
  select 'C2_compra_acumulado', 'error', 'replenishment', r.id, r.status,
         (coalesce(rc.s, 0) - coalesce(cc.s, 0))::numeric, r.received_qty::numeric
    from public.replenishments r
    left join (select replenishment_id, sum(qty) s from public.purchase_receipts where kind = 'orden' group by 1) rc
           on rc.replenishment_id = r.id
    left join (select pr.replenishment_id, sum(-m.change) s
                 from public.inventory_movements m join public.purchase_receipts pr on pr.id = m.receipt_id
                where m.reason = 'correccion_recepcion' and pr.kind = 'orden' group by 1) cc
           on cc.replenishment_id = r.id
   where r.received_qty <> coalesce(rc.s, 0) - coalesce(cc.s, 0)
  union all
  -- C3: todo renglón de un pedido surtido/entregado tiene exactamente sus salidas
  select 'C3_renglon_salidas', 'error', 'order_item', oi.id, o.external_ref, oi.qty::numeric, coalesce(s.s, 0)::numeric
    from public.order_items oi join public.orders o on o.id = oi.order_id
    left join (select order_item_id, sum(-change) s from public.inventory_movements
                where reason in ('surtido','venta') group by 1) s on s.order_item_id = oi.id
   where o.status in ('packed','shipped','delivered','fulfilled') and oi.qty <> coalesce(s.s, 0)
  union all
  -- C4: disposición vendible ⇔ exactamente su reingreso; merma ⇔ ninguno
  select 'C4_disposicion_movimiento', 'error', 'return_line', rl.id, coalesce(rl.disposition, 'pendiente'),
         (case when rl.disposition = 'vendible' then rl.qty else 0 end)::numeric, coalesce(mm.s, 0)::numeric
    from public.stock_return_lines rl
    left join (select return_line_id, sum(change) s from public.inventory_movements
                where return_line_id is not null group by 1) mm on mm.return_line_id = rl.id
   where coalesce(mm.s, 0) <> case when rl.disposition = 'vendible' then rl.qty else 0 end
  union all
  -- C5: devuelto ≤ surtido por pedido + lote
  select 'C5_devuelto_excede', 'error', 'order', x.order_id, x.lot_id::text, x.salido::numeric, x.devuelto::numeric
    from (select rl.order_id, rl.lot_id, sum(rl.qty) devuelto,
                 (select coalesce(sum(-m.change), 0) from public.inventory_movements m
                   where m.order_id = rl.order_id and m.lot_id = rl.lot_id and m.reason in ('surtido','venta')) salido
            from public.stock_return_lines rl group by 1, 2) x
   where x.devuelto > x.salido
  union all
  -- C6: pendientes físicos (stock físico esperado = lote + esto)
  select 'C6_pendiente_fisico', 'info', 'return_line', rl.id,
         case when rl.inspection is null then 'reingreso por confirmar (Almacén)' else 'disposición pendiente (Dirección)' end,
         rl.qty::numeric, null::numeric
    from public.stock_return_lines rl where rl.disposition is null
  union all
  -- C7 (alerta W2): cancelado con evidencia de pago sin marca de reembolso
  select 'C7_pago_tras_cancelar', 'alerta', 'order', o.id, o.external_ref, null::numeric, null::numeric
    from public.orders o left join public.order_cancellations c on c.order_id = o.id
   where o.status = 'cancelled'
     and (o.payment_status = 'paid' or (o.shipping_meta -> 'transfer' -> 'review' ->> 'status') = 'confirmed'
          or o.stripe_payment_id is not null)
     and coalesce(c.refund_review, 'no_aplica') = 'no_aplica'
  union all
  -- C8: caducados con existencia (no vendibles)
  select 'C8_caducado_en_stock', 'info', 'lot', l.id, l.lot_code || ' · caducó ' || l.expiry_date, null::numeric, l.quantity::numeric
    from public.lots l where public.lote_caducado(l.expiry_date) and l.quantity > 0
  union all
  -- C9 (D-06): bajas de almacén de los últimos 30 días, para revisión de Dirección
  select 'C9_baja_almacen', 'info', 'movement', m.id, m.reason || ' · ' || coalesce(m.reference, ''), null::numeric, m.change::numeric
    from public.inventory_movements m
   where m.reason in ('merma','ajuste') and m.change < 0 and m.created_at >= now() - interval '30 days';
end;
$$;

-- ---------------------------------------------------------------------------
-- 14) AUDITORÍA DE BAJAS (D-06): Dirección revisa merma/ajustes negativos
-- ---------------------------------------------------------------------------
create function public.auditoria_bajas(p_desde timestamptz default now() - interval '30 days',
                                       p_hasta timestamptz default now())
returns table (movement_id uuid, created_at timestamptz, actor uuid, actor_email text, actor_role text,
               motivo text, tipo text, sku text, lote text, cantidad integer)
  language plpgsql stable security definer set search_path = public as
$$
begin
  if public.auth_role() <> 'admin' then raise exception 'NO_AUTORIZADO: solo Dirección'; end if;
  return query
  select m.id, m.created_at, m.created_by, p.email, p.role_id, m.reference, m.reason, pr.sku, l.lot_code, m.change
    from public.inventory_movements m
    join public.lots l on l.id = m.lot_id
    join public.products pr on pr.id = l.product_id
    left join public.profiles p on p.id = m.created_by
   where m.reason in ('merma','ajuste') and m.change < 0
     and m.created_at >= p_desde and m.created_at <= p_hasta
   order by m.created_at desc;
end;
$$;

-- ---------------------------------------------------------------------------
-- 15) REEMBOLSO (registrar_devolucion) — misma firma y reglas financieras;
--     ya NO mueve inventario. La entrada física es recibir_devolucion/disponer.
-- ---------------------------------------------------------------------------
create or replace function public.registrar_devolucion(p_order_id uuid, p_tipo text, p_monto numeric, p_motivo text,
  p_usuario text default null::text, p_items jsonb default '[]'::jsonb)
returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_total    numeric;
  v_status   text;
  v_metodo   text;
  v_folio    text;
  v_devuelto numeric;
  v_restante numeric;
  v_id       uuid;
begin
  if public.auth_role() <> all (array['admin','billing','pos']) then
    raise exception 'NO_AUTORIZADO: no tienes permiso para registrar devoluciones';
  end if;
  if p_tipo is null or p_tipo <> all (array['devolucion','correccion','cortesia']) then
    raise exception 'TIPO_INVALIDO: usa devolucion, correccion o cortesia';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then
    raise exception 'MOTIVO_REQUERIDO: sin motivo no se puede auditar la devolución';
  end if;
  if p_monto is null or p_monto <= 0 then
    raise exception 'MONTO_INVALIDO: el monto debe ser mayor a cero';
  end if;

  select o.total, o.status, o.payment_method, o.external_ref
    into v_total, v_status, v_metodo, v_folio
    from public.orders o where o.id = p_order_id;
  if v_total is null then
    raise exception 'PEDIDO_INVALIDO: el pedido no existe';
  end if;
  if v_status = 'draft' then
    raise exception 'PEDIDO_INVALIDO: no se puede devolver un borrador';
  end if;

  select coalesce(sum(r.monto), 0) into v_devuelto
    from public.refunds r where r.order_id = p_order_id;
  v_restante := v_total - v_devuelto;
  if p_monto > v_restante then
    raise exception 'MONTO_EXCEDE: el máximo por devolver de este pedido es %', v_restante;
  end if;

  -- items queda como dato informativo del reembolso (W2 lo ligará a la devolución física).
  insert into public.refunds (order_id, tipo, monto, motivo, metodo, usuario, created_by, items)
  values (p_order_id, p_tipo, p_monto, left(btrim(p_motivo), 400), v_metodo,
          coalesce(nullif(btrim(p_usuario), ''), 'Sistema'), auth.uid(),
          case when p_tipo = 'devolucion' then p_items else null end)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'restante', v_restante - p_monto);
end;
$$;

-- ---------------------------------------------------------------------------
-- 16) Privilegios de ejecución de los comandos
-- ---------------------------------------------------------------------------
revoke all on function
  public.recibir_lote(uuid, uuid, text, date, integer, uuid, text, numeric, text, text),
  public.importar_lote(uuid, text, text, text, integer),
  public.cerrar_orden_compra(uuid, uuid, text),
  public.ajustar_lote(uuid, uuid, integer, text, text, uuid),
  public.surtir_pedido(uuid, uuid, jsonb),
  public.cancelar_pedido(uuid, uuid, text),
  public.confirmar_reingreso(uuid, uuid, jsonb),
  public.recibir_devolucion(uuid, uuid, jsonb, text),
  public.disponer_devolucion(uuid, jsonb),
  public.anular_guia_manual(uuid, uuid, text, text),
  public.inv_estado_operacion(uuid),
  public.conciliar_inventario(),
  public.auditoria_bajas(timestamptz, timestamptz)
  from public, anon;
grant execute on function
  public.recibir_lote(uuid, uuid, text, date, integer, uuid, text, numeric, text, text),
  public.importar_lote(uuid, text, text, text, integer),
  public.cerrar_orden_compra(uuid, uuid, text),
  public.ajustar_lote(uuid, uuid, integer, text, text, uuid),
  public.surtir_pedido(uuid, uuid, jsonb),
  public.cancelar_pedido(uuid, uuid, text),
  public.confirmar_reingreso(uuid, uuid, jsonb),
  public.recibir_devolucion(uuid, uuid, jsonb, text),
  public.disponer_devolucion(uuid, jsonb),
  public.anular_guia_manual(uuid, uuid, text, text),
  public.inv_estado_operacion(uuid),
  public.conciliar_inventario(),
  public.auditoria_bajas(timestamptz, timestamptz)
  to authenticated, service_role;

-- >>>>>>>>>>>>>>>> 20261012120300_w1_m4_authority.sql
-- ============================================================================
-- W1 · M4 — CIERRE DE AUTORIDAD: el inventario solo cambia por comandos.
--
--  · lots / inventory_movements / order_items: sin escritura directa de clientes
--  · replenishments: clientes solo crean (estado inicial forzado) y marcan `paid`
--  · orders: `packed` y `cancelled` solo por comando; sin regresiones de estado
--  · shipping_attempts: solo se crea guía para un pedido empacado y no cancelado
--  · apply_lot_movement: revocado (lo reemplaza ajustar_lote)
--
-- Las definiciones previas quedan en supabase/rollback/w1/00_prod_snapshot.sql.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) LOTES: solo lectura para clientes (SELECT lots_select_ops se conserva)
-- ---------------------------------------------------------------------------
drop policy if exists lots_write_warehouse on public.lots;
revoke insert, update, delete, truncate on public.lots from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2) KARDEX: sin inserción directa (SELECT invmov_select_ops se conserva)
-- ---------------------------------------------------------------------------
drop policy if exists invmov_insert_ops on public.inventory_movements;
revoke insert, update, delete, truncate on public.inventory_movements from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3) RENGLONES DE PEDIDO: los escriben crear_pedido / vender_pos / surtir_pedido
--    (verificado: el cliente con backend no escribe order_items directamente)
-- ---------------------------------------------------------------------------
drop policy if exists order_items_insert_scoped on public.order_items;
drop policy if exists order_items_update_scoped on public.order_items;
drop policy if exists order_items_delete_scoped on public.order_items;
revoke insert, update, delete, truncate on public.order_items from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4) COMPRAS: crear (admin/billing, estado inicial forzado) y marcar `paid`.
--    Estado, acumulado y cierre: solo por comando.
-- ---------------------------------------------------------------------------
drop policy if exists replenishments_update on public.replenishments;
revoke update, delete, truncate on public.replenishments from anon, authenticated;
grant update (paid) on public.replenishments to authenticated;
create policy replenishments_update_paid on public.replenishments
  for update to authenticated
  using (public.auth_role() = any (array['admin','billing']))
  with check (public.auth_role() = any (array['admin','billing']));

create or replace function public.replenishments_guard() returns trigger
  language plpgsql set search_path = public as
$$
begin
  if coalesce(current_setting('app.trusted', true), '') = 'on'
     or coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.status := 'pendiente'; new.received_qty := 0;
    new.closed_by := null; new.closed_at := null; new.close_reason := null;
    return new;
  end if;
  if (new.id, new.product_id, new.product_name, new.qty, new.unit_cost, new.kind, new.supplier, new.status,
      new.received_qty, new.closed_by, new.closed_at, new.close_reason, new.created_by, new.created_at)
     is distinct from
     (old.id, old.product_id, old.product_name, old.qty, old.unit_cost, old.kind, old.supplier, old.status,
      old.received_qty, old.closed_by, old.closed_at, old.close_reason, old.created_by, old.created_at) then
    raise exception 'REABASTECIMIENTO_SOLO_POR_COMANDO: estado, cantidades y cierre cambian solo por recepción/cierre';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_replenishments_guard on public.replenishments;
create trigger trg_replenishments_guard before insert or update on public.replenishments
  for each row execute function public.replenishments_guard();

-- ---------------------------------------------------------------------------
-- 5) PEDIDOS: guarda de transiciones relevantes para inventario (antes del
--    atajo de admin; el resto de la guarda previa queda IDÉNTICO).
-- ---------------------------------------------------------------------------
create or replace function public.orders_guard() returns trigger
  language plpgsql security definer set search_path = public as
$function$
DECLARE r text := public.auth_role();
BEGIN
  IF coalesce(current_setting('app.trusted', true), '') = 'on'
     OR coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role','') = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- W1: transiciones de inventario solo por comando; sin regresar desde empacado o posterior.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('packed','cancelled') THEN
      RAISE EXCEPTION 'TRANSICION_SOLO_POR_COMANDO: % → % solo por comando del servidor (surtir_pedido / cancelar_pedido)', OLD.status, NEW.status;
    END IF;
    IF OLD.status IN ('packed','shipped','delivered','fulfilled')
       AND NEW.status IN ('draft','pending_payment','paid','picking') THEN
      RAISE EXCEPTION 'TRANSICION_REGRESIVA: % → % no permitido', OLD.status, NEW.status;
    END IF;
    IF (NEW.status = 'picking'   AND OLD.status IS DISTINCT FROM 'paid')
       OR (NEW.status = 'shipped'   AND OLD.status IS DISTINCT FROM 'packed')
       OR (NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'shipped')
       OR (NEW.status = 'fulfilled' AND OLD.status IS DISTINCT FROM 'delivered') THEN
      RAISE EXCEPTION 'TRANSICION_INVALIDA: % → %', OLD.status, NEW.status;
    END IF;
  END IF;

  IF r = 'admin' THEN RETURN NEW; END IF;

  IF r = 'doctor' AND OLD.doctor_id = auth.uid() THEN
    IF OLD.status IS NOT NULL AND OLD.status NOT IN ('draft','pending_payment') THEN
      RAISE EXCEPTION 'No autorizado: el pedido ya está en proceso';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NEW.status NOT IN ('draft','pending_payment','cancelled') THEN
      RAISE EXCEPTION 'No autorizado: el doctor no puede mover el pedido a ese estado';
    END IF;
    IF NEW.doctor_id IS DISTINCT FROM OLD.doctor_id OR NEW.total IS DISTINCT FROM OLD.total
       OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.payment_status IS DISTINCT FROM OLD.payment_status
       OR NEW.payment_ref IS DISTINCT FROM OLD.payment_ref OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
       OR NEW.stripe_payment_id IS DISTINCT FROM OLD.stripe_payment_id OR NEW.invoice_meta IS DISTINCT FROM OLD.invoice_meta THEN
      RAISE EXCEPTION 'No autorizado: no puedes modificar campos financieros del pedido';
    END IF;
    RETURN NEW;
  END IF;

  IF r IN ('warehouse','packing') THEN
    IF NEW.doctor_id IS DISTINCT FROM OLD.doctor_id OR NEW.total IS DISTINCT FROM OLD.total
       OR NEW.payment_status IS DISTINCT FROM OLD.payment_status OR NEW.payment_ref IS DISTINCT FROM OLD.payment_ref
       OR NEW.payment_method IS DISTINCT FROM OLD.payment_method OR NEW.stripe_payment_id IS DISTINCT FROM OLD.stripe_payment_id
       OR NEW.invoice_meta IS DISTINCT FROM OLD.invoice_meta THEN
      RAISE EXCEPTION 'No autorizado: almacén/empaque solo actualiza estado y envío';
    END IF;
    RETURN NEW;
  END IF;

  IF r = 'billing' THEN
    IF NEW.doctor_id IS DISTINCT FROM OLD.doctor_id OR NEW.total IS DISTINCT FROM OLD.total THEN
      RAISE EXCEPTION 'No autorizado: facturación no modifica doctor ni total';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'No autorizado';
END; $function$;

revoke truncate on public.orders from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6) GUÍAS: solo se crea un intento de guía para un pedido EMPACADO y no cancelado.
--    Traza del flujo actual (solo lectura): el único INSERT es la edge `shipping`
--    (create_shipment, service_role), invocada solo desde Empaque › Cola, cuya cola
--    lista únicamente pedidos 'packed'; chofer propio no usa esta tabla. La edge
--    trata el fallo del INSERT como 409 ANTES de llamar a DHL → sin cambios en la
--    edge. Lee el pedido con FOR SHARE para serializarse contra cancelar_pedido.
-- ---------------------------------------------------------------------------
create or replace function public.shipping_attempts_guard() returns trigger
  language plpgsql set search_path = public as
$$
declare v_status text;
begin
  select status into v_status from public.orders where id = new.order_id for share;
  if v_status = 'cancelled' or exists (select 1 from public.order_cancellations where order_id = new.order_id) then
    raise exception 'PEDIDO_CANCELADO: no se crea guía para un pedido cancelado' using errcode = 'check_violation';
  end if;
  if v_status is distinct from 'packed' then
    raise exception 'PEDIDO_NO_EMPACADO: solo se crea guía para un pedido empacado (está %)', coalesce(v_status, 'inexistente')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_shipping_attempts_guard on public.shipping_attempts;
create trigger trg_shipping_attempts_guard before insert on public.shipping_attempts
  for each row execute function public.shipping_attempts_guard();

-- ---------------------------------------------------------------------------
-- 7) apply_lot_movement: fuera del alcance de clientes (merma/ajuste → ajustar_lote;
--    eventos/consignación quedan deshabilitados hasta W2 — ya eran code blocker)
-- ---------------------------------------------------------------------------
revoke all on function public.apply_lot_movement(uuid, integer, text, text) from public, anon, authenticated;

-- Funciones internas de guarda: no ejecutables por clientes.
revoke all on function public.replenishments_guard(), public.shipping_attempts_guard(),
  public.stock_return_lines_guard() from public, anon, authenticated;

-- >>>>>>>>>>>>>>>> historial de migraciones (misma transacción: esquema + historial atómicos)
insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261012120000', 'w1_m1_schema', '{}') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261012120100', 'w1_m2_constraints', '{}') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261012120200', 'w1_m3_commands', '{}') on conflict (version) do nothing;
insert into supabase_migrations.schema_migrations (version, name, statements) values ('20261012120300', 'w1_m4_authority', '{}') on conflict (version) do nothing;
commit;
