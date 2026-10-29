-- PAGO-DESDE-CONVERSACIÓN (20270210) · el vendedor de la ficha reporta el pago del cliente con la foto que el cliente
-- mandó en su conversación; queda en revisión para Dirección (no toca el libro); autoridad, foto y reglas de dinero.
begin;
\ir ../../../rollback/whatsapp_compuerta_abierta/99_down.sql
do $t$
declare v_admin uuid := tests.fixture_admin(); v_ale uuid := tests.user('pos'); v_otro uuid := tests.user('pos');
  c uuid; c2 uuid; r jsonb; m_img uuid; m_img2 uuid; m_otra uuid; a1 uuid; a2 uuid; a_otra uuid; cu uuid; cu2 uuid; p uuid; o uuid; o2 uuid;
  ruta text; entradas int; claim uuid; op uuid := gen_random_uuid();
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones"]}' where id in (v_ale, v_otro);
  insert into public.customers (full_name, phone, source, active) values ('LOURDES VELAZQUEZ', '6670002222', 'odoo', true) returning id into cu;
  insert into public.customers (full_name, phone, source, active) values ('OTRA CLIENTA', '6670003333', 'odoo', true) returning id into cu2;
  insert into public.cc_cartera_clientes (customer_id, seller_profile_id, motivo) values (cu, v_ale, 'Odoo'), (cu2, v_otro, 'Odoo');
  p := tests.producto_fam('Toxinas', 'Dysport', 1000);
  perform tests.act_as_owner();
  alter table public.cc_wa_config disable trigger trg_cc_wa_config_guardia; update public.cc_wa_config set modo = 'activo', ia_habilitada = false, envio_pausado = false where id;
  perform tests.act_as_service();
  r := public.cc_wa_entrante('5216670002222', 'Lourdes', 'wamid.PG.1', 'Hola, ya le deposité', false); c := (r ->> 'conversation_id')::uuid;
  r := public.cc_wa_entrante('5216670002222', 'Lourdes', 'wamid.PG.2', 'Envió una imagen por WhatsApp.', false); m_img := (r ->> 'message_id')::uuid;
  r := public.cc_wa_entrante('5216670002222', 'Lourdes', 'wamid.PG.3', 'Envió una imagen por WhatsApp.', false); m_img2 := (r ->> 'message_id')::uuid;
  r := public.cc_wa_entrante('5216670009999', 'Otra', 'wamid.PG.4', 'Envió una imagen por WhatsApp.', false); c2 := (r ->> 'conversation_id')::uuid; m_otra := (r ->> 'message_id')::uuid;
  a1 := (public.cc_adjunto_registrar_wa(m_img, c || '/11111111-1111-4111-8111-111111111111.jpg', 'image/jpeg', 1000) ->> 'id')::uuid;
  a2 := (public.cc_adjunto_registrar_wa(m_img2, c || '/22222222-2222-4222-8222-222222222222.png', 'image/png', 1000) ->> 'id')::uuid;
  a_otra := (public.cc_adjunto_registrar_wa(m_otra, c2 || '/33333333-3333-4333-8333-333333333333.jpg', 'image/jpeg', 1000) ->> 'id')::uuid;
  perform public.cc_asignar_asesor(c, v_admin, v_ale);
  perform tests.act_as(v_ale);
  perform public.cc_vincular_cliente(c, cu, false);
  o := (public.crear_pedido(gen_random_uuid(), null, null, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 2)), null, false, cu) ->> 'order_id')::uuid;
  perform tests.act_as(v_otro);
  o2 := (public.crear_pedido(gen_random_uuid(), null, null, jsonb_build_array(jsonb_build_object('product_id', p, 'qty', 1)), null, false, cu2) ->> 'order_id')::uuid;
  entradas := (select count(*) from public.payment_entries);

  -- 1 · preparar: su vendedor sí y recibe la ruta fija; otro vendedor, pedido de otra ficha o foto ajena no
  perform tests.act_as(v_ale);
  r := public.cc_pago_comprobante_preparar(o, a1);
  ruta := r ->> 'ruta_comprobante';
  perform tests.ok(ruta = 'transfers/' || o || '/chat-' || a1 || '.jpg' and r ->> 'ruta_chat' = c || '/11111111-1111-4111-8111-111111111111.jpg', '1 · ruta fija por foto');
  perform tests.ok(public.cc_pago_comprobante_preparar(o, a2) ->> 'ruta_comprobante' like '%.png', '1 · respeta la extensión');
  perform tests.throws(format('select public.cc_pago_comprobante_preparar(%L, %L)', o2, a1), 'NO_AUTORIZADO', '1 · pedido de un cliente que no es suyo');
  perform tests.throws(format('select public.cc_pago_comprobante_preparar(%L, %L)', o, a_otra), 'ADJUNTO_NO_ES_DEL_CLIENTE', '1 · foto de otra conversación');
  perform tests.act_as(v_otro);
  perform tests.throws(format('select public.cc_pago_comprobante_preparar(%L, %L)', o, a1), 'NO_AUTORIZADO', '1 · otro vendedor no');

  -- 2 · reportar: reglas de dinero y de la foto
  perform tests.act_as(v_ale);
  perform tests.throws(format('select public.cc_reportar_pago_cliente(gen_random_uuid(), %L, ''transferencia'', 100, null, %L, ''transfers/x.jpg'')', o, a1), 'COMPROBANTE_INVALIDO', '2 · la ruta tiene que ser la de esa foto');
  perform tests.throws(format('select public.cc_reportar_pago_cliente(gen_random_uuid(), %L, ''transferencia'', 5000, null, %L, %L)', o, a1, ruta), 'MONTO_MAYOR_AL_SALDO', '2 · no más que el saldo');
  perform tests.throws(format('select public.cc_reportar_pago_cliente(gen_random_uuid(), %L, ''stripe'', 100, null, %L, %L)', o, a1, ruta), 'METODO_INVALIDO', '2 · método válido');
  r := public.cc_reportar_pago_cliente(op, o, 'transferencia', 2000, 'SPEI 123', a1, ruta);
  claim := (r ->> 'claim_id')::uuid;
  perform tests.ok(r ->> 'status' = 'applied', '2 · reportado');
  perform tests.ok((public.cc_reportar_pago_cliente(op, o, 'transferencia', 2000, 'SPEI 123', a1, ruta) ->> 'status') = 'already_applied', '2 · reintento idempotente');
  perform tests.ok((select status = 'reportado' and declared_by = v_ale and proof_path = ruta and amount_declared = 2000 from public.payment_claims where id = claim), '2 · declaración en revisión con su comprobante');
  perform tests.eq((select count(*)::int from public.payment_entries), entradas, '2 · NO toca el libro');
  perform tests.throws(format('select public.cc_reportar_pago_cliente(gen_random_uuid(), %L, ''transferencia'', 100, null, %L, %L)', o, a2, public.cc_pago_comprobante_preparar(o, a2) ->> 'ruta_comprobante'), 'DECLARACION_ABIERTA', '2 · una declaración abierta por pedido');
  perform tests.throws(format('select public.reportar_pago(gen_random_uuid(), %L, ''transferencia'', 100)', o), 'NO_AUTORIZADO', '2 · la vía general sigue cerrada para el vendedor (D-SECB-1)');

  -- 3 · pedidos del cliente en la conversación: en revisión; tras validar Dirección, saldo 0 y último pago
  r := public.cc_cliente_pedidos(c);
  perform tests.ok(jsonb_array_length(r) = 1 and (r -> 0 ->> 'en_revision')::boolean and (r -> 0 ->> 'saldo')::numeric = 2000, '3 · su pedido, en revisión');
  perform tests.act_as(v_otro);
  perform tests.throws(format('select public.cc_cliente_pedidos(%L)', c), 'NO_AUTORIZADO', '3 · otro vendedor no');
  perform tests.act_as(v_admin);
  perform public.revisar_pago(gen_random_uuid(), claim, 'verificar');
  r := public.cc_cliente_pedidos(c);
  perform tests.ok((r -> 0 ->> 'saldo')::numeric = 0 and not (r -> 0 ->> 'en_revision')::boolean and (r -> 0 -> 'ultimo_pago' ->> 'monto')::numeric = 2000, '3 · validado: saldo 0 y último pago');
  perform tests.act_as(v_ale);
  perform tests.throws(format('select public.cc_reportar_pago_cliente(gen_random_uuid(), %L, ''transferencia'', 100, null, %L, %L)', o, a1, ruta), 'SIN_SALDO', '3 · ya sin saldo');
end $t$;
rollback;
