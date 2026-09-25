-- ============================================================================
-- FASE 2 · SNAPSHOT HISTÓRICO DE COSTO (COGS/margen NO retroactivo).
-- Congela el costo de adquisición del LOTE en cada movimiento de inventario, en la MISMA
-- transacción del insert, mediante un trigger BEFORE INSERT. Enfoque MÍNIMO y SEGURO:
-- NO reescribe vender_pos/surtir_pedido/apply_lot_movement/registrar_devolucion (firmas y
-- lógica intactas → cero riesgo a pagos/pedidos/anti-sobreventa); todos ellos insertan el
-- movimiento y el trigger le fija unit_cost = lots.unit_cost.
--
-- Reglas:
--  - Solo rellena cuando unit_cost viene NULL (recibir_lote ya fija su propio costo de entrada).
--  - Excluye reason='entrada' (la recepción/entrada gobierna su costo; NO se sobreescribe).
--  - Si lots.unit_cost IS NULL (costo desconocido) → el movimiento queda NULL. NUNCA
--    hace fallback a product_costs en una salida (no se fabrica costo histórico).
--  - NO hay backfill: los movimientos previos siguen con unit_cost NULL.
-- ============================================================================
create or replace function public.freeze_movement_cost()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.unit_cost is null and coalesce(new.reason, '') <> 'entrada' then
    new.unit_cost := (select unit_cost from public.lots where id = new.lot_id);
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_freeze_movement_cost on public.inventory_movements;
create trigger trg_freeze_movement_cost
  before insert on public.inventory_movements
  for each row execute function public.freeze_movement_cost();
