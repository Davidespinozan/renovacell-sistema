-- R4-B2-3b · exclusividad IA / persona en canales y toma formal por Dirección: la IA atiende en ai_active y mientras
-- espera asesor; calla en human_active (y lo que estaba en curso se descarta); Dirección no responde sin tomar; nadie escribe
-- en la atención de otra persona; espejo sin respuestas; lo del cliente, del sistema y de la IA no se bloquea; el saludo de
-- IA insertado directo no sale si la IA está apagada; el portal no cambia; la toma no crea solicitud ni toca la cartera.
begin;
\ir ../../../rollback/whatsapp_compuerta_abierta/99_down.sql   -- R4-C6: contrato con la compuerta CERRADA (abierta: canal_06)
do $t$
declare v_admin uuid := tests.fixture_admin(); a2 uuid; s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos'); d uuid := tests.user('doctor');
        r jsonb; t jsonb; c uuid; c2 uuid; c3 uuid; cp uuid; h text; v_turn uuid; n bigint; v_ev bigint;
begin
  perform tests.act_as_service();
  a2 := tests.user('admin');
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones"]}' where id in (s1, s2);
  perform tests.act_as_owner(); alter table public.cc_wa_config disable trigger trg_cc_wa_config_guardia; update public.cc_wa_config set modo = 'activo', ia_habilitada = true, envio_pausado = false where id;
  perform tests.act_as_service();
  r := public.cc_wa_entrante('5216670003001', 'Exclusiva', 'wamid.B23B.1', 'Hola', false);
  c := (r ->> 'conversation_id')::uuid; h := r ->> 'visitor_hash';

  -- 1 · ai_active: la IA atiende y su respuesta sale
  t := public.cc_ia_turno_reclamar(c, (r ->> 'seq')::bigint, 'anthropic', 'm');
  t := public.cc_ia_turno_responder((t ->> 'turn_id')::uuid, 'Hola, ¿en qué te ayudo?', 'GENERAL_CHAT');
  perform tests.ok((t ->> 'persistido')::boolean and exists (select 1 from public.cc_wa_salida where conversation_id = c and texto = 'Hola, ¿en qué te ayudo?'), '1 · ai_active: la IA responde y sale');
  -- 2 · Dirección no responde sin tomar; una asesora tampoco sin iniciar
  perform tests.throws(format('select public.cc_enviar_mensaje(%L, %L, null, %L, %L, %L)', c, 'admin', v_admin, 'adm:1', 'Hola, soy Dirección'), 'TOMA_REQUERIDA', '2 · Dirección sin tomar: TOMA_REQUERIDA');
  perform tests.throws_any(format('select public.cc_enviar_mensaje(%L, %L, null, %L, %L, %L)', c, 'seller', s1, 'sel:1', 'Hola'), array['NO_AUTORIZADO', 'ASESORIA_NO_INICIADA'], '2 · asesora sin asignación ni inicio: rechazo');
  -- 3 · en espera de asesor la IA sigue informando
  perform public.cc_solicitar_asesor(c, 'visitor', h, null);
  perform tests.ok((select modo in ('human_requested', 'human_assigned') from public.cc_conversations where id = c), '3 · el cliente pidió asesor');
  r := public.cc_wa_entrante('5216670003001', null, 'wamid.B23B.2', '¿Y mientras tanto?', false);
  t := public.cc_ia_turno_reclamar(c, (r ->> 'seq')::bigint, 'anthropic', 'm');
  perform tests.eq(t ->> 'estado', 'reclamado', '3 · esperando asesor: la IA puede responder');
  v_turn := (t ->> 'turn_id')::uuid;   -- turno EN CURSO para el punto 4

  -- 4 · la asesora asignada inicia: la IA en curso se descarta y deja de responder; la asesora escribe y sale
  perform public.cc_asignar_asesor(c, v_admin, s1);
  perform public.cc_iniciar_asesoria(c, s1);
  t := public.cc_ia_turno_responder(v_turn, 'respuesta tardía de la IA', 'GENERAL_CHAT');
  perform tests.ok(not (t ->> 'persistido')::boolean and t ->> 'motivo' = 'takeover_humano', '4 · IA en curso al iniciar la asesora: se descarta');
  r := public.cc_wa_entrante('5216670003001', null, 'wamid.B23B.3', 'Gracias', false);
  perform tests.ok((select modo = 'human_active' from public.cc_conversations where id = c), '4 · el mensaje del cliente entra en human_active');
  t := public.cc_ia_turno_reclamar(c, (r ->> 'seq')::bigint, 'anthropic', 'm');
  perform tests.eq(t ->> 'estado', 'silenciado', '4 · human_active: la IA no reclama');
  perform tests.throws($$select public.cc_enviar_mensaje('$$ || c || $$', 'ai', null, null, 'ai:x', 'intento directo de IA')$$, 'IA_SILENCIADA', '4 · human_active: la IA no persiste');
  r := public.cc_enviar_mensaje(c, 'seller', null, s1, 'sel:2', 'Hola, soy Lucía');
  perform tests.ok(exists (select 1 from public.cc_wa_salida where message_id = (r ->> 'id')::uuid), '4 · la asesora que atiende escribe y sale');
  perform tests.throws_any(format('select public.cc_enviar_mensaje(%L, %L, null, %L, %L, %L)', c, 'seller', s2, 'sel:3', 'Me meto'), array['NO_AUTORIZADO', 'ATENDIDA_POR_OTRO'], '4 · otra asesora: rechazo');
  -- 5 · Dirección no toma una atención en curso de otra persona
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.cc_tomar_conversacion(%L, %L)', c, 'Revisión'), 'ATENDIDA_POR_OTRO', '5 · Dirección no toma lo que atiende una asesora');
  perform tests.act_as_service();
  perform tests.throws_any(format('select public.cc_enviar_mensaje(%L, %L, null, %L, %L, %L)', c, 'admin', v_admin, 'adm:2', 'Intervengo'), array['TOMA_REQUERIDA', 'ATENDIDA_POR_OTRO'], '5 · ni escribe sin tomar');
  -- 6 · terminar conserva human_ended; el cliente vuelve y regresa a IA
  perform public.cc_terminar_asesoria(c, s1);
  perform tests.ok((select modo in ('human_ended', 'ai_active') from public.cc_conversations where id = c), '6 · terminar: conserva la conducta vigente (libera la atención)');
  r := public.cc_wa_entrante('5216670003001', null, 'wamid.B23B.4', 'Otra duda', false);
  perform tests.ok((select modo = 'ai_active' from public.cc_conversations where id = c), '6 · el cliente vuelve: regresa a IA');

  -- 7 · toma formal por Dirección de una conversación ASIGNADA a una asesora (sin iniciar)
  perform tests.act_as_owner(); select count(*) into v_ev from public.cc_conversation_events where conversation_id = c and tipo = 'human_requested'; perform tests.act_as_service();
  t := public.cc_ia_turno_reclamar(c, (r ->> 'seq')::bigint, 'anthropic', 'm'); v_turn := (t ->> 'turn_id')::uuid;   -- IA en curso
  perform public.cc_asignar_asesor(c, v_admin, s1);   -- asignada, sin iniciar (la IA sigue en espera)
  perform tests.act_as(s1);
  perform tests.throws(format('select public.cc_tomar_conversacion(%L)', c), 'NO_AUTORIZADO', '7 · solo Dirección toma');
  perform tests.act_as_anon();
  perform tests.throws(format('select public.cc_tomar_conversacion(%L)', c), 'permission denied', '7 · anónimo no toma');
  perform tests.act_as(v_admin);
  t := public.cc_tomar_conversacion(c, 'Cliente importante');
  perform tests.ok(t ->> 'modo' = 'human_active' and (t ->> 'tomada_por')::uuid = v_admin and t ->> 'desde' = 'human_assigned' and not (t ->> 'idempotente')::boolean, '7 · Dirección toma (human_assigned → human_active)');
  t := public.cc_tomar_conversacion(c);
  perform tests.ok((t ->> 'idempotente')::boolean, '7 · tomar otra vez: idempotente');
  perform tests.act_as(a2);
  perform tests.throws(format('select public.cc_tomar_conversacion(%L)', c), 'ATENDIDA_POR_OTRO', '7 · otro admin no la toma');
  perform tests.act_as_owner();
  perform tests.ok((select tomada_por = v_admin and tomada_at is not null and seller_profile_id = s1 from public.cc_conversations where id = c), '7 · registra quién/cuándo; la asesora asignada no se sobrescribe');
  perform tests.ok(exists (select 1 from public.cc_conversation_events where conversation_id = c and tipo = 'human_started' and detalle ->> 'toma_direccion' = 'true' and detalle ->> 'desde' = 'human_assigned' and detalle ->> 'motivo' = 'Cliente importante' and actor_profile_id = v_admin), '7 · auditado: human_started con desde/motivo/actor');
  perform tests.eq((select count(*) from public.cc_conversation_events where conversation_id = c and tipo = 'human_requested'), v_ev, '7 · la toma no crea una solicitud nueva');
  perform tests.act_as_service();
  t := public.cc_ia_turno_responder(v_turn, 'IA tarde', 'GENERAL_CHAT');
  perform tests.ok(not (t ->> 'persistido')::boolean and t ->> 'motivo' = 'takeover_humano', '7 · IA en curso al tomar: se descarta');
  r := public.cc_enviar_mensaje(c, 'admin', null, v_admin, 'adm:3', 'Hola, te atiende Dirección');
  perform tests.ok(exists (select 1 from public.cc_wa_salida where message_id = (r ->> 'id')::uuid), '7 · Dirección tomó: responde y sale');
  perform tests.throws(format('select public.cc_enviar_mensaje(%L, %L, null, %L, %L, %L)', c, 'admin', a2, 'adm:4', 'Yo también'), 'ATENDIDA_POR_OTRO', '7 · otro admin no escribe');
  perform public.cc_iniciar_asesoria(c, s1);   -- la asesora asignada "inicia": ya estaba activa (idempotente)…
  perform tests.throws(format('select public.cc_enviar_mensaje(%L, %L, null, %L, %L, %L)', c, 'seller', s1, 'sel:4', 'Hola'), 'ATENDIDA_POR_OTRO', '7 · …pero no escribe: la atiende Dirección');
  -- apagar la IA no interrumpe la atención humana
  perform tests.act_as_owner(); update public.cc_wa_config set ia_habilitada = false where id; perform tests.act_as_service();
  r := public.cc_enviar_mensaje(c, 'admin', null, v_admin, 'adm:5', 'Sigo aquí');
  perform tests.ok(r ->> 'id' is not null, '7 · IA apagada: Dirección sigue atendiendo');
  perform public.cc_terminar_asesoria(c, v_admin);
  perform tests.act_as_owner();
  perform tests.ok((select modo <> 'human_active' and tomada_por is null and tomada_at is null from public.cc_conversations where id = c), '7 · al terminar se limpia la toma');

  -- 8 · espejo: sin respuestas del personal; lo entrante y el sistema siguen
  update public.cc_wa_config set ia_habilitada = true where id;
  perform tests.act_as_service();
  r := public.cc_wa_entrante('5216670003002', 'Espejo', 'wamid.B23B.E1', 'Hola', false);
  c2 := (r ->> 'conversation_id')::uuid;
  perform tests.act_as(v_admin); t := public.cc_tomar_conversacion(c2);
  perform tests.ok(t ->> 'desde' = 'ai_active' and t ->> 'modo' = 'human_active', '8 · Dirección toma desde ai_active (→ human_assigned → human_active en una transacción)');
  perform tests.act_as_owner(); update public.cc_wa_config set modo = 'espejo' where id;
  perform tests.act_as_service();
  perform tests.throws(format('select public.cc_enviar_mensaje(%L, %L, null, %L, %L, %L)', c2, 'admin', v_admin, 'adm:e1', 'Hola'), 'CANAL_EN_ESPEJO', '8 · espejo: Dirección no responde');
  r := public.cc_wa_entrante('5216670003002', null, 'wamid.B23B.E2', 'sigo escribiendo', false);
  perform tests.ok(not (r ->> 'duplicado')::boolean and (r ->> 'conversation_id')::uuid = c2, '8 · espejo: lo entrante se registra');
  perform public._cc_sistema(c2, 'Aviso interno', 'sys:prueba:e');
  perform tests.ok(exists (select 1 from public.cc_messages where conversation_id = c2 and client_message_id = 'sys:prueba:e'), '8 · espejo: el sistema registra');

  -- 9 · saludo de IA insertado directo con la IA apagada: queda en la conversación pero NO sale
  perform tests.act_as_owner(); alter table public.cc_wa_config disable trigger trg_cc_wa_config_guardia; update public.cc_wa_config set modo = 'activo', ia_habilitada = false where id;
  perform tests.act_as_service();
  r := public.cc_wa_entrante('5216670003003', 'Saludo', 'wamid.B23B.S1', 'Hola', false);
  c3 := (r ->> 'conversation_id')::uuid;
  perform public.cc_enviar_mensaje(c3, 'ai', null, null, 'ai:saludo', 'Hola, soy el asistente');
  perform tests.ok(exists (select 1 from public.cc_messages where conversation_id = c3 and client_message_id = 'ai:saludo')
    and not exists (select 1 from public.cc_wa_salida s join public.cc_messages m on m.id = s.message_id where m.client_message_id = 'ai:saludo'), '9 · IA apagada: el mensaje de IA queda pero no sale');
  perform tests.ok(exists (select 1 from public.cc_wa_salida s join public.cc_messages m on m.id = s.message_id where s.conversation_id = c3 and m.client_message_id like 'sys:wa:%'), '9 · el aviso de transferencia sí sale');

  -- 10 · portal: sin cambios (Dirección escribe sin tomar; la toma no aplica)
  cp := (public.cc_abrir_conversacion(null, d) ->> 'conversation_id')::uuid;
  perform public.cc_enviar_mensaje(cp, 'doctor', null, d, 'p:1', 'Hola portal');
  r := public.cc_enviar_mensaje(cp, 'admin', null, v_admin, 'adm:p1', 'Hola doctor');
  perform tests.ok(r ->> 'id' is not null, '10 · portal: Dirección escribe como siempre');
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.cc_tomar_conversacion(%L)', cp), 'NO_ES_CANAL', '10 · portal: la toma no aplica');
  perform tests.act_as_owner();
  perform tests.ok(not public._cc_canal_activacion_lista(), '10 · compuerta cerrada');
end $t$;
rollback;
