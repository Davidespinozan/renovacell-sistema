-- CAJA SIN INTERBLOQUEOS · rollback de la migración 166: la llave vuelve a revisarse al guardar cada renglón (regresa el
-- interbloqueo de ventas simultáneas del mismo lote).
alter table public.order_items alter constraint order_items_lot_id_fkey not deferrable;
