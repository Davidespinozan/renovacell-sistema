-- Blindaje: el stock de un lote NUNCA debe quedar negativo.
-- Las RPCs ya lo evitan (apply_lot_movement, surtir_pedido, vender_pos usan
-- `quantity - qty >= 0`); esta restricción a nivel BD es la última línea de defensa
-- ante cualquier escritura nueva por otro camino. NOT VALID: no revalida las filas
-- existentes (no falla el push si hubiera un legacy), pero SÍ aplica a todo
-- INSERT/UPDATE futuro. Idempotente.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'lots_quantity_nonneg') then
    alter table public.lots
      add constraint lots_quantity_nonneg check (quantity >= 0) not valid;
  end if;
end $$;
