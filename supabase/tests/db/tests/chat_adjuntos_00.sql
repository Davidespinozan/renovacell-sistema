-- FOTOS EN EL CHAT (157) · la imagen va con su mensaje normal; solo el servidor registra; "usar como INE" solo con
-- una foto del propio doctor y por quien puede verificarlo; el bucket es privado.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); s1 uuid := tests.user('pos'); sOtro uuid := tests.user('pos'); d1 uuid := tests.user('doctor'); conv uuid; r jsonb; mDoc uuid; mVend uuid; mTxt uuid; aDoc uuid; aVend uuid;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id in (s1, sOtro);
  update public.profiles set verified = false where id = d1;
  insert into public.cc_cartera (profile_id, seller_profile_id) values (d1, s1);
  conv := (public.cc_abrir_conversacion(null, d1) ->> 'conversation_id')::uuid;
  perform tests.ok((select not public and file_size_limit = 3000000 and allowed_mime_types = array['image/jpeg', 'image/png'] from storage.buckets where id = 'chat'), '1 · bucket chat privado, 3 MB, solo JPG/PNG');
  mDoc := (public.cc_enviar_mensaje(conv, 'doctor', null, d1, 'img:' || gen_random_uuid(), 'Envió una imagen.') ->> 'id')::uuid;
  mTxt := (public.cc_enviar_mensaje(conv, 'doctor', null, d1, 'c:texto', 'Hola') ->> 'id')::uuid;
  r := public.cc_adjunto_registrar(mDoc, conv || '/' || gen_random_uuid() || '.jpg', 'image/jpeg', 1200);
  aDoc := (r ->> 'id')::uuid;
  perform tests.eq((r ->> 'idempotente')::boolean, false, '2 · la imagen queda ligada a su mensaje');
  perform tests.eq((public.cc_adjunto_registrar(mDoc, conv || '/' || gen_random_uuid() || '.jpg', 'image/jpeg', 1200) ->> 'idempotente')::boolean, true, '2 · reintentar no duplica');
  perform tests.throws(format('select public.cc_adjunto_registrar(%L, %L, %L, 10)', mTxt, conv || '/' || gen_random_uuid() || '.jpg', 'image/jpeg'), 'ADJUNTO_INVALIDO', '2 · un mensaje de texto no lleva imagen');
  perform tests.throws(format('select public.cc_adjunto_registrar(%L, %L, %L, 10)', (public.cc_enviar_mensaje(conv, 'doctor', null, d1, 'img:x2', 'Envió una imagen.') ->> 'id'), gen_random_uuid() || '/' || gen_random_uuid() || '.jpg', 'image/jpeg'), 'ADJUNTO_INVALIDO', '2 · la ruta debe ser de SU conversación');
  perform tests.throws(format('select public.cc_adjunto_registrar(%L, %L, %L, 10)', (public.cc_enviar_mensaje(conv, 'doctor', null, d1, 'img:x3', 'Envió una imagen.') ->> 'id'), conv || '/x.gif', 'image/gif'), 'check constraint', '2 · solo JPG/PNG con ruta válida');

  -- foto del asesor (no sirve como INE del doctor)
  perform public.cc_solicitar_asesor(conv, 'doctor', null, d1);
  perform public.cc_iniciar_asesoria(conv, s1);
  mVend := (public.cc_enviar_mensaje(conv, 'seller', null, s1, 'img:' || gen_random_uuid(), 'Envió una imagen.') ->> 'id')::uuid;
  aVend := (public.cc_adjunto_registrar(mVend, conv || '/' || gen_random_uuid() || '.png', 'image/png', 900) ->> 'id')::uuid;

  -- usar como INE
  perform tests.act_as(s1);
  r := public.cc_adjunto_para_verificacion(aDoc);
  perform tests.ok((r ->> 'profile_id')::uuid = d1 and r ->> 'ruta' like conv || '/%', '3 · su vendedor puede usar la foto del doctor como INE');
  perform tests.throws(format('select public.cc_adjunto_para_verificacion(%L)', aVend), 'ADJUNTO_NO_ES_DEL_DOCTOR', '3 · una foto del asesor no es identificación del doctor');
  perform tests.act_as(sOtro);
  perform tests.throws(format('select public.cc_adjunto_para_verificacion(%L)', aDoc), 'NO_AUTORIZADO', '3 · un vendedor que no lo atiende, no');
  perform tests.act_as(d1);
  perform tests.throws(format('select public.cc_adjunto_para_verificacion(%L)', aDoc), 'NO_AUTORIZADO', '3 · el doctor no se verifica solo');
  perform tests.throws('select count(*) from public.cc_adjuntos', 'permission denied', '4 · la tabla no se lee directo');
  perform tests.throws(format('select public.cc_adjunto_registrar(%L, %L, %L, 10)', mDoc, conv || '/' || gen_random_uuid() || '.jpg', 'image/jpeg'), 'permission denied', '4 · una sesión no registra adjuntos');
  perform tests.act_as_anon();
  perform tests.throws(format('select public.cc_adjunto_para_verificacion(%L)', aDoc), 'permission denied', '4 · anónimo no');
  perform tests.act_as_service();
  perform public.cc_adjunto_marcar_uso(aDoc, 'ine-front', s1);
  perform tests.ok((select uso = 'ine-front' and usado_por = s1 from public.cc_adjuntos where id = aDoc), '5 · queda constancia de que se usó como INE');
  perform tests.ok((select content = 'Envió una imagen.' from public.cc_messages where id = mDoc), '5 · el mensaje sigue siendo un mensaje normal (lectura, IA y sesiones sin cambios)');
end $t$;
rollback;
