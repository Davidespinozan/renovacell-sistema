-- ALTA-DESDE-CONVERSACIÓN (20270208) · foto de WhatsApp guardada con su mensaje; alta de cliente nuevo desde la
-- conversación (datos válidos, INE de esa persona, sin duplicar, cartera del vendedor, ligada) y autoridad.
begin;
\ir ../../../rollback/whatsapp_compuerta_abierta/99_down.sql
do $t$
declare v_admin uuid := tests.fixture_admin(); v_ale uuid := tests.user('pos'); v_otro uuid := tests.user('pos');
  c uuid; r jsonb; m_img uuid; m_img2 uuid; m_img3 uuid; m_txt uuid; a1 uuid; a2 uuid; cu uuid;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id in (v_ale, v_otro);
  insert into public.customers (full_name, email, phone, source, active, meta) values ('DRA EXISTENTE', 'existe@ejemplo.mx', '6670001111', 'odoo', true, '{"cedula":"9999999"}');
  perform tests.act_as_owner();
  alter table public.cc_wa_config disable trigger trg_cc_wa_config_guardia; update public.cc_wa_config set modo = 'activo', ia_habilitada = false, envio_pausado = false where id;
  perform tests.act_as_service();
  r := public.cc_wa_entrante('5216679990001', 'Ana', 'wamid.AL.1', 'Hola, quiero comprar', false); c := (r ->> 'conversation_id')::uuid; m_txt := (r ->> 'message_id')::uuid;
  r := public.cc_wa_entrante('5216679990001', 'Ana', 'wamid.AL.2', 'Envió una imagen por WhatsApp.', false); m_img := (r ->> 'message_id')::uuid;
  r := public.cc_wa_entrante('5216679990001', 'Ana', 'wamid.AL.3', 'Envió una imagen por WhatsApp. «reverso»', false); m_img2 := (r ->> 'message_id')::uuid;
  r := public.cc_wa_entrante('5216679990001', 'Ana', 'wamid.AL.4', 'Envió una imagen por WhatsApp.', false); m_img3 := (r ->> 'message_id')::uuid;

  -- 1 · la foto de WhatsApp se registra con SU mensaje: solo el servidor, solo imágenes de WhatsApp, ruta de esa conversación
  a1 := (public.cc_adjunto_registrar_wa(m_img, c || '/11111111-1111-4111-8111-111111111111.jpg', 'image/jpeg', 1000) ->> 'id')::uuid;
  a2 := (public.cc_adjunto_registrar_wa(m_img2, c || '/22222222-2222-4222-8222-222222222222.jpg', 'image/jpeg', 1000) ->> 'id')::uuid;
  perform tests.ok((public.cc_adjunto_registrar_wa(m_img, c || '/11111111-1111-4111-8111-111111111111.jpg', 'image/jpeg', 1000) ->> 'idempotente')::boolean, '1 · reintento idempotente');
  perform tests.throws(format('select public.cc_adjunto_registrar_wa(%L, %L, ''image/jpeg'', 10)', m_txt, c || '/33333333-3333-4333-8333-333333333333.jpg'), 'ADJUNTO_INVALIDO', '1 · un texto no lleva foto');
  perform tests.throws(format('select public.cc_adjunto_registrar_wa(%L, %L, ''image/jpeg'', 10)', m_img3, gen_random_uuid() || '/44444444-4444-4444-8444-444444444444.jpg'), 'ADJUNTO', '1 · ruta de otra conversación');
  perform tests.act_as(v_ale);
  perform tests.throws(format('select public.cc_adjunto_registrar_wa(%L, %L, ''image/jpeg'', 10)', m_img3, c || '/55555555-5555-4555-8555-555555555555.jpg'), 'permission denied', '1 · el personal no registra fotos a mano');

  -- 2 · autoridad: sin la conversación no se da de alta
  perform tests.act_as_service();
  perform public.cc_asignar_asesor(c, v_admin, v_ale);
  perform tests.act_as(v_otro);
  perform tests.throws(format('select public.cc_alta_cliente_conversacion(%L, ''Ana Gómez Ruiz'', ''12345678'')', c), 'NO_AUTORIZADO', '2 · otro vendedor no da de alta');

  -- 3 · validaciones y duplicados
  perform tests.act_as(v_ale);
  perform tests.throws(format('select public.cc_alta_cliente_conversacion(%L, ''Ana'', ''12345678'')', c), 'DATO_INVALIDO:nombre', '3 · nombre completo');
  perform tests.throws(format('select public.cc_alta_cliente_conversacion(%L, ''Ana Gómez'', ''123'')', c), 'DATO_INVALIDO:cedula', '3 · cédula de 7 u 8 dígitos');
  perform tests.throws(format('select public.cc_alta_cliente_conversacion(%L, ''Ana Gómez'', ''12345678'', ''no-es-correo'')', c), 'DATO_INVALIDO:email', '3 · correo válido');
  perform tests.throws(format('select public.cc_alta_cliente_conversacion(%L, ''Ana Gómez'', ''9999999'')', c), 'POSIBLE_DUPLICADO', '3 · cédula ya registrada: no se duplica');
  perform tests.throws(format('select public.cc_alta_cliente_conversacion(%L, ''Ana Gómez'', ''12345678'', ''EXISTE@ejemplo.mx'')', c), 'POSIBLE_DUPLICADO', '3 · correo ya registrado (sin importar mayúsculas)');
  perform tests.throws(format('select public.cc_alta_cliente_conversacion(%L, ''Ana Gómez'', ''12345678'', null, null, %L)', c, gen_random_uuid()), 'ADJUNTO_NO_ES_DEL_CLIENTE', '3 · INE de otra parte no');

  -- 4 · alta: ficha verificada con su WhatsApp, INE marcada, en la cartera de quien la atiende, ligada
  r := public.cc_alta_cliente_conversacion(c, '  Ana   Gómez Ruiz ', '1234-5678', 'Ana@Clinica.mx', 'Culiacán', a1, a2);
  cu := (r ->> 'customer_id')::uuid;
  perform tests.act_as_owner();
  perform tests.ok((select full_name = 'Ana Gómez Ruiz' and email = 'ana@clinica.mx' and phone = '6679990001' and source = 'conversacion' and meta ->> 'cedula' = '12345678' from public.customers where id = cu), '4 · ficha con datos limpios y su WhatsApp');
  perform tests.ok(exists (select 1 from public.customer_events e where e.customer_id = cu and e.tipo = 'verificacion_aprobada' and e.actor_profile_id = v_ale), '4 · verificación registrada por quien la hizo');
  perform tests.ok((select uso = 'ine-front' from public.cc_adjuntos where id = a1) and (select uso = 'ine-back' from public.cc_adjuntos where id = a2), '4 · INE frente y reverso marcadas');
  perform tests.ok((select seller_profile_id = v_ale from public.cc_cartera_clientes where customer_id = cu), '4 · en la cartera de quien la atiende');
  perform tests.ok((select customer_id = cu from public.cc_conversations where id = c), '4 · ligada a la conversación');
  perform tests.ok(exists (select 1 from public.customer_phones p where p.customer_id = cu and p.numero_norm = '6679990001'), '4 · su número quedó en la lista de teléfonos');
  perform tests.act_as(v_ale);
  perform tests.ok((public.cc_cliente_de_conversacion(c) ->> 'es_tuyo')::boolean, '4 · ya es su cliente: ve la ficha');
  perform tests.throws(format('select public.cc_alta_cliente_conversacion(%L, ''Ana Gómez'', ''87654321'')', c), 'YA_VINCULADA', '4 · no se da de alta dos veces');
  -- y puede invitarla (cliente sin cuenta de su cartera)
  perform tests.ok((public.cliente_invitacion_crear(cu) ->> 'token') is not null, '4 · su vendedora ya puede mandarle el acceso al portal');
end $t$;
rollback;
