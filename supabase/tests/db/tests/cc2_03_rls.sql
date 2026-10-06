-- CC-2 · Lectura directa (RLS) para autenticados: dueño, asesor asignado y Dirección; nada
-- más. Sin escritura directa para nadie. Anon nada. Eventos solo Dirección.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin(); v_doc uuid := tests.user('doctor'); v_doc2 uuid := tests.user('doctor');
  v_pos uuid := tests.user('pos'); v_pos2 uuid := tests.user('pos'); v_wh uuid := tests.user('warehouse');
  hA text := repeat('a', 64); cA uuid; cD uuid;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta,'{}') || '{"capabilities":["conversaciones"]}' where id in (v_pos, v_pos2);
  perform public.cc_visitante_abrir(null, hA, '{}'::jsonb, null);
  cA := (public.cc_abrir_conversacion(hA, null) ->> 'conversation_id')::uuid;
  perform public.cc_enviar_mensaje(cA, 'visitor', hA, null, 'c:1', 'visitante');
  cD := (public.cc_abrir_conversacion(null, v_doc) ->> 'conversation_id')::uuid;
  perform public.cc_enviar_mensaje(cD, 'doctor', null, v_doc, 'd:1', 'doctor');
  perform public.cc_solicitar_asesor(cD, 'doctor', null, v_doc);
  perform public.cc_asignar_asesor(cD, v_admin, v_pos);   -- CC-7 · asigna Dirección

  perform tests.act_as(v_doc);
  perform tests.eq((select count(*)::int from public.cc_conversations), 1, '25 · el doctor ve solo su conversación');
  perform tests.eq((select count(*)::int from public.cc_messages), 2, 'y solo los mensajes de su conversación (el suyo + el de sistema al pedir asesor)');
  perform tests.eq((select count(*)::int from public.cc_participants), 2, 'participantes de su conversación (él y el asesor)');
  perform tests.eq((select count(*)::int from public.cc_conversation_events), 0, 'los eventos no son para el doctor');
  perform tests.throws(format('update public.cc_conversations set modo = ''ai_active'' where id = %L', cD), 'permission denied', 'el doctor no escribe la conversación');
  perform tests.throws(format('insert into public.cc_messages (conversation_id, seq, actor_type, actor_profile_id, content, content_hash) values (%L, 9, ''doctor'', %L, ''x'', ''y'')', cD, v_doc), 'permission denied', 'ni inserta mensajes');
  perform tests.throws(format('update public.cc_participants set last_read_seq = 99 where conversation_id = %L', cD), 'permission denied', 'ni toca su read state a mano');

  perform tests.act_as(v_doc2);
  perform tests.eq((select count(*)::int from public.cc_conversations), 0, '25 · otro doctor no ve nada');
  perform tests.act_as(v_pos);
  perform tests.eq((select count(*)::int from public.cc_conversations), 1, '30 · el asesor asignado ve la asignada');
  perform tests.eq((select count(*)::int from public.cc_messages where conversation_id = cA), 0, '30 · y no la del visitante');
  perform tests.act_as(v_pos2);
  perform tests.eq((select count(*)::int from public.cc_conversations), 0, '5 · asesor no asignado no ve ninguna por RLS');
  perform tests.act_as(v_wh);
  perform tests.eq((select count(*)::int from public.cc_conversations), 0, 'almacén no ve conversaciones');
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*)::int from public.cc_conversations), 2, 'Dirección ve todas');
  perform tests.ok((select count(*) from public.cc_conversation_events) >= 3, 'Dirección lee los eventos');
  perform tests.act_as_anon();
  perform tests.throws('select count(*) from public.cc_conversations', 'permission denied', '24 · anon nada');
  perform tests.throws('select count(*) from public.cc_participants', 'permission denied', 'anon nada (participantes)');
  perform tests.act_as_owner();
  -- suspensión: el asesor pierde la lectura directa también (auth_role falla cerrado)
  perform tests.suspender(v_pos, 'prueba');
  perform tests.act_as(v_pos);
  perform tests.throws('select count(*) from public.cc_conversations', 'CUENTA_SUSPENDIDA', '7 · suspendido: la RLS también lo niega');
  perform tests.act_as_owner();
  perform tests.ok(not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename like 'cc\_%'), 'U · ninguna tabla cc_* publicada en realtime (transporte = Edge/polling)');
end $t$;
rollback;
