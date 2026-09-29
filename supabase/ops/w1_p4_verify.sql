-- ============================================================================
-- W1 · P4 — VERIFICACIÓN POSTERIOR (SOLO LECTURA: transacción READ ONLY + ROLLBACK).
-- Uso: psql -X -v ON_ERROR_STOP=1 -f supabase/ops/w1_p4_verify.sql
-- Resultado esperado: todas las filas ok = t y la línea final "W1_VERIFY: N/N OK".
-- ============================================================================
begin read only;
with checks(chk, ok) as (values
  ('tablas W1 creadas (5)', (select count(*) = 5 from pg_class where relnamespace = 'public'::regnamespace and relname in
      ('inventory_operations','purchase_receipts','stock_returns','stock_return_lines','order_cancellations'))),
  ('comandos W1 instalados (13 públicos)', (select count(*) = 13 from pg_proc where pronamespace = 'public'::regnamespace and proname in
      ('recibir_lote','importar_lote','cerrar_orden_compra','ajustar_lote','surtir_pedido','cancelar_pedido','confirmar_reingreso',
       'recibir_devolucion','disponer_devolucion','anular_guia_manual','inv_estado_operacion','conciliar_inventario','auditoria_bajas'))),
  ('firma vieja recibir_lote eliminada', to_regprocedure('public.recibir_lote(uuid,text,text,integer,text,numeric,text,text,uuid)') is null),
  ('firma vieja surtir_pedido eliminada', to_regprocedure('public.surtir_pedido(uuid,text,jsonb,jsonb)') is null),
  ('firma vieja importar_lote eliminada', to_regprocedure('public.importar_lote(text,text,text,integer,text)') is null),
  ('lots_quantity_nonneg VALIDADA', (select convalidated from pg_constraint where conname = 'lots_quantity_nonneg')),
  ('identidad de lote única', to_regclass('public.uq_lots_product_code') is not null),
  ('kardex exige op_id', (select attnotnull from pg_attribute where attrelid = 'public.inventory_movements'::regclass and attname = 'op_id')),
  ('kardex exige referencia de negocio', exists (select 1 from pg_constraint where conname = 'ck_invmov_referencia')),
  ('sin política de escritura directa en lots', not exists (select 1 from pg_policies where tablename = 'lots' and policyname = 'lots_write_warehouse')),
  ('sin inserción directa al kardex', not exists (select 1 from pg_policies where tablename = 'inventory_movements' and policyname = 'invmov_insert_ops')),
  ('sin escritura directa a order_items', not exists (select 1 from pg_policies where tablename = 'order_items' and policyname like 'order_items_%_scoped' and cmd <> 'SELECT')),
  ('authenticated sin INSERT/UPDATE/DELETE en lots/kardex/renglones', not exists (select 1 from information_schema.role_table_grants
      where table_schema = 'public' and table_name in ('lots','inventory_movements','order_items') and grantee in ('anon','authenticated')
        and privilege_type in ('INSERT','UPDATE','DELETE','TRUNCATE'))),
  ('apply_lot_movement no ejecutable por authenticated', not has_function_privilege('authenticated', 'public.apply_lot_movement(uuid,integer,text,text)', 'EXECUTE')),
  ('helpers internos no ejecutables por authenticated', not has_function_privilege('authenticated', 'public._w1_trusted(boolean)', 'EXECUTE')),
  ('guarda de guía instalada', exists (select 1 from pg_trigger where tgname = 'trg_shipping_attempts_guard')),
  ('guarda de compras instalada', exists (select 1 from pg_trigger where tgname = 'trg_replenishments_guard')),
  ('ledgers nuevos append-only', (select count(*) = 4 from pg_trigger where tgname in ('trg_inventory_operations_append_only','trg_purchase_receipts_append_only',
      'trg_order_cancellations_append_only','trg_stock_returns_append_only'))),
  ('ledgers existentes intactos', (select count(*) = 3 from pg_trigger where tgname in ('trg_inventory_movements_append_only','trg_audit_logs_append_only','trg_freeze_movement_cost'))),
  ('conciliación C1: lote = Σ kardex (0 diferencias)', not exists (select 1 from public.lots l
      where l.quantity <> coalesce((select sum(change) from public.inventory_movements m where m.lot_id = l.id), 0))),
  ('historial de migraciones registra M1–M4', (select count(*) = 4 from supabase_migrations.schema_migrations
      where version in ('20261012120000','20261012120100','20261012120200','20261012120300'))),
  ('precio_de sin cambios', md5(pg_get_functiondef('public.precio_de(uuid,uuid,integer)'::regprocedure)) = '9efe19506f40e19c3dc5baeca66b9014'),
  ('crear_pedido sin cambios', md5(pg_get_functiondef('public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)'::regprocedure)) = '99d610b10ea8f5629e38e27b11ff0be8'),
  ('review_transfer_payment sin cambios', md5(pg_get_functiondef('public.review_transfer_payment(uuid,text,text)'::regprocedure)) = 'b736bcd1c74e04c21121370b256f49d1'),
  ('ledger_append_only sin cambios', md5(pg_get_functiondef('public.ledger_append_only()'::regprocedure)) = '7563f161c00630c2725591c680a354f2')
)
select chk, ok from checks
union all
select 'W1_VERIFY: ' || count(*) filter (where ok) || '/' || count(*) || case when bool_and(ok) then ' OK' else ' FALLA' end, bool_and(ok) from checks;
rollback;
