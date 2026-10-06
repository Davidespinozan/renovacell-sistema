-- UX-2/UX-1 (122) · El rollback quita crear_orden_compra, devuelve cc_leer_conversacion al texto de
-- 121 y NO toca datos: órdenes, inventario y conversaciones quedan idénticos.
begin;
do $t$
declare v_bill uuid := tests.user('billing'); v_p uuid := tests.product(); r jsonb;
begin
  perform tests.act_as(v_bill);
  r := public.crear_orden_compra(tests.op(), v_p, 5, 10, 'compra', 'P');
  perform tests.act_as_owner();
  create temp table ux_antes on commit drop as
    select (select count(*) from public.replenishments) as ordenes, (select count(*) from public.inventory_movements) as movimientos,
           (select count(*) from public.inventory_operations) as operaciones, (select count(*) from public.cc_conversations) as convs;
end $t$;
reset role;
select set_config('request.jwt.claims', '', true);
\ir ../../../rollback/ux_compras_chat/99_down.sql
do $t$
declare a record;
begin
  select * into a from ux_antes;
  perform tests.ok(to_regprocedure('public.crear_orden_compra(uuid,uuid,integer,numeric,text,text,text)') is null, 'comando retirado');
  perform tests.ok(pg_get_functiondef('public.cc_leer_conversacion(uuid,text,text,uuid,bigint,integer)'::regprocedure) !~ 'leido_hasta', 'cc_leer_conversacion sin leido_hasta (texto de 121)');
  perform tests.ok(to_regprocedure('public.cc_leer_conversacion(uuid,text,text,uuid,bigint,integer)') is not null, 'la lectura sigue existiendo');
  perform tests.eq((select count(*) from public.replenishments), a.ordenes, 'órdenes intactas (incluida la creada por el comando)');
  perform tests.eq((select count(*) from public.inventory_movements), a.movimientos, 'kardex intacto');
  perform tests.eq((select count(*) from public.inventory_operations), a.operaciones, 'registro de operaciones intacto (append-only)');
  perform tests.eq((select count(*) from public.cc_conversations), a.convs, 'conversaciones intactas');
  perform tests.ok(exists (select 1 from pg_constraint where conrelid = 'public.inventory_operations'::regclass and contype = 'c' and pg_get_constraintdef(oid) !~ 'alta_compra'), 'restricción original restaurada (NOT VALID si ya hubo altas)');
end $t$;
rollback;
