-- HERRAMIENTAS DEL VENDEDOR · bloque A (20270214) · buscar una palabra en las conversaciones (sin acentos ni mayúsculas;
-- solo las que quien busca puede ver) y, por producto, qué clientes lo compraron (vendedor: su cartera; jefe y Dirección: todos).
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin();
  s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos'); sJefe uuid := tests.user('pos'); sNo uuid := tests.user('pos');
  d1 uuid := tests.user('doctor'); d2 uuid := tests.user('doctor');
  c1 uuid; c2 uuid; cu1 uuid; cu2 uuid; cuSin uuid; p1 uuid; p2 uuid; r jsonb; o uuid;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones"]}' where id in (s1, s2);
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","jefe_ventas"]}' where id = sJefe;
  cu1 := tests.cliente(d1); cu2 := tests.cliente(d2);
  update public.customers set full_name = 'Dra. Ana Pérez' where id = cu1; update public.customers set full_name = 'Dr. Beto Ruiz' where id = cu2;
  insert into public.cc_cartera (profile_id, seller_profile_id) values (d1, s1), (d2, s2);
  insert into public.customers (full_name, phone, active) values ('Clínica Sin Cuenta', '6691234567', true) returning id into cuSin;
  insert into public.cc_cartera_clientes (customer_id, seller_profile_id) values (cuSin, s1);

  -- conversaciones: c1 la atiende s1, c2 la atiende s2
  c1 := (public.cc_abrir_conversacion(null, d1) ->> 'conversation_id')::uuid;
  c2 := (public.cc_abrir_conversacion(null, d2) ->> 'conversation_id')::uuid;
  perform tests.act_as_owner();
  update public.cc_conversations set seller_profile_id = s1, modo = 'human_active' where id = c1;
  update public.cc_conversations set seller_profile_id = s2, modo = 'human_active' where id = c2;
  perform tests.act_as_service();
  perform public.cc_enviar_mensaje(c1, 'doctor', null, d1, 'a1', 'Quiero 3 cajas de DYSPORT para el viernes');
  perform public.cc_enviar_mensaje(c1, 'doctor', null, d1, 'a2', 'Y la Factúra a nombre de la clínica, 100% pagado');
  perform public.cc_enviar_mensaje(c1, 'doctor', null, d1, 'a3', 'dysport de 500 si hay');
  perform public.cc_enviar_mensaje(c2, 'doctor', null, d2, 'b1', 'Mándame la factura del mes');

  -- ══ 1 · buscar una palabra: sin acentos ni mayúsculas, solo lo que me toca ══
  perform tests.act_as(s1);
  r := public.cc_buscar_mensajes('dysport');
  perform tests.ok(jsonb_array_length(r) = 1 and r -> 0 ->> 'conversation_id' = c1::text and (r -> 0 ->> 'coincidencias')::int = 2, '1 · encuentra su conversación y cuántas veces se dijo');
  perform tests.eq(r -> 0 ->> 'texto', 'dysport de 500 si hay', '1 · con el mensaje más reciente que coincide');
  perform tests.ok((r -> 0 ->> 'puede_abrir')::boolean and (r -> 0 ->> 'tuya')::boolean, '1 · y la puede abrir');
  perform tests.eq(jsonb_array_length(public.cc_buscar_mensajes('FACTURA')), 1, '1 · sin acentos ni mayúsculas: "FACTURA" encuentra "Factúra"; y NO la conversación de otro vendedor');
  perform tests.eq(jsonb_array_length(public.cc_buscar_mensajes('100%')), 1, '1 · busca también números y signos (el % no es comodín)');
  perform tests.eq(jsonb_array_length(public.cc_buscar_mensajes('%%%')), 0, '1 · "%%%" no trae todo');
  perform tests.eq(public.cc_buscar_mensajes('dy'), '[]'::jsonb, '1 · menos de 3 letras: nada');
  perform tests.act_as(s2);
  perform tests.eq(jsonb_array_length(public.cc_buscar_mensajes('factura')), 1, '1 · s2 solo ve la suya');
  perform tests.eq(jsonb_array_length(public.cc_buscar_mensajes('dysport')), 0, '1 · y no la de s1');
  perform tests.act_as(v_admin);
  perform tests.eq(jsonb_array_length(public.cc_buscar_mensajes('factura')), 2, '1 · Dirección busca en todas');
  perform tests.act_as(sNo);
  perform tests.throws('select public.cc_buscar_mensajes(''factura'')', 'NO_AUTORIZADO', '1 · sin atender conversaciones, no busca');
  perform tests.act_as(d1);
  perform tests.throws('select public.cc_buscar_mensajes(''factura'')', 'NO_AUTORIZADO', '1 · un doctor no busca');
  -- la que ya atendió (participante) se sigue encontrando aunque hoy la tenga otro
  perform tests.act_as_owner();
  insert into public.cc_participants (conversation_id, rol, profile_id, actor_type) values (c2, 'asesor', s1, 'seller') on conflict do nothing;
  perform tests.act_as(s1);
  perform tests.ok(exists (select 1 from jsonb_array_elements(public.cc_buscar_mensajes('factura del mes')) x where x ->> 'conversation_id' = c2::text and not (x ->> 'puede_abrir')::boolean), '1 · encuentra la que atendió antes (sin poder abrirla si ya no es suya)');

  -- ══ 2 · quién compró este producto ══
  perform tests.act_as_service();
  p1 := tests.product(); p2 := tests.product();
  perform tests.order(d1, 'delivered', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 2)));
  perform tests.order(d1, 'paid', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 1)), 'pending', null, 'F-ANA-2');
  perform tests.order(d2, 'delivered', jsonb_build_array(jsonb_build_object('product_id', p1, 'qty', 5)));
  perform tests.order(d2, 'cancelled', jsonb_build_array(jsonb_build_object('product_id', p2, 'qty', 9)));
  perform tests.order(d1, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', p2, 'qty', 9)));
  perform tests.act_as_owner();   -- venta en caja a una ficha sin cuenta (el pedido nace con su cliente)
  insert into public.orders (external_ref, customer_id, total, status, payment_method, payment_status) values ('F-CLIN-1', cuSin, 400, 'delivered', 'efectivo', 'pending') returning id into o;
  insert into public.order_items (order_id, product_id, qty, unit_price) values (o, p2, 4, 100);
  perform tests.act_as_service();

  perform tests.act_as(s1);
  r := public.cc_compradores_producto(p1);
  perform tests.ok(jsonb_array_length(r) = 1 and r -> 0 ->> 'customer_id' = cu1::text, '2 · el vendedor ve SOLO a sus clientes que lo compraron');
  perform tests.ok((r -> 0 ->> 'veces')::int = 2 and (r -> 0 ->> 'unidades')::int = 3 and r -> 0 ->> 'ultimo_folio' is not null and r -> 0 -> 'vendedor' = 'null'::jsonb, '2 · cuántas veces, cuántas piezas y su último folio (' || r::text || ')');
  perform tests.eq(public.cc_compradores_producto(p2) -> 0 ->> 'nombre', 'Clínica Sin Cuenta', '2 · también clientes sin cuenta (pedido a su ficha); cancelados y pendientes de pago no cuentan');
  perform tests.ok(exists (select 1 from jsonb_array_elements(public.cc_productos_compradores()) x where x ->> 'product_id' = p1::text and (x ->> 'clientes')::int = 1), '2 · en la lista de productos: 1 cliente suyo lo compró');
  perform tests.act_as(sJefe);
  r := public.cc_compradores_producto(p1);
  perform tests.ok(jsonb_array_length(r) = 2 and exists (select 1 from jsonb_array_elements(r) x where x ->> 'vendedor' is not null), '2 · el jefe de ventas ve a todos, con su vendedor');
  perform tests.act_as(v_admin);
  perform tests.eq(jsonb_array_length(public.cc_compradores_producto(p1)), 2, '2 · Dirección ve a todos');
  perform tests.act_as(d1);
  perform tests.throws(format('select public.cc_compradores_producto(%L)', p1), 'NO_AUTORIZADO', '2 · un doctor no');
  perform tests.act_as_anon();
  perform tests.throws(format('select public.cc_compradores_producto(%L)', p1), 'permission denied', '2 · anónimo no');
end $t$;
rollback;
