-- W5 · KPIs · El rollback quita funciones e índices y NO toca un solo dato: pedidos,
-- cobros e inventario quedan idénticos y las operaciones de negocio siguen funcionando.
begin;
do $t$
declare v_doc uuid := tests.user('doctor'); v_p uuid := tests.product(100); v_o uuid;
begin
  perform tests.stock(v_p, 'W5-RB', 10);
  v_o := tests.packed_order(v_doc, jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 2)));
  create temp table w5_antes on commit drop as
    select (select count(*) from public.orders) as pedidos, (select count(*) from public.payment_entries) as cobros,
           (select count(*) from public.inventory_movements) as movimientos, (select sum(quantity) from public.lots) as existencia,
           tests.conciliacion_errores() as hallazgos;
end $t$;

-- Se ejecuta el script REAL de bajada, no una copia.
\ir ../../../rollback/w5/99_down.sql

do $t$
declare v_doc uuid := tests.user('doctor'); v_p uuid := tests.product(100); v_o uuid; a record;
begin
  perform tests.ok(to_regproc('public.kpi_ventas') is null and to_regproc('public.kpi_por_cobrar') is null
               and to_regproc('public.kpi_resultado') is null and to_regproc('public._kpi_ventas') is null
               and to_regproc('public.dia_negocio') is null and to_regproc('public._kpi_inicio') is null,
    'las funciones de W5 desaparecieron');
  perform tests.ok(to_regclass('public.idx_orders_created_at') is null
               and to_regclass('public.idx_payment_entries_value_date') is null, 'y sus índices');
  select * into a from w5_antes;
  perform tests.ok(a.pedidos = (select count(*) from public.orders) and a.cobros = (select count(*) from public.payment_entries)
               and a.movimientos = (select count(*) from public.inventory_movements) and a.existencia = (select sum(quantity) from public.lots),
    'ningún dato cambió: pedidos, cobros, kardex y existencia idénticos');
  perform tests.ok(public.hoy_local() is not null and to_regclass('public.v_order_money') is not null,
    'hoy_local() y v_order_money (W1/W2) siguen en pie');
  -- Lo esencial: sin W5 el negocio opera igual.
  perform tests.stock(v_p, 'W5-RB2', 10);
  v_o := tests.packed_order(v_doc, jsonb_build_array(jsonb_build_object('product_id', v_p, 'qty', 1)));
  perform tests.ok((select status from public.orders where id = v_o) = 'packed', 'crear, cobrar y surtir un pedido sigue funcionando');
  -- Se compara contra ANTES de bajar (no contra cero): en la corrida completa las pruebas
  -- de concurrencia dejan fixtures confirmados que esta prueba no creó.
  perform tests.eq(tests.conciliacion_errores(), a.hallazgos, 'y la conciliación de inventario queda exactamente como estaba');
end $t$;
rollback;
