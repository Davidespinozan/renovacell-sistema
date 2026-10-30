-- CONTACTO CONVERSACIONAL (20270212) · sin formulario: el asistente saluda y pide el nombre al abrir; la IA registra los datos
-- que le dan en la conversación con las mismas reglas del prerregistro; un dato malo vuelve como campo; ya con datos, la
-- conversación entra a la cola de su vendedor. Solo el visitante de esa conversación y solo el servidor.
begin;
do $t$
declare
  s1 uuid := tests.user('pos'); hA text := repeat('a', 63) || '5'; hB text := repeat('b', 63) || '6'; hC text := repeat('c', 63) || '7';
  r jsonb; cA uuid; cC uuid; vA uuid; c1 text;
begin
  perform tests.act_as_service();
  update public.profiles set full_name = 'Roberto Ibarra', meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones"]}' where id = s1;
  c1 := public._cc_enlace_de_vendedor(s1);
  perform public.cc_visitante_abrir(null, hA, '{}'::jsonb, null); perform public.cc_visitante_abrir(null, hB, '{}'::jsonb, null); perform public.cc_visitante_abrir(null, hC, '{}'::jsonb, null);
  vA := public._cc_visitor_por_hash(hA);
  perform public.cc_visitante_enlace(hA, c1);

  -- ══ 1 · pendiente y saludo ══
  perform tests.eq(public.cc_ia_contacto_pendiente(hA), '{"pendiente": true, "asesor": "Roberto", "recomienda": null}'::jsonb, '1 · le faltan datos y la IA sabe quién es su asesor');
  cA := (public.cc_abrir_conversacion(hA, null) ->> 'conversation_id')::uuid;
  perform tests.ok(public.cc_bienvenida_contacto(cA, hA), '1 · al abrir, el asistente saluda');
  perform tests.eq((select content from public.cc_messages where conversation_id = cA and actor_type = 'ai'),
    'Hola, te damos la bienvenida a Renovacell. Soy el asistente y te acompaño mientras Roberto, tu asesor, se une a la conversación. Para empezar, ¿cómo te llamas?', '1 · y pide el nombre, con su asesor');
  perform tests.ok(not public.cc_bienvenida_contacto(cA, hA), '1 · una sola vez');
  perform tests.eq((select count(*)::int from public.cc_messages where conversation_id = cA), 1, '1 · sin duplicados');
  perform tests.throws(format('select public.cc_bienvenida_contacto(%L, %L)', cA, hB), 'NO_AUTORIZADO', '1 · otro visitante no toca esa conversación');
  perform tests.eq(public._cc_texto_bienvenida(null, 'Lourdes'), 'Hola, te damos la bienvenida a Renovacell. Qué gusto que vengas de parte de Lourdes. Soy el asistente y estoy aquí para ayudarte. Para empezar, ¿cómo te llamas?', '1 · recomendación sin asesor');

  -- ══ 2 · la IA registra; un dato malo vuelve como campo ══
  perform public.cc_enviar_mensaje(cA, 'visitor', hA, null, 'c:a1', 'Ana Ruiz, 669 111 2233, ana.conv@test.local');
  r := public.cc_ia_registrar_contacto(cA, hA, 'Ana Ruiz', '12345', 'ana.conv@test.local', false, null);
  perform tests.eq(r, '{"registrado": false, "campo": "telefono"}'::jsonb, '2 · celular inválido: vuelve el campo para pedirlo de nuevo');
  perform tests.eq(public.cc_ia_contacto_pendiente(hA) ->> 'pendiente', 'true', '2 · sigue pendiente');
  r := public.cc_ia_registrar_contacto(cA, hA, 'Ana Ruiz', '669 111 2233', 'ana.conv@test.local', false, null);
  perform tests.eq(r ->> 'registrado', 'true', '2 · registrado');
  perform tests.eq(r ->> 'asesor_asignado', 'true', '2 · y ya entró a la cola con su asesor');
  perform tests.ok((select seller_profile_id = s1 and modo = 'human_assigned' from public.cc_conversations where id = cA), '2 · la conversación es de Roberto (vendedor del enlace)');
  perform tests.ok((select assigned_to = s1 and meta -> 'consentimiento' ->> 'forma' like 'al escribir sus datos en el chat%' from public.prospects where visitor_id = vA), '2 · prospecto de Roberto, con la forma del consentimiento');
  perform tests.eq(public.cc_ia_contacto_pendiente(hA) ->> 'pendiente', 'false', '2 · ya no está pendiente');
  perform tests.eq(public.cc_ia_registrar_contacto(cA, hA, 'Otra Persona', '6690000000', 'otra@test.local', false, null) ->> 'ya_estaba', 'true', '2 · no se re-registra con otros datos');
  perform tests.ok((select email = 'ana.conv@test.local' from public.cc_prerregistros where visitor_id = vA), '2 · el contacto no cambia');

  -- ══ 3 · con datos ya no hay saludo de bienvenida; solo el visitante de esa conversación; solo servidor ══
  cC := (public.cc_abrir_conversacion(hC, null) ->> 'conversation_id')::uuid;
  perform tests.throws(format('select public.cc_ia_registrar_contacto(%L, %L, %L, %L, %L, false, null)', cC, hA, 'X Y', '6690000001', 'x@test.local'), 'NO_AUTORIZADO', '3 · no registra datos en la conversación de otro');
  perform tests.act_as(s1);
  perform tests.throws(format('select public.cc_ia_registrar_contacto(%L, %L, %L, %L, %L, false, null)', cC, hC, 'X Y', '6690000001', 'x@test.local'), 'permission denied', '3 · una sesión no lo ejecuta');
  perform tests.throws(format('select public.cc_bienvenida_contacto(%L, %L)', cC, hC), 'permission denied', '3 · ni el saludo');
  perform tests.act_as_anon();
  perform tests.throws(format('select public.cc_ia_contacto_pendiente(%L)', hC), 'permission denied', '3 · anónimo tampoco');
end $t$;
rollback;
