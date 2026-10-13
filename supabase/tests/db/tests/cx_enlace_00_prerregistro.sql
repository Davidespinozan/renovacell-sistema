-- CX-ENLACE (150) · enlace único de contacto con prerregistro: validación, prospecto, coincidencia sin ambigüedad,
-- puerta del chat, ruteo al vendedor del cliente o a Dirección, datos de contacto para quien atiende y continuidad
-- de la conversación al registrarse. La coincidencia SOLO rutea: no adopta ni da acceso.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin();
  s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos'); sNo uuid := tests.user('pos');
  d1 uuid := tests.user('doctor', 'dra.cartera@test.local'); d2 uuid := tests.user('doctor'); dNuevo uuid;
  hA text := repeat('a', 63) || '1'; hB text := repeat('b', 63) || '2'; hC text := repeat('c', 63) || '3'; hD text := repeat('d', 63) || '4'; hE text := repeat('e', 63) || '5'; hF text := repeat('f', 63) || '6';
  r jsonb; cA uuid; cB uuid; cC uuid; cu1 uuid; cuH uuid; cuX uuid; cuY uuid; n int; vA uuid; vE uuid; p1 uuid;
  pre text := 'select public.cc_visitante_prerregistrar(%L, %L, %L, %L, %L, %L, %L)';
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id in (s1, s2);   -- sNo: sin capacidad
  cu1 := tests.cliente(d1); update public.customers set phone = '6691110001' where id = cu1;
  insert into public.cc_cartera (profile_id, seller_profile_id) values (d1, s1);
  insert into public.customers (full_name, email, phone, seller_name, active) values ('Histórica Odoo', 'historica@test.local', '6692220002', 'VENDEDOR ODOO X', true) returning id into cuH;
  insert into public.cc_cartera_historica_equivalencias (seller_name_odoo, seller_profile_id) values ('VENDEDOR ODOO X', s2);
  insert into public.customers (full_name, email, phone, active) values ('Doble Uno', 'doble@test.local', '6693330003', true) returning id into cuX;
  insert into public.customers (full_name, email, phone, active) values ('Doble Dos', 'otro@test.local', '+52 669 333 0003', true) returning id into cuY;
  perform public.cc_visitante_abrir(null, hA, '{}'::jsonb, null); perform public.cc_visitante_abrir(null, hB, '{}'::jsonb, null);
  perform public.cc_visitante_abrir(null, hC, '{}'::jsonb, null); perform public.cc_visitante_abrir(null, hD, '{}'::jsonb, null);
  perform public.cc_visitante_abrir(null, hE, '{}'::jsonb, null);
  vA := public._cc_visitor_por_hash(hA); vE := public._cc_visitor_por_hash(hE);

  -- ══ 1 · puerta: sin prerregistro no se conversa ══
  perform tests.eq(public.cc_puerta_chat(hA, null), '{"visitante": true, "prerregistrado": false, "nombre": null}'::jsonb, '1 · visitante sin prerregistro: puerta cerrada');
  perform tests.eq(public.cc_puerta_chat(hF, null) ->> 'visitante', 'false', '1 · token desconocido: no es visitante');
  perform tests.eq(public.cc_puerta_chat(null, d2) ->> 'prerregistrado', 'false', '1 · doctor sin prerregistro: la puerta no se abre por aquí');

  -- ══ 2 · validación ══
  perform tests.throws(format(pre, hF, 'Ana Ruiz', '6690000001', 'ana@test.local', false, null, true), 'SESION_INVALIDA', '2 · token inválido');
  perform tests.throws(format(pre, hA, 'Ana Ruiz', '6690000001', 'ana@test.local', false, null, false), 'PRERREGISTRO_INVALIDO: consentimiento', '2 · sin aceptar el aviso');
  perform tests.throws(format(pre, hA, 'An', '6690000001', 'ana@test.local', false, null, true), 'PRERREGISTRO_INVALIDO: nombre', '2 · nombre corto');
  perform tests.throws(format(pre, hA, 'Ana Ruiz', '12345', 'ana@test.local', false, null, true), 'PRERREGISTRO_INVALIDO: telefono', '2 · teléfono inválido');
  perform tests.throws(format(pre, hA, 'Ana Ruiz', '6690000001', 'ana@', false, null, true), 'PRERREGISTRO_INVALIDO: email', '2 · correo inválido');
  perform tests.throws(format(pre, hA, 'Ana Ruiz', '6690000001', 'ana@test.local', true, '12', true), 'PRERREGISTRO_INVALIDO: cedula', '2 · cédula demasiado corta');
  perform tests.eq((select count(*)::int from public.cc_prerregistros), 0, '2 · nada quedó guardado tras los rechazos');

  -- ══ 3 · alta sin coincidencia: prospecto nuevo, sin vendedor ══
  r := public.cc_visitante_prerregistrar(hA, '  Ana   Ruiz ', '+52 (669) 000-0001', ' ANA@Test.Local ', true, '1234567', true);
  perform tests.eq(r ->> 'estado', 'registrado', '3 · registrado'); perform tests.eq(r ->> 'nombre', 'Ana Ruiz', '3 · nombre normalizado');
  perform tests.ok((select telefono = '6690000001' and email = 'ana@test.local' and es_medico and cedula = '1234567' and posible_customer_id is null and posible_seller_id is null and consent_at is not null from public.cc_prerregistros where visitor_id = vA), '3 · contacto normalizado, sin coincidencia');
  select prospect_id into p1 from public.cc_prerregistros where visitor_id = vA;
  perform tests.ok((select source = 'Enlace de contacto' and status = 'nuevo' and visitor_id = vA and assigned_to is null and meta -> 'consentimiento' ->> 'privacidad' = 'true' from public.prospects where id = p1), '3 · prospecto creado y ligado al visitante, con constancia del aviso');
  perform tests.ok(exists (select 1 from public.cc_visitor_events where visitor_id = vA and tipo = 'prerregistro'), '3 · queda en la bitácora del visitante');
  perform tests.eq(public.cc_puerta_chat(hA, null), '{"visitante": true, "prerregistrado": true, "nombre": "Ana Ruiz"}'::jsonb, '3 · puerta abierta');
  perform tests.ok(exists (select 1 from public.notifications where kind = 'contacto_enlace' and roles = array['admin'] and user_ids is null and screen = 'av_prosp' and body = 'Nuevo contacto por el enlace, sin vendedor: Ana Ruiz'), '3 · Dirección recibe el aviso para asignarle vendedor');
  -- idempotente e inmutable: nadie se re-rutea tecleando los datos de otro
  r := public.cc_visitante_prerregistrar(hA, 'Otra Persona', '6691110001', 'dra.cartera@test.local', false, null, true);
  perform tests.eq(r ->> 'estado', 'ya_registrado', '3 · segundo intento: ya registrado');
  perform tests.ok((select email = 'ana@test.local' and posible_seller_id is null from public.cc_prerregistros where visitor_id = vA), '3 · el contacto NO cambia');
  perform tests.eq((select count(*)::int from public.prospects where visitor_id = vA), 1, '3 · un solo prospecto');
  perform tests.eq((select count(*)::int from public.notifications where event_key = 'prerregistro:' || vA::text), 1, '3 · un solo aviso por visitante');

  -- ══ 4 · coincidencias ══
  r := public.cc_visitante_prerregistrar(hB, 'Quien Dice Ser', '6699999999', 'dra.cartera@test.local', false, null, true);   -- correo de un cliente con cartera
  perform tests.ok((select posible_customer_id = cu1 and posible_profile_id = d1 and posible_seller_id = s1 from public.cc_prerregistros where visitor_id = public._cc_visitor_por_hash(hB)), '4 · correo de cliente con cartera → su vendedor');
  perform tests.ok((select assigned_to = s1 and customer_id = cu1 from public.prospects where id = (select prospect_id from public.cc_prerregistros where visitor_id = public._cc_visitor_por_hash(hB))), '4 · el prospecto queda con ese vendedor');
  perform tests.ok(exists (select 1 from public.notifications where kind = 'contacto_enlace' and user_ids = array[s1] and roles is null and body like 'Un posible cliente tuyo escribió por el enlace de contacto: Quien Dice Ser'), '4 · el aviso va SOLO a ese vendedor');
  r := public.cc_visitante_prerregistrar(hC, 'Cliente Histórico', '669 222 0002', 'nuevo.correo@test.local', false, null, true);   -- teléfono de cliente histórico
  perform tests.ok((select posible_customer_id = cuH and posible_profile_id is null and posible_seller_id = s2 from public.cc_prerregistros where visitor_id = public._cc_visitor_por_hash(hC)), '4 · teléfono de cliente histórico → vendedor por equivalencia');
  r := public.cc_visitante_prerregistrar(hD, 'Ambiguo Dos', '6693330003', 'x@test.local', false, null, true);                    -- dos clientes con ese teléfono
  perform tests.ok((select posible_customer_id is null and posible_seller_id is null from public.cc_prerregistros where visitor_id = public._cc_visitor_por_hash(hD)), '4 · coincidencia ambigua → sin afirmación (decide Dirección)');
  update public.cc_cartera set seller_profile_id = sNo where profile_id = d1;
  perform tests.eq(public._cc_prerregistro_coincidencia('dra.cartera@test.local', '0000000000') ->> 'seller', null, '4 · vendedor no elegible → no se propone');
  perform tests.eq(public._cc_prerregistro_coincidencia('dra.cartera@test.local', '0000000000') ->> 'customer', cu1::text, '4 · … pero la coincidencia con el cliente se conserva');
  update public.cc_cartera set seller_profile_id = s1 where profile_id = d1;
  -- prospecto existente: se reutiliza
  insert into public.prospects (name, email, phone, source, status, meta) values ('Ya Estaba', 'ya@test.local', '6694440004', 'Landing', 'nuevo', '{}') returning id into p1;
  r := public.cc_visitante_prerregistrar(hE, 'Ya Estaba', '6694440004', 'otro.correo@test.local', false, null, true);
  perform tests.ok((select prospect_id = p1 from public.cc_prerregistros where visitor_id = vE) and (select visitor_id = vE from public.prospects where id = p1), '4 · prospecto existente reutilizado (mismo teléfono) y ligado');

  -- ══ 5 · ruteo: el que coincide va a su vendedor; el que no, a Dirección ══
  cB := (public.cc_abrir_conversacion(hB, null) ->> 'conversation_id')::uuid;
  perform public.cc_enviar_mensaje(cB, 'visitor', hB, null, 'c:b1', 'Hola, necesito ayuda');
  r := public.cc_solicitar_asesor(cB, 'visitor', hB, null);
  perform tests.ok((select modo = 'human_assigned' and seller_profile_id = s1 and ruteo_motivo is null and profile_id is null from public.cc_conversations where id = cB), '5 · posible cliente → asignado al vendedor del cliente, SIN adoptar la cuenta');
  perform tests.ok(exists (select 1 from public.notifications where body like 'Solicitud de asesor: Quien Dice Ser (posible cliente, sin confirmar)%'), '5 · el aviso al vendedor dice que es un posible cliente sin confirmar');
  cA := (public.cc_abrir_conversacion(hA, null) ->> 'conversation_id')::uuid;
  perform public.cc_enviar_mensaje(cA, 'visitor', hA, null, 'c:a1', 'Hola');
  r := public.cc_solicitar_asesor(cA, 'visitor', hA, null);
  perform tests.ok((select modo = 'human_requested' and seller_profile_id is null and ruteo_motivo = 'visitante' from public.cc_conversations where id = cA), '5 · sin coincidencia → cola de Dirección');
  perform tests.ok(exists (select 1 from public.notifications where body like 'Solicitud de asesor sin vendedor: Ana Ruiz (prerregistro)%'), '5 · Dirección ve el nombre del prerregistro');
  -- si el vendedor deja de ser elegible, no se le asigna
  cC := (public.cc_abrir_conversacion(hC, null) ->> 'conversation_id')::uuid;
  update public.profiles set meta = meta - 'capabilities' where id = s2;
  perform public.cc_enviar_mensaje(cC, 'visitor', hC, null, 'c:c1', 'Hola');
  r := public.cc_solicitar_asesor(cC, 'visitor', hC, null);
  perform tests.ok((select seller_profile_id is null and ruteo_motivo = 'visitante' from public.cc_conversations where id = cC), '5 · vendedor que ya no atiende → Dirección');

  -- ══ 6 · quien atiende ve el contacto; nadie más ══
  perform tests.act_as(v_admin);
  perform tests.eq(public.cc_contacto_de(cB) ->> 'posible_cliente', (select full_name from public.customers where id = cu1), '6 · Dirección ve el posible cliente');
  perform tests.eq(public.cc_contacto_de(cA) - 'desde', '{"nombre": "Ana Ruiz", "telefono": "6690000001", "email": "ana@test.local", "es_medico": true, "cedula": "1234567", "posible_cliente": null, "confirmado": false}'::jsonb, '6 · contacto completo, sin confirmar');
  perform tests.ok(exists (select 1 from public.cc_cola_asesorias() q where q.conversation_id = cA and q.dueno = 'Ana Ruiz (prerregistro)'), '6 · la cola muestra el nombre');
  perform tests.act_as(s1);
  perform tests.eq(public.cc_contacto_de(cB) ->> 'telefono', '6699999999', '6 · el asesor asignado ve el contacto');
  perform tests.throws(format('select public.cc_contacto_de(%L)', cA), 'NO_AUTORIZADO', '6 · un vendedor no ve el contacto de una conversación ajena');
  perform tests.act_as(d2);
  perform tests.throws(format('select public.cc_contacto_de(%L)', cB), 'NO_AUTORIZADO', '6 · un doctor no ve contactos');
  perform tests.throws('select count(*) from public.cc_prerregistros', 'permission denied', '6 · la tabla no se lee directo con sesión');
  perform tests.throws(format(pre, hF, 'Ana Ruiz', '6690000001', 'ana@test.local', false, null, true), 'permission denied', '6 · una sesión no ejecuta el prerregistro');
  perform tests.throws(format('select public.cc_puerta_chat(%L, null)', hA), 'permission denied', '6 · ni consulta la puerta');
  perform tests.act_as_anon();
  perform tests.throws(format(pre, hF, 'Ana Ruiz', '6690000001', 'ana@test.local', false, null, true), 'permission denied', '6 · anónimo tampoco');
  perform tests.throws(format('select public.cc_contacto_de(%L)', cA), 'permission denied', '6 · anónimo no ve contactos');

  -- ══ 7 · continuidad: se registra y entra → la MISMA conversación con su historial ══
  perform tests.act_as_service();
  dNuevo := tests.user('doctor', 'ana@test.local');
  update public.profiles set verified = false where id = dNuevo;
  perform tests.eq(public.cc_puerta_chat(null, dNuevo) ->> 'prerregistrado', 'false', '7 · cuenta nueva sin vínculo: puerta cerrada (el correo igual NO basta)');
  perform tests.ok(public.cc_visitante_vincular_registro(hA, dNuevo), '7 · su registro (mismo dispositivo) queda vinculado');
  perform tests.eq(public.cc_puerta_chat(null, dNuevo) ->> 'prerregistrado', 'true', '7 · doctor sin verificar que viene de un prerregistro: sigue conversando');
  r := public.cc_visitante_adoptar(null, dNuevo);
  perform tests.eq(r ->> 'estado', 'adoptado', '7 · al iniciar sesión adopta');
  perform tests.ok((select profile_id = dNuevo from public.cc_conversations where id = cA) and (select count(*) >= 1 from public.cc_messages where conversation_id = cA and content = 'Hola'), '7 · la misma conversación, con su historial, ahora es de la cuenta');
  perform tests.eq(public.cc_puerta_chat(null, dNuevo) ->> 'prerregistrado', 'true', '7 · y la puerta sigue abierta tras adoptar');
  perform tests.act_as(v_admin);
  perform tests.eq(public.cc_contacto_de(cA) ->> 'confirmado', 'true', '7 · el contacto queda marcado como confirmado');
  perform tests.act_as_service();
  perform tests.ok((select profile_id is null from public.cc_conversations where id = cB), '7 · el "posible cliente" NUNCA se adoptó a la cuenta del cliente real');
  perform tests.eq((select count(*)::int from public.cc_conversations where profile_id = d1), 0, '7 · la cuenta del cliente real no recibió nada');
end $t$;
rollback;
