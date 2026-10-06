-- CC-2 · Adopción (CC-1) integrada: la conversación del visitante conserva su id, el perfil se
-- vuelve dueño, los mensajes históricos no cambian de actor, asesor/atribución/prospecto se
-- preservan, consolidación cuando el perfil ya tenía una abierta, todo en la misma transacción.
begin;
do $t$
declare
  v_doc uuid := tests.user('doctor'); v_doc2 uuid := tests.user('doctor'); v_pos uuid := tests.user('pos');
  hA text := repeat('a', 64); hB text := repeat('b', 64); hC text := repeat('c', 64);
  vidA uuid; vidB uuid; vidC uuid; cA uuid; cB uuid; cC uuid; cD uuid; r jsonb; pA uuid; hash2 text;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta,'{}') || '{"capabilities":["conversaciones"]}', verified = false where id = v_pos;
  update public.profiles set verified = false where id in (v_doc, v_doc2);
  vidA := (public.cc_visitante_abrir(null, hA, '{"utm_source":"google"}'::jsonb, null) ->> 'visitor_id')::uuid;
  cA := (public.cc_abrir_conversacion(hA, null) ->> 'conversation_id')::uuid;
  perform public.cc_enviar_mensaje(cA, 'visitor', hA, null, 'c:1', 'Hola como visitante');
  perform public.cc_enviar_mensaje(cA, 'ai', null, null, 'ai:1', 'Hola, ¿en qué te ayudo?');
  insert into public.prospects (name, email, source, status) values ('Ana', 'ana@x.mx', 'Landing', 'nuevo') returning id into pA;
  perform public.cc_visitante_prospecto(hA, pA);
  perform public.cc_solicitar_asesor(cA, 'visitor', hA, null);
  perform public.cc_asignar_asesor(cA, v_pos, v_pos);

  -- ══ 16 · adoptar conserva conversation_id y todo lo demás ═══════════════
  r := public.cc_visitante_adoptar(hA, v_doc);
  perform tests.eq(r ->> 'estado', 'adoptado', 'adoptado');
  perform tests.eq((r ->> 'conversaciones')::int, 1, 'una conversación adoptada en la misma transacción');
  perform tests.act_as_owner();
  perform tests.eq((select profile_id from public.cc_conversations where id = cA), v_doc, '16 · la MISMA conversación ahora es del doctor');
  perform tests.eq((select visitor_id from public.cc_conversations where id = cA), vidA, 'el visitante sigue como procedencia');
  perform tests.eq((select seller_profile_id from public.cc_conversations where id = cA), v_pos, 'el asesor asignado se preserva');
  perform tests.eq((select modo from public.cc_conversations where id = cA), 'human_assigned', 'el modo se preserva');
  perform tests.eq((select actor_type from public.cc_messages where client_message_id = 'c:1'), 'visitor', '17 · el mensaje histórico sigue siendo del visitante (no se reescribe)');
  perform tests.eq((select actor_visitor_id from public.cc_messages where client_message_id = 'c:1'), vidA, '17 · con su procedencia');
  perform tests.eq((select visitor_id from public.prospects where id = pA), vidA, 'el prospecto sigue ligado');
  perform tests.eq((select first_touch ->> 'utm_source' from public.cc_visitors where id = vidA), 'google', 'la atribución se preserva');
  perform tests.eq((select count(*)::int from public.cc_participants where conversation_id = cA and profile_id = v_doc and rol = 'dueno'), 1, 'el perfil se incorpora como dueño');
  perform tests.eq((select count(*)::int from public.cc_participants where conversation_id = cA and visitor_id = vidA), 1, 'el visitante se conserva como participante histórico');
  perform tests.eq((select count(*)::int from public.cc_conversation_events where conversation_id = cA and tipo = 'visitor_adopted'), 1, 'evento visitor_adopted');
  perform tests.act_as_service();
  -- el doctor continúa el MISMO hilo; el token viejo ya no sirve
  perform tests.eq((public.cc_abrir_conversacion(null, v_doc) ->> 'conversation_id')::uuid, cA, '14 · el doctor abre y le toca el mismo id');
  r := public.cc_enviar_mensaje(cA, 'doctor', null, v_doc, 'd:1', 'Ya me registré');
  perform tests.eq((r ->> 'seq')::int, 4, 'el doctor escribe en el mismo hilo (seq 4 tras sistema)');
  perform tests.throws(format('select public.cc_enviar_mensaje(%L, ''visitor'', %L, null, null, ''x'')', cA, hA), 'SESION_INVALIDA', 'el token de visitante ya no sirve (rotado al adoptar)');
  perform tests.throws(format('select public.cc_leer_conversacion(%L, ''doctor'', null, %L)', cA, v_doc2), 'NO_AUTORIZADO', '4 · otro doctor no la lee');

  -- ══ consolidación: el perfil ya tenía una abierta ═══════════════════════
  vidB := (public.cc_visitante_abrir(null, hB, '{}'::jsonb, null) ->> 'visitor_id')::uuid;
  cB := (public.cc_abrir_conversacion(hB, null) ->> 'conversation_id')::uuid;
  perform public.cc_enviar_mensaje(cB, 'visitor', hB, null, 'b:1', 'Desde otro dispositivo');
  r := public.cc_visitante_adoptar(hB, v_doc);
  perform tests.eq(r ->> 'estado', 'adoptado', 'segundo dispositivo adoptado');
  perform tests.act_as_owner();
  perform tests.eq((select estado from public.cc_conversations where id = cA), 'abierta', 'la conversación activa del doctor sigue abierta');
  perform tests.eq((select estado from public.cc_conversations where id = cB), 'cerrada', 'la del segundo dispositivo se consolida (cerrada, no borrada)');
  perform tests.eq((select profile_id from public.cc_conversations where id = cB), v_doc, 'pero queda ligada al doctor (historial suyo)');
  perform tests.eq((select count(*)::int from public.cc_messages where conversation_id = cB), 1, 'sus mensajes se conservan');
  perform tests.ok(exists (select 1 from public.cc_conversation_events where conversation_id = cB and tipo = 'conversation_closed' and detalle ->> 'motivo' = 'consolidada'), 'evento de consolidación con el id destino');
  perform tests.eq((select count(*)::int from public.cc_conversations where profile_id = v_doc and estado = 'abierta'), 1, 'una sola abierta por perfil');
  perform tests.act_as_service();

  -- ══ adopción por vínculo del registro (sin token) también arrastra la conversación ═
  vidC := (public.cc_visitante_abrir(null, hC, '{}'::jsonb, null) ->> 'visitor_id')::uuid;
  cC := (public.cc_abrir_conversacion(hC, null) ->> 'conversation_id')::uuid;
  perform public.cc_enviar_mensaje(cC, 'visitor', hC, null, 'x:1', 'Me voy a registrar');
  perform tests.ok(public.cc_visitante_vincular_registro(hC, v_doc2), 'registro vincula');
  r := public.cc_visitante_adoptar(null, v_doc2);
  perform tests.eq((r ->> 'conversaciones')::int, 1, 'adopción diferida arrastra la conversación');
  perform tests.act_as_owner();
  perform tests.eq((select profile_id from public.cc_conversations where id = cC), v_doc2, 'conversación del visitante C → doctor 2');
  perform tests.act_as_service();
  perform tests.eq((public.cc_abrir_conversacion(null, v_doc2) ->> 'conversation_id')::uuid, cC, 'el doctor 2 continúa el hilo que empezó como visitante');

  -- ══ E · mismo correo que el prospecto no da acceso a nada ════════════════
  update public.profiles set email = 'ana@x.mx' where id = v_doc2;
  perform tests.throws(format('select public.cc_leer_conversacion(%L, ''doctor'', null, %L)', cA, v_doc2), 'NO_AUTORIZADO', '18 · correo igual al prospecto de A: sin acceso a la conversación de A');

  -- ══ la purga de visitantes nunca toca uno con conversación ══════════════
  perform tests.act_as_owner();
  update public.cc_visitors set last_seen_at = now() - interval '200 days' where id in (vidA, vidB, vidC);
  perform tests.act_as_service();
  perform tests.eq(public.cc_visitantes_purgar(90), 0, 'purga: 0 (todos tienen conversación o están adoptados)');
end $t$;
rollback;
