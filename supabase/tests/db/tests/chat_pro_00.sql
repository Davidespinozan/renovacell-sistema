-- CHAT PRO (161) · "escribiendo…" con la autoridad de leer, respuestas rápidas por dueño y unión manual de la
-- conversación del enlace a una cuenta registrada en otro dispositivo (solo si coincide por correo o celular).
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos'); d uuid; dr uuid;
  h1 text := repeat('5', 63) || 'a'; h2 text := repeat('6', 63) || 'b'; c1 uuid; c2 uuid; v1 uuid; v2 uuid; n int;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id in (s1, s2);
  perform public.cc_visitante_abrir(null, h1, '{}'::jsonb, null); perform public.cc_visitante_abrir(null, h2, '{}'::jsonb, null);
  perform public.cc_visitante_prerregistrar(h1, 'Dra. Otro Equipo', '6690000201', 'otro.equipo@test.local', true, null, true);
  perform public.cc_visitante_prerregistrar(h2, 'Persona Ajena', '6690000299', 'ajena@test.local', false, null, true);
  c1 := (public.cc_abrir_conversacion(h1, null) ->> 'conversation_id')::uuid; perform public.cc_enviar_mensaje(c1, 'visitor', h1, null, 'p:1', 'Hola, quiero informes');
  c2 := (public.cc_abrir_conversacion(h2, null) ->> 'conversation_id')::uuid;
  v1 := public._cc_visitor_por_hash(h1); v2 := public._cc_visitor_por_hash(h2);

  -- 1 · escribiendo
  perform public.cc_escribiendo(c1, 'visitor', h1, null, true);
  perform tests.ok((select escribiendo_hasta > now() from public.cc_participants where conversation_id = c1 and visitor_id = v1), '1 · el visitante marca que escribe (unos segundos)');
  perform public.cc_escribiendo(c1, 'visitor', h1, null, false);
  perform tests.ok((select escribiendo_hasta is null from public.cc_participants where conversation_id = c1 and visitor_id = v1), '1 · al enviar se apaga');
  perform tests.throws(format('select public.cc_escribiendo(%L, %L, %L, null, true)', c1, 'visitor', h2), 'NO_AUTORIZADO', '1 · otro visitante no puede marcar en una conversación ajena');
  perform tests.throws(format('select public.cc_escribiendo(%L, %L, null, %L, true)', c1, 'seller', s2), 'NO_AUTORIZADO', '1 · un vendedor que no la atiende tampoco');
  perform tests.act_as(s1);
  perform tests.throws(format('select public.cc_escribiendo(%L, %L, %L, null, true)', c1, 'visitor', h1), 'permission denied', '1 · nadie la llama directo');

  -- 2 · respuestas rápidas
  perform tests.ok((select count(*) from public.cc_respuestas_rapidas) = 7, '2 · el vendedor ve las 7 de la empresa');
  perform public.cc_respuesta_guardar(null, 'Mía', 'Texto propio', false);
  perform tests.ok((select count(*) from public.cc_respuestas_rapidas) = 8, '2 · crea las suyas');
  perform tests.throws($$select public.cc_respuesta_guardar(null, 'Empresa', 'No puedo', true)$$, 'NO_AUTORIZADO', '2 · el vendedor no crea de la empresa');
  perform tests.throws(format('select public.cc_respuesta_guardar(%L, %L, %L, false)', (select id from public.cc_respuestas_rapidas where profile_id is null limit 1), 'Otro', 'Cambiado'), 'NO_AUTORIZADO', '2 · ni las edita');
  perform tests.throws($$insert into public.cc_respuestas_rapidas (profile_id, titulo, texto) values (auth.uid(), 'Directo', 'Sin comando')$$, 'permission denied', '2 · sin escritura directa en la tabla');
  perform tests.throws($$select public.cc_respuesta_guardar(null, 'X', 'Y', false)$$, 'DATOS_INVALIDOS', '2 · título y texto con sentido');
  perform tests.act_as(s2);
  perform tests.ok((select count(*) from public.cc_respuestas_rapidas) = 7, '2 · otro vendedor no ve las mías');
  perform tests.throws(format('select public.cc_respuesta_borrar(%L)', (select id from public.cc_respuestas_rapidas r where r.titulo = 'Saludo')), 'NO_AUTORIZADO', '2 · ni borra las de la empresa');
  perform tests.act_as(v_admin);
  perform public.cc_respuesta_guardar(null, 'Horario', 'Atendemos de 10 a 18 h', true);
  perform tests.ok((select count(*) from public.cc_respuestas_rapidas where profile_id is null) = 8, '2 · Dirección agrega de la empresa');
  perform public.cc_respuesta_borrar((select id from public.cc_respuestas_rapidas where titulo = 'Horario'));
  perform tests.ok((select count(*) from public.cc_respuestas_rapidas where profile_id is null) = 7, '2 · y las borra');
  dr := tests.user('doctor'); perform tests.act_as(dr);
  perform tests.ok((select count(*) from public.cc_respuestas_rapidas) = 0, '2 · un doctor no ve ninguna');

  -- 3 · unir la conversación del enlace (se registró en otro equipo, con OTRO correo y el mismo celular)
  perform tests.act_as_service();
  d := tests.user('doctor', 'correo.distinto@test.local');
  update public.profiles set verified = false, meta = coalesce(meta, '{}') || '{"shipping":{"phone":"+52 669 000 0201"}}' where id = d;
  insert into public.cc_cartera (profile_id, seller_profile_id) values (d, s1);
  perform tests.act_as(s2);
  perform tests.throws(format('select public.cc_enlace_candidatos(%L)', d), 'NO_AUTORIZADO', '3 · quien no lo atiende no ve candidatos');
  perform tests.act_as(s1);
  select jsonb_array_length(public.cc_enlace_candidatos(d)) into n;
  perform tests.ok(n = 1 and public.cc_enlace_candidatos(d) -> 0 ->> 'coincide' = 'celular' and (public.cc_enlace_candidatos(d) -> 0 ->> 'mensajes')::int = 1, '3 · su vendedor ve la conversación que coincide por celular');
  perform tests.throws(format('select public.cc_enlace_unir(%L, %L)', d, v2), 'NO_COINCIDE', '3 · no se une una conversación que no coincide');
  perform public.cc_enlace_unir(d, v1);
  perform tests.act_as_service();
  perform tests.ok((select profile_id = d from public.cc_conversations where id = c1) and exists (select 1 from public.cc_messages where conversation_id = c1 and content = 'Hola, quiero informes'), '3 · la conversación pasa a su cuenta con su historial');
  perform tests.ok((select profile_id is null from public.cc_conversations where id = c2), '3 · la ajena no se toca');
  perform tests.act_as(s1);
  perform tests.ok(jsonb_array_length(public.cc_enlace_candidatos(d)) = 0, '3 · ya unida, deja de ser candidata');
end $t$;
rollback;
