-- METAS Y COMISIONES · Dirección y el jefe de ventas (capacidad jefe_ventas) leen el mismo resumen; un vendedor sin la
-- capacidad no; los pedidos de cuentas internas no aparecen; el jefe no puede leer las tablas directo ni editar metas.
begin;
do $t$
declare
  v_adm uuid := tests.user('admin'); v_jefe uuid := tests.user('pos'); v_ven uuid := tests.user('pos'); v_int uuid := tests.user('pos');
  p uuid; cu uuid; o1 uuid := gen_random_uuid(); o2 uuid := gen_random_uuid(); o3 uuid := gen_random_uuid(); r jsonb;
  hoy date := (now() at time zone 'America/Mazatlan')::date;
begin
  perform tests.act_as_service();
  update public.profiles set meta = jsonb_build_object('capabilities', jsonb_build_array('conversaciones', 'jefe_ventas')) where id = v_jefe;
  update public.profiles set meta = jsonb_build_object('capabilities', jsonb_build_array('conversaciones')) where id = v_ven;
  update public.profiles set interna = true where id = v_int;
  p := tests.producto_cat('Rellenos', 1000); perform tests.stock(p, 'JEFE-1', 50);
  perform tests.act_as_owner();
  insert into public.customers (full_name, phone, source) values ('Cliente Jefe', '6670003333', 'odoo') returning id into cu;
  insert into public.orders (id, customer_id, status, total, shipping_meta) values
    (o1, cu, 'delivered', 1000, jsonb_build_object('seller_profile_id', v_ven, 'seller', 'ven@x')),
    (o2, cu, 'delivered', 1000, jsonb_build_object('seller_profile_id', v_int, 'seller', 'int@x')),
    (o3, cu, 'delivered', 1000, '{}'::jsonb);
  insert into public.order_items (order_id, product_id, qty, unit_price) values (o1, p, 1, 1000), (o2, p, 1, 1000), (o3, p, 1, 1000);
  insert into public.sales_targets (seller, target, commission_rate) values ('__default__', 50000, 0.05) on conflict (seller) do nothing;

  -- ══ 1 · quién puede ═══════════════════════════════════════════════════════════════════════════
  perform tests.act_as(v_ven);
  perform tests.throws(format('select public.comisiones_equipo(%L, %L)', hoy - 31, hoy), 'NO_AUTORIZADO', '1.1 · un vendedor sin la capacidad no ve las comisiones del equipo');
  perform tests.act_as(v_jefe);
  r := public.comisiones_equipo(hoy - 31, hoy);
  perform tests.ok(r ? 'pedidos' and r ? 'asientos' and r ? 'metas' and not (r ->> 'puede_editar')::boolean, '1.2 · el jefe de ventas sí, en solo lectura');
  perform tests.throws(format('select public.comisiones_equipo(%L, %L)', hoy, hoy - 1), 'PERIODO_INVALIDO', '1.3 · periodo al revés: no');

  -- ══ 2 · qué ve el jefe ═══════════════════════════════════════════════════════════════════════
  perform tests.ok(r -> 'vendedores' @> jsonb_build_array(jsonb_build_object('id', v_ven)) and r -> 'vendedores' @> jsonb_build_array(jsonb_build_object('id', v_jefe))
               and not (r -> 'vendedores' @> jsonb_build_array(jsonb_build_object('id', v_int))), '2.1 · todos los vendedores, sin la cuenta interna');
  perform tests.ok(r -> 'pedidos' @> jsonb_build_array(jsonb_build_object('id', o1)) and r -> 'pedidos' @> jsonb_build_array(jsonb_build_object('id', o3))
               and not (r -> 'pedidos' @> jsonb_build_array(jsonb_build_object('id', o2))), '2.2 · los pedidos del equipo y sin vendedor; el de la cuenta interna no');
  perform tests.ok((select x -> 'items' -> 0 ->> 'linea' in ('cosm', 'prof') from jsonb_array_elements(r -> 'pedidos') x where x ->> 'id' = o1::text), '2.3 · cada renglón trae su línea para la tasa');
  perform tests.ok(not exists (select 1 from jsonb_array_elements(r -> 'pedidos') x where x ? 'customer_id' or x ? 'doctor_id' or (x -> 'shipping_meta') ? 'address'), '2.4 · sin datos del cliente ni de la dirección');
  perform tests.ok(r -> 'metas' @> '[{"seller":"__default__"}]'::jsonb, '2.5 · trae las metas y tasas vigentes');
  perform tests.eq((select count(*)::int from public.sales_targets), 0, '2.6 · pero no puede leer la tabla de metas directo');
  perform tests.throws('insert into public.sales_targets (seller, target, commission_rate) values (''x'', 1, 0.1)', 'row-level security', '2.7 · ni editar metas');

  -- ══ 3 · Dirección: lo mismo y puede editar ════════════════════════════════════════════════════
  perform tests.act_as(v_adm);
  r := public.comisiones_equipo(hoy - 31, hoy);
  perform tests.ok((r ->> 'puede_editar')::boolean and not (r -> 'pedidos' @> jsonb_build_array(jsonb_build_object('id', o2))), '3.1 · Dirección ve lo mismo (sin la interna) y puede editar');
  perform tests.act_as(v_int);
  perform tests.throws(format('select public.comisiones_equipo(%L, %L)', hoy - 31, hoy), 'NO_AUTORIZADO', '3.2 · una cuenta interna sin la capacidad tampoco');
end $t$;
rollback;
