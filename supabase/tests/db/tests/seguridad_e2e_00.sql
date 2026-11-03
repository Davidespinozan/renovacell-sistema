-- SEGURIDAD-E2E (20270318) · cada ataque de la auditoría se reproduce y se rechaza; lo legítimo sigue funcionando.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); d1 uuid := tests.user('doctor'); d2 uuid := tests.user('doctor'); s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos');
  v_bill uuid := tests.user('billing'); p uuid; o1 uuid; o2 uuid; l uuid; r jsonb; ok boolean; u uuid := gen_random_uuid(); cu1 uuid;
  rec jsonb := '{"rfc":"XAXX010101AB1","razon_social":"CLINICA PRUEBA","regimen":"601","cp":"80000","uso_cfdi":"G03","email_facturacion":"fact@prueba.mx"}';
begin
  perform tests.act_as_owner();
  p := tests.product(1000);
  cu1 := tests.cliente(d1);
  o1 := gen_random_uuid();   -- como lo crea el portal: con su ficha de cliente desde el inicio
  insert into public.orders (id, external_ref, doctor_id, customer_id, total, status, payment_method, payment_status, shipping_meta)
  values (o1, 'SSE001', d1, cu1, 2000, 'pending_payment', 'transferencia', 'pending', '{"entrega":{"opcion":"recoge","tipo":"recoge","flete":0}}');
  insert into public.order_items (order_id, product_id, qty, unit_price) values (o1, p, 2, 1000);
  o2 := tests.order(d2, 'pending_payment', jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1, 'unit_price', 1000)), 'pending', null, 'SSE002');
  insert into public.cc_cartera (profile_id, seller_profile_id) values (d1, s1);
  insert into public.cc_cartera_clientes (customer_id, seller_profile_id) values (cu1, s1) on conflict do nothing;

  -- ══ P1-1 · el doctor no reescribe la entrega de su pedido ══
  perform tests.act_as(d1);
  begin update public.orders set shipping_meta = jsonb_set(shipping_meta, '{entrega,opcion}', '"foraneo_dhl"') where id = o1; ok := false; exception when insufficient_privilege then ok := sqlerrm like 'ENTREGA_SOLO_POR_COMANDO%'; end;
  perform tests.ok(ok, 'P1-1 · un doctor no cambia "recoger" por "envío" en su pedido');
  perform tests.act_as_owner();
  perform tests.ok((select shipping_meta -> 'entrega' ->> 'opcion' = 'recoge' from public.orders where id = o1), 'P1-1 · la entrega sigue como se vendió');

  -- ══ P1-2 · link de pago ══
  perform tests.act_as(d1); l := (public.link_pago_solicitar(o1) ->> 'id')::uuid;
  perform tests.act_as(s2);
  begin perform public.link_pago_enviar(l, 'https://pagos.bb.com.mx/x'); ok := false; exception when insufficient_privilege then ok := true; end;
  perform tests.ok(ok, 'P1-2 · otro vendedor no pone el link del cliente de alguien más');
  perform tests.act_as(s1);
  r := public.link_pago_enviar(l, 'https://bajio.estafa.com/pagar');
  perform tests.ok(not (r ->> 'banbajio')::boolean, 'P1-2 · bajio.estafa.com NO pasa por BanBajío');
  r := public.link_pago_enviar(l, 'https://pagos.bb.com.mx/link/abc');
  perform tests.ok((r ->> 'banbajio')::boolean, 'P1-2 · el dominio real del banco sí');
  perform tests.act_as(s2);
  begin perform public.link_pago_cancelar(l, 'x'); ok := false; exception when insufficient_privilege then ok := true; end;
  perform tests.ok(ok, 'P1-2 · otro vendedor no lo cancela');
  perform tests.act_as(v_bill);
  perform tests.ok((public.link_pago_cancelar(l, 'cliente pidió transferencia') ->> 'estado') = 'cancelado', 'P1-2 · Facturación sí');

  -- ══ P1-3 · FISCAL-1 ══
  perform tests.act_as(s2);
  begin perform public.solicitar_cfdi(u, o2, rec); ok := false; exception when others then ok := sqlerrm like 'NO_AUTORIZADO%'; end;
  perform tests.ok(ok, 'P1-3 · un vendedor no solicita factura de un pedido que no es suyo');
  begin perform public.set_order_fiscal_snapshot(o2, rec); ok := false; exception when others then ok := sqlerrm like 'NO_AUTORIZADO%'; end;
  perform tests.ok(ok, 'P1-3 · ni cambia el receptor fiscal');
  perform tests.act_as(v_bill);
  perform public.solicitar_cfdi(gen_random_uuid(), o2, rec);
  perform tests.ok(exists (select 1 from public.fiscal_documents where order_id = o2), 'P1-3 · Facturación sí');

  -- ══ P2 · alta directa de perfil ══
  perform tests.act_as_owner();
  perform tests.ok(exists (select 1 from pg_trigger where tgname = 'profiles_insert_guard'), 'P2 · guarda de alta de perfil');
  perform tests.ok((select allowed_mime_types = array['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif'] and file_size_limit = 10485760 from storage.buckets where id = 'media'), 'P2 · media: solo imágenes, 10 MB');
end $t$;
rollback;

-- P2 · un usuario autenticado SIN perfil que inserta el suyo como Dirección queda como doctor sin verificar.
begin;
do $t$ declare u uuid := gen_random_uuid(); begin
  insert into auth.users (id, email) values (u, 'sinperfil@test.local');
  delete from public.profiles where id = u;
  perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);
end $t$;
set local role authenticated;
insert into public.profiles (id, email, role_id, verified, meta) select (current_setting('request.jwt.claims')::jsonb ->> 'sub')::uuid, 'sinperfil@test.local', 'admin', true, '{"capabilities":["jefe_ventas"]}';
reset role;
do $t$ begin
  perform tests.ok((select role_id = 'doctor' and not verified and not (meta ? 'capabilities') from public.profiles where email = 'sinperfil@test.local'), 'P2 · el perfil queda como doctor sin verificar y sin capacidades');
end $t$;
rollback;
