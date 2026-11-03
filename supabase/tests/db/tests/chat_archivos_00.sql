-- CHAT-ARCHIVOS (20270324) · videos y documentos en Conversaciones: el servidor autoriza con las mismas reglas que un
-- mensaje, liga el archivo YA subido a su mensaje 'arc:' y nada de esto queda al alcance de la app. Las fotos no cambian.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos'); d1 uuid := tests.user('doctor'); d2 uuid := tests.user('doctor');
  conv uuid; m uuid; ruta text; r jsonb; ok boolean;
  pdf text := 'application/pdf';
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones"]}' where id in (s1, s2);
  insert into public.cc_cartera (profile_id, seller_profile_id) values (d1, s1);
  conv := (public.cc_abrir_conversacion(null, d1) ->> 'conversation_id')::uuid;
  perform tests.act_as_owner();
  update public.cc_conversations set seller_profile_id = s1 where id = conv;
  perform tests.ok(exists (select 1 from storage.buckets where id = 'chat_archivos' and not public and file_size_limit = 52428800 and 'video/mp4' = any (allowed_mime_types) and not 'image/jpeg' = any (allowed_mime_types)),
                   '0 · bucket privado de 50 MB solo para videos y documentos');
  perform tests.ok((select file_size_limit = 3000000 and allowed_mime_types = array['image/jpeg', 'image/png'] from storage.buckets where id = 'chat'), '0 · el de fotos no cambia');

  -- ══ 1 · autorizar: mismas reglas que escribir ══
  perform tests.act_as_service();
  r := public.cc_archivo_autorizar(conv, 'doctor', null, d1, pdf, 2000000);
  perform tests.ok((r ->> 'ok')::boolean and r ->> 'clase' = 'documento' and r -> 'canal' = 'null'::jsonb, '1 · el doctor dueño puede mandar un PDF (' || r::text || ')');
  perform tests.eq(public.cc_archivo_autorizar(conv, 'doctor', null, d1, 'video/mp4', 40000000) ->> 'clase', 'video', '1 · y un video de 40 MB');
  perform tests.throws(format('select public.cc_archivo_autorizar(%L, ''doctor'', null, %L, %L, 1000)', conv, d2, pdf), 'NO_AUTORIZADO', '1 · otro doctor no');
  perform tests.throws(format('select public.cc_archivo_autorizar(%L, ''seller'', null, %L, %L, 1000)', conv, s1, pdf), 'ASESORIA_NO_INICIADA', '1 · el asesor, solo con la asesoría iniciada');
  perform tests.throws(format('select public.cc_archivo_autorizar(%L, ''seller'', null, %L, %L, 1000)', conv, s2, pdf), 'NO_AUTORIZADO', '1 · otro vendedor no');
  perform tests.throws(format('select public.cc_archivo_autorizar(%L, ''doctor'', null, %L, ''application/x-msdownload'', 1000)', conv, d1), 'ARCHIVO_TIPO', '1 · un ejecutable no');
  perform tests.throws(format('select public.cc_archivo_autorizar(%L, ''doctor'', null, %L, ''image/jpeg'', 1000)', conv, d1), 'ARCHIVO_TIPO', '1 · las fotos van por su camino de siempre');
  perform tests.throws(format('select public.cc_archivo_autorizar(%L, ''doctor'', null, %L, %L, 60000000)', conv, d1, pdf), 'ARCHIVO_TAMANO', '1 · más de 50 MB no');
  perform tests.act_as_owner();
  update public.cc_conversations set modo = 'human_active' where id = conv;
  perform tests.act_as_service();
  perform tests.eq(public.cc_archivo_autorizar(conv, 'seller', null, s1, pdf, 1000) ->> 'ok', 'true', '1 · con la asesoría iniciada, el asesor sí');
  perform tests.eq(public.cc_archivo_autorizar(conv, 'admin', null, v_admin, pdf, 1000) ->> 'ok', 'true', '1 · Dirección también');

  -- ══ 2 · registrar: el archivo subido va con SU mensaje ══
  ruta := conv || '/' || gen_random_uuid() || '.pdf';
  m := (public.cc_enviar_mensaje(conv, 'doctor', null, d1, 'arc:' || gen_random_uuid(), 'Envió un documento: Ficha técnica.pdf.') ->> 'id')::uuid;
  perform tests.throws(format('select public.cc_archivo_registrar(%L, %L, %L, 1000, ''Ficha técnica.pdf'')', m, ruta, pdf), 'ARCHIVO_INEXISTENTE', '2 · sin archivo subido no se registra');
  perform tests.act_as_owner();
  insert into storage.objects (bucket_id, name) values ('chat_archivos', ruta);
  perform tests.act_as_service();
  r := public.cc_archivo_registrar(m, ruta, pdf, 1000, '  Ficha técnica.pdf ');
  perform tests.ok(not (r ->> 'idempotente')::boolean and (select clase = 'documento' and nombre = 'Ficha técnica.pdf' from public.cc_archivos where message_id = m), '2 · registrado, con su clase y su nombre');
  perform tests.ok((public.cc_archivo_registrar(m, ruta, pdf, 1000, 'x') ->> 'idempotente')::boolean, '2 · reintento: idempotente');
  m := (public.cc_enviar_mensaje(conv, 'doctor', null, d1, 'c:' || gen_random_uuid(), 'texto normal') ->> 'id')::uuid;
  perform tests.throws(format('select public.cc_archivo_registrar(%L, %L, %L, 1000, ''a.pdf'')', m, ruta, pdf), 'ARCHIVO_INVALIDO', '2 · un mensaje normal no lleva archivo');
  m := (public.cc_enviar_mensaje(conv, 'doctor', null, d1, 'arc:' || gen_random_uuid(), 'Envió un video.') ->> 'id')::uuid;
  perform tests.throws(format('select public.cc_archivo_registrar(%L, %L, ''video/mp4'', 1000, ''v.mp4'')', m, gen_random_uuid() || '/' || gen_random_uuid() || '.mp4'), 'ARCHIVO_INVALIDO', '2 · ni con la ruta de otra conversación');

  -- ══ 3 · Instagram/Messenger: solo texto y fotos ══
  perform tests.act_as_owner();
  insert into public.cc_meta_contactos (canal, psid, profile_id) values ('instagram', '1234567', d1);
  perform tests.act_as_service();
  perform tests.throws(format('select public.cc_archivo_autorizar(%L, ''doctor'', null, %L, %L, 1000)', conv, d1, pdf), 'ARCHIVO_CANAL', '3 · por Instagram no salen archivos');
  perform tests.act_as_owner();
  delete from public.cc_meta_contactos where psid = '1234567';
  update public.cc_conversations set estado = 'cerrada', closed_at = now() where id = conv;
  perform tests.act_as_service();
  perform tests.throws(format('select public.cc_archivo_autorizar(%L, ''doctor'', null, %L, %L, 1000)', conv, d1, pdf), 'CONVERSACION_CERRADA', '3 · conversación cerrada: no');

  -- ══ 4 · nada al alcance de la app ══
  perform tests.act_as(d1);
  perform tests.throws(format('select public.cc_archivo_autorizar(%L, ''doctor'', null, %L, %L, 1000)', conv, d1, pdf), 'permission denied', '4 · la app no autoriza por su cuenta');
  perform tests.throws(format('select public.cc_archivo_registrar(%L, %L, %L, 1000, ''a'')', m, ruta, pdf), 'permission denied', '4 · ni registra');
  perform tests.throws('select count(*) from public.cc_archivos', 'permission denied', '4 · ni lee la tabla');
  perform tests.eq((select count(*)::int from storage.objects where bucket_id = 'chat_archivos'), 0, '4 · ni ve los archivos en el almacenamiento');
end $t$;
rollback;
