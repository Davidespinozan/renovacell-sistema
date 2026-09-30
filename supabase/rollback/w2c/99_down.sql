-- ============================================================================
-- W2-C · ROLLBACK. Baja en CAPAS: C antes de W2, W2 antes de W1.
-- Restaura verbatim las cuatro definiciones extendidas desde 00_w2_snapshot.sql
-- y recrea la custodia legacy (sin pérdida: se eliminó con 0 filas).
--
-- Uso:  psql -X -v ON_ERROR_STOP=1 -f supabase/rollback/w2c/00_w2_snapshot.sql \
--                                  -f supabase/rollback/w2c/99_down.sql
-- ============================================================================

-- ------------------------------------------------------------------ revierte C4
-- (las políticas legacy vuelven en 00_w2_snapshot.sql, que recrea tablas y grants)
drop policy if exists events_select_legacy on public.events;
drop policy if exists consignment_select_legacy on public.consignment_stock;

-- ------------------------------------------------------------------ revierte C3
drop function if exists public.abrir_custodia(uuid, text, text, uuid, uuid, text, text, date);
drop function if exists public.entregar_custodia(uuid, uuid, jsonb);
drop function if exists public.devolver_de_custodia(uuid, uuid, jsonb, text);
drop function if exists public.registrar_perdida_custodia(uuid, uuid, text, jsonb, text, text);
drop function if exists public.cerrar_custodia(uuid, uuid, text);
drop function if exists public.estado_custodia(uuid);
drop function if exists public.estado_operacion_custodia(uuid);
drop function if exists public.conciliar_custodia();
drop function if exists public._w2c_perdida(uuid, text, uuid, int, text, text, uuid);
drop function if exists public._w2c_op_begin(uuid, text, jsonb);
drop function if exists public._w2c_op_finish(uuid, text, jsonb, jsonb);
drop function if exists public._w2c_trusted(boolean);
-- vender_pos vuelve a su firma de 12 argumentos (sin custodia)
drop function if exists public.vender_pos(uuid, text, numeric, text, uuid, jsonb, jsonb, jsonb, boolean, jsonb, uuid, numeric, uuid);

-- ------------------------------------------------------------------ revierte C2
alter table public.custody_lines drop constraint if exists ck_custody_line_kind;
alter table public.custody_lines drop constraint if exists ck_custody_line_qty;
alter table public.custody_lines drop constraint if exists ck_custody_line_held_delta;
alter table public.custody_lines drop constraint if exists ck_custody_line_venta;
alter table public.custody_lines drop constraint if exists ck_custody_line_precio;
alter table public.custody_lines drop constraint if exists ck_custody_line_perdida;
alter table public.custody_lines drop constraint if exists ck_custody_line_motivo;
drop index if exists public.uq_custody_line_reversa;
drop index if exists public.uq_custody_line_order_item;
drop index if exists public.uq_custody_line_inv_op;
drop index if exists public.uq_custody_abierta_user;
drop index if exists public.uq_custody_abierta_cust;

-- ------------------------------------------------------------------ revierte C1
drop view if exists public.v_custody_liquidacion;
drop view if exists public.v_custody_stock;
drop view if exists public.v_stock_disponible;
drop trigger if exists trg_custodies_guard on public.custodies;
drop function if exists public.custodies_guard();
drop table if exists public.custody_lines;
drop table if exists public.custodies;
drop table if exists public.custody_operations;
-- custody_held se elimina AL FINAL: product_stock, ajustar_lote y surtir_pedido
-- dependen de ella hasta que el snapshot restaure sus versiones previas.
drop function if exists public.custody_held_en(uuid, uuid);
drop function if exists public.custody_held(uuid);
