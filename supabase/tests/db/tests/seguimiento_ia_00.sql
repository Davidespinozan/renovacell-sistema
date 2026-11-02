-- SEGUIMIENTO IA (20270301) · carrito abandonado, recompra y promoción: un mensaje por evento con montos del servidor,
-- con respiro por doctor, sin interrumpir a un asesor, respetando la baja de difusiones; el vendedor se entera y
-- Dirección prende/apaga y ve qué pasó. El push al doctor sale de un disparador acotado a los mensajes proactivos.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); s1 uuid := tests.user('pos');
  dCar uuid := tests.user('doctor'); dRec uuid := tests.user('doctor'); dPro uuid := tests.user('doctor'); dHum uuid := tests.user('doctor'); dBaja uuid := tests.user('doctor');
  a uuid := tests.product(1300); c uuid := tests.product(4600);
  v_cart uuid; v_o uuid; v_conv uuid; n int; r jsonb; t text; hoy date; ok boolean;
begin
  perform tests.act_as_owner();
  update public.products set show_portal = true, category = 'Toxinas' where id in (a, c);
  update public.products set name = 'Nabota 100' where id = a; update public.products set name = 'Botox 100' where id = c;
  insert into public.product_volume_prices (product_id, min_quantity, price, nivel) values (a, 10, 1170, 'medio'), (a, 50, 800, 'mayoreo'), (c, 5, 4370, 'medio'), (c, 10, 3900, 'mayoreo');
  update public.cc_seguimiento_config set hora_desde = 0, hora_hasta = 24, domingo = true where id;   -- la prueba no depende de la hora
  perform tests.cliente(dCar); perform tests.cliente(dRec); perform tests.cliente(dPro); perform tests.cliente(dHum);
  perform tests.cliente(dBaja); update public.customers set difusiones_baja_at = now() where profile_id = dBaja;
  hoy := public.hoy_local();

  -- carrito abandonado hace 30 h
  insert into public.cc_carts (profile_id, estado, last_activity_at) values (dCar, 'active', now() - interval '30 hours') returning id into v_cart;
  insert into public.cc_cart_items (cart_id, product_id, quantity) values (v_cart, a, 8);
  -- recompra: 10 Botox hace 95 días (ciclo de Toxinas = 90)
  v_o := tests.order(dRec, 'delivered', jsonb_build_array(jsonb_build_object('product_id', c, 'qty', 10, 'unit_price', 3900)));
  perform tests.fechar(v_o, now() - interval '95 days');
  -- promoción vigente de algo que compró hace 20 días (y otro doctor igual, pero dado de baja de difusiones)
  v_o := tests.order(dPro, 'delivered', jsonb_build_array(jsonb_build_object('product_id', a, 'qty', 5, 'unit_price', 1300))); perform tests.fechar(v_o, now() - interval '20 days');
  v_o := tests.order(dBaja, 'delivered', jsonb_build_array(jsonb_build_object('product_id', a, 'qty', 5, 'unit_price', 1300))); perform tests.fechar(v_o, now() - interval '20 days');
  perform tests.act_as(v_admin);
  perform public.promocion_guardar(jsonb_build_object('nombre', 'Promo Nabota', 'desde', hoy - 1, 'hasta', hoy + 5, 'lineas', jsonb_build_array(jsonb_build_object('product_id', a, 'precio', 1100))));
  -- un asesor atiende a dHum, que también dejó su carrito
  perform tests.act_as_service();
  v_conv := (public._cc_conversacion_de(null, dHum) ->> 'conversation_id')::uuid;
  update public.cc_conversations set modo = 'human_assigned', seller_profile_id = s1 where id = v_conv;
  insert into public.cc_carts (profile_id, estado, last_activity_at) values (dHum, 'active', now() - interval '25 hours') returning id into v_cart;
  insert into public.cc_cart_items (cart_id, product_id, quantity) values (v_cart, c, 2);

  -- ══ 1 · un mensaje por evento, con montos del servidor ══
  n := public.cc_seguimiento_despachar();
  perform tests.eq(n, 3, '1 · carrito, recompra y promoción: tres mensajes');
  perform tests.ok(not exists (select 1 from public.cc_messages m join public.cc_conversations v on v.id = m.conversation_id where v.profile_id in (dPro, dBaja) and m.client_message_id like 'tpl:seg:recompra:%'), '1 · una compra de hace 20 días no es recompra (ciclo de su categoría, no 14 días)');
  select m.content into t from public.cc_messages m join public.cc_conversations v on v.id = m.conversation_id where v.profile_id = dCar and m.client_message_id like 'tpl:seg:carrito:%';
  perform tests.ok(t like '%Te quedó pendiente tu carrito: 8 Nabota 100 ($8,800 en total)%' and t like '%Con 2 piezas más%medio mayoreo%', '1 · carrito: lo que lleva, su total (con la promoción vigente) y cuánto le falta para el siguiente nivel');
  select m.content into t from public.cc_messages m join public.cc_conversations v on v.id = m.conversation_id where v.profile_id = dRec and m.client_message_id like 'tpl:seg:recompra:%';
  perform tests.ok(t like '%llevaste 10 Botox 100. ¿Te preparo el mismo pedido? Con 10 te queda a $3,900 por pieza (mayoreo).%', '1 · recompra: lo de siempre con el precio de esa cantidad');
  select m.content into t from public.cc_messages m join public.cc_conversations v on v.id = m.conversation_id where v.profile_id = dPro and m.client_message_id like 'tpl:seg:promo:%';
  perform tests.ok(t like '%Promo Nabota está vigente hasta el%en Nabota 100, que ya has llevado: $1,100 por pieza%', '1 · promoción: nombre, vigencia y escalones');
  perform tests.ok(not exists (select 1 from public.cc_messages m join public.cc_conversations v on v.id = m.conversation_id where v.profile_id = dBaja and m.actor_type = 'ai'), '1 · dado de baja de difusiones: sin promoción');

  -- ══ 2 · con asesor: no se interrumpe, se avisa al vendedor ══
  perform tests.ok(not exists (select 1 from public.cc_messages where conversation_id = v_conv and actor_type = 'ai'), '2 · con asesor atendiendo la IA no escribe');
  perform tests.ok(exists (select 1 from public.notifications where kind = 'seguimiento' and s1 = any (user_ids) and body like '%dejó su carrito sin terminar%'), '2 · el vendedor se entera');

  -- ══ 3 · cada evento una vez; respiro por doctor ══
  perform tests.eq(public.cc_seguimiento_despachar(), 0, '3 · la segunda corrida no repite');
  insert into public.cc_carts (profile_id, estado, last_activity_at) values (dRec, 'active', now() - interval '22 hours') returning id into v_cart;
  insert into public.cc_cart_items (cart_id, product_id, quantity) values (v_cart, a, 3);
  perform tests.eq(public.cc_seguimiento_despachar(), 0, '3 · un evento nuevo del mismo doctor espera el respiro de 24 h');

  -- ══ 4 · push acotado a lo proactivo ══
  select m.id into v_o from public.cc_messages m join public.cc_conversations v on v.id = m.conversation_id where v.profile_id = dCar and m.client_message_id like 'tpl:seg:%';
  r := public.ia_proactivo_push_carga(v_o);
  perform tests.ok((r -> 'perfiles' ->> 0)::uuid = dCar and r ->> 'texto' like '¡Hola%Te quedó pendiente tu carrito%', '4 · la carga del push es para el doctor, con el texto');
  perform tests.ok(public.ia_proactivo_push_carga((select id from public.cc_messages where actor_type <> 'ai' limit 1)) is null, '4 · un mensaje que no es proactivo no genera carga');
  perform tests.ok(exists (select 1 from pg_trigger where tgname = 'cc_proactivo_push' and tgrelid = 'public.cc_messages'::regclass), '4 · el disparador existe');

  -- ══ 5 · Dirección ══
  perform tests.act_as(v_admin);
  r := public.seguimiento_resumen(30);
  perform tests.ok((r -> 'carrito' ->> 'enviados')::int = 2 and (r -> 'recompra' ->> 'enviados')::int = 1 and (r -> 'promo' ->> 'enviados')::int = 1, '5 · resumen por tipo (el del asesor cuenta como atendido)');
  r := public.seguimiento_config_guardar('{"promo": false}');
  perform tests.ok(not (r ->> 'promo')::boolean and (r ->> 'carrito')::boolean, '5 · apagar un tipo');
  perform tests.act_as(s1);
  begin perform public.seguimiento_config_guardar('{"carrito": false}'); ok := false; exception when insufficient_privilege then ok := true; end;
  perform tests.ok(ok, '5 · un vendedor no cambia el seguimiento');
  perform tests.ok(not has_function_privilege('authenticated', 'public.cc_seguimiento_despachar()', 'EXECUTE'), '5 · el despachador es del servidor');
end $t$;
rollback;
