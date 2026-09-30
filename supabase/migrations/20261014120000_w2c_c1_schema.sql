-- ============================================================================
-- W2-C · C1 — CUSTODIA: esquema, libro y disponibilidad.
--
--  · Acuerdo de custodia (evento o vendedor)              custodies
--  · LIBRO append-only de la custodia                     custody_lines
--  · Registro de idempotencia                             custody_operations
--  · Existencia en custodia (DERIVADA del libro)          custody_held()
--  · Disponibilidad operativa por lote                    v_stock_disponible
--
-- Principios (diseño congelado, D-W2-C-1..10):
--   G-1 `lots.quantity` = existencia PROPIA total no vendida/no perdida, e INCLUYE
--       lo que está temporalmente en custodia. NO hay un segundo stock físico.
--   G-2 disponible = lots.quantity − custody_held(lote). Es la ÚNICA semántica de
--       disponibilidad operativa y vive en el servidor.
--   G-3 La ENTREGA a custodia no mueve inventario, no genera COGS, ni revenue, ni
--       cuenta por cobrar: solo cambia de manos la responsabilidad.
--   G-4 La obligación económica nace en la VENTA, por la ruta de W2 (una sola).
--   G-5 Faltante, daño, merma y caducado son hechos PROPIOS, nunca ventas fingidas,
--       y nunca generan deuda automática al tenedor.
--   G-6 El tenedor es una referencia estable y auditable, jamás un correo mutable.
--
-- No cambia comportamiento: las constraints van en C2, los comandos y las
-- extensiones quirúrgicas en C3, el cierre de autoridad en C4. W1 y W2 intactos aquí.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) Registro de operaciones de custodia (gemelo de inventory_operations y
--    money_operations). Separado a propósito: W1 y W2 quedan intactos.
-- ---------------------------------------------------------------------------
create table public.custody_operations (
  op_id      uuid primary key,
  kind       text not null check (kind in (
               'custodia_abierta','entrega','devolucion','perdida','custodia_cerrada')),
  actor      uuid,
  actor_role text not null default '',
  request    jsonb not null,
  result     jsonb,
  created_at timestamptz not null default now()
);
comment on table public.custody_operations is
  'Idempotencia de las operaciones de custodia: un op_id = una operación. Un reintento devuelve el resultado ya registrado.';

-- ---------------------------------------------------------------------------
-- 2) El ACUERDO de custodia. Unifica eventos y consignación (D-W2-C-5): un evento
--    es una custodia con fecha; la consignación de un vendedor es permanente.
--    El TENEDOR (D-W2-C-7) es una referencia estable: un usuario del sistema o un
--    cliente/tercero del maestro de clientes. Nunca un correo ni un texto libre.
-- ---------------------------------------------------------------------------
create table public.custodies (
  id                 uuid primary key,              -- = op_id de la apertura
  kind               text not null,                 -- 'evento' | 'vendedor'
  holder_kind        text not null,                 -- 'staff' | 'doctor' | 'tercero'
  holder_user_id     uuid references auth.users(id) on delete restrict,
  holder_customer_id uuid references public.customers(id) on delete restrict,
  event_name         text,                          -- solo kind='evento'
  event_venue        text,
  event_date         date,
  status             text not null default 'abierta',
  opened_at          timestamptz not null default now(),
  opened_by          uuid,
  closed_at          timestamptz,
  closed_by          uuid,
  close_reason       text,
  op_id              uuid,
  created_at         timestamptz not null default now()
);
comment on table public.custodies is
  'Custodia de producto propio en manos de un tenedor (evento o vendedor). El título NO se transfiere: las unidades siguen siendo de la empresa.';
comment on column public.custodies.holder_user_id is
  'Tenedor con cuenta en el sistema (staff o doctor). Excluyente con holder_customer_id.';
comment on column public.custodies.holder_customer_id is
  'Tenedor SIN cuenta (doctor externo, distribuidor, tercero) referenciado en el maestro de clientes. No se crea un usuario interno para representarlo.';

create index idx_custodies_holder_user on public.custodies(holder_user_id) where holder_user_id is not null;
create index idx_custodies_holder_cust on public.custodies(holder_customer_id) where holder_customer_id is not null;
create index idx_custodies_abiertas on public.custodies(kind, status) where status = 'abierta';

-- ---------------------------------------------------------------------------
-- 3) EL LIBRO de la custodia — append-only. Toda la existencia en custodia es la
--    SUMA de este libro; no hay contador que mantener ni conciliar.
--    `held_delta` hace explícito el efecto sobre la existencia en poder, para que
--    la aritmética viva en un solo lugar y sea verificable por constraint (C2).
-- ---------------------------------------------------------------------------
create table public.custody_lines (
  id              uuid primary key,
  custody_id      uuid not null references public.custodies(id) on delete restrict,
  kind            text not null,     -- entrega|venta|devolucion|faltante|merma|caducado|ajuste
  product_id      uuid not null references public.products(id) on delete restrict,
  lot_id          uuid not null references public.lots(id) on delete restrict,
  qty             integer not null,
  held_delta      integer not null,  -- +qty entrega · −qty el resto · ±qty en 'ajuste'
  unit_price      numeric,           -- solo 'venta', SIEMPRE del servidor (precio_de)
  order_id        uuid references public.orders(id) on delete restrict,
  order_item_id   uuid references public.order_items(id) on delete restrict,
  -- DIFERIBLE a propósito (mismo patrón que inventory_movements.op_id en W1): la línea
  -- de pérdida se escribe ANTES de la baja para que el piso de custodia ya haya bajado
  -- cuando se invoca ajustar_lote. Ambas quedan en la misma transacción o ninguna.
  inventory_op_id uuid references public.inventory_operations(op_id) on delete restrict
                    deferrable initially deferred,
  reversal_of     uuid references public.custody_lines(id) on delete restrict,
  motivo          text,
  evidence_ref    text,
  actor           uuid,
  actor_role      text not null default '',
  op_id           uuid,
  created_at      timestamptz not null default clock_timestamp()
);
comment on table public.custody_lines is
  'Libro append-only de la custodia. Entrega, venta, devolución, faltante, merma, caducado y ajuste compensatorio. Nunca se edita ni se borra: se corrige con una línea ajuste que referencia la original.';
comment on column public.custody_lines.held_delta is
  'Efecto sobre la existencia EN PODER del tenedor. custody_held(lote) = Σ held_delta.';
comment on column public.custody_lines.inventory_op_id is
  'Baja real de inventario (W1 ajustar_lote) ligada a esta pérdida. Obligatoria en faltante/merma/caducado: no existe pérdida sin su baja.';

create index idx_custody_lines_lot     on public.custody_lines(lot_id);
create index idx_custody_lines_custody on public.custody_lines(custody_id, lot_id);
create index idx_custody_lines_order   on public.custody_lines(order_id) where order_id is not null;

-- Append-only (reusa la guarda del libro de dinero: misma disciplina, un solo patrón).
create trigger trg_custody_lines_append_only before update or delete on public.custody_lines
  for each row execute function public.ledger_append_only();
create trigger trg_custody_lines_no_truncate before truncate on public.custody_lines
  for each statement execute function public.ledger_append_only();
create trigger trg_custody_operations_append_only before update or delete on public.custody_operations
  for each row execute function public.ledger_append_only();

-- La custodia se abre y se cierra por comando; su identidad y su tenedor son inmutables.
create or replace function public.custodies_guard() returns trigger
  language plpgsql set search_path = public as
$$
begin
  if current_setting('renovacell.purge', true) = 'on' then return coalesce(new, old); end if;
  if coalesce(current_setting('app.trusted', true), '') = 'on' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then
    raise exception 'CUSTODIA_NO_SE_BORRA: una custodia no se elimina; se cierra con motivo.'
      using errcode = 'check_violation';
  end if;
  raise exception 'CUSTODIA_SOLO_POR_COMANDO: la custodia se abre y se cierra con los comandos del servidor.'
    using errcode = 'check_violation';
end;
$$;
create trigger trg_custodies_guard before update or delete on public.custodies
  for each row execute function public.custodies_guard();

-- ---------------------------------------------------------------------------
-- 4) EXISTENCIA EN CUSTODIA — derivada del libro (G-2). No hay columna que cuadrar.
-- ---------------------------------------------------------------------------
create function public.custody_held(p_lot uuid) returns integer
  language sql stable security definer set search_path = public as
$$
  select coalesce(sum(l.held_delta), 0)::int from public.custody_lines l where l.lot_id = p_lot;
$$;
comment on function public.custody_held(uuid) is
  'Unidades de ese lote actualmente EN PODER de algún tenedor. Piso que ninguna operación de almacén/POS puede consumir.';

create function public.custody_held_en(p_custody uuid, p_lot uuid) returns integer
  language sql stable security definer set search_path = public as
$$
  select coalesce(sum(l.held_delta), 0)::int from public.custody_lines l
   where l.custody_id = p_custody and l.lot_id = p_lot;
$$;

-- ---------------------------------------------------------------------------
-- 5) DISPONIBILIDAD OPERATIVA — la autoridad única (G-2). Cualquier camino que
--    PROMETA o ASIGNE stock lee de aquí, nunca de lots.quantity directamente.
-- ---------------------------------------------------------------------------
create view public.v_stock_disponible as
select
  l.id                                            as lot_id,
  l.product_id,
  l.lot_code,
  l.expiry_date,
  l.location,
  l.quantity                                      as propio,
  public.custody_held(l.id)                       as en_custodia,
  greatest(l.quantity - public.custody_held(l.id), 0) as disponible,
  public.lote_caducado(l.expiry_date)             as caducado
from public.lots l;
comment on view public.v_stock_disponible is
  'Autoridad de disponibilidad por LOTE: propio (lots.quantity, incluye custodia) − en_custodia = disponible. Surtido, POS y catálogo asignan y prometen contra `disponible`.';

-- ---------------------------------------------------------------------------
-- 6) Existencia en custodia por custodia/producto/lote (pantallas y liquidación).
-- ---------------------------------------------------------------------------
create view public.v_custody_stock as
select
  l.custody_id,
  l.product_id,
  l.lot_id,
  sum(case when l.kind = 'entrega'    then l.qty else 0 end)::int as entregado,
  sum(case when l.kind = 'venta'      then l.qty else 0 end)::int as vendido,
  sum(case when l.kind = 'devolucion' then l.qty else 0 end)::int as devuelto,
  sum(case when l.kind in ('faltante','merma','caducado') then l.qty else 0 end)::int as perdido,
  sum(l.held_delta)::int                                          as en_poder
from public.custody_lines l
group by l.custody_id, l.product_id, l.lot_id;

-- ---------------------------------------------------------------------------
-- 7) LIQUIDACIÓN — el estado económico de una custodia. NO es un evento de dinero:
--    el dinero ya nació en cada venta por la ruta de W2 (G-4). Esto lo resume.
-- ---------------------------------------------------------------------------
create view public.v_custody_liquidacion as
select
  c.id                                       as custody_id,
  c.kind,
  c.status,
  coalesce(u.entregado, 0)                   as unidades_entregadas,
  coalesce(u.vendido, 0)                     as unidades_vendidas,
  coalesce(u.devuelto, 0)                    as unidades_devueltas,
  coalesce(u.perdido, 0)                     as unidades_perdidas,
  coalesce(u.en_poder, 0)                    as unidades_en_poder,
  coalesce(v.importe_vendido, 0)             as importe_vendido,
  coalesce(m.cobrado_neto, 0)                as cobrado,
  coalesce(v.importe_vendido, 0) - coalesce(m.cobrado_neto, 0) as saldo
from public.custodies c
left join lateral (
  select sum(entregado) entregado, sum(vendido) vendido, sum(devuelto) devuelto,
         sum(perdido) perdido, sum(en_poder) en_poder
    from public.v_custody_stock s where s.custody_id = c.id
) u on true
left join lateral (
  select sum(l.qty * coalesce(l.unit_price, 0)) as importe_vendido
    from public.custody_lines l where l.custody_id = c.id and l.kind = 'venta'
) v on true
left join lateral (
  -- El dinero se lee del libro de W2 por los pedidos de esta custodia (una sola verdad).
  select sum(om.cobrado_neto) as cobrado_neto
    from public.v_order_money om
   where om.order_id in (select distinct l.order_id from public.custody_lines l
                          where l.custody_id = c.id and l.order_id is not null)
) m on true;

-- ---------------------------------------------------------------------------
-- 8) RLS: las tablas nuevas nacen de SOLO LECTURA. Escriben ÚNICAMENTE los
--    comandos SECURITY DEFINER de C3.
-- ---------------------------------------------------------------------------
alter table public.custody_operations enable row level security;
alter table public.custodies          enable row level security;
alter table public.custody_lines      enable row level security;

revoke insert, update, delete, truncate on
  public.custody_operations, public.custodies, public.custody_lines from anon, authenticated;
revoke all on public.custody_operations, public.custodies, public.custody_lines from anon;

-- Dirección/Facturación/Almacén ven todas; el TENEDOR con cuenta ve la suya.
-- Una custodia de un tercero (sin login) la ven solo Dirección y Almacén.
create policy custodies_select_ops on public.custodies
  for select to authenticated using (
    public.auth_role() = any (array['admin','billing','warehouse','packing'])
    or holder_user_id = auth.uid());
create policy custody_lines_select_ops on public.custody_lines
  for select to authenticated using (
    public.auth_role() = any (array['admin','billing','warehouse','packing'])
    or exists (select 1 from public.custodies c where c.id = custody_id and c.holder_user_id = auth.uid()));
create policy custody_operations_select_admin on public.custody_operations
  for select to authenticated using (public.auth_role() = 'admin');

grant select on public.custodies, public.custody_lines, public.custody_operations to authenticated;
grant select on public.v_stock_disponible, public.v_custody_stock, public.v_custody_liquidacion to authenticated;
-- El saldo POR CUSTODIA es interno: los clientes lo piden por estado_custodia /
-- v_custody_stock (que sí pasan por RLS). custody_held(lote) en cambio es público:
-- es la disponibilidad, y la necesitan las vistas.
revoke all on function public.custody_held_en(uuid, uuid) from public, anon, authenticated;
