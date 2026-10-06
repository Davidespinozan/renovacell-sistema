-- CC-2 · Handoff: máquina de estados, solicitud, asignación (cola / preferido / Dirección),
-- capability del vendedor, silencio de la IA, inicio/fin, reanudar, cola, suspensión.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); v_doc uuid := tests.user('doctor');
  v_pos uuid := tests.user('pos'); v_pos2 uuid := tests.user('pos'); v_pos_sin uuid := tests.user('pos'); v_wh uuid := tests.user('warehouse');
  hA text := repeat('a', 64); hR text := repeat('b', 64); cA uuid; cR uuid; cD uuid; r jsonb; code text; n int;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta,'{}') || '{"capabilities":["conversaciones"]}' where id in (v_pos, v_pos2);
  perform public.cc_visitante_abrir(null, hA, '{}'::jsonb, null);
  cA := (public.cc_abrir_conversacion(hA, null) ->> 'conversation_id')::uuid;
  perform public.cc_enviar_mensaje(cA, 'visitor', hA, null, 'c:1', 'Quiero hablar con alguien');

  -- ══ transiciones ════════════════════════════════════════════════════════
  perform tests.ok(public._cc_transicion_valida('ai_active', 'human_requested') and public._cc_transicion_valida('human_requested', 'human_assigned')
               and public._cc_transicion_valida('human_assigned', 'human_active') and public._cc_transicion_valida('human_active', 'human_ended')
               and public._cc_transicion_valida('human_ended', 'ai_active'), 'camino completo válido');
  perform tests.ok(not public._cc_transicion_valida('human_active', 'ai_active') and not public._cc_transicion_valida('ai_active', 'human_active')
               and not public._cc_transicion_valida('human_ended', 'human_active'), '14 · saltos inválidos rechazados');

  -- ══ solicitar asesor (sin preferido) → cola ═════════════════════════════
  perform tests.throws(format('select public.cc_solicitar_asesor(%L, ''seller'', null, %L)', cA, v_pos), 'NO_AUTORIZADO', 'solo el dueño solicita');
  r := public.cc_solicitar_asesor(cA, 'visitor', hA, null);
  perform tests.eq(r ->> 'modo', 'human_requested', 'human_requested');
  perform tests.eq((r ->> 'asesor')::boolean, false, 'sin asesor: a la cola');
  r := public.cc_solicitar_asesor(cA, 'visitor', hA, null);
  perform tests.eq((r ->> 'idempotente')::boolean, true, '28 · reintento de solicitud idempotente');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.cc_conversation_events where conversation_id = cA and tipo = 'human_requested'), 1, 'un solo evento human_requested');
  perform tests.eq((select count(*)::int from public.cc_messages where conversation_id = cA and actor_type = 'system'), 1, 'un mensaje de sistema');
  perform tests.act_as_service();
  -- política human_requested: la IA PUEDE seguir; el dueño puede escribir
  r := public.cc_enviar_mensaje(cA, 'ai', null, null, 'ai:2', 'Mientras llega un asesor, te sigo ayudando.');
  perform tests.ok((r ->> 'seq')::int > 0, 'L · IA puede responder en human_requested');

  -- ══ cola y autoasignación (solo quien puede atender, solo desde la cola) ═
  perform tests.act_as(v_pos);
  perform tests.eq((select count(*)::int from public.cc_cola_asesorias() q where q.conversation_id = cA and q.modo = 'human_requested'), 1, 'R · el vendedor con capability ve la cola');
  perform tests.act_as(v_pos_sin);
  perform tests.eq((select count(*)::int from public.cc_cola_asesorias()), 0, 'Q · vendedor SIN capability no ve la cola');
  perform tests.act_as(v_doc);
  perform tests.eq((select count(*)::int from public.cc_cola_asesorias()), 0, 'un doctor no ve la cola');
  perform tests.act_as_service();
  perform tests.throws_any(format('select public.cc_asignar_asesor(%L, %L, %L)', cA, v_pos_sin, v_pos_sin), array['NO_AUTORIZADO', 'ASESOR_INVALIDO'], 'Q · sin capability no se autoasigna');
  perform tests.throws(format('select public.cc_asignar_asesor(%L, %L, %L)', cA, v_pos, v_pos2), 'NO_AUTORIZADO', '13 · un vendedor no asigna a otro');
  perform tests.throws(format('select public.cc_asignar_asesor(%L, %L, %L)', cA, v_admin, v_wh), 'ASESOR_INVALIDO', 'Dirección no puede asignar a quien no atiende');
  r := public.cc_asignar_asesor(cA, v_pos, v_pos);
  perform tests.eq(r ->> 'modo', 'human_assigned', 'autoasignación desde la cola → human_assigned');
  r := public.cc_asignar_asesor(cA, v_pos, v_pos);
  perform tests.eq((r ->> 'idempotente')::boolean, true, '29 · reintento de asignación idempotente');
  perform tests.throws(format('select public.cc_asignar_asesor(%L, %L, %L)', cA, v_pos2, v_pos2), 'YA_ASIGNADA', '13 · otro vendedor no se la queda');
  -- IA silenciada desde human_assigned; asesor no escribe hasta iniciar
  perform tests.throws(format('select public.cc_enviar_mensaje(%L, ''ai'', null, null, ''ai:3'', ''x'')', cA), 'IA_SILENCIADA', '15 · IA callada en human_assigned');
  perform tests.throws(format('select public.cc_enviar_mensaje(%L, ''seller'', null, %L, null, ''x'')', cA, v_pos), 'ASESORIA_NO_INICIADA', 'el asesor escribe solo con la asesoría iniciada');
  perform tests.throws(format('select public.cc_iniciar_asesoria(%L, %L)', cA, v_pos2), 'NO_AUTORIZADO', 'otro vendedor no inicia');
  r := public.cc_iniciar_asesoria(cA, v_pos);
  perform tests.eq(r ->> 'modo', 'human_active', 'human_active');
  perform tests.throws(format('select public.cc_enviar_mensaje(%L, ''ai'', null, null, ''ai:4'', ''x'')', cA), 'IA_SILENCIADA', '15 · IA callada en human_active');
  r := public.cc_enviar_mensaje(cA, 'seller', null, v_pos, 's:1', 'Hola, soy tu asesor.');
  perform tests.ok((r ->> 'seq')::int > 0, 'el asesor asignado escribe');
  perform tests.act_as_owner();
  perform tests.eq((select actor_type from public.cc_messages where client_message_id = 's:1'), 'seller', 'actor seller fijado por el servidor');
  perform tests.ok(exists (select 1 from public.cc_messages where conversation_id = cA and actor_type = 'system' and content like '%se unió%'), 'T · mensaje de sistema "se unió"');
  perform tests.act_as_service();
  r := public.cc_enviar_mensaje(cA, 'visitor', hA, null, 'c:2', 'Gracias');
  perform tests.ok((r ->> 'seq')::int > 0, 'el dueño sigue escribiendo en human_active');
  perform tests.throws(format('select public.cc_reanudar_ia(%L, ''visitor'', %L, null)', cA, hA), 'TRANSICION_INVALIDA', 'el dueño no reanuda la IA mientras el asesor está activo');

  -- ══ suspensión: el asesor pierde autoridad al instante ══════════════════
  perform tests.act_as_owner();
  perform tests.suspender(v_pos, 'prueba cc2');
  perform tests.act_as_service();
  perform tests.throws(format('select public.cc_enviar_mensaje(%L, ''seller'', null, %L, null, ''x'')', cA, v_pos), 'CUENTA_SUSPENDIDA', '7 · asesor suspendido no escribe');
  perform tests.throws(format('select public.cc_leer_conversacion(%L, ''seller'', null, %L)', cA, v_pos), 'CUENTA_SUSPENDIDA', '7 · ni lee');
  perform tests.act_as_owner(); perform tests.reactivar(v_pos); perform tests.act_as_service();

  -- ══ Dirección reasigna / libera; terminar; reanudar IA ═══════════════════
  r := public.cc_asignar_asesor(cA, v_admin, v_pos2);
  perform tests.eq(r ->> 'seller', v_pos2::text, 'Dirección reasigna');
  perform tests.eq(r ->> 'modo', 'human_assigned', 'E · reasignar desde human_active vuelve a human_assigned (el nuevo asesor debe iniciar)');
  perform tests.throws(format('select public.cc_enviar_mensaje(%L, ''seller'', null, %L, null, ''x'')', cA, v_pos), 'NO_AUTORIZADO', 'E · el asesor anterior ya no tiene acceso (sin fantasma)');
  r := public.cc_asignar_asesor(cA, v_admin, null);
  perform tests.eq(r ->> 'modo', 'human_requested', 'Dirección libera → vuelve a la cola');
  perform tests.ok((r ->> 'seller') is null, 'sin asesor');
  r := public.cc_asignar_asesor(cA, v_admin, v_pos);
  r := public.cc_iniciar_asesoria(cA, v_pos);
  perform tests.throws(format('select public.cc_terminar_asesoria(%L, %L)', cA, v_pos2), 'NO_AUTORIZADO', 'otro vendedor no termina');
  r := public.cc_terminar_asesoria(cA, v_pos);
  perform tests.eq(r ->> 'modo', 'human_ended', 'human_ended');
  perform tests.throws(format('select public.cc_enviar_mensaje(%L, ''ai'', null, null, ''ai:5'', ''x'')', cA), 'IA_SILENCIADA', 'IA callada en human_ended hasta reanudar');
  r := public.cc_reanudar_ia(cA, 'visitor', hA, null);
  perform tests.eq(r ->> 'modo', 'ai_active', 'ai_resumed → ai_active');
  r := public.cc_enviar_mensaje(cA, 'ai', null, null, 'ai:6', 'De vuelta contigo.');
  perform tests.ok((r ->> 'seq')::int > 0, 'IA habla de nuevo');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.cc_conversation_events where conversation_id = cA and tipo = 'ai_resumed'), 1, '20 · evento ai_resumed durable');
  perform tests.eq((select count(*)::int from public.cc_conversation_events where conversation_id = cA and tipo in ('human_assigned','seller_unassigned','human_started','human_ended')), 8, '20 · eventos de handoff durables (3 asignaciones + 2 desasignaciones + 2 inicios + 1 fin = 8)');
  perform tests.act_as_service();

  -- ══ referido → preferido → autoasignación al solicitar ══════════════════
  perform tests.act_as(v_admin);
  code := public.cc_codigo_referido_crear(v_pos2);
  perform tests.act_as_service();
  perform public.cc_visitante_abrir(null, hR, '{}'::jsonb, code);
  cR := (public.cc_abrir_conversacion(hR, null) ->> 'conversation_id')::uuid;
  perform tests.act_as_owner();
  perform tests.eq((select seller_preferido_id from public.cc_conversations where id = cR), v_pos2, 'P · preferido = vendedor del referido (resuelto en servidor)');
  perform tests.act_as_service();
  r := public.cc_solicitar_asesor(cR, 'visitor', hR, null);
  perform tests.eq(r ->> 'modo', 'human_assigned', 'P · solicitar con preferido atendible → asignado directo');
  perform tests.act_as_owner();
  perform tests.eq((select seller_profile_id from public.cc_conversations where id = cR), v_pos2, '11 · seller_profile_id lo puso el servidor');
  perform tests.act_as_service();

  -- ══ doctor: unverified no gana nada por chatear ════════════════════════
  update public.profiles set verified = false where id = v_doc;
  cD := (public.cc_abrir_conversacion(null, v_doc) ->> 'conversation_id')::uuid;
  perform public.cc_enviar_mensaje(cD, 'doctor', null, v_doc, null, 'Hola');
  perform public.cc_solicitar_asesor(cD, 'doctor', null, v_doc);
  perform tests.act_as_owner();
  perform tests.eq((select verified from public.profiles where id = v_doc), false, '20 · sigue sin verificar');
  perform tests.act_as(v_doc);
  perform tests.eq((select count(*)::int from public.products_safe), 0, '21 · el chat no revela precios (products_safe vacío para no verificado)');
end $t$;
rollback;
