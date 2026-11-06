-- PASAR CONVERSACIÓN (5 nov 2026) · quien atiende (o Dirección) pasa la conversación a otro vendedor, con motivo, aunque la
-- asesoría ya esté iniciada. El nuevo recibe el aviso; la cartera no cambia; nadie más puede pasarla.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin();
  d1 uuid := tests.user('doctor');
  s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos'); sNo uuid := tests.user('pos'); v_ext uuid := tests.user('pos');
  c1 uuid; r jsonb; lista jsonb;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id in (s1, s2, v_ext);
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["eventos"]}' where id = sNo;   -- de ventas, pero NO atiende conversaciones
  perform tests.cliente(d1);
  insert into public.cc_cartera (profile_id, seller_profile_id) values (d1, s1);
  perform tests.act_as(v_admin);
  perform public.cc_horario_guardar('America/Mazatlan', (select jsonb_agg(jsonb_build_object('dia', g, 'abierto', true, 'abre', '00:00', 'cierra', '23:59:59.999999')) from generate_series(1, 7) g));
  perform tests.act_as_service();
  c1 := (public.cc_abrir_conversacion(null, d1) ->> 'conversation_id')::uuid;
  perform public.cc_solicitar_asesor(c1, 'doctor', null, d1);
  perform public.cc_iniciar_asesoria(c1, s1);
  perform tests.act_as_owner();
  perform tests.ok((select modo = 'human_active' and seller_profile_id = s1 from public.cc_conversations where id = c1), '0 · s1 atiende (asesoría iniciada)');

  -- ══ 1 · lista de a quién pasarla: vendedores que atienden, sin uno mismo ══════════════════════════
  perform tests.act_as(s1);
  lista := public.cc_vendedores_traspaso();
  perform tests.ok(lista @> jsonb_build_array(jsonb_build_object('id', s2)) and not lista @> jsonb_build_array(jsonb_build_object('id', s1))
               and not lista @> jsonb_build_array(jsonb_build_object('id', sNo)), '1 · lista: s2 sí; ni uno mismo ni quien no atiende');
  perform tests.act_as(d1);
  perform tests.throws('select public.cc_vendedores_traspaso()', 'NO_AUTORIZADO', '1 · un doctor no ve la lista');

  -- ══ 2 · validaciones ══════════════════════════════════════════════════════════════════════════════
  perform tests.act_as(v_ext);
  perform tests.throws(format('select public.cc_pasar_conversacion(%L, %L, ''x'')', c1, s2), 'NO_ES_TUYA', '2 · otro vendedor no puede pasar una conversación ajena');
  perform tests.act_as(d1);
  perform tests.throws(format('select public.cc_pasar_conversacion(%L, %L, ''x'')', c1, s2), 'NO_AUTORIZADO', '2 · un doctor no puede');
  perform tests.act_as(s1);
  perform tests.throws(format('select public.cc_pasar_conversacion(%L, %L, ''  '')', c1, s2), 'MOTIVO_REQUERIDO', '2 · motivo obligatorio');
  perform tests.throws(format('select public.cc_pasar_conversacion(%L, %L, ''x'')', c1, sNo), 'VENDEDOR_NO_ELEGIBLE', '2 · solo a quien atiende conversaciones');
  perform tests.throws(format('select public.cc_pasar_conversacion(%L, %L, ''x'')', c1, s1), 'MISMO_VENDEDOR', '2 · no a sí mismo');

  -- ══ 3 · s1 se la pasa a s2 (asesoría ya iniciada) ════════════════════════════════════════════════
  r := public.cc_pasar_conversacion(c1, s2, 'Ya es cliente de s2');
  perform tests.ok(r ->> 'seller' = s2::text and r ->> 'modo' = 'human_assigned' and not (r ->> 'idempotente')::boolean, '3 · pasó a s2 y queda asignada para que la inicie');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = c1 and kind = 'handoff_asignado' and user_ids = array[s2]), 1, '3 · aviso al nuevo vendedor');
  perform tests.ok(exists (select 1 from public.cc_conversation_events where conversation_id = c1 and tipo = 'seller_unassigned' and detalle ->> 'seller' = s1::text and detalle ->> 'origen' = 'traspaso'), '3 · bitácora: sale s1 por traspaso');
  perform tests.ok(exists (select 1 from public.cc_conversation_events where conversation_id = c1 and tipo = 'human_assigned' and detalle ->> 'seller' = s2::text and detalle ->> 'motivo' = 'Ya es cliente de s2' and actor_profile_id = s1), '3 · bitácora: entra s2 con el motivo y quién la pasó');
  perform tests.ok((select left_at is not null from public.cc_participants where conversation_id = c1 and profile_id = s1 and rol = 'asesor'), '3 · s1 deja de ser asesor de la conversación');
  perform tests.ok((select seller_profile_id = s1 from public.cc_cartera where profile_id = d1), '3 · la cartera NO cambia');

  -- ══ 4 · s1 ya no puede pasarla; s2 sí la inicia; Dirección puede pasar cualquiera ═════════════════
  perform tests.act_as(s1);
  perform tests.throws(format('select public.cc_pasar_conversacion(%L, %L, ''x'')', c1, v_ext), 'NO_ES_TUYA', '4 · quien la pasó ya no la mueve');
  perform tests.act_as_service();
  perform public.cc_iniciar_asesoria(c1, s2);
  perform tests.act_as(v_admin);
  r := public.cc_pasar_conversacion(c1, v_ext, 'Reparto de carga');
  perform tests.ok(r ->> 'seller' = v_ext::text, '4 · Dirección la pasa aunque no sea suya');

  -- ══ 5 · con el asistente atendiendo no hay a quién pasarla ═══════════════════════════════════════
  perform tests.act_as_service();
  perform public.cc_iniciar_asesoria(c1, v_ext);
  perform public.cc_terminar_asesoria(c1, v_ext);
  perform public.cc_enviar_mensaje(c1, 'doctor', null, d1, 'd1:pasar:1', 'Otra duda');
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.cc_pasar_conversacion(%L, %L, ''x'')', c1, s2), 'SIN_ATENCION_HUMANA', '5 · en IA no se pasa');
  perform tests.act_as_owner();
end $t$;
rollback;
