-- TERMINAR-SOLICITUD (20270205) · una solicitud de asesor que nadie inició también se puede terminar: Dirección
-- cualquiera, el vendedor solo la suya; vuelve a la IA, se cierra la sesión y se limpia el ruteo.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); v_pos uuid := tests.user('pos'); v_pos2 uuid := tests.user('pos');
  hA text := repeat('c', 64); hB text := repeat('d', 64); cA uuid; cB uuid; r jsonb;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta,'{}') || '{"capabilities":["conversaciones"]}' where id in (v_pos, v_pos2);
  perform public.cc_visitante_abrir(null, hA, '{}'::jsonb, null);
  perform public.cc_visitante_abrir(null, hB, '{}'::jsonb, null);
  cA := (public.cc_abrir_conversacion(hA, null) ->> 'conversation_id')::uuid;
  cB := (public.cc_abrir_conversacion(hB, null) ->> 'conversation_id')::uuid;
  perform public.cc_enviar_mensaje(cA, 'visitor', hA, null, 'a:1', 'Quiero hablar con alguien');
  perform public.cc_enviar_mensaje(cB, 'visitor', hB, null, 'b:1', 'Hola');
  perform public.cc_solicitar_asesor(cA, 'visitor', hA, null);
  perform public.cc_solicitar_asesor(cB, 'visitor', hB, null);

  -- ══ 1 · sin vendedor (human_requested): el vendedor NO puede, Dirección SÍ ══
  perform tests.eq((select modo from public.cc_conversations where id = cA), 'human_requested', '1 · la solicitud espera asesor');
  perform tests.throws(format('select public.cc_terminar_asesoria(%L, %L)', cA, v_pos), 'NO_AUTORIZADO', '1 · un vendedor no termina una solicitud sin asignar');
  r := public.cc_terminar_asesoria(cA, v_admin);
  perform tests.ok(r ->> 'modo' = 'ai_active' and (r ->> 'iniciada')::boolean = false, '1 · Dirección la termina: vuelve a la IA (iniciada = false)');
  perform tests.ok((select seller_profile_id is null and asesoria_solicitada_at is null and ruteo_motivo is null and reparto_probados = '{}' from public.cc_conversations where id = cA), '1 · ruteo, reparto y marcas limpios');
  perform tests.ok(exists (select 1 from public.cc_conversation_sessions where conversation_id = cA and estado = 'cerrada' and close_reason = 'direccion_finalizo'), '1 · la sesión queda cerrada por Dirección');
  perform tests.ok(exists (select 1 from public.cc_messages where conversation_id = cA and content like 'Cerramos esta solicitud de asesor%'), '1 · el cliente ve el aviso de cierre de la solicitud');
  perform tests.ok(not exists (select 1 from public.cc_messages where conversation_id = cA and content like 'La asesoría terminó%'), '1 · no se le dice que una asesoría terminó (nunca empezó)');
  r := public.cc_terminar_asesoria(cA, v_admin);
  perform tests.ok((r ->> 'idempotente')::boolean, '1 · repetirlo no hace nada');

  -- ══ 2 · asignada sin iniciar (human_assigned): otro vendedor NO, el asignado SÍ ══
  perform public.cc_asignar_asesor(cB, v_admin, v_pos);
  perform tests.eq((select modo from public.cc_conversations where id = cB), 'human_assigned', '2 · asignada a un vendedor, sin iniciar');
  perform tests.throws(format('select public.cc_terminar_asesoria(%L, %L)', cB, v_pos2), 'NO_AUTORIZADO', '2 · otro vendedor no la termina');
  r := public.cc_terminar_asesoria(cB, v_pos);
  perform tests.eq(r ->> 'modo', 'ai_active', '2 · el vendedor asignado la termina');
  perform tests.ok(exists (select 1 from public.cc_conversation_sessions where conversation_id = cB and estado = 'cerrada' and close_reason = 'asesor_finalizo'), '2 · sesión cerrada por el asesor');

  -- ══ 3 · sin solicitud (ai_active) sigue sin ser "terminable" para un vendedor ══
  perform tests.throws(format('select public.cc_terminar_asesoria(%L, %L)', cB, v_pos2), 'NO_AUTORIZADO', '3 · sin solicitud, un tercero no obtiene nada');

  -- ══ 4 · el cliente puede volver a pedir asesor después ══
  perform public.cc_enviar_mensaje(cA, 'visitor', hA, null, 'a:2', 'Otra vez');
  r := public.cc_solicitar_asesor(cA, 'visitor', hA, null);
  perform tests.eq((select modo from public.cc_conversations where id = cA), 'human_requested', '4 · tras cerrarla, el cliente puede volver a pedir asesor');
end $t$;
rollback;
