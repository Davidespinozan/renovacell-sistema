-- CC-2 · Conversación canónica: abrir/reanudar por posesión o perfil, una abierta por dueño,
-- mensajes append-only con actor fijado por el servidor, idempotencia, frontera de contenido,
-- autoridad por actor (visitante/doctor/asesor/Dirección), lectura, read state.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); v_doc uuid := tests.user('doctor'); v_doc2 uuid := tests.user('doctor');
  v_pos uuid := tests.user('pos'); v_pos_sin uuid := tests.user('pos'); v_wh uuid := tests.user('warehouse');
  hA text := repeat('a', 64); hB text := repeat('b', 64); hX text := repeat('e', 64);
  vidA uuid; vidB uuid; cA uuid; cB uuid; cD uuid; r jsonb; m1 jsonb; m2 jsonb; n int; lect jsonb;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta,'{}') || '{"capabilities":["conversaciones"]}' where id = v_pos;   -- vendedor que atiende
  vidA := (public.cc_visitante_abrir(null, hA, '{"utm_source":"google"}'::jsonb, null) ->> 'visitor_id')::uuid;
  vidB := (public.cc_visitante_abrir(null, hB, '{}'::jsonb, null) ->> 'visitor_id')::uuid;

  -- ══ privilegios: ningún cliente ejecuta comandos ni escribe tablas ══════
  perform tests.act_as_anon();
  perform tests.throws('select count(*) from public.cc_conversations', 'permission denied', '24 · anon no enumera conversaciones');
  perform tests.throws('select count(*) from public.cc_messages', 'permission denied', 'anon no lee mensajes');
  perform tests.throws(format('select public.cc_abrir_conversacion(%L, null)', hA), 'permission denied', 'anon no invoca comandos');
  perform tests.act_as(v_doc);
  perform tests.throws(format('select public.cc_enviar_mensaje(gen_random_uuid(), ''admin'', null, %L, null, ''x'')', v_doc), 'permission denied', '8/9 · authenticated no invoca cc_enviar_mensaje (ni como admin ni como ai)');
  perform tests.throws('insert into public.cc_messages (conversation_id, seq, actor_type, content, content_hash) values (gen_random_uuid(), 1, ''ai'', ''x'', ''y'')', 'permission denied', '9 · authenticated no inserta mensajes directos');
  perform tests.act_as_service();

  -- ══ abrir: visitante → una abierta; reanudar devuelve la misma ═══════════
  r := public.cc_abrir_conversacion(hA, null);
  cA := (r ->> 'conversation_id')::uuid;
  perform tests.eq((r ->> 'nuevo')::boolean, true, 'visitante A abre (nueva)');
  perform tests.eq(r ->> 'modo', 'ai_active', 'modo inicial ai_active');
  r := public.cc_abrir_conversacion(hA, null);
  perform tests.eq((r ->> 'conversation_id')::uuid, cA, 'C1 · reanudar devuelve el MISMO id');
  perform tests.eq((r ->> 'nuevo')::boolean, false, 'no es nueva');
  perform tests.throws(format('select public.cc_abrir_conversacion(%L, null)', hX), 'SESION_INVALIDA', '1 · token inventado no abre (sin revelar nada)');
  cB := (public.cc_abrir_conversacion(hB, null) ->> 'conversation_id')::uuid;
  perform tests.ok(cB <> cA, 'otro visitante → otra conversación');
  -- doctor
  r := public.cc_abrir_conversacion(null, v_doc);
  cD := (r ->> 'conversation_id')::uuid;
  perform tests.eq((public.cc_abrir_conversacion(null, v_doc) ->> 'conversation_id')::uuid, cD, 'doctor: una abierta, reanuda la misma');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.cc_conversation_events where conversation_id = cA and tipo = 'conversation_opened'), 1, 'evento conversation_opened (uno)');
  perform tests.eq((select count(*)::int from public.cc_participants where conversation_id = cA), 1, 'participante dueño (visitante)');
  perform tests.act_as_service();

  -- ══ enviar: actor fijado por el servidor; contenido acotado ═════════════
  m1 := public.cc_enviar_mensaje(cA, 'visitor', hA, null, 'c:1', 'Hola, ¿tienen plasma rico en plaquetas? <b>no soy html</b>');
  perform tests.eq((m1 ->> 'seq')::int, 1, 'primer mensaje seq 1');
  perform tests.act_as_owner();
  perform tests.eq((select actor_type from public.cc_messages where id = (m1 ->> 'id')::uuid), 'visitor', '7 · actor_type lo fija el servidor');
  perform tests.eq((select actor_visitor_id from public.cc_messages where id = (m1 ->> 'id')::uuid), vidA, '8 · actor_visitor_id = visitante A');
  perform tests.eq((select content from public.cc_messages where id = (m1 ->> 'id')::uuid), 'Hola, ¿tienen plasma rico en plaquetas? <b>no soy html</b>', 'el texto se guarda íntegro (el escape es del render)');
  perform tests.act_as_service();
  -- idempotencia
  m2 := public.cc_enviar_mensaje(cA, 'visitor', hA, null, 'c:1', 'Hola, ¿tienen plasma rico en plaquetas? <b>no soy html</b>');
  perform tests.eq(m2 ->> 'id', m1 ->> 'id', '12 · mismo client_message_id + mismo payload → mismo mensaje');
  perform tests.eq((m2 ->> 'idempotente')::boolean, true, 'marcado idempotente');
  perform tests.throws(format('select public.cc_enviar_mensaje(%L, ''visitor'', %L, null, ''c:1'', ''otro texto'')', cA, hA), 'IDEMPOTENCIA_CONFLICTO', '13 · misma llave + payload distinto → conflicto');
  perform tests.throws(format('select public.cc_enviar_mensaje(%L, ''visitor'', %L, null, null, ''   '')', cA, hA), 'CONTENIDO_VACIO', 'vacío rechazado');
  perform tests.throws(format('select public.cc_enviar_mensaje(%L, ''visitor'', %L, null, null, %L)', cA, hA, repeat('x', 4001)), 'CONTENIDO_LARGO', 'largo rechazado');
  perform tests.throws(format('select public.cc_enviar_mensaje(%L, ''gerente'', %L, null, null, ''x'')', cA, hA), 'ACTOR_INVALIDO', 'actor fuera de la lista');
  -- ai/system solo internos
  perform tests.throws(format('select public.cc_enviar_mensaje(%L, ''ai'', %L, null, null, ''x'')', cA, hA), 'ACTOR_INVALIDO', '9 · ai con token de visitante → inválido');
  perform tests.throws(format('select public.cc_enviar_mensaje(%L, ''admin'', null, %L, null, ''x'')', cA, v_doc), 'NO_AUTORIZADO', '8 · un doctor que se dice admin → no autorizado');
  r := public.cc_enviar_mensaje(cA, 'ai', null, null, 'ai:1', 'Claro, te cuento sobre PRP.');
  perform tests.eq((r ->> 'seq')::int, 2, 'IA responde en ai_active (seq 2)');
  r := public.cc_enviar_mensaje(cA, 'ai', null, null, 'ai:1', 'Claro, te cuento sobre PRP.');
  perform tests.eq((r ->> 'idempotente')::boolean, true, 'respuesta IA idempotente por client_id');

  -- ══ autoridad cruzada ═══════════════════════════════════════════════════
  perform tests.throws(format('select public.cc_leer_conversacion(%L, ''visitor'', %L, null)', cA, hB), 'NO_AUTORIZADO', '2 · visitante B no lee la de A');
  perform tests.throws(format('select public.cc_enviar_mensaje(%L, ''visitor'', %L, null, null, ''x'')', cA, hB), 'NO_AUTORIZADO', '3 · visitante B no escribe en la de A');
  perform tests.throws(format('select public.cc_leer_conversacion(%L, ''doctor'', null, %L)', cD, v_doc2), 'NO_AUTORIZADO', '4 · doctor 2 no lee la del doctor 1');
  perform tests.throws(format('select public.cc_leer_conversacion(%L, ''doctor'', null, %L)', cA, v_doc), 'NO_AUTORIZADO', 'un doctor no lee la de un visitante');
  perform tests.throws(format('select public.cc_leer_conversacion(%L, ''seller'', null, %L)', cA, v_pos), 'NO_AUTORIZADO', '5 · asesor no asignado no lee');
  perform tests.throws(format('select public.cc_enviar_mensaje(%L, ''seller'', null, %L, null, ''x'')', cA, v_pos), 'NO_AUTORIZADO', '6 · asesor no asignado no escribe');
  perform tests.throws(format('select public.cc_leer_conversacion(%L, ''seller'', null, %L)', cA, v_wh), 'NO_AUTORIZADO', 'almacén no participa');
  perform tests.throws(format('select public.cc_leer_conversacion(gen_random_uuid(), ''doctor'', null, %L)', v_doc), 'NO_AUTORIZADO', '1 · id inexistente → mismo error (no revela existencia)');
  lect := public.cc_leer_conversacion(cA, 'admin', null, v_admin);
  perform tests.eq(lect ->> 'rol', 'supervisor', '6 · Dirección supervisa');
  perform tests.eq(jsonb_array_length(lect -> 'mensajes'), 2, 'Dirección ve los 2 mensajes');
  perform tests.ok(lect::text not like '%' || hA || '%' and lect::text not like '%' || vidA::text || '%', 'la lectura no expone hash ni id del visitante');
  lect := public.cc_leer_conversacion(cA, 'visitor', hA, null, 1);
  perform tests.eq(jsonb_array_length(lect -> 'mensajes'), 1, 'paginación desde seq 1 → solo el seq 2');
  perform tests.eq((lect -> 'mensajes' -> 0 ->> 'propio')::boolean, false, 'el mensaje de IA no es propio');

  -- ══ read state ══════════════════════════════════════════════════════════
  perform public.cc_marcar_leido(cA, 'visitor', hA, null, 99);
  perform tests.act_as_owner();
  perform tests.eq((select last_read_seq from public.cc_participants where conversation_id = cA and visitor_id = vidA), 2::bigint, 'leído se topa al último seq real');
  perform tests.act_as_service();

  -- ══ C15 · correo/teléfono iguales no son prueba ═════════════════════════
  update public.profiles set email = 'ana@x.mx' where id = v_doc2;
  insert into public.prospects (name, email, source, status, visitor_id) values ('Ana', 'ana@x.mx', 'Landing', 'nuevo', vidA);
  perform tests.throws(format('select public.cc_leer_conversacion(%L, ''doctor'', null, %L)', cA, v_doc2), 'NO_AUTORIZADO', '18/19 · mismo correo que el prospecto del visitante: sin acceso');

  -- ══ append-only ═════════════════════════════════════════════════════════
  perform tests.act_as_owner();
  perform tests.throws(format('update public.cc_messages set content = ''editado'' where id = %L', m1 ->> 'id'), 'APPEND_ONLY', '10 · un mensaje no se edita');
  perform tests.throws(format('delete from public.cc_messages where id = %L', m1 ->> 'id'), 'APPEND_ONLY', 'un mensaje no se borra');
  perform tests.throws(format('delete from public.cc_conversation_events where conversation_id = %L', cA), 'APPEND_ONLY', 'un evento no se borra');
  perform tests.throws_any(format('delete from public.cc_visitors where id = %L', vidA), array['violates foreign key', 'APPEND_ONLY'], 'el visitante con conversación no se puede borrar (FK restrict / bitácora append-only)');
  perform tests.throws('insert into public.cc_messages (conversation_id, seq, actor_type, actor_profile_id, content, content_hash) values (' || quote_literal(cA) || ', 99, ''ai'', ' || quote_literal(v_doc) || ', ''x'', ''y'')', 'ck_ccm_identidad', 'constraint: ai con perfil es imposible');
  -- cerrar: no borra; reabrir: evento
  perform tests.act_as_service();
  r := public.cc_cerrar_conversacion(cA, 'visitor', hA, null);
  perform tests.eq(r ->> 'estado', 'cerrada', 'cerrar');
  perform tests.throws(format('select public.cc_enviar_mensaje(%L, ''visitor'', %L, null, null, ''x'')', cA, hA), 'CONVERSACION_CERRADA', 'no se escribe en cerrada');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.cc_messages where conversation_id = cA), 2, 'cerrar no borra mensajes');
  perform tests.act_as_service();
  r := public.cc_abrir_conversacion(hA, null);
  perform tests.ok((r ->> 'conversation_id')::uuid = cA and r ->> 'estado' = 'abierta' and (r ->> 'nuevo')::boolean = false, '35 · CC-7 · cerrar no es permanente: abrir reabre la MISMA conversación (canal permanente)');
  r := public.cc_reabrir_conversacion(cA, 'visitor', hA, null);
  perform tests.eq((r ->> 'idempotente')::boolean, true, 'reabrir una abierta: idempotente');
  perform public.cc_cerrar_conversacion(cA, 'visitor', hA, null);
  r := public.cc_reabrir_conversacion(cA, 'visitor', hA, null);
  perform tests.eq(r ->> 'estado', 'abierta', 'reabrir explícito');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.cc_conversations where visitor_id = vidA), 1, '35 · una sola conversación del dueño: nunca se pierde el historial');
  perform tests.eq((select count(*)::int from public.cc_conversation_events where conversation_id = cA and tipo = 'conversation_reopened'), 2, 'eventos conversation_reopened (canal permanente + explícito)');
  perform tests.ok(not exists (select 1 from public.cc_conversation_events e where e.detalle::text ilike '%plasma%'), '23 · los eventos no contienen contenido');
end $t$;
rollback;
