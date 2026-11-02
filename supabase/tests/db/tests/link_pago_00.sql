-- LINK DE PAGO (20270309) · el cliente pide link (portal / WhatsApp / su vendedor), el vendedor pega el de BanBajío, se le
-- entrega (WhatsApp vinculado, correo, su pedido) y Dirección/Facturación lo marcan pagado con el cobro de siempre.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); d1 uuid := tests.user('doctor'); d2 uuid := tests.user('doctor'); s1 uuid := tests.user('pos');
  p uuid; o1 uuid; o2 uuid; r jsonb; l uuid; ok boolean; c1 uuid;
begin
  perform tests.act_as_owner();
  p := tests.product(1000);
  o1 := tests.order(d1, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 2, 'unit_price', 1000)), 'pending', null, 'SLP001');
  o2 := tests.order(d2, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1, 'unit_price', 1000)), 'pending', null, 'SLP002');
  insert into public.cc_cartera (profile_id, seller_profile_id) values (d1, s1);

  -- ══ 1 · el doctor lo pide desde su pedido; su vendedor se entera (push urgente) ══
  perform tests.act_as(d1);
  r := public.link_pago_solicitar(o1); l := (r ->> 'id')::uuid;
  perform tests.ok(r ->> 'estado' = 'solicitado' and (r ->> 'monto')::numeric = 2000 and r ->> 'url' is null, '1 · solicitado por el saldo exacto, sin link todavía');
  perform tests.eq((public.link_pago_solicitar(o1) ->> 'id'), l::text, '1 · pedirlo dos veces no crea otro');
  begin perform public.link_pago_solicitar(o2); ok := false; exception when check_violation then ok := true; end;
  perform tests.ok(ok, '1 · un doctor no pide link del pedido de otro');
  perform tests.act_as_owner();
  perform tests.ok(exists (select 1 from public.notifications where kind = 'link_pago' and s1 = any (user_ids) and screen = 'links_pago'), '1 · aviso a su vendedor');

  -- ══ 2 · el vendedor pega el link de BanBajío ══
  perform tests.act_as(s1);
  begin perform public.link_pago_enviar(l, 'http://pagos.bb.com.mx/x'); ok := false; exception when check_violation then ok := true; end;
  perform tests.ok(ok, '2 · solo https');
  r := public.link_pago_enviar(l, 'https://pagos.bb.com.mx/link/abc123');
  perform tests.ok(r ->> 'estado' = 'enviado' and (r ->> 'banbajio')::boolean and r ->> 'dominio' = 'pagos.bb.com.mx', '2 · enviado y reconocido como BanBajío');
  perform tests.ok((public.link_pago_enviar(l, 'https://otro-sitio.com/x') ->> 'banbajio')::boolean = false, '2 · un dominio ajeno se marca (para revisarlo)');
  perform public.link_pago_enviar(l, 'https://pagos.bb.com.mx/link/abc123');
  perform tests.act_as_owner();
  perform tests.ok(exists (select 1 from public.comm_outbox where plantilla = 'link_pago' and order_id = o1 and payload ->> 'url' = 'https://pagos.bb.com.mx/link/abc123'), '2 · correo con el link encolado');
  perform tests.ok(exists (select 1 from public.notifications where kind = 'link_pago_listo' and d1 = any (user_ids)), '2 · aviso al doctor');
  perform tests.act_as(d1);
  perform tests.eq((public.link_pago_de_pedido(o1) ->> 'url'), 'https://pagos.bb.com.mx/link/abc123', '2 · el doctor lo ve en su pedido');

  -- ══ 3 · el vendedor NO marca pagos; Dirección sí, con el cobro de siempre ══
  perform tests.act_as(s1);
  begin perform public.link_pago_pagado(l, 'AUT 123'); ok := false; exception when insufficient_privilege then ok := true; end;
  perform tests.ok(ok, '3 · el vendedor no registra cobros');
  perform tests.act_as(v_admin);
  r := public.link_pago_pagado(l, 'AUT 123');
  perform tests.ok(r ->> 'estado' = 'pagado', '3 · marcado pagado');
  perform tests.act_as_owner();
  perform tests.ok((select saldo = 0 from public.v_order_money where order_id = o1), '3 · el pedido quedó sin saldo (cobro registrado en el libro)');
  perform tests.act_as(d1);
  begin perform public.link_pago_solicitar(o1); ok := false; exception when check_violation then ok := true; end;
  perform tests.ok(ok, '3 · sin saldo ya no se pide link');

  -- ══ 4 · WhatsApp: la IA lo pide por el doctor vinculado; sin vínculo, no ══
  perform tests.act_as_service();
  r := public.cc_wa_entrante('5216675559999', 'Dr. Dos', 'wamid.LP.1', '¿me mandas link para pagar con tarjeta?', false); c1 := (r ->> 'conversation_id')::uuid;
  begin perform public.cc_ia_link_pago(c1, d2); ok := false; exception when insufficient_privilege then ok := true; end;
  perform tests.ok(ok, '4 · sin vínculo del WhatsApp no se pide nada');
  perform tests.act_as_owner(); update public.cc_wa_contactos set vinculo_profile_id = d2, vinculado_at = now(), vinculado_via = 'personal' where wa_id = '5216675559999'; perform tests.act_as_service();
  r := public.cc_ia_link_pago(c1, d2);
  perform tests.ok((r ->> 'solicitado')::boolean and r ->> 'folio' = 'SLP002' and r ->> 'via' = 'whatsapp', '4 · la IA lo pidió (su pedido con saldo)');
  perform tests.act_as(s1);
  perform public.link_pago_enviar((r ->> 'id')::uuid, 'https://pagos.bb.com.mx/link/zz9');
  perform tests.act_as_owner();
  perform tests.ok(exists (select 1 from public.cc_messages where conversation_id = c1 and content like '%https://pagos.bb.com.mx/link/zz9%'), '4 · el link le llega por su WhatsApp');

  -- ══ 5 · permisos ══
  perform tests.ok(not has_function_privilege('authenticated', 'public.cc_ia_link_pago(uuid,uuid,text)', 'EXECUTE')
               and not has_table_privilege('authenticated', 'public.pago_links', 'SELECT'), '5 · tabla y función de la IA, solo del servidor');
end $t$;
rollback;
