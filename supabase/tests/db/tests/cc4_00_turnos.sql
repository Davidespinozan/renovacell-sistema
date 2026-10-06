-- CC-4 · Libro de turnos: un turno por disparador, reclamo con arrendamiento, orden por
-- conversación, idempotencia del reintento, descarte por takeover humano o cierre bajo lock,
-- fallo re-reclamable, aviso de no disponibilidad una sola vez, traza de herramientas acotada,
-- todo solo para service_role; Dirección lee el libro (RLS), nadie más.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); v_doc uuid := tests.user('doctor'); v_pos uuid := tests.user('pos');
  hA text := repeat('a', 64); cA uuid; cD uuid; m1 jsonb; m2 jsonb; r jsonb; t1 uuid; t2 uuid; n int; prev jsonb;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta,'{}') || '{"capabilities":["conversaciones"]}' where id = v_pos;
  perform public.cc_visitante_abrir(null, hA, '{}'::jsonb, null);
  cA := (public.cc_abrir_conversacion(hA, null) ->> 'conversation_id')::uuid;
  m1 := public.cc_enviar_mensaje(cA, 'visitor', hA, null, 'c:1', 'Hola, ¿qué tienen para hidratación?');

  -- ══ privilegios ═════════════════════════════════════════════════════════════
  perform tests.act_as_anon();
  perform tests.throws(format('select public.cc_ia_turno_reclamar(%L, 1, ''falso'', ''m'')', cA), 'permission denied', 'anon no reclama turnos');
  perform tests.throws('select count(*) from public.cc_ai_turns', 'permission denied', 'anon no lee el libro');
  perform tests.act_as(v_doc);
  perform tests.throws(format('select public.cc_ia_turno_reclamar(%L, 1, ''falso'', ''m'')', cA), 'permission denied', 'doctor no reclama turnos');
  perform tests.throws(format('select public.cc_ia_turno_responder(%L, ''x'')', gen_random_uuid()), 'permission denied', 'doctor no persiste respuestas de IA');
  perform tests.throws(format('select public.cc_ia_precio(%L, %L, 1)', v_doc, gen_random_uuid()), 'permission denied', 'doctor no invoca herramientas de IA directo (las usa el servidor)');
  perform tests.eq((select count(*) from public.cc_ai_turns), 0::bigint, 'doctor ve el libro vacío (RLS)');
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.cc_ia_turno_reclamar(%L, 1, ''falso'', ''m'')', cA), 'permission denied', 'ni Dirección orquesta desde un cliente');

  -- ══ reclamar ════════════════════════════════════════════════════════════════
  perform tests.act_as_service();
  perform tests.throws(format('select public.cc_ia_turno_reclamar(%L, 99, ''falso'', ''m'')', cA), 'DISPARADOR_INEXISTENTE', 'el disparador debe existir');
  r := public.cc_ia_turno_reclamar(cA, (m1 ->> 'seq')::bigint, 'falso', 'falso-1', 60);
  t1 := (r ->> 'turn_id')::uuid;
  perform tests.eq(r ->> 'estado', 'reclamado', 'A · primer reclamo gana');
  perform tests.eq(r ->> 'operation_id', 'ai:' || (m1 ->> 'seq'), 'A · operation_id = ai:<seq> (el client_id de CC-2)');
  r := public.cc_ia_turno_reclamar(cA, (m1 ->> 'seq')::bigint, 'falso', 'falso-1', 60);
  perform tests.eq(r ->> 'estado', 'en_curso', 'A · segundo worker ve en_curso (arrendamiento vivo)');
  perform tests.eq((r ->> 'turn_id')::uuid, t1, 'A · mismo turno');
  -- orden: un segundo mensaje mientras el primero sigue en curso
  m2 := public.cc_enviar_mensaje(cA, 'visitor', hA, null, 'c:2', 'y precio?');
  r := public.cc_ia_turno_reclamar(cA, (m2 ->> 'seq')::bigint, 'falso', 'falso-1', 60);
  t2 := (r ->> 'turn_id')::uuid;
  perform tests.eq(r ->> 'estado', 'reclamado', 'B · el disparador más nuevo se reclama aunque el viejo siga en curso (el nuevo gana)');
  -- traza
  perform public.cc_ia_herramienta_registrar(t1, 0, 'buscar_productos', 'ok', array[gen_random_uuid()], '{"n":3}'::jsonb);
  perform tests.throws(format('select public.cc_ia_herramienta_registrar(%L, 0, ''x'', ''ok'', ''{}'', %L::jsonb)', t1, '{"big":"' || repeat('x', 2100) || '"}'), 'ck_catc_detalle', 'C · el detalle de la traza está acotado (2000)');
  perform tests.throws(format('select public.cc_ia_herramienta_registrar(%L, 0, ''x'', ''raro'', ''{}'', null)', t1), 'ck_catc_status', 'C · estado de herramienta cerrado');

  -- ══ responder: persiste por cc_enviar_mensaje como ai; idempotente ══════════
  r := public.cc_ia_turno_responder(t1, 'Respuesta vieja que llega tarde', 'PRODUCT_DISCOVERY', '{}', 0, 1, 1);
  perform tests.eq((r ->> 'persistido')::boolean, false, 'B · la respuesta del disparador VIEJO llega después del reclamo del nuevo → no se persiste');
  perform tests.eq(r ->> 'motivo', 'superado', 'B · motivo superado');
  perform tests.eq((select status || ':' || error_class from public.cc_ai_turns where id = t1), 'discarded:superado', 'B · turno viejo discarded:superado');
  r := public.cc_ia_turno_reclamar(cA, (m1 ->> 'seq')::bigint, 'falso', 'falso-1', 60);
  perform tests.eq(r ->> 'estado', 'silenciado', 'B · re-reclamar el superado devuelve su estado final (discarded) sin volver a correr');
  -- el turno NUEVO responde normalmente (es el que el usuario espera)
  r := public.cc_ia_turno_responder(t2, 'Tenemos opciones para hidratación. ¿Buscas uso profesional?', 'PRODUCT_DISCOVERY', array['KNOWLEDGE_EVIDENCE'], 1, 300, 80);
  perform tests.eq((r ->> 'persistido')::boolean, true, 'D · respuesta persistida');
  t1 := t2;
  perform tests.ok(exists (select 1 from public.cc_messages where id = (r ->> 'message_id')::uuid and actor_type = 'ai' and client_message_id = 'ai:' || (m2 ->> 'seq')), 'D · mensaje ai con client_id del turno');
  perform tests.eq((select status from public.cc_ai_turns where id = t1), 'completed', 'D · turno completed');
  perform tests.eq((select tool_rounds from public.cc_ai_turns where id = t1), 1, 'D · rondas registradas');
  perform tests.eq((select input_tokens from public.cc_ai_turns where id = t1), 300, 'D · métricas sin transcript');
  perform tests.ok((select evidencia from public.cc_ai_turns where id = t1) @> array['KNOWLEDGE_EVIDENCE'], 'D · evidencia del turno');
  prev := r;
  r := public.cc_ia_turno_responder(t1, 'OTRO TEXTO (reintento tardío)', null, null);
  perform tests.eq((r ->> 'idempotente')::boolean, true, 'E · responder dos veces es idempotente (no segundo mensaje)');
  perform tests.eq(r ->> 'message_id', prev ->> 'message_id', 'E · mismo mensaje');
  perform tests.eq((select count(*) from public.cc_messages where conversation_id = cA and actor_type = 'ai'), 1::bigint, 'E · un solo mensaje ai');
  r := public.cc_ia_turno_reclamar(cA, (m2 ->> 'seq')::bigint, 'falso', 'falso-1', 60);
  perform tests.eq(r ->> 'estado', 'ya_completado', 'E · re-reclamar un turno completado → ya_completado (no se llama al proveedor)');
  -- tercer disparador para el bloque F
  m2 := public.cc_enviar_mensaje(cA, 'visitor', hA, null, 'c:2b', 'y el precio?');
  r := public.cc_ia_turno_reclamar(cA, (m2 ->> 'seq')::bigint, 'falso', 'falso-1', 60);
  t2 := (r ->> 'turn_id')::uuid;
  perform tests.eq(r ->> 'estado', 'reclamado', 'F · nuevo disparador reclamado');

  -- ══ fallo re-reclamable + aviso una vez ═════════════════════════════════════
  r := public.cc_ia_turno_fallar(t2, 'provider_timeout', true, 'PRICE', 0, 120, 0);
  perform tests.eq(r ->> 'estado', 'unknown', 'F · timeout ambiguo → unknown');
  perform public.cc_ia_aviso_no_disponible(cA); perform public.cc_ia_aviso_no_disponible(cA); perform public.cc_ia_aviso_no_disponible(cA);
  perform tests.eq((select count(*) from public.cc_messages where conversation_id = cA and actor_type = 'system' and client_message_id = 'sys:ia_no_disponible'), 1::bigint, 'F · el aviso de no disponibilidad entra UNA vez por conversación');
  r := public.cc_ia_turno_reclamar(cA, (m2 ->> 'seq')::bigint, 'falso', 'falso-1', 60);
  perform tests.eq(r ->> 'estado', 'reclamado', 'F · un turno unknown/failed se re-reclama');
  perform tests.eq((r ->> 'attempts')::int, 2, 'F · attempts = 2');
  perform tests.eq(r ->> 'operation_id', 'ai:' || (m2 ->> 'seq'), 'F · mismo operation_id → el reintento persistirá el MISMO mensaje');
  r := public.cc_ia_turno_responder(t2, 'El precio se habilita al verificar tu cuenta.', 'PRICE', '{}', 0, 200, 40);
  perform tests.eq((r ->> 'persistido')::boolean, true, 'F · reintento persiste');
  perform tests.eq((select count(*) from public.cc_messages where conversation_id = cA and actor_type = 'ai'), 2::bigint, 'F · exactamente 2 mensajes ai (uno por disparador)');

  -- ══ takeover humano durante la llamada al proveedor → descarte ══════════════
  m1 := public.cc_enviar_mensaje(cA, 'visitor', hA, null, 'c:3', 'quiero hablar con alguien');
  r := public.cc_ia_turno_reclamar(cA, (m1 ->> 'seq')::bigint, 'falso', 'falso-1', 60);
  t1 := (r ->> 'turn_id')::uuid;
  perform tests.eq(r ->> 'estado', 'reclamado', 'G · reclamado antes del takeover');
  perform public.cc_solicitar_asesor(cA, 'visitor', hA, null);
  perform public.cc_asignar_asesor(cA, v_admin, v_pos);   -- CC-7 · asigna Dirección
  perform public.cc_iniciar_asesoria(cA, v_pos);            -- CC-7 · el takeover es la sesión humana iniciada (la IA sigue en human_assigned)
  perform tests.eq((select modo from public.cc_conversations where id = cA), 'human_active', 'G · humano activo mientras "el proveedor responde"');
  n := (select count(*) from public.cc_messages where conversation_id = cA and actor_type = 'ai');
  r := public.cc_ia_turno_responder(t1, 'Respuesta tardía de la IA', 'HUMAN_REQUEST', '{}', 0, 1, 1);
  perform tests.eq((r ->> 'persistido')::boolean, false, 'G · la respuesta tardía NO se inserta');
  perform tests.eq(r ->> 'motivo', 'takeover_humano', 'G · motivo takeover_humano');
  perform tests.eq((select status from public.cc_ai_turns where id = t1), 'discarded', 'G · turno discarded');
  perform tests.eq((select count(*) from public.cc_messages where conversation_id = cA and actor_type = 'ai'), n::bigint, 'G · sin mensaje nuevo');
  perform tests.ok(not exists (select 1 from public.cc_messages where content = 'Respuesta tardía de la IA'), 'G · el texto descartado no se guardó en ningún lado');
  -- con humano asignado, reclamar un disparador nuevo → silenciado sin texto
  perform public.cc_iniciar_asesoria(cA, v_pos);
  m1 := public.cc_enviar_mensaje(cA, 'visitor', hA, null, 'c:4', 'gracias');
  r := public.cc_ia_turno_reclamar(cA, (m1 ->> 'seq')::bigint, 'falso', 'falso-1', 60);
  perform tests.eq(r ->> 'estado', 'silenciado', 'H · human_active → la IA no reclama (silenciado)');
  perform tests.eq((select status || ':' || error_class from public.cc_ai_turns where id = (r ->> 'turn_id')::uuid), 'discarded:ia_silenciada', 'H · queda registrado sin texto');

  -- ══ cierre durante la llamada → descarte ════════════════════════════════════
  perform public.cc_abrir_conversacion(null, v_doc);
  cD := (public.cc_abrir_conversacion(null, v_doc) ->> 'conversation_id')::uuid;
  m1 := public.cc_enviar_mensaje(cD, 'doctor', null, v_doc, 'c:1', 'hola');
  r := public.cc_ia_turno_reclamar(cD, (m1 ->> 'seq')::bigint, 'falso', 'falso-1', 60); t1 := (r ->> 'turn_id')::uuid;
  perform public.cc_cerrar_conversacion(cD, 'doctor', null, v_doc);
  r := public.cc_ia_turno_responder(t1, 'tarde', null, null);
  perform tests.eq(r ->> 'motivo', 'conversacion_cerrada', 'I · cerrada mientras corría → descarte');
  perform tests.throws(format('select public.cc_ia_turno_responder(%L, ''x'')', gen_random_uuid()), 'TURNO_INEXISTENTE', 'I · turno inexistente');

  -- ══ Dirección lee el libro; nadie escribe tablas ════════════════════════════
  perform tests.act_as(v_admin);
  perform tests.ok((select count(*) from public.cc_ai_turns) >= 4 and (select count(*) from public.cc_ai_tool_calls) >= 1, 'J · Dirección audita turnos y traza');
  perform tests.throws('update public.cc_ai_turns set status = ''completed''', 'permission denied', 'J · Dirección no escribe el libro');
  perform tests.throws('insert into public.cc_ai_tool_calls (turn_id, round, tool_name, status) values (gen_random_uuid(), 0, ''x'', ''ok'')', 'permission denied', 'J · ni la traza');
  perform tests.ok(not exists (select 1 from public.cc_ai_turns t where t::text ilike '%hidratación%' or t::text ilike '%respuesta tardía%'), 'J · el libro no contiene texto de mensajes');
end $t$;
rollback;
