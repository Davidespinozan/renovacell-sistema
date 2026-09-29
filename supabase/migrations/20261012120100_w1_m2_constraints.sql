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
