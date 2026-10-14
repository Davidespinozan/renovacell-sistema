-- CONTINUIDAD (156) · al aprobar, el prerregistro único con el MISMO correo pasa a la cuenta con su conversación,
-- aunque se haya registrado en otro dispositivo. Sin aprobación o con ambigüedad, no se liga nada.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); s1 uuid := tests.user('pos'); dA uuid; dB uuid; dC uuid;
  hA text := repeat('1', 63) || 'a'; hB text := repeat('2', 63) || 'b'; hC1 text := repeat('3', 63) || 'c'; hC2 text := repeat('4', 63) || 'd'; cA uuid; cB uuid; cC uuid;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id = s1;
  perform public.cc_visitante_abrir(null, hA, '{}'::jsonb, null); perform public.cc_visitante_abrir(null, hB, '{}'::jsonb, null);
  perform public.cc_visitante_abrir(null, hC1, '{}'::jsonb, null); perform public.cc_visitante_abrir(null, hC2, '{}'::jsonb, null);
  perform public.cc_visitante_prerregistrar(hA, 'Dra. Celular', '6690000101', 'celular@test.local', true, null, true);
  perform public.cc_visitante_prerregistrar(hB, 'Dra. Dirección', '6690000102', 'direccion.flujo@test.local', true, null, true);
  perform public.cc_visitante_prerregistrar(hC1, 'Uno', '6690000103', 'doble@test.local', false, null, true);
  perform public.cc_visitante_prerregistrar(hC2, 'Dos', '6690000104', 'doble@test.local', false, null, true);
  cA := (public.cc_abrir_conversacion(hA, null) ->> 'conversation_id')::uuid; perform public.cc_enviar_mensaje(cA, 'visitor', hA, null, 'c:1', 'Hola desde el celular');
  cB := (public.cc_abrir_conversacion(hB, null) ->> 'conversation_id')::uuid; perform public.cc_enviar_mensaje(cB, 'visitor', hB, null, 'c:2', 'Hola');
  cC := (public.cc_abrir_conversacion(hC1, null) ->> 'conversation_id')::uuid;
  -- se registran en OTRO dispositivo (sin token): cuentas pendientes con el mismo correo
  dA := tests.user('doctor', 'celular@test.local'); dB := tests.user('doctor', 'direccion.flujo@test.local'); dC := tests.user('doctor', 'doble@test.local');
  update public.profiles set verified = false where id in (dA, dB, dC);
  insert into public.cc_cartera (profile_id, seller_profile_id) values (dA, s1);
  perform tests.ok((select profile_id is null from public.cc_conversations where id = cA), '1 · registrarse con el mismo correo NO liga nada por sí solo');

  perform tests.act_as(s1);
  perform public.doctor_verificar(dA, true, null);
  perform tests.act_as_service();
  perform tests.ok((select profile_id = dA from public.cc_conversations where id = cA) and exists (select 1 from public.cc_messages where conversation_id = cA and content = 'Hola desde el celular'), '2 · al aprobarlo su vendedor, la conversación del celular pasa a su cuenta con su historial');
  perform tests.ok((select estado = 'adoptado' and adopted_profile_id = dA from public.cc_visitors where id = public._cc_visitor_por_hash(hA)) is null
                   or not exists (select 1 from public.cc_visitors where token_hash = hA), '2 · el token viejo del celular ya no sirve (se rotó al adoptar)');

  perform tests.act_as(v_admin);
  perform public.admin_approve_doctor(dB, null, jsonb_build_object('full_name', 'Dra. Dirección'));
  perform tests.act_as_service();
  perform tests.ok((select profile_id = dB from public.cc_conversations where id = cB), '3 · también cuando aprueba Dirección');

  perform tests.act_as(v_admin);
  perform public.doctor_verificar(dC, true, null);
  perform tests.act_as_service();
  perform tests.ok((select profile_id is null from public.cc_conversations where id = cC), '4 · dos prerregistros con ese correo: no se adivina, no se liga');
  perform tests.act_as(s1);
  perform tests.throws(format('select public._ligar_prerregistro(%L)', dC), 'permission denied', '5 · nadie la llama directo');
end $t$;
rollback;
