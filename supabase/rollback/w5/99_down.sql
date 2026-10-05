-- ============================================================================
-- W5 · KPIs · ROLLBACK. Quita las funciones de indicadores y sus índices.
--
-- No hay datos que proteger: W5 no creó tablas ni escribió una sola fila. Bajarlo
-- no altera pedidos, cobros, inventario ni documentos fiscales; solo deja a las
-- pantallas sin las cifras de cabecera (mostrarán "No disponible", nunca un cero).
-- Ejecutar en UNA transacción:  psql -1 -v ON_ERROR_STOP=1 -f 99_down.sql
-- ============================================================================
drop function if exists public.kpi_resultado(date, date);
drop function if exists public.kpi_por_cobrar();
drop function if exists public.kpi_ventas(date, date);
drop function if exists public._kpi_ventas(date, date);
drop function if exists public._kpi_inicio(date);
drop function if exists public.dia_negocio(timestamptz);
drop index if exists public.idx_payment_entries_value_date;
drop index if exists public.idx_orders_created_at;
