-- ============================================================================
-- W2-C · C2 — CONSTRAINTS (todas VÁLIDAS, sin excepciones históricas).
--
-- PRECONDICIÓN: la custodia legacy (events / consignment_stock) debe estar VACÍA.
-- Sus contadores eran escritos por el cliente y no hay forma honesta de derivar de
-- ellos un libro: si alguien operó con ellos, hay que reconstruir la historia antes.
-- Producción se activa con 0 filas, así que pasa trivialmente y las constraints se
-- validan de inmediato, sin backfill.
-- ============================================================================

do $pre$
declare n int;
begin
  select count(*) into n from public.events;
  if n > 0 then
    raise exception 'W2C_C2_PRECONDICION: % evento(s) legacy con contadores del cliente. Reconstruye la historia de custodia antes de W2-C.', n;
  end if;
  select count(*) into n from public.consignment_stock;
  if n > 0 then
    raise exception 'W2C_C2_PRECONDICION: % saldo(s) de consignación legacy. Reconstruye la historia de custodia antes de W2-C.', n;
  end if;
end
$pre$;

-- ---------------------------------------------------------------------------
-- LA CUSTODIA
-- ---------------------------------------------------------------------------
alter table public.custodies add constraint ck_custody_kind
  check (kind in ('evento','vendedor'));
alter table public.custodies add constraint ck_custody_status
  check (status in ('abierta','cerrada'));
alter table public.custodies add constraint ck_custody_cierre
  check ((status = 'cerrada') = (closed_at is not null));
alter table public.custodies add constraint ck_custody_cierre_motivo
  check (closed_at is null or nullif(btrim(close_reason), '') is not null);

-- D-W2-C-7 · el tenedor es UNA referencia estable, nunca un correo ni un texto libre.
alter table public.custodies add constraint ck_custody_holder_kind
  check (holder_kind in ('staff','doctor','tercero'));
alter table public.custodies add constraint ck_custody_holder_unico
  check ((holder_user_id is not null)::int + (holder_customer_id is not null)::int = 1);
-- El personal interno SIEMPRE tiene cuenta; un tercero nunca la finge.
alter table public.custodies add constraint ck_custody_holder_staff
  check (holder_kind <> 'staff' or holder_user_id is not null);
alter table public.custodies add constraint ck_custody_holder_tercero
  check (holder_kind <> 'tercero' or holder_customer_id is not null);

-- Un evento se identifica por su nombre; una consignación de vendedor no lo usa.
alter table public.custodies add constraint ck_custody_evento
  check ((kind = 'evento') = (nullif(btrim(event_name), '') is not null));
alter table public.custodies add constraint ck_custody_no_evento
  check (kind = 'evento' or (event_venue is null and event_date is null));

-- Una sola custodia ABIERTA por tenedor y tipo: el saldo de un vendedor es único y
-- un evento no se duplica a medias. (Los sobrantes por nombre de evento —el bug
-- legacy— dejan de ser posibles porque la identidad es el id, no el nombre.)
create unique index uq_custody_abierta_user on public.custodies(kind, holder_user_id)
  where status = 'abierta' and holder_user_id is not null;
create unique index uq_custody_abierta_cust on public.custodies(kind, holder_customer_id)
  where status = 'abierta' and holder_customer_id is not null;

-- ---------------------------------------------------------------------------
-- EL LIBRO
-- ---------------------------------------------------------------------------
alter table public.custody_lines add constraint ck_custody_line_kind
  check (kind in ('entrega','venta','devolucion','faltante','merma','caducado','ajuste'));
alter table public.custody_lines add constraint ck_custody_line_qty
  check (qty > 0);

-- La aritmética de la existencia en poder queda FIJADA por constraint: ninguna línea
-- puede declarar un efecto que no corresponda a su tipo.
alter table public.custody_lines add constraint ck_custody_line_held_delta check (
     (kind = 'entrega' and held_delta = qty)
  or (kind in ('venta','devolucion','faltante','merma','caducado') and held_delta = -qty)
  or (kind = 'ajuste' and reversal_of is not null and abs(held_delta) = qty and held_delta <> 0));

-- La VENTA es la única que lleva precio, y se liga al pedido real (G-4).
alter table public.custody_lines add constraint ck_custody_line_venta check (
  (kind = 'venta') = (order_id is not null and order_item_id is not null and unit_price is not null));
alter table public.custody_lines add constraint ck_custody_line_precio
  check (unit_price is null or unit_price >= 0);

-- G-5 · no existe pérdida sin su baja real de inventario, ni baja sin motivo.
alter table public.custody_lines add constraint ck_custody_line_perdida check (
  (kind in ('faltante','merma','caducado')) = (inventory_op_id is not null));
alter table public.custody_lines add constraint ck_custody_line_motivo
  check (kind not in ('faltante','merma','caducado','ajuste') or nullif(btrim(motivo), '') is not null);

-- Una corrección compensa UNA línea, y solo una vez.
create unique index uq_custody_line_reversa on public.custody_lines(reversal_of)
  where reversal_of is not null;
-- Un renglón de pedido se atribuye a UNA sola línea de venta de custodia.
create unique index uq_custody_line_order_item on public.custody_lines(order_item_id)
  where order_item_id is not null;
-- La baja de inventario de una pérdida no se reutiliza en dos líneas.
create unique index uq_custody_line_inv_op on public.custody_lines(inventory_op_id)
  where inventory_op_id is not null;
