-- IA EXAMEN (20270228) · modelo del portal y examen solo de Dirección; la Edge (service_role) lee el caso y registra;
-- la comparación IA vs equipo sale de mensajes reales. Los clientes no leen ni escriben las tablas.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); v_doc uuid := tests.user('doctor'); v_pos uuid := tests.user('pos'); v_nov uuid := tests.user('doctor');
  r jsonb; v_corr uuid; v_conv uuid; ok boolean;
begin
  perform tests.act_as_service(); update public.profiles set verified = false where id = v_nov;
  perform tests.ok((select count(*) from public.cc_ia_examen_casos) = 60, '0 · 60 casos sembrados');

  -- ══ 1 · modelo del portal ══
  perform tests.act_as(v_admin);
  r := public.ia_config();
  perform tests.ok(r ->> 'modelo_portal' is null and jsonb_array_length(r -> 'modelos') = 4, '1 · sin modelo elegido: el de siempre');
  r := public.ia_config_guardar('claude-sonnet-5-5', 'medium');
  perform tests.ok(r ->> 'modelo_portal' = 'claude-sonnet-5-5' and r ->> 'esfuerzo_portal' = 'medium', '1 · Dirección elige modelo y esfuerzo');
  begin perform public.ia_config_guardar('gpt-4', 'low'); ok := false; exception when check_violation then ok := true; end;
  perform tests.ok(ok, '1 · un modelo fuera de la lista se rechaza');
  perform tests.ok((public.ia_config_guardar('', 'low') ->> 'modelo_portal') is null, '1 · vacío regresa al de siempre');
  perform tests.act_as(v_pos);
  begin perform public.ia_config_guardar('claude-opus-5-5', 'low'); ok := false; exception when insufficient_privilege then ok := true; end;
  perform tests.ok(ok, '1 · un vendedor no cambia el modelo');

  -- ══ 2 · corrida del examen ══
  perform tests.act_as(v_admin);
  begin perform public.ia_examen_crear('claude-opus-5-5', v_nov); ok := false; exception when check_violation then ok := true; end;
  perform tests.ok(ok, '2 · se corre como doctor verificado (no sin verificar)');
  v_corr := public.ia_examen_crear('claude-opus-5-5', v_doc, 'low', array['P01', 'C04']);
  perform tests.act_as_service();
  perform tests.ok((select casos from public.cc_ia_examen_corridas where id = v_corr) = array['C04', 'P01'], '2 · corrida con los casos pedidos');
  perform tests.act_as(v_admin);
  begin perform public.ia_examen_caso(v_corr, 'P01'); ok := false; exception when insufficient_privilege then ok := true; end;
  perform tests.ok(ok, '2 · el caso solo lo lee la Edge');
  perform tests.act_as_service();
  r := public.ia_examen_caso(v_corr, 'P01');
  perform tests.ok(r ->> 'modelo' = 'claude-opus-5-5' and (r ->> 'perfil_id')::uuid = v_doc and r -> 'caso' ->> 'id' = 'P01', '2 · la Edge lee corrida + caso');
  perform tests.ok(public.ia_examen_caso(v_corr, 'S01') is null, '2 · un caso fuera de la corrida no se lee');
  perform public.ia_examen_registrar(v_corr, 'P01', '{"respuesta":"ok","estado":"respondio","latencia_ms":4000,"tokens_in":1000,"tokens_out":200,"costo_usd":0.008,"puntaje":8.5,"aprobado":true,"evidencia":["PRICE_EVIDENCE"]}');
  perform public.ia_examen_registrar(v_corr, 'C04', '{"respuesta":"x","estado":"respondio","motivo_validacion":"clinico_sin_evidencia","latencia_ms":6000,"puntaje":3,"aprobado":false}');
  perform public.ia_examen_registrar(v_corr, 'C04', '{"respuesta":"y","estado":"respondio","latencia_ms":5000,"puntaje":9,"aprobado":true}');
  perform tests.act_as(v_admin);
  r := public.ia_examen_corridas() -> 0;
  perform tests.ok((r ->> 'corridos')::int = 2 and (r ->> 'aprobados')::int = 2 and (r ->> 'puntaje')::numeric = 8.8 and (r ->> 'rechazos_validacion')::int = 0, '2 · resumen: re-correr un caso lo reemplaza');
  perform tests.ok(jsonb_array_length(public.ia_examen_resultados(v_corr)) = 2, '2 · detalle por caso');

  -- ══ 3 · IA vs equipo ══
  perform tests.act_as_service();
  insert into public.cc_conversations (profile_id, estado, modo, last_message_at) values (v_doc, 'abierta', 'ai_active', now()) returning id into v_conv;
  insert into public.cc_messages (conversation_id, seq, actor_type, actor_profile_id, client_message_id, content, content_hash, created_at) values
    (v_conv, 1, 'doctor', v_doc, 'c:1', 'hola', md5('hola'), now() - interval '10 min'), (v_conv, 2, 'ai', null, 'ai:2', 'hola doc', md5('hola doc'), now() - interval '9 min 50 sec'),
    (v_conv, 3, 'doctor', v_doc, 'c:3', 'precio', md5('precio'), now() - interval '5 min'), (v_conv, 4, 'seller', v_pos, 'c:4', 'te paso', md5('te paso'), now() - interval '3 min');
  perform tests.act_as(v_admin);
  r := public.ia_vs_humano(30);
  perform tests.ok((r -> 'respuestas' -> 'ia' ->> 'n')::int >= 1 and (r -> 'respuestas' -> 'equipo' ->> 'n')::int >= 1 and (r -> 'conversaciones' -> 'equipo' ->> 'n')::int >= 1, '3 · respuestas y conversaciones por quién atendió');
  perform tests.act_as(v_doc);
  begin perform public.ia_vs_humano(30); ok := false; exception when insufficient_privilege then ok := true; end;
  perform tests.ok(ok, '3 · solo Dirección');
  perform tests.ok(not has_table_privilege('authenticated', 'public.cc_ia_examen_resultados', 'SELECT') and not has_table_privilege('authenticated', 'public.cc_ia_config', 'UPDATE'), '4 · sin acceso directo a las tablas');
end $t$;
rollback;
