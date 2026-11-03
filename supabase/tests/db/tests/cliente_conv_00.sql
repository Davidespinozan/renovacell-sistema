-- CLIENTE-CONV (20270316) · la conversación del PORTAL de un doctor resuelve su ficha por su cuenta: su vendedor ve sus
-- pedidos, usa la foto que el doctor mandó como comprobante y el seguimiento queda en su ficha. Otro vendedor no.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos'); d1 uuid := tests.user('doctor');
  cu uuid; conv uuid; p uuid; o uuid; m uuid; a uuid; r jsonb;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones"]}' where id in (s1, s2);
  cu := tests.cliente(d1);
  insert into public.cc_cartera (profile_id, seller_profile_id) values (d1, s1);
  conv := (public.cc_abrir_conversacion(null, d1) ->> 'conversation_id')::uuid;
  update public.cc_conversations set seller_profile_id = s1 where id = conv;
  perform tests.ok((select customer_id is null from public.cc_conversations where id = conv) and public._cc_cliente_conv(conv) = cu, '0 · conversación del portal sin ficha ligada: se resuelve por la cuenta');
  p := tests.producto_fam('Toxinas', 'Dysport', 1000); perform tests.stock(p, 'CC-L', 10);
  m := (public.cc_enviar_mensaje(conv, 'doctor', null, d1, 'img:' || gen_random_uuid(), 'Envió una imagen.') ->> 'id')::uuid;
  a := (public.cc_adjunto_registrar(m, conv || '/' || gen_random_uuid() || '.jpg', 'image/jpeg', 1200) ->> 'id')::uuid;
  perform tests.act_as(s1);
  o := (public.crear_pedido(gen_random_uuid(), null, d1, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)), null, false, cu) ->> 'order_id')::uuid;

  r := public.cc_cliente_pedidos(conv);
  perform tests.ok(jsonb_array_length(r) = 1 and r -> 0 ->> 'id' = o::text, '1 · su vendedor ve los pedidos del doctor en el chat');
  perform tests.ok((public.cc_pago_comprobante_preparar(o, a) ->> 'ruta_comprobante') like 'transfers/' || o || '/chat-%', '2 · la foto que mandó el doctor sirve como comprobante');
  perform public.seguimiento_guardar(null, conv, 'lo_esta_pensando', 'Le interesa Dysport', current_date + 3);
  perform tests.act_as_owner();
  perform tests.ok((select customer_id = cu from public.cc_seguimientos where conversation_id = conv or customer_id = cu order by created_at desc limit 1), '3 · el seguimiento queda en su ficha');

  perform tests.act_as(s2);
  perform tests.throws(format('select public.cc_cliente_pedidos(%L)', conv), 'NO_AUTORIZADO', '4 · otro vendedor no');
  perform tests.act_as_owner();
  perform tests.ok(not has_function_privilege('authenticated', 'public._cc_cliente_conv(uuid)', 'EXECUTE'), '5 · la resolución es solo del servidor');
end $t$;
rollback;
