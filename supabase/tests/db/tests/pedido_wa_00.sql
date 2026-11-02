-- PEDIDO POR WHATSAPP (20270307) · con un doctor vinculado en WhatsApp la IA guarda su dirección, revisa y confirma el pedido por
-- el MISMO checkout del portal (su carrito, sus precios, la entrega del servidor), entrega los datos de pago y avisa al
-- responsable. Sin vínculo no se puede; sin revisión vigente no se confirma; "actuar como" no se queda puesto.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); d1 uuid := tests.user('doctor'); d2 uuid := tests.user('doctor'); s1 uuid := tests.user('pos');
  c1 uuid; p uuid; k uuid; r jsonb; ok boolean; v_n int;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones"]}' where id = s1;
  p := tests.producto_cat('Rellenos', 1000); perform tests.stock(p, 'WA-L', 50);
  perform tests.cliente(d1); insert into public.cc_cartera (profile_id, seller_profile_id) values (d1, s1);
  perform tests.act_as_owner();
  update public.company_settings set banco = 'BanBajío', clabe = '030000000000000001', titular = 'Renovacell SA';
  perform tests.act_as_service();
  r := public.cc_wa_entrante('5216675556666', 'Dra. Ana', 'wamid.PW.1', 'Quiero 2 rellenos', false); c1 := (r ->> 'conversation_id')::uuid;

  -- sin vínculo, nada
  begin perform public.cc_ia_pedido_revisar(c1, d1); ok := false; exception when insufficient_privilege then ok := true; end;
  perform tests.ok(ok, '0 · sin vínculo del WhatsApp no se revisa ningún pedido');
  perform tests.act_as_owner(); update public.cc_wa_contactos set vinculo_profile_id = d1, vinculado_at = now(), vinculado_via = 'personal' where wa_id = '5216675556666'; perform tests.act_as_service();
  begin perform public.cc_ia_pedido_revisar(c1, d2); ok := false; exception when insufficient_privilege then ok := true; end;
  perform tests.ok(ok, '0 · con vínculo, solo para ESE doctor');

  -- ══ 1 · su carrito (el mismo del portal) y su dirección dictada ══
  k := (public.cc_carrito_abrir('doctor', null, d1) ->> 'cart_id')::uuid; perform public.cc_carrito_agregar(k, 'doctor', null, d1, p, 2, 'pw1');
  perform tests.eq((public.cc_ia_direccion_guardar(c1, d1, '{"calle":"Av. Obregón","numero":"120","cp":"123","ciudad":"Culiacán","estado":"Sinaloa"}') ->> 'campo'), 'cp', '1 · CP inválido: se pide de nuevo');
  r := public.cc_ia_direccion_guardar(c1, d1, '{"calle":"Av. Obregón","numero":"120","colonia":"Centro","cp":"80000","ciudad":"Culiacán","estado":"Sinaloa"}');
  perform tests.ok((r ->> 'guardada')::boolean and (select count(*) from public.doctor_locations where doctor_id = d1 and is_default) = 1, '1 · dirección guardada en su perfil (predeterminada)');

  -- ══ 2 · revisión: precio, entrega y fecha del servidor ══
  r := public.cc_ia_pedido_revisar(c1, d1);
  perform tests.ok(r -> 'entrega_opciones' is not null and r ->> 'direccion_guardada' like 'Av. Obregón 120%', '2 · revisión con opciones de entrega y su dirección');
  r := public.cc_ia_pedido_revisar(c1, d1, 'recoge');
  perform tests.ok((r ->> 'listo')::boolean and r ->> 'review_id' is not null, '2 · eligiendo recoger: lista para confirmar');
  perform tests.ok(coalesce(current_setting('request.jwt.claim.sub', true), '') = '', '2 · "actuar como" no se queda puesto');

  -- ══ 3 · confirmación: pedido real, datos de pago y aviso al responsable ══
  r := public.cc_ia_pedido_confirmar(c1, d1);
  perform tests.ok((r ->> 'confirmado')::boolean and r ->> 'folio' is not null and r -> 'pago' ->> 'clabe' = '030000000000000001' and r -> 'pago' ->> 'referencia' = r ->> 'folio', '3 · pedido creado con folio y datos de pago (referencia = folio)');
  perform tests.ok((select doctor_id = d1 and shipping_meta ->> 'source' = 'cc_checkout' from public.orders where id = (r ->> 'order_id')::uuid), '3 · es un pedido del checkout canónico de ese doctor');
  perform tests.ok(exists (select 1 from public.notifications where kind = 'pedido_wa' and s1 = any (user_ids)), '3 · su vendedor se entera');
  perform tests.eq((public.cc_ia_pedido_confirmar(c1, d1) ->> 'motivo'), 'SIN_REVISION_VIGENTE', '3 · sin revisión vigente no se confirma otra vez');
  perform tests.ok(coalesce(current_setting('request.jwt.claim.sub', true), '') = '', '3 · "actuar como" no se queda puesto');
  perform tests.ok(not has_function_privilege('authenticated', 'public.cc_ia_pedido_confirmar(uuid,uuid)', 'EXECUTE') and not has_function_privilege('authenticated', 'public._cc_actuar_como(uuid)', 'EXECUTE'), '4 · solo el servidor');
end $t$;
rollback;
