-- COTIZACIONES (20270209) · el vendedor cotiza a SU cliente sin cuenta: precios del servidor congelados (volumen
-- incluido), vigencia 7 días, por correo al buzón, convertida en pedido; autoridad; la clienta con cuenta la ve.
begin;
do $t$
declare v_rob uuid := tests.user('pos'); v_ale uuid := tests.user('pos'); v_admin uuid := tests.fixture_admin(); dL uuid := tests.user('doctor');
  cL uuid; cSin uuid; p uuid; p2 uuid; r jsonb; cot uuid; o uuid;
begin
  perform tests.act_as_service();
  insert into public.customers (full_name, email, phone, source, active) values ('LOURDES VELAZQUEZ', 'lourdes@ejemplo.mx', '5512342562', 'odoo', true) returning id into cL;
  insert into public.customers (full_name, phone, source, active) values ('SIN CORREO', '6670007777', 'odoo', true) returning id into cSin;
  insert into public.cc_cartera_clientes (customer_id, seller_profile_id, motivo) values (cL, v_rob, 'Odoo'), (cSin, v_rob, 'Odoo');
  p := tests.producto_fam('Toxinas', 'Dysport', 1000);
  p2 := tests.producto_fam('Toxinas', 'Nabota', 500);
  insert into public.product_volume_prices (product_id, min_quantity, price, discount_percent) values (p, 5, 900, 10);

  -- 1 · autoridad: otro vendedor no cotiza al cliente de Roberto
  perform tests.act_as(v_ale);
  perform tests.throws(format('select public.cc_cotizacion_crear(%L, %L)', cL, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1))), 'NO_AUTORIZADO', '1 · otro vendedor no cotiza');

  -- 2 · Roberto cotiza: precio del servidor con volumen, congelado, vigencia 7 días, folio C-
  perform tests.act_as(v_rob);
  r := public.cc_cotizacion_crear(cL, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 5), jsonb_build_object('product_id', p2, 'qty', 2, 'unit_price', 1)), 'Entrega en Tlalnepantla');
  cot := (r ->> 'id')::uuid;
  perform tests.ok(r ->> 'folio' like 'C-%', '2 · folio C-');
  perform tests.eq((r ->> 'total')::numeric, 5500::numeric, '2 · total = 5×900 (volumen) + 2×500; el precio del navegador no cuenta');
  perform tests.ok((r ->> 'vigente_hasta')::timestamptz between now() + interval '6 days 23 hours' and now() + interval '7 days 1 hour', '2 · vigente 7 días');
  perform tests.ok((r ->> 'seller_profile_id')::uuid = v_rob, '2 · del vendedor de su cartera');
  perform tests.throws(format('select public.cc_cotizacion_crear(%L, %L)', cL, '[{"product_id":"00000000-0000-4000-8000-000000000000","qty":1}]'), 'PRODUCTO_NO_DISPONIBLE', '2 · producto inexistente');
  perform tests.throws(format('select public.cc_cotizacion_crear(%L, %L)', cL, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 0))), 'LINEAS_INVALIDAS', '2 · cantidad inválida');
  -- el precio queda congelado aunque luego cambie el catálogo
  perform tests.act_as_service(); update public.products set price = 2000 where id = p2; perform tests.act_as(v_rob);
  perform tests.eq((select total from public.cotizaciones where id = cot), 5500::numeric, '2 · congelada: no cambia con el catálogo');

  -- 3 · por correo: al buzón con su plantilla; sin correo se avisa
  r := public.cc_cotizacion_enviar(cot, 'correo');
  perform tests.ok(r ->> 'para' = 'l•••@ejemplo.mx', '3 · a su correo (enmascarado)');
  perform tests.act_as_owner();
  perform tests.ok(exists (select 1 from public.comm_outbox where plantilla = 'cotizacion' and customer_id = cL and to_address = 'lourdes@ejemplo.mx' and payload ->> 'folio' like 'C-%' and status = 'pendiente'), '3 · encolada con su folio');
  perform tests.act_as(v_rob);
  r := public.cc_cotizacion_enviar(cot, 'chat');
  perform tests.ok((select enviada_chat_at is not null and enviada_correo_at is not null from public.cotizaciones where id = cot), '3 · registra que se mandó por chat y por correo');
  perform tests.throws(format('select public.cc_cotizacion_enviar(%L, ''correo'')', (public.cc_cotizacion_crear(cSin, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1))) ->> 'id')), 'SIN_CORREO', '3 · sin correo en su ficha');

  -- 4 · se convierte en pedido (de ESE cliente) y queda ligada
  r := public.crear_pedido(gen_random_uuid(), null, null, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 5)), null, false, cL);
  o := (r ->> 'order_id')::uuid;
  perform tests.throws(format('select public.cc_cotizacion_convertida(%L, %L)', cot, (public.crear_pedido(gen_random_uuid(), null, null, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)), null, false, cSin) ->> 'order_id')), 'PEDIDO_AJENO', '4 · no con el pedido de otro cliente');
  r := public.cc_cotizacion_convertida(cot, o);
  perform tests.ok((select estado = 'convertida' and order_id = o from public.cotizaciones where id = cot), '4 · convertida y ligada al pedido');
  perform tests.throws(format('select public.cc_cotizacion_enviar(%L, ''correo'')', cot), 'COTIZACION_NO_VIGENTE', '4 · ya no se reenvía');

  -- 5 · lectura: su vendedor y Dirección sí; otro vendedor no; la clienta con cuenta sí
  perform tests.eq((select count(*)::int from public.cotizaciones where customer_id = cL), 1, '5 · su vendedor la ve');
  perform tests.act_as(v_ale);
  perform tests.eq((select count(*)::int from public.cotizaciones where customer_id = cL), 0, '5 · otro vendedor no');
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*)::int from public.cotizaciones where customer_id = cL), 1, '5 · Dirección sí');
  perform tests.act_as_service(); update public.customers set profile_id = dL where id = cL;
  perform tests.act_as(dL);
  perform tests.eq((select count(*)::int from public.cotizaciones where customer_id = cL), 1, '5 · la clienta con cuenta ve su cotización');
  perform tests.throws(format('select public.cc_cotizacion_cancelar(%L)', cot), 'NO_AUTORIZADO', '5 · pero no la modifica');
end $t$;
rollback;
