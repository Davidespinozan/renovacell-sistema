-- AUDITORÍA PRE-OPERACIÓN (20270203): vendedor por cartera del cliente / equivalencia Odoo; el pedido pasa a "pagado"
-- al cobrarse completo (y regresa si se reversa); el chofer lee los renglones de SUS pedidos; avisos por rol real
-- (auxiliar); aviso de pedido nuevo; recordatorio de cola sin vendedor.
begin;
do $t$
declare
  v_ale uuid := tests.user('pos', 'ale@test.local'); v_rob uuid := tests.user('pos', 'rob@test.local'); v_int uuid := tests.user('pos', 'int@test.local');
  v_baja uuid := tests.user('pos', 'baja2@test.local'); v_adm uuid := tests.fixture_admin(); v_drv uuid := tests.user('driver'); v_drv2 uuid := tests.user('driver');
  v_pack uuid := tests.user('packing');
  cCart uuid; cOdoo uuid; cOdooX uuid; cNada uuid; cBaja uuid; r jsonb; p uuid; o uuid; o2 uuid; e uuid; n int;
begin
  perform tests.act_as_service();
  update public.profiles set interna = true where id = v_int;
  update public.profiles set active = false where id = v_baja;
  insert into public.customers (full_name, source) values ('Cartera Cliente', 'odoo') returning id into cCart;
  insert into public.customers (full_name, seller_name, source) values ('Odoo Rob', '  roberto test ', 'odoo') returning id into cOdoo;
  insert into public.customers (full_name, seller_name, source) values ('Odoo sin equivalencia', 'Alguien Más', 'odoo') returning id into cOdooX;
  insert into public.customers (full_name, source) values ('Sin nada', 'odoo') returning id into cNada;
  insert into public.customers (full_name, source) values ('Cartera baja', 'odoo') returning id into cBaja;
  insert into public.cc_cartera_clientes (customer_id, seller_profile_id) values (cCart, v_ale), (cBaja, v_baja);
  insert into public.cc_cartera_historica_equivalencias (seller_name_odoo, seller_profile_id, motivo) values ('ROBERTO TEST', v_rob, 'prueba');

  -- ══ 1 · atribución ═══════════════════════════════════════════════════════════════════════════
  r := public._cx0c_atribucion(cCart, null);
  perform tests.ok(r ->> 'estado' = 'cartera' and (r ->> 'seller_profile_id')::uuid = v_ale, '1.1 · cliente sin portal con cartera de cliente → su vendedora');
  r := public._cx0c_atribucion(cOdoo, null);
  perform tests.ok(r ->> 'estado' = 'cartera' and (r ->> 'seller_profile_id')::uuid = v_rob, '1.2 · vendedor Odoo con equivalencia confirmada (sin distinguir mayúsculas/espacios)');
  perform tests.eq(public._cx0c_atribucion(cOdooX, null) ->> 'estado', 'no_resoluble', '1.3 · vendedor Odoo sin equivalencia: no_resoluble como antes');
  perform tests.eq(public._cx0c_atribucion(cNada, null) ->> 'estado', 'sin_asignacion', '1.4 · sin ninguna señal: sin_asignacion como antes (POS cae al cajero)');
  perform tests.eq(public._cx0c_atribucion(cBaja, null) ->> 'estado', 'no_resoluble', '1.5 · vendedor dado de baja: no_resoluble (no cae al cajero)');

  -- ══ 2 · pagado al cobrar completo ═══════════════════════════════════════════════════════════
  p := tests.producto_cat('Rellenos', 1000); perform tests.stock(p, 'GL-1', 20);
  perform tests.act_as_owner();
  insert into public.orders (customer_id, status, total, shipping_meta) values (cCart, 'pending_payment', 1000, '{}'::jsonb) returning id into o;
  insert into public.order_items (order_id, product_id, qty, unit_price) values (o, p, 1, 1000);
  perform tests.act_as(v_adm);
  perform public.registrar_cobro(tests.op(), o, 'efectivo', 400);
  perform tests.eq((select status from public.orders where id = o), 'pending_payment', '2.1 · abono parcial: sigue pendiente de pago');
  perform public.registrar_cobro(tests.op(), o, 'efectivo', 600);
  perform tests.eq((select status from public.orders where id = o), 'paid', '2.2 · cobrado completo: el pedido pasa a pagado');
  e := (select id from public.payment_entries where order_id = o and amount = 600 limit 1);
  perform public.reversar_asiento(tests.op(), e, 'prueba');
  perform tests.eq((select status from public.orders where id = o), 'pending_payment', '2.3 · una reversa que lo deja sin pagar lo regresa a pendiente');

  -- ══ 3 · chofer lee sus renglones ═════════════════════════════════════════════════════════════
  perform tests.act_as_owner();
  insert into public.shipments (order_id, driver_id, status) values (o, v_drv, 'por_despachar');
  perform tests.act_as(v_drv);
  perform tests.eq((select count(*)::int from public.order_items where order_id = o), 1, '3.1 · el chofer ve qué lleva en su envío');
  perform tests.act_as(v_drv2);
  perform tests.eq((select count(*)::int from public.order_items where order_id = o), 0, '3.2 · otro chofer no');

  -- ══ 4 · aviso por rol real (auxiliar) ════════════════════════════════════════════════════════
  perform tests.act_as_owner();
  insert into public.notifications (body, roles) values ('solo auxiliar GL', array['packing']), ('almacén GL', array['warehouse']);
  perform tests.act_as(v_pack);
  perform tests.eq((select count(*)::int from public.notifications where body in ('solo auxiliar GL', 'almacén GL')), 2, '4.1 · el auxiliar recibe los avisos de su rol y los de almacén');

  -- ══ 6 · aviso de pedido nuevo ════════════════════════════════════════════════════════════════
  perform tests.act_as_owner();
  insert into public.orders (customer_id, status, total, external_ref, shipping_meta) values (cCart, 'pending_payment', 1500, 'S-GL6', jsonb_build_object('seller_profile_id', v_ale)) returning id into o2;
  perform tests.ok(exists (select 1 from public.notifications where event_key = 'pedido_nuevo:' || o2 and 'admin' = any(roles) and body like '%S-GL6%por cobrar%'), '6.1 · Dirección recibe el pedido nuevo por cobrar');
  perform tests.ok(exists (select 1 from public.notifications where event_key = 'pedido_nuevo_vendedor:' || o2 and v_ale = any(user_ids)), '6.2 · y el vendedor del pedido');
  insert into public.orders (customer_id, status, total, shipping_meta) values (cCart, 'delivered', 100, '{"channel":"pos"}'::jsonb) returning id into o2;
  perform tests.ok(not exists (select 1 from public.notifications where event_key = 'pedido_nuevo:' || o2), '6.3 · la venta de mostrador (nace pagada) no avisa');
end $t$;
rollback;
