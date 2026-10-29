-- PEDIDOS-PREVIOS (20270207) · el vendedor le vende a una clienta SIN cuenta; cuando ella crea su cuenta, ve ese pedido
-- en su portal (pedido, renglones, envío, estado de dinero) y puede reportar su pago. Nadie más gana acceso.
begin;
do $t$
declare v_rob uuid := tests.user('pos'); dL uuid := tests.user('doctor'); dX uuid := tests.user('doctor'); v_bill uuid := tests.user('billing');
  cL uuid; p uuid; o uuid; r jsonb; lineas jsonb;
begin
  perform tests.act_as_service();
  insert into public.customers (full_name, phone, source, active) values ('LOURDES VELAZQUEZ NAVARRETE', '5512342562', 'odoo', true) returning id into cL;
  insert into public.cc_cartera_clientes (customer_id, seller_profile_id, motivo) values (cL, v_rob, 'Odoo');
  p := tests.producto_fam('Toxinas', 'Dysport', 6000);
  perform tests.stock(p, 'PP-L', 50);
  lineas := jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1));

  -- 1 · Roberto le levanta el pedido por WhatsApp (sin cuenta)
  perform tests.act_as(v_rob);
  r := public.crear_pedido(gen_random_uuid(), null, null, lineas, null, false, cL);
  o := (r ->> 'order_id')::uuid;
  perform tests.act_as_owner();
  perform tests.ok((select doctor_id is null and customer_id = cL from public.orders where id = o), '1 · pedido a su ficha, sin doctor');

  -- 2 · antes de tener cuenta ligada, ningún doctor lo ve
  perform tests.act_as(dL);
  perform tests.eq((select count(*)::int from public.orders where id = o), 0, '2 · sin vínculo, ella todavía no lo ve');
  perform tests.throws(format('select public.estado_dinero_pedido(%L)', o), 'NO_AUTORIZADO', '2 · ni su estado de dinero');

  -- 3 · crea su cuenta (la invitación liga la ficha): ahora lo ve todo
  perform tests.act_as_service();
  update public.customers set profile_id = dL where id = cL;
  perform tests.act_as(dL);
  perform tests.eq((select count(*)::int from public.orders where id = o), 1, '3 · su pedido anterior aparece en su portal');
  perform tests.ok((select count(*) > 0 from public.order_items where order_id = o), '3 · con sus productos');
  perform tests.ok(public.estado_dinero_pedido(o) ? 'saldo', '3 · y su estado de dinero');
  perform tests.ok(public.order_owner(o) = dL, '3 · order_owner la reconoce (envíos)');

  -- 4 · puede reportar su pago de ese pedido
  r := public.reportar_pago(gen_random_uuid(), o, 'transferencia', 6000, 'REF-PP-1', null, null);
  perform tests.ok(r is not null, '4 · reporta el pago de su pedido anterior');
  perform tests.ok((select count(*) > 0 from public.payment_claims where order_id = o), '4 · y ve su reporte');

  -- 5 · otro doctor no gana nada
  perform tests.act_as(dX);
  perform tests.eq((select count(*)::int from public.orders where id = o), 0, '5 · otro doctor no lo ve');
  perform tests.throws(format('select public.reportar_pago(gen_random_uuid(), %L, ''transferencia'', 1, null, null, null)', o), 'NO_AUTORIZADO', '5 · ni reporta su pago');
  perform tests.ok(not public._pedido_es_del_doctor(o), '5 · no es suyo');

  -- 6 · el pedido sigue siendo del vendedor y con doctor_id NULL (identidad inmutable)
  perform tests.act_as(v_rob);
  perform tests.eq((select count(*)::int from public.orders where id = o), 1, '6 · Roberto lo sigue viendo');
  perform tests.act_as_owner();
  perform tests.ok((select doctor_id is null from public.orders where id = o), '6 · doctor_id sigue NULL');
end $t$;
rollback;
