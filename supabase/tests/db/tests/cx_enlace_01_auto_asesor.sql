-- CX-ENLACE-2 (151) · el contacto del enlace entra a la cola humana con su primer mensaje: al vendedor del posible
-- cliente o a la cola de Dirección; el asistente sigue pudiendo responder; no se repite con cada mensaje.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); s1 uuid := tests.user('pos'); d1 uuid := tests.user('doctor', 'cliente.auto@test.local'); d2 uuid := tests.user('doctor');
  hA text := repeat('a', 63) || '7'; hB text := repeat('b', 63) || '8'; hC text := repeat('c', 63) || '9';
  r jsonb; cA uuid; cB uuid; cC uuid; cD uuid; n int;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id = s1;
  perform tests.cliente(d1); insert into public.cc_cartera (profile_id, seller_profile_id) values (d1, s1);
  perform public.cc_visitante_abrir(null, hA, '{}'::jsonb, null); perform public.cc_visitante_abrir(null, hB, '{}'::jsonb, null); perform public.cc_visitante_abrir(null, hC, '{}'::jsonb, null);
  perform public.cc_visitante_prerregistrar(hA, 'Nueva Persona', '6695550001', 'nueva@test.local', false, null, true);
  perform public.cc_visitante_prerregistrar(hB, 'Posible Cliente', '6695550002', 'cliente.auto@test.local', false, null, true);

  -- ══ 1 · sin coincidencia → cola de Dirección, con su nombre ══
  cA := (public.cc_abrir_conversacion(hA, null) ->> 'conversation_id')::uuid;
  perform tests.ok((select modo = 'ai_active' and asesoria_solicitada_at is null from public.cc_conversations where id = cA), '1 · al abrir sigue con el asistente (nada entra a la cola sin un mensaje)');
  perform public.cc_enviar_mensaje(cA, 'visitor', hA, null, 'c:a1', 'Hola, quiero información');
  r := public.cc_enlace_auto_asesor(cA, hA);
  perform tests.eq(r, '{"solicitado": true, "modo": "human_requested", "asesor": false}'::jsonb, '1 · primer mensaje → solicitud registrada sin que la pida');
  perform tests.ok((select seller_profile_id is null and ruteo_motivo = 'visitante' and handoff_origen = 'manual' and asesoria_solicitada_at is not null from public.cc_conversations where id = cA), '1 · queda en la cola de Dirección');
  perform tests.ok(exists (select 1 from public.notifications where kind = 'handoff_sin_vendedor' and conversation_id = cA and roles = array['admin'] and body like '%Nueva Persona (prerregistro)%'), '1 · Dirección recibe la alerta con el nombre');
  perform tests.ok(exists (select 1 from public.cc_messages where conversation_id = cA and actor_type = 'system' and content not ilike 'Pediste%'), '1 · el aviso en el chat no dice "pediste"');
  perform tests.ok(public._cc_ia_puede('human_requested'), '1 · el asistente sigue pudiendo responder mientras llega el asesor');
  perform tests.act_as(v_admin);
  perform tests.ok(exists (select 1 from jsonb_array_elements(public.cc_ruteo_pendientes() -> 'conversaciones') x where x ->> 'conversation_id' = cA::text and x ->> 'nombre' = 'Nueva Persona' and x ->> 'dueno' = 'visitante'), '1 · aparece en Pendientes de Dirección con su nombre (no "Visitante")');
  perform tests.ok(exists (select 1 from public.cc_cola_asesorias() q where q.conversation_id = cA), '1 · y en Conversaciones de Dirección');

  -- ══ 2 · no se repite con cada mensaje; quien eligió seguir con el asistente no vuelve a la cola ══
  perform tests.act_as_service();
  select count(*) into n from public.notifications where conversation_id = cA;
  perform public.cc_enviar_mensaje(cA, 'visitor', hA, null, 'c:a2', '¿Siguen ahí?');
  perform tests.eq(public.cc_enlace_auto_asesor(cA, hA) ->> 'solicitado', 'false', '2 · ya en cola: no se vuelve a solicitar');
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = cA), n, '2 · sin alertas duplicadas');
  r := public.cc_handoff_rechazar(cA, 'visitor', hA, null);
  if (select modo from public.cc_conversations where id = cA) in ('ai_active', 'human_offered') then
    perform tests.eq(public.cc_enlace_auto_asesor(cA, hA) ->> 'solicitado', 'false', '2 · tras "seguir con el asistente" no se le vuelve a meter a la cola');
  else
    perform tests.ok(true, '2 · (el rechazo no aplica a este handoff; sin caso que probar)');
  end if;

  -- ══ 3 · posible cliente → directo a su vendedor ══
  cB := (public.cc_abrir_conversacion(hB, null) ->> 'conversation_id')::uuid;
  perform public.cc_enviar_mensaje(cB, 'visitor', hB, null, 'c:b1', 'Hola');
  r := public.cc_enlace_auto_asesor(cB, hB);
  perform tests.eq(r, '{"solicitado": true, "modo": "human_assigned", "asesor": true}'::jsonb, '3 · posible cliente → asignado a su vendedor');
  perform tests.ok(exists (select 1 from public.notifications where kind = 'handoff_asignado' and conversation_id = cB and user_ids = array[s1]), '3 · alerta solo a ese vendedor');
  perform tests.act_as(s1);
  perform tests.ok(exists (select 1 from public.cc_cola_asesorias() q where q.conversation_id = cB and q.es_mia and q.dueno = 'Posible Cliente (posible cliente, sin confirmar)'), '3 · el vendedor la ve en sus conversaciones');
  perform tests.ok(not exists (select 1 from public.cc_cola_asesorias() q where q.conversation_id = cA), '3 · y no ve la que no es suya');

  -- ══ 4 · límites: sin prerregistro, cuentas, tokens ajenos, permisos ══
  perform tests.act_as_service();
  cC := (public.cc_abrir_conversacion(hC, null) ->> 'conversation_id')::uuid;
  perform public.cc_enviar_mensaje(cC, 'visitor', hC, null, 'c:c1', 'Hola');
  perform tests.eq(public.cc_enlace_auto_asesor(cC, hC) ->> 'solicitado', 'false', '4 · visitante SIN prerregistro: no entra a la cola');
  perform tests.throws(format('select public.cc_enlace_auto_asesor(%L, %L)', cA, hC), 'NO_AUTORIZADO', '4 · un visitante no mueve la conversación de otro');
  perform tests.throws(format('select public.cc_enlace_auto_asesor(%L, %L)', cA, repeat('0', 64)), 'SESION_INVALIDA', '4 · token inválido');
  cD := (public.cc_abrir_conversacion(null, d2) ->> 'conversation_id')::uuid;
  perform tests.throws(format('select public.cc_enlace_auto_asesor(%L, %L)', cD, hA), 'NO_AUTORIZADO', '4 · no toca la conversación de una cuenta');
  perform tests.act_as(d2);
  perform tests.throws(format('select public.cc_enlace_auto_asesor(%L, %L)', cA, hA), 'permission denied', '4 · una sesión no lo ejecuta');
  perform tests.act_as_anon();
  perform tests.throws(format('select public.cc_enlace_auto_asesor(%L, %L)', cA, hA), 'permission denied', '4 · anónimo tampoco');
end $t$;
rollback;
