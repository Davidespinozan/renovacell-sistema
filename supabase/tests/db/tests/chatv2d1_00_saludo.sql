-- CHAT V2-D1 (130) · Saludo comercial proactivo y persistente: UNO por episodio nuevo del carrito, de la persona
-- Asistente con procedencia 'tpl:' (sin proveedor ni cc_ai_turns), contexto canónico (nombre, producto, asesora
-- confirmada), sin datos comerciales ni clínicos, y sin saludo en dedupe / ya en curso / solicitud / rechazo.
begin;
do $t$
declare
  dA uuid := tests.user('doctor'); dN uuid := tests.user('doctor'); dX uuid := tests.user('doctor'); dR uuid := tests.user('doctor');
  dD uuid := tests.user('doctor'); dU uuid := tests.user('doctor');
  s1 uuid := tests.user('pos'); sU uuid := tests.user('pos');
  pA uuid; pB uuid; kA uuid; kN uuid; kX uuid; kR uuid; kD uuid; kU uuid; cA uuid; cN uuid; cX uuid; cR uuid; cD uuid; cU uuid;
  r jsonb; m jsonb; g record; v_ai0 int; v_txt text; ses_a uuid;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"],"name":"Lucía · Ventas"}' where id = s1;
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"],"name":"ventas2@renovacell.mx"}' where id = sU;
  update public.profiles set meta = coalesce(meta, '{}') || '{"name":"Dr. David Espinoza"}' where id = dA;
  update public.profiles set meta = coalesce(meta, '{}') || '{"name":"maría lópez"}' where id = dN;
  update public.profiles set meta = coalesce(meta, '{}') || '{"name":"david espinoza"}' where id = dD;
  perform tests.cliente(dA); perform tests.cliente(dN); perform tests.cliente(dX); perform tests.cliente(dR); perform tests.cliente(dD); perform tests.cliente(dU);
  pA := tests.producto_cat('Rellenos', 1000); pB := tests.producto_cat('Rellenos', 500);
  update public.products set name = 'Golden Placenta Mask' where id = pA;
  perform tests.stock(pA, 'D1-A', 200); perform tests.stock(pB, 'D1-B', 200);
  insert into public.cc_cartera (profile_id, seller_profile_id) values (dA, s1), (dX, s1), (dR, s1), (dD, s1), (dU, sU);   -- dN sin cartera
  v_ai0 := (select count(*) from public.cc_ai_turns);

  -- ══ ayudantes puros ══
  perform tests.eq(public._cc_primer_nombre('Dr. David Espinoza'), 'David', 'D1 · nombre: sin título');
  perform tests.eq(public._cc_primer_nombre('david espinoza'), 'David', 'D1 · nombre: capitalizado');
  perform tests.eq(public._cc_primer_nombre('Lucía · Ventas'), 'Lucía', 'D1 · nombre: sin rol');
  perform tests.ok(public._cc_primer_nombre('ventas1@renovacell.mx') is null and public._cc_primer_nombre('') is null and public._cc_primer_nombre(null) is null, 'D1 · cuenta técnica o vacía → sin nombre');
  perform tests.eq(public._cc_texto_saludo('David', 'Golden Placenta Mask', true, 'Lucía'),
    '¡Hola, David! 👋 Veo que te interesa Golden Placenta Mask. ¿Te gustaría conocer sus características o necesitas alguna recomendación? Lucía, tu asesora, ya tiene tu solicitud. Mientras tanto, estoy aquí para ayudarte.', 'D1 · plantilla completa (texto aprobado)');
  perform tests.ok(public._cc_texto_saludo(null, null, false, null) like '¡Hola! 👋 Veo que estás armando tu pedido.%Ya registré tu solicitud con nuestro equipo comercial. Mientras tanto, estoy aquí para ayudarte.', 'D1 · variante segura sin nombre, producto ni asesora');
  perform tests.ok(public._cc_texto_saludo('Ana', 'X', true, null) like '%Tu asesora ya tiene tu solicitud.%', 'D1 · asesora confirmada sin nombre presentable');
  v_txt := public._cc_texto_saludo('David', 'Golden Placenta Mask', true, 'Lucía') || public._cc_texto_saludo(null, null, false, null);
  perform tests.ok(v_txt !~* '(\$|precio|costo|disponib|existencia|descuento|promoci|horario|minuto|hora|inmediat|dosis|indicaci|beneficio|garantiz)', 'D1 · sin precios, disponibilidad, descuentos, horarios, tiempos ni afirmaciones clínicas');
  perform tests.eq(public._cc_procedencia_mensaje('ai', 'tpl:saludo:x:1'), 'ia_plantilla', 'D1 · procedencia: plantilla');
  perform tests.eq(public._cc_procedencia_mensaje('ai', 'ai:12'), 'ia_generada', 'D1 · procedencia: IA real');

  -- ══ primer episodio: UN saludo, después del aviso, en la sesión del episodio, con contexto canónico ══
  kA := (public.cc_carrito_abrir('doctor', null, dA) ->> 'cart_id')::uuid;
  r := public.cc_carrito_agregar(kA, 'doctor', null, dA, pA, 1, 'a-1');
  cA := (r -> 'handoff' ->> 'conversation_id')::uuid;
  ses_a := (select id from public.cc_conversation_sessions where conversation_id = cA and estado = 'abierta');
  select m2.* into g from public.cc_messages m2 where m2.conversation_id = cA and m2.client_message_id like 'tpl:saludo:%';
  perform tests.ok(g.actor_type = 'ai' and g.client_message_id = 'tpl:saludo:' || kA || ':0', 'D1 · persona Asistente con procedencia tpl:saludo:<carrito>:<seq>');
  perform tests.eq(g.content, '¡Hola, David! 👋 Veo que te interesa Golden Placenta Mask. ¿Te gustaría conocer sus características o necesitas alguna recomendación? Lucía, tu asesora, ya tiene tu solicitud. Mientras tanto, estoy aquí para ayudarte.', 'D1 · nombre, producto y asesora confirmada (canónicos)');
  perform tests.eq(g.seq, (select seq from public.cc_messages where conversation_id = cA and client_message_id like 'sys:handoff:%') + 1, 'D1 · justo después del aviso (orden: aviso → ruteo → saludo)');
  perform tests.ok(g.seq >= (select first_seq from public.cc_conversation_sessions where id = ses_a), 'D1 · dentro de la sesión del episodio');
  perform tests.eq((select count(*)::int from public.cc_ai_turns), v_ai0, 'D1 · ninguna llamada al proveedor (sin cc_ai_turns)');
  perform tests.ok((select count(*) = max(seq) and count(distinct seq) = count(*) from public.cc_messages where conversation_id = cA), 'D1 · seq contiguo');
  -- cursores: el saludo NO se marca leído
  perform tests.ok(coalesce((select last_read_seq from public.cc_participants where conversation_id = cA and profile_id = dA), 0) < g.seq, 'D1 · el cursor del doctor no avanza por el saludo (queda sin leer)');
  -- C2: un mensaje del asistente renueva la actividad de la sesión
  perform tests.eq((select last_activity_at from public.cc_conversation_sessions where id = ses_a), g.created_at, 'D1 · C2: el saludo cuenta como actividad (renueva)');
  -- historial (C3) y contexto de IA
  r := public.cc_sesion_leer(ses_a, 'doctor', null, dA, 0, 100);
  perform tests.ok(exists (select 1 from jsonb_array_elements(r -> 'mensajes') x where x ->> 'actor' = 'ai' and x ->> 'content' like '¡Hola, David!%'), 'D1 · C3: el saludo está en el historial de la sesión');
  m := public.cc_enviar_mensaje(cA, 'doctor', null, dA, 'a-q1', '¿Qué incluye la caja?');
  r := public.cc_ia_contexto(cA, (m ->> 'seq')::bigint, 30);
  perform tests.ok(exists (select 1 from jsonb_array_elements(r) x where x ->> 'actor' = 'ai' and x ->> 'content' like '¡Hola, David!%'), 'D1 · la IA ve su propio saludo en el contexto de la sesión');
  -- dedupe dentro del episodio: subir y agregar NO saludan otra vez
  r := public.cc_carrito_actualizar(kA, 'doctor', null, dA, pA, 3, 'a-2');
  r := public.cc_carrito_agregar(kA, 'doctor', null, dA, pB, 1, 'a-3');
  perform tests.eq((select count(*)::int from public.cc_messages where conversation_id = cA and client_message_id like 'tpl:saludo:%'), 1, 'D1 · episodio deduplicado → cero saludos nuevos');
  -- reintento de la misma operación e invocación repetida del ayudante → sin duplicado
  r := public.cc_carrito_agregar(kA, 'doctor', null, dA, pA, 1, 'a-1');
  perform tests.ok((r ->> 'idempotente')::boolean, 'D1 · reintento: idempotente');
  perform tests.act_as_owner();
  perform public._cc_saludo_comercial(cA, kA, pA, true, 0);
  perform tests.eq((select count(*)::int from public.cc_messages where conversation_id = cA and client_message_id like 'tpl:saludo:%'), 1, 'D1 · el mismo episodio nunca inserta dos saludos');
  perform tests.act_as_service();
  -- humano activo: la IA real sigue silenciada (el saludo no abre ninguna vía nueva)
  perform public.cc_iniciar_asesoria(cA, s1);
  perform tests.throws(format('select public.cc_enviar_mensaje(%L, ''ai'', null, null, ''ai:a:9'', ''x'')', cA), 'IA_SILENCIADA', 'D1 · human_active → IA silenciada');
  -- episodio NUEVO tras el cierre → saludo nuevo
  perform public.cc_terminar_asesoria(cA, s1);
  r := public.cc_carrito_actualizar(kA, 'doctor', null, dA, pA, 4, 'a-4');
  perform tests.eq((select count(*)::int from public.cc_messages where conversation_id = cA and client_message_id like 'tpl:saludo:%'), 2, 'D1 · episodio nuevo tras el cierre → un saludo nuevo');
  perform tests.ok((select bool_and(m2.seq >= s.first_seq) from public.cc_messages m2 join public.cc_conversation_sessions s on s.conversation_id = m2.conversation_id and s.ordinal = 2
                     where m2.conversation_id = cA and m2.client_message_id like 'tpl:saludo:%' and m2.seq > (select last_seq from public.cc_conversation_sessions where conversation_id = cA and ordinal = 1)), 'D1 · el segundo saludo cae en la sesión 2');

  -- ══ sin vendedor (sin cartera): saludo genérico, sin nombrar a nadie ══
  kN := (public.cc_carrito_abrir('doctor', null, dN) ->> 'cart_id')::uuid;
  r := public.cc_carrito_agregar(kN, 'doctor', null, dN, pB, 1, 'n-1');
  cN := (r -> 'handoff' ->> 'conversation_id')::uuid;
  v_txt := (select content from public.cc_messages where conversation_id = cN and client_message_id like 'tpl:saludo:%');
  perform tests.ok(v_txt like '¡Hola, María! 👋%' and v_txt like '%Ya registré tu solicitud con nuestro equipo comercial.%' and v_txt not like '%tu asesora%', 'D1 · sin vendedor: no afirma una asesora');
  -- vendedor asignado con nombre técnico: no se expone la cuenta
  kU := (public.cc_carrito_abrir('doctor', null, dU) ->> 'cart_id')::uuid;
  r := public.cc_carrito_agregar(kU, 'doctor', null, dU, pB, 1, 'u-1');
  cU := (r -> 'handoff' ->> 'conversation_id')::uuid;
  v_txt := (select content from public.cc_messages where conversation_id = cU and client_message_id like 'tpl:saludo:%');
  perform tests.ok(v_txt like '%Tu asesora ya tiene tu solicitud.%' and v_txt not like '%@%', 'D1 · asesora confirmada con cuenta técnica → sin nombre');

  -- ══ producto no disponible para contexto (firma de 1 argumento: reintento/adopción) → variante genérica ══
  kX := (public.cc_carrito_abrir('doctor', null, dX) ->> 'cart_id')::uuid;
  perform tests.act_as_owner();
  insert into public.cc_cart_items (cart_id, product_id, quantity) values (kX, pA, 1);
  r := public._cc_handoff_carrito(kX);
  cX := (r ->> 'conversation_id')::uuid;
  perform tests.ok((select content like '%Veo que estás armando tu pedido.%' from public.cc_messages where conversation_id = cX and client_message_id like 'tpl:saludo:%'), 'D1 · sin producto de contexto → variante segura');
  perform tests.act_as_service();

  -- ══ sin saludo: solicitud explícita, 'ya en curso' y rechazo ══
  cR := (public.cc_abrir_conversacion(null, dR) ->> 'conversation_id')::uuid;
  perform public.cc_solicitar_asesor(cR, 'doctor', null, dR);
  perform tests.eq((select count(*)::int from public.cc_messages where conversation_id = cR and actor_type = 'ai'), 0, 'D1 · solicitud explícita desde el chat → sin saludo');
  kR := (public.cc_carrito_abrir('doctor', null, dR) ->> 'cart_id')::uuid;
  r := public.cc_carrito_agregar(kR, 'doctor', null, dR, pA, 1, 'r-1');      -- con atención humana ya en curso
  perform tests.eq((select count(*)::int from public.cc_messages where conversation_id = cR and actor_type = 'ai'), 0, 'D1 · episodio ya en curso → sin saludo');
  -- rechazo de un episodio del CARRITO (semántica de CI-1): dentro de la sesión no se vuelve a saludar
  kU := (public.cc_carrito_abrir('doctor', null, dU) ->> 'cart_id')::uuid;
  perform public.cc_handoff_rechazar(cU, 'doctor', null, dU);
  r := public.cc_carrito_actualizar(kU, 'doctor', null, dU, pB, 3, 'u-2');
  perform tests.eq((select count(*)::int from public.cc_messages where conversation_id = cU and client_message_id like 'tpl:saludo:%'), 1, 'D1 · rechazo en el episodio actual → sin saludo nuevo');

  -- ══ caso DAVID: 'solicitado' heredado de una sesión cerrada + 1 producto + subir cantidad ══
  kD := (public.cc_carrito_abrir('doctor', null, dD) ->> 'cart_id')::uuid;
  r := public.cc_carrito_agregar(kD, 'doctor', null, dD, pA, 1, 'd-1');
  cD := (r -> 'handoff' ->> 'conversation_id')::uuid;
  perform public.cc_iniciar_asesoria(cD, s1); perform public.cc_terminar_asesoria(cD, s1);
  perform tests.act_as_owner(); update public.cc_carts set handoff_session_id = null where id = kD; perform tests.act_as_service();
  r := public.cc_carrito_actualizar(kD, 'doctor', null, dD, pA, 2, 'd-2');
  v_txt := (select content from public.cc_messages where conversation_id = cD and client_message_id like 'tpl:saludo:%' order by seq desc limit 1);
  perform tests.eq(v_txt, '¡Hola, David! 👋 Veo que te interesa Golden Placenta Mask. ¿Te gustaría conocer sus características o necesitas alguna recomendación? Lucía, tu asesora, ya tiene tu solicitud. Mientras tanto, estoy aquí para ayudarte.', 'DAVID · episodio nuevo con el saludo esperado');
  perform tests.eq((select count(*)::int from public.cc_messages where conversation_id = cD and client_message_id like 'tpl:saludo:%'), 2, 'DAVID · un saludo por episodio (1 + 1)');

  -- ══ esquema: procedencia garantizada ══
  perform tests.act_as_owner();
  perform tests.throws(format('insert into public.cc_messages (conversation_id, seq, actor_type, client_message_id, content, content_hash) values (%L, 9999, ''ai'', ''x:1'', ''y'', md5(''y''))', cA), 'ck_ccm_procedencia_ia', 'D1 · un mensaje de IA sin procedencia ai:/tpl: no entra');
  perform tests.throws(format('insert into public.cc_messages (conversation_id, seq, actor_type, content, content_hash) values (%L, 9998, ''ai'', ''y'', md5(''y''))', cA), 'ck_ccm_procedencia_ia', 'D1 · ni sin client_message_id');
end $t$;
rollback;
