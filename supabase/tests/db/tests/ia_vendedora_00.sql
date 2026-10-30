-- IA-VENDEDORA (20270223) · la IA vende con datos del servidor: escalones con nivel y reglas, cotización de combinaciones,
-- oportunidades con montos exactos, perfil del cliente (especialidad, lo que compra, su carrito, lo que buscó) y
-- recomendaciones con motivo. Nada de precio para quien no puede verlo.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); d1 uuid := tests.user('doctor'); dn uuid; s1 uuid := tests.user('pos');
  a uuid := tests.product(1300); b uuid := tests.product(800); c uuid := tests.product(4600); x uuid := tests.product(500); y uuid := tests.product(300);
  cu uuid; r jsonb; o jsonb; v_cart uuid; v_o uuid;
begin
  perform tests.act_as_owner();
  dn := tests.user('doctor'); perform tests.act_as_service(); update public.profiles set verified = false where id = dn; perform tests.act_as_owner();
  update public.products set show_portal = true, category = 'Toxinas' where id in (a, b, c);
  update public.products set show_portal = true, category = 'Vitaminas', family = 'Vitaminas' where id in (x, y);
  update public.products set name = 'Nabota 100' where id = a; update public.products set name = 'Innotox 50' where id = b; update public.products set name = 'Botox 100' where id = c;
  update public.products set name = 'Vitamina C' where id = x; update public.products set name = 'Vitamina B12' where id = y;
  insert into public.product_volume_prices (product_id, min_quantity, price, nivel) values
    (a, 10, 1170, 'medio'), (a, 50, 800, 'mayoreo'), (b, 10, 720, 'medio'), (b, 50, 400, 'mayoreo'), (c, 5, 4370, 'medio'), (c, 10, 3900, 'mayoreo');
  cu := tests.cliente(d1);
  update public.customers set tipo_cliente = 'doctor', especialidad = 'dermatologia' where id = cu;
  insert into public.cc_producto_especialidad (product_id, especialidad) values (x, 'dermatologia');
  insert into public.cc_product_relations (product_id, related_id, tipo, estado, nota) values (a, y, 'complemento', 'approved', 'se usa junto');

  -- ══ 1 · precio de un producto: escalones con nivel y reglas del pedido ══
  perform tests.act_as_service();
  r := public.cc_ia_precio(d1, a, 1);
  perform tests.ok(r -> 'escalas' -> 0 ->> 'nivel' = 'medio_mayoreo' and r -> 'escalas' -> 1 ->> 'nivel' = 'mayoreo' and (r ->> 'se_junta_para_medio_mayoreo')::boolean
    and r ->> 'reglas_del_pedido' like '%TODO el pedido%', '1 · escalones con su nivel, si se junta y las reglas');
  perform tests.ok(not (public.cc_ia_precio(d1, c, 1) ->> 'se_junta_para_medio_mayoreo')::boolean, '1 · el de medio en 5 no se junta');

  -- ══ 2 · cotizar una combinación con las reglas del pedido ══
  r := public.cc_ia_cotizar(d1, jsonb_build_array(jsonb_build_object('product_id', a, 'cantidad', 5), jsonb_build_object('product_id', b, 'cantidad', 5)));
  perform tests.ok((r ->> 'autorizado')::boolean and (r ->> 'total')::numeric = 5 * 1170 + 5 * 720 and (r ->> 'ahorro_vs_precio_por_pieza')::numeric = 5 * 130 + 5 * 80
    and (r -> 'lineas' -> 0 ->> 'por_reglas_del_pedido')::boolean, '2 · 5 + 5 a medio mayoreo, con el ahorro exacto');
  perform tests.ok(not (public.cc_ia_cotizar(dn, jsonb_build_array(jsonb_build_object('product_id', a, 'cantidad', 5))) ->> 'autorizado')::boolean, '2 · sin verificar: sin precio');

  -- ══ 3 · oportunidades exactas ══
  r := public.cc_ia_cotizar(d1, jsonb_build_array(jsonb_build_object('product_id', a, 'cantidad', 5), jsonb_build_object('product_id', b, 'cantidad', 3)));
  select e into o from jsonb_array_elements(r -> 'oportunidades') e where e ->> 'tipo' = 'juntar_10';
  perform tests.ok((o ->> 'faltan')::int = 2 and (o ->> 'ahorro_en_lo_que_ya_lleva')::numeric = 5 * 130 + 3 * 80, '3 · juntar 10: faltan 2 y ahorra $890 en lo que ya lleva');
  select e into o from jsonb_array_elements(r -> 'oportunidades') e where e ->> 'tipo' = 'mayoreo' and e ->> 'product_id' = a::text;
  perform tests.ok((o ->> 'faltan')::int = 45 and (o ->> 'precio_unitario_al_llegar')::numeric = 800 and (o ->> 'ahorro_en_lo_que_ya_lleva')::numeric = 5 * 500 + 3 * 400, '3 · mayoreo: con 45 más todo baja (y cuánto ahorra en lo que ya lleva)');
  r := public.cc_ia_cotizar(d1, jsonb_build_array(jsonb_build_object('product_id', c, 'cantidad', 3)));
  perform tests.ok(exists (select 1 from jsonb_array_elements(r -> 'oportunidades') e where e ->> 'tipo' = 'medio_mayoreo' and (e ->> 'faltan')::int = 2 and (e ->> 'precio_unitario_al_llegar')::numeric = 4370), '3 · medio mayoreo propio (de 5): faltan 2');
  r := public.cc_ia_cotizar(d1, jsonb_build_array(jsonb_build_object('product_id', a, 'cantidad', 50), jsonb_build_object('product_id', b, 'cantidad', 1)));
  perform tests.ok(jsonb_array_length(r -> 'oportunidades') = 0 and (r -> 'lineas' -> 0 ->> 'precio_unitario')::numeric = 400, '3 · ya en mayoreo: nada más que ofrecer por cantidad');

  -- ══ 4 · actividad del catálogo: la deja el doctor y es solo suya ══
  perform tests.act_as(d1);
  perform tests.ok((public.cc_registrar_actividad('ficha', a) ->> 'ok')::boolean and (public.cc_registrar_actividad('busqueda', null, '  botox  ') ->> 'ok')::boolean, '4 · el doctor deja su señal');
  perform tests.ok((public.cc_registrar_actividad('ficha', a) ->> 'repetida')::boolean, '4 · repetida en 10 min no se duplica');
  perform tests.act_as(s1);
  perform tests.ok(not (public.cc_registrar_actividad('ficha', a) ->> 'ok')::boolean, '4 · el personal no deja señales de cliente');
  perform tests.throws('select count(*) from public.cc_actividad_catalogo', 'permission denied', '4 · la tabla no se lee directo');

  -- ══ 5 · perfil comercial para la IA ══
  perform tests.act_as_owner();
  insert into public.orders (external_ref, doctor_id, customer_id, total, status, payment_method, payment_status, created_at)
  values ('T-IAV-1', d1, cu, 400, 'delivered', 'transferencia', 'pending', now() - interval '60 days') returning id into v_o;
  insert into public.order_items (order_id, product_id, qty, unit_price) values (v_o, c, 4, 100);
  insert into public.cc_carts (profile_id, estado) values (d1, 'active') returning id into v_cart;
  insert into public.cc_cart_items (cart_id, product_id, quantity) values (v_cart, a, 4);
  perform tests.act_as_service();
  r := public.cc_ia_perfil_comercial(d1);
  perform tests.ok(r ->> 'especialidad' = 'Dermatología' and r ->> 'tipo_cliente' like 'doctor%' and r -> 'compra_seguido' -> 0 ->> 'nombre' = 'Botox 100'
    and r -> 'carrito' -> 0 ->> 'nombre' = 'Nabota 100' and exists (select 1 from jsonb_array_elements(r -> 'oportunidades_del_carrito') e where e ->> 'tipo' = 'juntar_10' and (e ->> 'faltan')::int = 6)
    and exists (select 1 from jsonb_array_elements(r -> 'interes_reciente') e where e ->> 'termino' = 'botox'), '5 · especialidad, lo que compra, su carrito, sus oportunidades y lo que buscó');
  perform tests.ok(public.cc_ia_perfil_comercial(dn) is null, '5 · sin verificar: sin perfil comercial (no hay precios que ofrecer)');

  -- ══ 6 · recomendaciones con motivo ══
  r := public.cc_ia_recomendaciones(d1, null, 10);
  perform tests.ok(exists (select 1 from jsonb_array_elements(r) e where e ->> 'product_id' = y::text and e ->> 'motivo' = 'complemento')
    and exists (select 1 from jsonb_array_elements(r) e where e ->> 'product_id' = x::text and e ->> 'motivo' = 'tu_especialidad')
    and exists (select 1 from jsonb_array_elements(r) e where e ->> 'product_id' = c::text and e ->> 'motivo' = 'recompra')
    and not exists (select 1 from jsonb_array_elements(r) e where e ->> 'product_id' = a::text), '6 · complemento curado, su especialidad y recompra; nunca lo que ya lleva');
  r := public.cc_ia_recomendaciones(d1, b, 10);
  perform tests.ok(exists (select 1 from jsonb_array_elements(r) e where e ->> 'product_id' = c::text and e ->> 'motivo' in ('similar', 'recompra')), '6 · similares del producto que está viendo');

  -- ══ 7 · permisos ══
  perform tests.act_as(d1);
  perform tests.throws(format('select public.cc_ia_cotizar(%L, ''[]'')', d1), 'permission denied', '7 · cotizar solo desde el servidor');
  perform tests.throws(format('select public.cc_ia_perfil_comercial(%L)', d1), 'permission denied', '7 · el perfil comercial solo lo pide el servidor');
  perform tests.act_as(v_admin);
  perform tests.eq((public.producto_especialidades_guardar(a, array['dermatologia', 'medicina_estetica']) ->> 'especialidades')::int, 2, '7 · Dirección cura especialidades por producto');
  perform tests.throws(format('select public.producto_especialidades_guardar(%L, array[''astronauta''])', a), 'ESPECIALIDAD_INVALIDA', '7 · solo especialidades del catálogo');
  perform tests.act_as(s1);
  perform tests.throws(format('select public.producto_especialidades_guardar(%L, array[''dermatologia''])', a), 'NO_AUTORIZADO', '7 · un vendedor no las cambia');
  perform tests.ok(public.producto_especialidades() ? a::text, '7 · pero sí las ve');
end $t$;
rollback;
