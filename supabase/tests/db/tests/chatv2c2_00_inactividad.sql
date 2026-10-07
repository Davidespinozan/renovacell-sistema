-- Chat V2-C2 · Cierre por inactividad (T1..T20 + R2/R4/R5/R7/R8; R1/R3/R6 en concurrency/chatv2c2_concurrency.sh).
-- El "tiempo" se simula moviendo last_activity_at dentro de esta transacción de prueba.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin();
  dIA uuid := tests.user('doctor'); dH uuid := tests.user('doctor'); dR uuid := tests.user('doctor'); dA uuid := tests.user('doctor'); dX uuid := tests.user('doctor');
  dT uuid := tests.user('doctor'); dM uuid := tests.user('doctor');
  sH uuid := tests.user('pos'); sA uuid := tests.user('pos');
  pA uuid; cIA uuid; cH uuid; cR uuid; cA uuid; cX uuid; cT uuid; cM uuid; k uuid; r jsonb; n int; t uuid; v_seq bigint; v_ts timestamptz;
  antes record; semana jsonb;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id in (sH, sA);
  perform tests.cliente(dH); perform tests.cliente(dA); perform tests.cliente(dM);
  pA := tests.producto_cat('Rellenos', 1000); perform tests.stock(pA, 'C2-A', 100);
  insert into public.cc_cartera (profile_id, seller_profile_id) values (dH, sH), (dA, sA), (dM, sH);
  perform tests.act_as(v_admin);
  semana := (select jsonb_agg(jsonb_build_object('dia', g, 'abierto', true, 'abre', '00:00', 'cierra', '23:59:59.999999')) from generate_series(1, 7) g);
  perform public.cc_horario_guardar('America/Mazatlan', semana);
  perform tests.act_as_service();

  -- Sesiones de prueba
  cIA := (public.cc_abrir_conversacion(null, dIA) ->> 'conversation_id')::uuid; perform public.cc_enviar_mensaje(cIA, 'doctor', null, dIA, 'ia-1', 'Hola');
  k := (public.cc_carrito_abrir('doctor', null, dH) ->> 'cart_id')::uuid; r := public.cc_carrito_agregar(k, 'doctor', null, dH, pA, 1, 'h-1'); cH := (r -> 'handoff' ->> 'conversation_id')::uuid;
  perform public.cc_iniciar_asesoria(cH, sH); perform public.cc_enviar_mensaje(cH, 'seller', null, sH, 'h-2', 'Hola doctor');
  cR := (public.cc_abrir_conversacion(null, dR) ->> 'conversation_id')::uuid; perform public.cc_enviar_mensaje(cR, 'doctor', null, dR, 'r-1', 'Quiero asesor'); perform public.cc_solicitar_asesor(cR, 'doctor', null, dR);
  k := (public.cc_carrito_abrir('doctor', null, dA) ->> 'cart_id')::uuid; r := public.cc_carrito_agregar(k, 'doctor', null, dA, pA, 1, 'a-1'); cA := (r -> 'handoff' ->> 'conversation_id')::uuid;
  cX := (public.cc_abrir_conversacion(null, dX) ->> 'conversation_id')::uuid; perform public.cc_enviar_mensaje(cX, 'doctor', null, dX, 'x-1', 'Hola');
  perform tests.act_as_owner();
  perform tests.ok((select modo = 'human_requested' and seller_profile_id is null from public.cc_conversations where id = cR), 'premisa · cR human_requested sin vendedor');
  perform tests.ok((select modo = 'human_assigned' and seller_profile_id = sA from public.cc_conversations where id = cA), 'premisa · cA human_assigned (SLA 3/7 vigente)');
  perform tests.ok((select modo = 'human_active' from public.cc_conversations where id = cH), 'premisa · cH human_active');

  -- ══ T19 · configuración NULL → absolutamente nada ══
  perform tests.ok((select sesion_ia_min is null and sesion_humana_min is null and sesion_aviso_previo_min is null and solicitud_expira_min is null from public.cc_atencion_config), 'T19 · llega desactivado (NULL)');
  update public.cc_conversation_sessions set last_activity_at = now() - interval '30 days' where conversation_id in (cIA, cH, cR, cA, cX) and estado = 'abierta';
  select (select count(*) from public.cc_conversation_events) ev, (select count(*) from public.cc_messages) ms, (select count(*) from public.notifications) nt, (select count(*) from public.cc_conversation_sessions where estado = 'abierta') ab into antes;
  perform tests.act_as_service(); r := public.cc_sesiones_cerrar_inactivas(); perform tests.act_as_owner();
  perform tests.eq(r ->> 'omitido', 'desactivado', 'T19 · el motor no evalúa');
  perform tests.ok((select count(*) from public.cc_conversation_events) = antes.ev and (select count(*) from public.cc_messages) = antes.ms and (select count(*) from public.notifications) = antes.nt
                   and (select count(*) from public.cc_conversation_sessions where estado = 'abierta') = antes.ab, 'T19 · cero cierres, mensajes, eventos o avisos');

  -- ══ T20 · vista previa (simulando 4h/8h/7h/24h) → cero mutaciones ══
  perform tests.act_as(v_admin);
  r := public.cc_sesiones_inactivas_preview(240, 480, 60, 1440);
  perform tests.act_as_owner();
  perform tests.ok((r -> 'umbrales' ->> 'simulado')::boolean and (r -> 'umbrales' -> 'configurado' ->> 'ia_min') is null, 'T20 · simulado; lo configurado sigue NULL');
  perform tests.eq((select e ->> 'accion' from jsonb_array_elements(r -> 'sesiones') e where (e ->> 'conversation_id')::uuid = cIA), 'cerrar_ia_silencioso', 'T20 · IA vencida → cerrar_ia_silencioso');
  perform tests.eq((select e ->> 'accion' from jsonb_array_elements(r -> 'sesiones') e where (e ->> 'conversation_id')::uuid = cH), 'cerrar_humana', 'T20 · humana vencida → cerrar_humana');
  perform tests.eq((select e ->> 'accion' from jsonb_array_elements(r -> 'sesiones') e where (e ->> 'conversation_id')::uuid = cR), 'expirar_solicitud', 'T20 · solicitud vencida → expirar_solicitud');
  perform tests.ok((select count(*) from public.cc_conversation_events) = antes.ev and (select count(*) from public.cc_messages) = antes.ms and (select count(*) from public.notifications) = antes.nt
                   and (select count(*) from public.cc_conversation_sessions where estado = 'abierta') = antes.ab, 'T20 · la vista previa no muta nada');
  perform tests.act_as(dIA);
  perform tests.throws('select public.cc_sesiones_inactivas_preview()', 'NO_AUTORIZADO', 'T20 · un doctor no ve la vista previa');
  perform tests.act_as(sH);
  perform tests.throws('select public.cc_sesiones_inactivas_preview()', 'NO_AUTORIZADO', 'T20 · un vendedor no ve la vista previa');
  perform tests.act_as(dIA);
  perform tests.throws('select public.cc_sesiones_cerrar_inactivas()', 'permission denied', 'el motor no es invocable desde el frontend');

  -- Activación (en la prueba): 4h / 8h / aviso 1h antes / 24h
  perform tests.act_as(v_admin);
  perform tests.throws('select public.cc_sesiones_config_guardar(240, 480, 480, 1440)', 'CONFIG_INVALIDA', 'config · aviso >= cierre humano se rechaza');
  r := public.cc_sesiones_config_guardar(240, 480, 60, 1440);
  perform tests.ok((r -> 'sesiones' ->> 'ia_min')::int = 240 and (r -> 'sesiones' ->> 'humana_min')::int = 480 and (r -> 'sesiones' ->> 'aviso_previo_min')::int = 60 and (r -> 'sesiones' ->> 'solicitud_min')::int = 1440, 'config · guardada');
  perform tests.act_as_owner();
  perform tests.ok((select sesion_ia_min = 240 and solicitud_expira_min = 1440 from public.cc_atencion_config_hist order by id desc limit 1), 'config · historial append-only con los valores');

  -- ══ T1/T2/T14/T16/T17 · IA ══
  update public.cc_conversation_sessions set last_activity_at = now() - interval '3 hours 59 minutes' where conversation_id = cIA and estado = 'abierta';
  update public.cc_conversation_sessions set last_activity_at = now() - interval '1 hour' where conversation_id in (cH, cR, cA, cX) and estado = 'abierta';
  perform tests.act_as_service(); perform public.cc_sesiones_cerrar_inactivas(); perform tests.act_as_owner();
  perform tests.ok((select estado = 'abierta' from public.cc_conversation_sessions where conversation_id = cIA and ordinal = 1), 'T1 · IA < 4 h → sigue abierta');
  select count(*) into n from public.cc_messages where conversation_id = cIA;
  update public.cc_conversation_sessions set last_activity_at = now() - interval '4 hours 1 minute' where conversation_id = cIA and estado = 'abierta';
  perform tests.act_as_service(); r := public.cc_sesiones_cerrar_inactivas(); perform tests.act_as_owner();
  perform tests.ok((select estado = 'cerrada' and close_reason = 'inactividad' and closed_by_actor_type = 'system' from public.cc_conversation_sessions where conversation_id = cIA and ordinal = 1), 'T2 · IA > 4 h → sesión cerrada por inactividad');
  perform tests.eq((select count(*)::int from public.cc_messages where conversation_id = cIA), n, 'T14 · cierre IA silencioso (sin mensaje)');
  perform tests.ok((select detalle ->> 'modo_al_cerrar' = 'ai_active' and (detalle ->> 'umbral_min')::int = 240 and detalle ? 'inactiva_desde' and actor_type = 'system'
                      from public.cc_conversation_events where conversation_id = cIA and tipo = 'session_closed'), 'F · session_closed con modo, umbral e inactiva_desde');
  perform tests.ok((select estado = 'abierta' and modo = 'ai_active' from public.cc_conversations where id = cIA), 'T17 · la conversación permanente sigue abierta (ai_active)');
  perform tests.act_as_service();
  r := public.cc_enviar_mensaje(cIA, 'doctor', null, dIA, 'ia-2', 'Volví');
  perform tests.act_as_owner();
  perform tests.ok((select ordinal = 2 and estado = 'abierta' from public.cc_conversation_sessions where conversation_id = cIA and estado = 'abierta') and (select count(*) = 1 from public.cc_conversations where profile_id = dIA), 'T17 · el doctor vuelve: misma conversación, sesión 2');

  -- ══ T3/T4/T5 · humana: aviso a las 7 h, reloj reiniciado por actividad ══
  update public.cc_conversation_sessions set last_activity_at = now() - interval '6 hours 59 minutes' where conversation_id = cH and estado = 'abierta';
  perform tests.act_as_service(); perform public.cc_sesiones_cerrar_inactivas(); perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = cH and kind = 'sesion_por_cerrar'), 0, 'T3 · humana < 7 h → sin aviso');
  update public.cc_conversation_sessions set last_activity_at = now() - interval '7 hours 1 minute' where conversation_id = cH and estado = 'abierta';
  perform tests.act_as_service(); perform public.cc_sesiones_cerrar_inactivas(); perform public.cc_sesiones_cerrar_inactivas(); perform tests.act_as_owner();
  perform tests.ok((select count(*) = 1 and bool_and(user_ids = array[sH] and screen = 'asesorias' and event_key like 'cierre_aviso:%') from public.notifications where conversation_id = cH and kind = 'sesion_por_cerrar'), 'T4 · 7 h → UN aviso al asesor (idempotente)');
  perform tests.ok((select estado = 'abierta' from public.cc_conversation_sessions where conversation_id = cH and estado = 'abierta') and (select modo = 'human_active' from public.cc_conversations where id = cH), 'T4 · pero NO se cierra');
  perform tests.act_as_service(); perform public.cc_enviar_mensaje(cH, 'doctor', null, dH, 'h-3', 'Sigo aquí'); perform tests.act_as_owner();
  perform tests.ok((select last_activity_at > now() - interval '1 minute' from public.cc_conversation_sessions where conversation_id = cH and estado = 'abierta'), 'T5 · la actividad del doctor reinicia el reloj');
  perform tests.act_as_service(); perform public.cc_sesiones_cerrar_inactivas(); perform tests.act_as_owner();
  perform tests.ok((select modo = 'human_active' from public.cc_conversations where id = cH) and (select count(*) = 1 from public.notifications where conversation_id = cH and kind = 'sesion_por_cerrar'), 'T5 · sin cierre ni aviso nuevo con el reloj reiniciado');

  -- ══ T6/T15/T16 · humana > 8 h → cierre con UN mensaje de sistema y eventos correctos ══
  v_ts := now() - interval '8 hours 1 minute';
  update public.cc_conversation_sessions set last_activity_at = v_ts where conversation_id = cH and estado = 'abierta';
  select count(*) into n from public.cc_messages where conversation_id = cH;
  perform tests.act_as_service(); r := public.cc_sesiones_cerrar_inactivas(); perform tests.act_as_owner();
  perform tests.ok((r ->> 'cerradas_humanas')::int >= 1, 'T6 · el motor reporta el cierre humano');
  perform tests.ok((select estado = 'cerrada' and close_reason = 'inactividad' and closed_by_actor_type = 'system' and asesor_profile_id = sH and last_seq = (select ultimo_seq from public.cc_conversations where id = cH)
                      from public.cc_conversation_sessions where conversation_id = cH and ordinal = 1), 'T6 · sesión cerrada (inactividad, system, asesor preservado, last_seq = último)');
  perform tests.eq((select count(*)::int from public.cc_messages where conversation_id = cH), n + 1, 'T15 · exactamente UN mensaje nuevo');
  perform tests.ok((select actor_type = 'system' and content = 'Tu asesoría terminó por inactividad. Puedes escribir cuando quieras.' and client_message_id like 'sys:inactividad:%'
                           and seq = (select last_seq from public.cc_conversation_sessions where conversation_id = cH and ordinal = 1)
                      from public.cc_messages where conversation_id = cH order by seq desc limit 1), 'T15 · el aviso pertenece a la sesión (seq = last_seq)');
  perform tests.ok((select last_activity_at = v_ts from public.cc_conversation_sessions where conversation_id = cH and ordinal = 1), 'T15 · el aviso NO renovó last_activity_at');
  perform tests.eq((select count(*)::int from public.cc_conversation_events where conversation_id = cH and tipo = 'human_ended' and actor_type = 'system' and detalle ->> 'motivo' = 'inactividad'), 1, 'T15 · human_ended (system) una vez');
  perform tests.eq((select count(*)::int from public.cc_conversation_events where conversation_id = cH and tipo = 'session_closed'), 1, 'T15 · session_closed una vez');
  perform tests.ok((select modo = 'ai_active' and seller_profile_id is null and estado = 'abierta' from public.cc_conversations where id = cH), 'T6 · conversación ai_active, asesor liberado, sigue abierta');
  perform tests.eq((select seller_profile_id from public.cc_cartera where profile_id = dH), sH, 'T16 · cartera intacta (responsable comercial)');
  perform tests.ok((select left_at is not null from public.cc_participants where conversation_id = cH and rol = 'asesor'), 'T6 · el asesor deja la atención temporal');
  perform tests.eq((select count(*)::int from public.cc_conversation_sessions where conversation_id = cH and estado = 'abierta'), 0, 'T6 · el aviso no abrió otra sesión');

  -- ══ T18 · segunda ejecución → idempotente ══
  select (select count(*) from public.cc_conversation_events) ev, (select count(*) from public.cc_messages) ms, (select count(*) from public.notifications) nt into antes;
  perform tests.act_as_service(); perform public.cc_sesiones_cerrar_inactivas(); perform tests.act_as_owner();
  perform tests.ok((select count(*) from public.cc_conversation_events) = antes.ev and (select count(*) from public.cc_messages) = antes.ms and (select count(*) from public.notifications) = antes.nt, 'T18 · sin eventos, mensajes ni avisos duplicados');

  -- ══ T7/T8 · solicitud sin vendedor ══
  update public.cc_conversation_sessions set last_activity_at = now() - interval '23 hours' where conversation_id = cR and estado = 'abierta';
  perform tests.act_as_service(); perform public.cc_sesiones_cerrar_inactivas(); perform tests.act_as_owner();
  perform tests.ok((select modo = 'human_requested' from public.cc_conversations where id = cR), 'T7 · < 24 h → la solicitud sigue');
  update public.cc_conversation_sessions set last_activity_at = now() - interval '24 hours 1 minute' where conversation_id = cR and estado = 'abierta';
  select count(*) into n from public.cc_messages where conversation_id = cR;
  perform tests.act_as_service(); perform public.cc_sesiones_cerrar_inactivas(); perform public.cc_sesiones_cerrar_inactivas(); perform tests.act_as_owner();
  perform tests.ok((select estado = 'cerrada' and close_reason = 'solicitud_expirada' from public.cc_conversation_sessions where conversation_id = cR and ordinal = 1), 'T8 · > 24 h → solicitud expirada (sesión cerrada)');
  perform tests.ok((select modo = 'ai_active' and estado = 'abierta' from public.cc_conversations where id = cR), 'T8 · IA disponible, conversación abierta');
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = cR and kind = 'solicitud_expirada' and 'admin' = any(roles)), 1, 'T8 · UNA notificación a Dirección');
  perform tests.eq((select count(*)::int from public.cc_messages where conversation_id = cR), n, 'T8 · sin mensaje visible');
  perform tests.act_as_service(); r := public.cc_solicitar_asesor(cR, 'doctor', null, dR); perform tests.act_as_owner();
  perform tests.eq(r ->> 'modo', 'human_requested', 'T8 · el doctor puede volver a solicitar asesor (nueva sesión)');
  perform tests.ok((select ordinal = 2 from public.cc_conversation_sessions where conversation_id = cR and estado = 'abierta'), 'T8 · la nueva solicitud vive en la sesión 2');

  -- ══ T9 · solicitud asignada (SLA 3/7 de CHV2-A) > 24 h → expira sin romper el SLA ══
  update public.cc_conversation_sessions set last_activity_at = now() - interval '24 hours 1 minute' where conversation_id = cA and estado = 'abierta';
  perform tests.act_as_service(); perform public.cc_sesiones_cerrar_inactivas(); perform tests.act_as_owner();
  perform tests.ok((select close_reason = 'solicitud_expirada' from public.cc_conversation_sessions where conversation_id = cA and ordinal = 1) and (select modo = 'ai_active' and seller_profile_id is null from public.cc_conversations where id = cA), 'T9 · asignada > 24 h → expira y libera');
  perform tests.eq((select seller_profile_id from public.cc_cartera where profile_id = dA), sA, 'T9 · cartera intacta');
  perform tests.act_as_service(); r := public.cc_atencion_evaluar(); perform tests.act_as_owner();
  perform tests.ok(r ? 'evaluadas' and public._cc_atencion(cA) ->> 'estado' = 'ia', 'T9 · el evaluador SLA 3/7 sigue funcionando y ya no ve la solicitud expirada');

  -- ══ R4/R5 · tomar o reasignar una solicitud ya expirada falla limpio ══
  perform tests.act_as_service();
  perform tests.throws(format('select public.cc_iniciar_asesoria(%L, %L)', cA, sA), 'NO_AUTORIZADO', 'R4 · tomar una solicitud expirada falla limpio');
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.cc_solicitud_reasignar(%L, %L, ''tarde'')', cA, sH), 'SOLICITUD_NO_REASIGNABLE', 'R5 · reasignar una solicitud expirada falla limpio');
  perform tests.act_as_owner();
  perform tests.ok((select modo = 'ai_active' from public.cc_conversations where id = cA), 'R4/R5 · nunca queda human_active sobre una sesión cerrada');

  -- ══ T10/T11/T12/T13 · autoridad de actividad ══
  perform tests.act_as_service();
  cT := (public.cc_abrir_conversacion(null, dT) ->> 'conversation_id')::uuid; perform public.cc_enviar_mensaje(cT, 'doctor', null, dT, 't-1', 'Hola');
  perform tests.act_as_owner();
  v_ts := now() - interval '2 hours';
  update public.cc_conversation_sessions set last_activity_at = v_ts where conversation_id = cT and estado = 'abierta';
  perform public._cc_sistema(cT, 'Tu conversación volvió a la cola de asesores.', 'sys:cola:prueba');
  perform tests.ok((select last_activity_at = v_ts from public.cc_conversation_sessions where conversation_id = cT and estado = 'abierta'), 'T10 · sys administrativo NO renueva');
  perform tests.act_as_service(); perform public.cc_marcar_leido(cT, 'doctor', null, dT, 99); perform tests.act_as_owner();
  perform tests.ok((select last_activity_at = v_ts from public.cc_conversation_sessions where conversation_id = cT and estado = 'abierta'), 'T13 · leer / cursor NO renueva');
  perform tests.act_as_service(); perform public.cc_solicitar_asesor(cT, 'doctor', null, dT); perform tests.act_as_owner();
  perform tests.ok((select last_activity_at > v_ts + interval '1 hour' from public.cc_conversation_sessions where conversation_id = cT and estado = 'abierta'), 'T11 · sys:solicitud (acto del doctor) SÍ renueva');
  -- T12: con cartera, la solicitud queda asignada y el inicio del asesor renueva
  perform tests.act_as_service();
  cM := (public.cc_abrir_conversacion(null, dM) ->> 'conversation_id')::uuid; perform public.cc_enviar_mensaje(cM, 'doctor', null, dM, 'm-1', 'Hola'); perform public.cc_solicitar_asesor(cM, 'doctor', null, dM);
  perform tests.act_as_owner();
  update public.cc_conversation_sessions set last_activity_at = v_ts where conversation_id = cM and estado = 'abierta';
  perform tests.act_as_service(); perform public.cc_iniciar_asesoria(cM, sH); perform tests.act_as_owner();
  perform tests.ok((select last_activity_at > v_ts + interval '1 hour' from public.cc_conversation_sessions where conversation_id = cM and estado = 'abierta'), 'T12 · sys:inicio (acto del asesor) SÍ renueva');

  -- ══ R7 · cierre manual previo → el motor no hace nada ══
  update public.cc_conversation_sessions set last_activity_at = now() - interval '9 hours' where conversation_id = cM and estado = 'abierta';
  perform tests.act_as_service(); perform public.cc_terminar_asesoria(cM, sH); perform tests.act_as_owner();
  select (select count(*) from public.cc_conversation_events where conversation_id = cM) ev, (select count(*) from public.cc_messages where conversation_id = cM) ms into antes;
  perform tests.act_as_service(); perform public.cc_sesiones_cerrar_inactivas(); perform tests.act_as_owner();
  perform tests.ok((select count(*) from public.cc_conversation_events where conversation_id = cM) = antes.ev and (select count(*) from public.cc_messages where conversation_id = cM) = antes.ms, 'R7 · tras un cierre manual el motor es no-op');
  perform tests.ok((select close_reason = 'asesor_finalizo' from public.cc_conversation_sessions where conversation_id = cM and ordinal = 1), 'R7 · se conserva el motivo manual');

  -- ══ R2/R8 · respuesta de IA de una sesión cerrada por inactividad → descartada ══
  perform tests.act_as_service();
  r := public.cc_enviar_mensaje(cX, 'doctor', null, dX, 'x-2', '¿Precio?'); v_seq := (r ->> 'seq')::bigint;
  r := public.cc_ia_turno_reclamar(cX, v_seq, 'prueba', 'modelo'); t := (r ->> 'turn_id')::uuid;
  perform tests.act_as_owner();
  update public.cc_conversation_sessions set last_activity_at = now() - interval '5 hours' where conversation_id = cX and estado = 'abierta';
  perform tests.act_as_service(); perform public.cc_sesiones_cerrar_inactivas();
  r := public.cc_ia_turno_responder(t, 'Respuesta tardía');
  perform tests.ok(not (r ->> 'persistido')::boolean and r ->> 'motivo' = 'sesion_cambiada', 'R2/R8 · la IA no escribe en la sesión cerrada (sesion_cambiada)');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.cc_conversation_sessions where conversation_id = cX), 1, 'R2/R8 · y no abre una sesión nueva');
end $t$;
rollback;
