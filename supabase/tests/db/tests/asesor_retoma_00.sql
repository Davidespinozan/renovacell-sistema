-- RETOMA DEL ASESOR (20270304) · caso real de la Dra. Muciño: el asesor que la atendió la recupera si ella vuelve a
-- escribir dentro de 24 h de un cierre por inactividad (en horario se le asigna y al cliente se le dice; fuera de horario
-- solo se le avisa). Un contacto sin cartera recuerda a quien lo atendió para su siguiente solicitud. La cartera gana.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos');
  r jsonb; c1 uuid; c2 uuid; c3 uuid; semana jsonb; t text; h1 text; h3 text;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id in (s1, s2);
  perform tests.act_as_owner();
  update public.cc_wa_config set modo = 'activo', ia_habilitada = true where id;   -- como en producción: la IA atiende WhatsApp
  update public.cc_atencion_config set sesion_humana_min = 480, sesion_ia_min = 1440, solicitud_expira_min = 1440, sesion_aviso_previo_min = null where id = 1;
  perform tests.act_as(v_admin);
  semana := (select jsonb_agg(jsonb_build_object('dia', g, 'abierto', true, 'abre', '00:00', 'cierra', '23:59:59.999999')) from generate_series(1, 7) g);
  perform public.cc_horario_guardar('America/Mazatlan', semana);
  perform tests.act_as_service();

  -- ══ 1 · la atiende s1 y se cierra por inactividad ══
  r := public.cc_wa_entrante('5216670000001', 'Kattya', 'wamid.RT.1', 'Quiero 10 botox', false); c1 := (r ->> 'conversation_id')::uuid;
  select visitor_hash into h1 from public.cc_wa_contactos where wa_id = '5216670000001';
  perform public.cc_solicitar_asesor(c1, 'visitor', h1, null);
  perform tests.act_as_owner(); perform public._cc_handler_asignar(c1, s1, 'admin', v_admin, null, 'direccion'); perform tests.act_as_service();
  perform public.cc_iniciar_asesoria(c1, s1);
  perform public.cc_enviar_mensaje(c1, 'seller', null, s1, 's-rt-1', '¿Con quién tengo el gusto?');
  perform tests.ok((select ultimo_asesor_id from public.cc_conversations where id = c1) = s1, '1 · se recuerda quién la atendió');
  update public.cc_conversation_sessions set last_activity_at = now() - interval '9 hours' where conversation_id = c1 and estado = 'abierta';
  perform public.cc_sesiones_cerrar_inactivas();
  perform tests.ok((select modo = 'ai_active' and seller_profile_id is null and ultimo_asesor_id = s1 from public.cc_conversations where id = c1), '1 · cierre por inactividad: vuelve a la IA pero se sigue sabiendo quién la atendió');

  -- ══ 2 · contesta dentro de 24 h, en horario: regresa con s1 y se le dice ══
  r := public.cc_wa_entrante('5216670000001', 'Kattya', 'wamid.RT.2', 'Con Kattya Muciño, doctora', false);
  perform tests.ok((select modo = 'human_assigned' and seller_profile_id = s1 from public.cc_conversations where id = c1) and r ->> 'modo' = 'human_assigned', '2 · regresa con el mismo asesor (y la IA ya no toma el turno)');
  select content into t from public.cc_messages where conversation_id = c1 and client_message_id like 'sys:solicitud:retoma:%';
  perform tests.ok(t like 'Ya le avisé a%quien te atendió%', '2 · al cliente se le dice que su asesor ya sabe (y sale por WhatsApp: prefijo permitido)');
  perform tests.ok(exists (select 1 from public.notifications where kind = 'handoff_asignado' and s1 = any (user_ids) and conversation_id = c1), '2 · el asesor recibe la alerta');
  perform tests.ok(exists (select 1 from public.cc_wa_salida where conversation_id = c1 and texto like 'Ya le avisé%'), '2 · el aviso sale por WhatsApp');

  -- ══ 3 · fuera de horario: la IA atiende y al asesor solo se le avisa ══
  r := public.cc_wa_entrante('5216670000003', 'Luis', 'wamid.RT.3', 'Hola', false); c3 := (r ->> 'conversation_id')::uuid;
  select visitor_hash into h3 from public.cc_wa_contactos where wa_id = '5216670000003';
  perform public.cc_solicitar_asesor(c3, 'visitor', h3, null);
  perform tests.act_as_owner(); perform public._cc_handler_asignar(c3, s2, 'admin', v_admin, null, 'direccion'); perform tests.act_as_service();
  perform public.cc_iniciar_asesoria(c3, s2);
  update public.cc_conversation_sessions set last_activity_at = now() - interval '9 hours' where conversation_id = c3 and estado = 'abierta';
  perform public.cc_sesiones_cerrar_inactivas();
  perform tests.act_as(v_admin);
  semana := (select jsonb_agg(jsonb_build_object('dia', g, 'abierto', false)) from generate_series(1, 7) g);
  perform public.cc_horario_guardar('America/Mazatlan', semana);
  perform tests.act_as_service();
  r := public.cc_wa_entrante('5216670000003', 'Luis', 'wamid.RT.4', 'Sigo interesado', false);
  perform tests.ok((select modo = 'ai_active' from public.cc_conversations where id = c3), '3 · fuera de horario la IA sigue atendiendo');
  perform tests.ok(exists (select 1 from public.notifications where kind = 'retoma' and s2 = any (user_ids) and conversation_id = c3), '3 · y al asesor se le avisa');

  -- ══ 4 · sin cartera, su siguiente solicitud va con quien lo atendió (no al reparto) ══
  perform tests.act_as(v_admin);
  semana := (select jsonb_agg(jsonb_build_object('dia', g, 'abierto', true, 'abre', '00:00', 'cierra', '23:59:59.999999')) from generate_series(1, 7) g);
  perform public.cc_horario_guardar('America/Mazatlan', semana);
  perform tests.act_as_service();
  r := public.cc_wa_entrante('5216670000002', 'Ana', 'wamid.RT.5', 'Hola', false); c2 := (r ->> 'conversation_id')::uuid;
  perform tests.act_as_owner(); update public.cc_conversations set ultimo_asesor_id = s2 where id = c2; perform tests.act_as_service();
  perform public.cc_solicitar_asesor(c2, 'visitor', (select visitor_hash from public.cc_wa_contactos where wa_id = '5216670000002'), null);
  perform tests.ok((select seller_profile_id = s2 and modo = 'human_assigned' from public.cc_conversations where id = c2), '4 · va con su último asesor');
  perform tests.ok(not has_function_privilege('authenticated', 'public._cc_retoma_tr()', 'EXECUTE'), '5 · los disparadores no los ejecuta un cliente');
end $t$;
rollback;
