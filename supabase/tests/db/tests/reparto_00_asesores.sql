-- REPARTO DE ASESORÍAS (181) · sin vendedor de cartera, la solicitud se reparte al azar entre los vendedores elegibles para
-- nuevos; si nadie la inicia en el plazo, el evaluador la pasa a otro; agotados, nueva vuelta (sin vendedores, Dirección). Quien la toma se queda con la
-- cartera. Con el reparto apagado, todo sigue como en CC-7/CHV2-A (Dirección). Horario 24/7 para medir minutos hábiles.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin();
  d1 uuid := tests.user('doctor'); d2 uuid := tests.user('doctor'); d3 uuid := tests.user('doctor'); d4 uuid := tests.user('doctor');
  s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos'); s3 uuid := tests.user('pos'); sNo uuid := tests.user('pos'); v_pos uuid := tests.user('pos');
  c1 uuid; c2 uuid; c3 uuid; c4 uuid; cv uuid; r jsonb; a jsonb; v1 uuid; v2 uuid; v3 uuid; n int; semana jsonb; hV text := repeat('a', 64); zona text := 'America/Mazatlan';
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id in (s1, s2, s3);
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones"]}' where id = sNo;   -- atiende, pero NO recibe clientes nuevos
  perform tests.cliente(d1); perform tests.cliente(d2); perform tests.cliente(d3); perform tests.cliente(d4);
  insert into public.cc_cartera (profile_id, seller_profile_id) values (d4, sNo);
  perform tests.act_as(v_admin);
  semana := (select jsonb_agg(jsonb_build_object('dia', g, 'abierto', true, 'abre', '00:00', 'cierra', '23:59:59.999999')) from generate_series(1, 7) g);
  perform public.cc_horario_guardar(zona, semana);

  -- ══ 1 · configuración: solo Dirección; apagado por defecto (la 182 lo enciende en prod) ═══════════
  perform tests.ok((public.cc_atencion_config_ver() -> 'reparto' ->> 'activo')::boolean = false and (public.cc_atencion_config_ver() -> 'reparto' ->> 'min')::int = 5
               and (public.cc_atencion_config_ver() -> 'reparto' ->> 'vendedores_elegibles')::int = 3, '1 · config: apagado, 5 min, 3 vendedores elegibles para nuevos');
  perform tests.act_as(v_pos);
  perform tests.throws('select public.cc_atencion_reparto_guardar(true, 5, true)', 'NO_AUTORIZADO', '1 · Ventas no configura el reparto');
  perform tests.act_as(v_admin);
  perform tests.throws('select public.cc_atencion_reparto_guardar(true, 0, true)', 'CONFIG_INVALIDA', '1 · minutos entre 1 y 1440');

  -- ══ 2 · apagado: doctor sin cartera → Dirección, como antes (CHV2-A B) ═══════════════════════════
  perform tests.act_as(v_admin);
  perform public.cc_atencion_reparto_guardar(false, 5, true);
  perform tests.act_as_service();
  c3 := (public.cc_abrir_conversacion(null, d3) ->> 'conversation_id')::uuid;
  perform public.cc_solicitar_asesor(c3, 'doctor', null, d3);
  perform tests.act_as_owner();
  perform tests.ok((select modo = 'human_requested' and seller_profile_id is null and ruteo_motivo = 'sin_vendedor' from public.cc_conversations where id = c3), '2 · apagado: queda para Dirección');
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = c3 and kind = 'handoff_sin_vendedor'), 1, '2 · apagado: alerta a Dirección');

  -- ══ 3 · encendido: doctor sin cartera → un vendedor al azar (elegible para nuevos), alerta a él, nada a Dirección ═
  perform tests.act_as(v_admin);
  r := public.cc_atencion_reparto_guardar(true, 5, true);
  perform tests.ok((r -> 'reparto' ->> 'activo')::boolean, '3 · reparto activo');
  perform tests.act_as_service();
  c1 := (public.cc_abrir_conversacion(null, d1) ->> 'conversation_id')::uuid;
  r := public.cc_solicitar_asesor(c1, 'doctor', null, d1);
  perform tests.ok((r ->> 'asesor')::boolean and r ->> 'modo' = 'human_assigned', '3 · la solicitud sale asignada');
  perform tests.act_as_owner();
  select seller_profile_id into v1 from public.cc_conversations where id = c1;
  perform tests.ok(v1 in (s1, s2, s3) and (select ruteo_motivo = 'reparto' and reparto_probados = array[v1] and reparto_at is not null from public.cc_conversations where id = c1), '3 · repartida a un vendedor elegible para nuevos, anotado como probado');
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = c1 and kind = 'handoff_asignado' and user_ids = array[v1]), 1, '3 · UNA alerta al vendedor repartido');
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = c1 and 'admin' = any(coalesce(roles, '{}'))), 0, '3 · CERO alertas a Dirección');
  perform tests.ok(not exists (select 1 from public.cc_cartera where profile_id = d1), '3 · la cartera NO cambia por el reparto');
  a := public._cc_atencion(c1);
  perform tests.ok(a ->> 'estado' = 'reparto' and (a -> 'reparto' ->> 'intento')::int = 1 and (a -> 'reparto' ->> 'umbral_min')::int = 5 and (a -> 'reparto' ->> 'en_reparto')::boolean, '3 · estado derivado reparto · intento 1');
  perform tests.act_as(v_admin);
  perform tests.ok((public.cc_ruteo_resumen() ->> 'reparto_en_curso')::int = 1 and (public.cc_ruteo_resumen() ->> 'vendedores_elegibles_nuevos')::int = 3 and (public.cc_ruteo_resumen() ->> 'reparto_activo')::boolean, '3 · resumen de Dirección');

  -- ══ 4 · el evaluador respeta el plazo; vencido, pasa a OTRO vendedor; nunca repite ni toma al no elegible ═
  perform tests.act_as_service();
  r := public.cc_atencion_evaluar();
  perform tests.eq((r ->> 'repartos')::int, 0, '4 · antes del plazo no rota');
  perform tests.act_as_owner();
  update public.cc_conversations set asesoria_asignada_at = now() - interval '6 minutes' where id = c1;
  perform tests.act_as_service();
  r := public.cc_atencion_evaluar();
  perform tests.eq((r ->> 'repartos')::int, 1, '4 · vencido el plazo: rota');
  perform tests.act_as_owner();
  select seller_profile_id into v2 from public.cc_conversations where id = c1;
  perform tests.ok(v2 in (s1, s2, s3) and v2 <> v1 and (select modo = 'human_assigned' and ruteo_motivo = 'reparto' and reparto_probados = array[v1, v2] from public.cc_conversations where id = c1), '4 · ahora la tiene otro vendedor; probados = 2');
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = c1 and kind = 'handoff_asignado' and user_ids = array[v2]), 1, '4 · alerta al segundo vendedor');
  perform tests.ok((select asesoria_asignada_at > now() - interval '1 minute' from public.cc_conversations where id = c1), '4 · el reloj del handler se reinicia');
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = c1 and kind in ('handoff_aviso', 'handoff_escalado')), 0, '4 · sin avisos ni escalaciones: la rotación los sustituye');
  update public.cc_conversations set asesoria_asignada_at = now() - interval '6 minutes' where id = c1;
  perform tests.act_as_service(); r := public.cc_atencion_evaluar(); perform tests.act_as_owner();
  select seller_profile_id into v3 from public.cc_conversations where id = c1;
  perform tests.ok(v3 in (s1, s2, s3) and v3 <> v1 and v3 <> v2 and (select cardinality(reparto_probados) = 3 from public.cc_conversations where id = c1), '4 · tercer vendedor distinto');

  -- ══ 5 · REPARTO-VERIF (dueño, 30 oct) · agotados los vendedores: NUEVA VUELTA entre vendedores (Dirección solo se entera) ══
  update public.cc_conversations set asesoria_asignada_at = now() - interval '6 minutes' where id = c1;
  perform tests.act_as_service(); r := public.cc_atencion_evaluar(); perform tests.act_as_owner();
  perform tests.eq((r ->> 'agotados')::int, 0, '5 · ya no se agota hacia Dirección');
  select seller_profile_id into v1 from public.cc_conversations where id = c1;
  perform tests.ok(v1 in (s1, s2, s3) and v1 <> v3 and (select modo = 'human_assigned' and ruteo_motivo = 'reparto' and reparto_probados = array[v3, v1] from public.cc_conversations where id = c1), '5 · nueva vuelta: otro vendedor (no el último); sNo nunca la recibe');
  perform tests.ok((select asesoria_asignada_at > now() - interval '1 minute' from public.cc_conversations where id = c1), '5 · reloj nuevo para la vuelta');
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = c1 and kind = 'handoff_escalado' and roles = array['admin'] and body like 'Nadie tomó la solicitud en su vuelta%'), 1, '5 · Dirección solo se entera');
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = c1 and kind = 'handoff_sin_vendedor'), 0, '5 · no le llega como trabajo');
  perform tests.act_as_service(); r := public.cc_atencion_evaluar(); perform tests.act_as_owner();
  perform tests.eq((r ->> 'repartos')::int, 0, '5 · antes del plazo no vuelve a rotar');
  -- sin NINGÚN vendedor que reciba clientes nuevos: entonces sí, a Dirección
  perform tests.act_as_service(); update public.profiles set meta = meta - 'capabilities' where id in (s1, s2, s3); perform tests.act_as_owner();
  update public.cc_conversations set asesoria_asignada_at = now() - interval '6 minutes' where id = c1;
  perform tests.act_as_service(); r := public.cc_atencion_evaluar(); perform tests.act_as_owner();
  perform tests.eq((r ->> 'agotados')::int, 1, '5 · sin vendedores: agotado');
  perform tests.ok((select modo = 'human_requested' and seller_profile_id is null and ruteo_motivo = 'sin_vendedor' from public.cc_conversations where id = c1), '5 · human_requested para Dirección');
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = c1 and kind = 'handoff_sin_vendedor' and roles = array['admin']), 1, '5 · UNA alerta a Dirección');
  perform tests.eq(public._cc_atencion(c1) ->> 'estado', 'solicitado_sin_vendedor', '5 · estado derivado');
  perform tests.ok(not exists (select 1 from public.cc_participants where conversation_id = c1 and rol = 'asesor' and left_at is null), '5 · ningún asesor sigue como participante');
  perform tests.act_as_service(); r := public.cc_atencion_evaluar(); perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = c1 and kind = 'handoff_sin_vendedor'), 1, '5 · el evaluador no repite la alerta');
  perform tests.act_as_service(); update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id in (s1, s2, s3); perform tests.act_as_owner();

  -- ══ 6 · quien la toma se queda con la cartera; la próxima solicitud ya le llega directo ═════════
  perform tests.act_as_service();
  c2 := (public.cc_abrir_conversacion(null, d2) ->> 'conversation_id')::uuid;
  perform public.cc_solicitar_asesor(c2, 'doctor', null, d2);
  perform tests.act_as_owner();
  select seller_profile_id into v1 from public.cc_conversations where id = c2;
  perform tests.act_as_service();   -- iniciar/terminar llegan por la Edge chat (servicio)
  r := public.cc_iniciar_asesoria(c2, v1);
  perform tests.ok(r ->> 'modo' = 'human_active' and (r ->> 'cartera_fijada')::boolean, '6 · inicia y se fija la cartera');
  perform tests.act_as_owner();
  perform tests.ok((select seller_profile_id = v1 and motivo like 'Reparto automático%' and asignado_por = v1 from public.cc_cartera where profile_id = d2), '6 · cartera d2 → vendedor que la tomó');
  perform tests.eq((select count(*)::int from public.cc_cartera_historial where profile_id = d2 and seller_nuevo = v1 and seller_anterior is null), 1, '6 · historial auditable');
  perform tests.ok((select ruteo_motivo is null and modo = 'human_active' from public.cc_conversations where id = c2), '6 · ya no está en reparto');
  perform tests.eq(public._cc_atencion(c2) ->> 'estado', 'activo', '6 · asesoría en curso');
  perform tests.act_as_service(); perform public.cc_terminar_asesoria(c2, v1); perform tests.act_as_owner();
  perform tests.act_as_service();
  c2 := (public.cc_abrir_conversacion(null, d2) ->> 'conversation_id')::uuid;
  perform public.cc_solicitar_asesor(c2, 'doctor', null, d2);
  perform tests.act_as_owner();
  perform tests.ok((select seller_profile_id = v1 and ruteo_motivo is null and modo = 'human_assigned' from public.cc_conversations where id = c2), '6 · la siguiente va directo por cartera, sin reparto');

  -- ══ 7 · doctor CON cartera no se reparte; con "fija cartera" apagado no se fija ═════════════════
  perform tests.act_as_service();
  c4 := (public.cc_abrir_conversacion(null, d4) ->> 'conversation_id')::uuid;
  perform public.cc_solicitar_asesor(c4, 'doctor', null, d4);
  perform tests.act_as_owner();
  perform tests.ok((select seller_profile_id = sNo and ruteo_motivo is null and cardinality(reparto_probados) = 0 from public.cc_conversations where id = c4), '7 · con cartera va a su vendedor aunque no reciba nuevos');
  perform tests.act_as(v_admin); perform public.cc_atencion_reparto_guardar(true, 5, false);
  perform tests.act_as_service();
  perform public.cc_cartera_asignar(d3, null, 'prueba');   -- d3 sigue sin cartera (idempotente) y su solicitud sigue en cola
  r := public._cc_rutear(c3);
  perform tests.ok((r ->> 'asignado')::boolean and (r ->> 'reparto')::boolean, '7 · al reencender, la solicitud en cola de Dirección se reparte al volver a rutear');
  perform tests.act_as_owner();
  select seller_profile_id into v2 from public.cc_conversations where id = c3;
  perform tests.act_as_service(); r := public.cc_iniciar_asesoria(c3, v2); perform tests.act_as_owner();
  perform tests.ok(not (r ->> 'cartera_fijada')::boolean and not exists (select 1 from public.cc_cartera where profile_id = d3), '7 · fija cartera apagado: no se fija');

  -- ══ 8 · visitante (lead) también se reparte ══════════════════════════════════════════════════════
  perform tests.act_as_service();
  perform public.cc_visitante_abrir(null, hV, '{}'::jsonb, null);
  cv := (public.cc_abrir_conversacion(hV, null) ->> 'conversation_id')::uuid;
  perform public.cc_solicitar_asesor(cv, 'visitor', hV, null);
  perform tests.act_as_owner();
  perform tests.ok((select modo = 'human_assigned' and ruteo_motivo = 'reparto' and seller_profile_id in (s1, s2, s3) from public.cc_conversations where id = cv), '8 · visitante repartido a un vendedor que recibe nuevos');
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = cv and 'admin' = any(coalesce(roles, '{}'))), 0, '8 · sin alerta a Dirección');

  -- ══ 9 · bitácora ════════════════════════════════════════════════════════════════════════════════
  perform tests.ok((select count(*) from public.audit_logs where action = 'Reparto de asesorías') >= 3, '9 · cada cambio de configuración queda en bitácora');
  perform tests.act_as_owner();
end $t$;
rollback;
