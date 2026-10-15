-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- CAJA SIN INTERBLOQUEOS (migración 166) · POS-CONCURRENCY-DEADLOCK
--   Hallazgo: dos ventas de Caja simultáneas del MISMO lote se interbloqueaban (SQLSTATE 40P01; 8–9 de 10 fallaban,
--   sin efectos parciales). Causa: vender_pos guarda primero los renglones del pedido y la llave foránea
--   order_items.lot_id → lots toma en ese momento un candado ligero (KEY SHARE) del lote; después la venta pide el
--   candado fuerte (FOR UPDATE) del mismo lote. Cada venta tenía el ligero y esperaba el fuerte de la otra.
--   Cambio: esa llave foránea se revisa AL CONFIRMAR (deferrable initially deferred). Para entonces la venta ya tiene el
--   candado fuerte del lote, así que la segunda venta solo espera su turno; no hay ciclo. La regla es la misma (un
--   renglón no puede apuntar a un lote inexistente), solo cambia el momento en que se revisa.
--   NO cambia: vender_pos ni ninguna otra función (precios, validaciones, inventario, custodia, dinero, idempotencia).
--   Rollback: supabase/rollback/pos_sin_interbloqueo/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if not exists (select 1 from pg_constraint where conname = 'order_items_lot_id_fkey' and conrelid = 'public.order_items'::regclass) then
    raise exception 'POS-INTERBLOQUEO: falta la llave order_items_lot_id_fkey';
  end if;
end $pre$;

alter table public.order_items alter constraint order_items_lot_id_fkey deferrable initially deferred;

do $post$ begin
  if not exists (select 1 from pg_constraint where conname = 'order_items_lot_id_fkey' and conrelid = 'public.order_items'::regclass and condeferrable and condeferred) then
    raise exception 'POS-INTERBLOQUEO: la llave no quedó diferida';
  end if;
end $post$;
