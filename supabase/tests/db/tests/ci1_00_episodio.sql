-- Commercial Intent · CI-1 (128) · Episodio comercial = sesión (C1), repetible. Señal FUERTE = agregar o subir
-- cantidad sin episodio vigente; bajar/quitar/vaciar nunca disparan; un aviso o rechazo de una sesión CERRADA
-- se rearma; el aviso de sistema va antes que los eventos (todos con su sesión). CI1-01 … CI1-25 (+ caso David).
begin;
do $t$
declare
  dA uuid := tests.user('doctor'); dB uuid := tests.user('doctor'); dR uuid := tests.user('doctor'); dD uuid := tests.user('doctor');
  dN uuid := tests.user('doctor'); dM uuid := tests.user('doctor'); dI uuid := tests.user('doctor');
  s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos');
  pA uuid; pB uuid; kA uuid; kB uuid; kR uuid; kD uuid; kN uuid; kM uuid; kI uuid; cA uuid; cB uuid; cR uuid; cD uuid; cN uuid; cM uuid; cI uuid;
  r jsonb; m jsonb; ses1 jsonb; ses_a uuid; ses_b uuid; n_notif int; n_ev int; t0 timestamptz; turno uuid; v_lact timestamptz;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id in (s1, s2);
  perform tests.cliente(dA); perform tests.cliente(dB); perform tests.cliente(dR); perform tests.cliente(dD); perform tests.cliente(dN); perform tests.cliente(dM); perform tests.cliente(dI);
  pA := tests.producto_cat('Rellenos', 1000); pB := tests.producto_cat('Rellenos', 500);
  perform tests.stock(pA, 'CI1-A', 200); perform tests.stock(pB, 'CI1-B', 200);
  insert into public.cc_cartera (profile_id, seller_profile_id) values (dA, s1), (dB, s1), (dR, s1), (dD, s2), (dM, s1), (dI, s1);   -- dN: sin cartera

  -- ══ CI1-01 · carrito nuevo, sin episodio, primer artículo → episodio (sesión 1, aviso, ruteo, 1 notificación) ══
  kA := (public.cc_carrito_abrir('doctor', null, dA) ->> 'cart_id')::uuid;
  r := public.cc_carrito_agregar(kA, 'doctor', null, dA, pA, 1, 'a-1');
  perform tests.ok(r -> 'handoff' ->> 'estado' = 'solicitado' and coalesce((r -> 'handoff' ->> 'idempotente')::boolean, false) = false, 'CI1-01 · primer artículo → episodio nuevo (aviso NUEVO en la respuesta)');
  cA := (r -> 'handoff' ->> 'conversation_id')::uuid;
  ses_a := (select id from public.cc_conversation_sessions where conversation_id = cA and estado = 'abierta');
  perform tests.ok((select ordinal = 1 and origen = 'carrito' from public.cc_conversation_sessions where id = ses_a), 'CI1-01 · sesión 1 abierta por el aviso (origen carrito)');
  perform tests.ok((select modo = 'human_assigned' and seller_profile_id = s1 from public.cc_conversations where id = cA), 'CI1-15 · ruteado a su vendedor de cartera');
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = cA and kind = 'handoff_asignado'), 1, 'CI1-14 · una notificación por episodio');
  perform tests.eq((select handoff_session_id from public.cc_carts where id = kA), ses_a, 'CI-1 · el carrito queda ligado a la sesión del episodio');
  -- CI1-19 · todos los eventos del episodio llevan la sesión (el aviso abrió la sesión ANTES de los eventos)
  perform tests.ok((select count(*) = 3 and bool_and(session_id = ses_a) from public.cc_conversation_events where conversation_id = cA and tipo in ('session_opened', 'human_handoff_requested', 'human_assigned')), 'CI1-19 · session_opened + solicitado + asignado, todos con su sesión');
  perform tests.ok((select bool_and(seq > (select first_seq - 1 from public.cc_conversation_sessions where id = ses_a)) from public.cc_messages where conversation_id = cA and client_message_id like 'sys:handoff:%'), 'CI1-19 · el aviso pertenece a la sesión');
  -- CI1-07 / CI1-05 · más señales fuertes en el MISMO episodio (human_assigned) → nada nuevo
  n_ev := (select count(*) from public.cc_conversation_events where conversation_id = cA);
  r := public.cc_carrito_actualizar(kA, 'doctor', null, dA, pA, 3, 'a-2');
  perform tests.ok(jsonb_typeof(r -> 'handoff') = 'null' or (r -> 'handoff') is null, 'CI1-05 · subir cantidad en human_assigned → sin aviso en la respuesta');
  r := public.cc_carrito_agregar(kA, 'doctor', null, dA, pB, 2, 'a-3');
  r := public.cc_carrito_actualizar(kA, 'doctor', null, dA, pB, 5, 'a-4');
  perform tests.eq((select count(*)::int from public.cc_messages where conversation_id = cA and client_message_id like 'sys:handoff:%'), 1, 'CI1-07 · varias subidas → un solo aviso');
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = cA and kind = 'handoff_asignado'), 1, 'CI1-07 · varias subidas → una notificación');
  perform tests.eq((select count(*)::int from public.cc_conversation_events where conversation_id = cA), n_ev, 'CI1-07 · varias subidas → sin eventos nuevos');
  -- CI1-08 / 09 / 10 / 11 · bajar, quitar, vaciar y re-agregar dentro del mismo episodio → nada
  r := public.cc_carrito_actualizar(kA, 'doctor', null, dA, pB, 1, 'a-5');
  perform tests.ok((r -> 'handoff') is null or jsonb_typeof(r -> 'handoff') = 'null', 'CI1-08 · bajar cantidad no dispara');
  r := public.cc_carrito_quitar(kA, 'doctor', null, dA, pB, 'a-6');
  perform tests.ok((r -> 'handoff') is null or jsonb_typeof(r -> 'handoff') = 'null', 'CI1-09 · quitar no dispara');
  r := public.cc_carrito_vaciar(kA, 'doctor', null, dA, 'a-7');
  perform tests.ok(((r -> 'handoff') is null or jsonb_typeof(r -> 'handoff') = 'null') and (select handoff_estado = 'solicitado' and handoff_session_id = ses_a from public.cc_carts where id = kA), 'CI1-10 · vaciar no dispara ni rearma (estado y sesión intactos)');
  r := public.cc_carrito_agregar(kA, 'doctor', null, dA, pA, 1, 'a-8');
  perform tests.eq((select count(*)::int from public.cc_messages where conversation_id = cA and client_message_id like 'sys:handoff:%'), 1, 'CI1-11 · vaciar y re-agregar en el mismo episodio → sin duplicado');
  -- CI1-06 · human_active + subir → nada
  perform public.cc_iniciar_asesoria(cA, s1);
  r := public.cc_carrito_actualizar(kA, 'doctor', null, dA, pA, 4, 'a-9');
  perform tests.ok(((r -> 'handoff') is null or jsonb_typeof(r -> 'handoff') = 'null') and (select count(*) = 1 from public.notifications where conversation_id = cA and kind = 'handoff_asignado'), 'CI1-06 · human_active + subir → sin duplicado');
  -- CI1-12 · tras CERRAR el episodio (terminar), una señal fuerte abre un episodio NUEVO (sesión 2)
  perform public.cc_terminar_asesoria(cA, s1);
  ses1 := (select to_jsonb(s) from public.cc_conversation_sessions s where id = ses_a);
  r := public.cc_carrito_actualizar(kA, 'doctor', null, dA, pA, 5, 'a-10');
  perform tests.ok(r -> 'handoff' ->> 'estado' = 'solicitado' and (r -> 'handoff' ->> 'conversation_id')::uuid = cA, 'CI1-12 · episodio cerrado + subir → episodio nuevo en la MISMA conversación');
  ses_b := (select id from public.cc_conversation_sessions where conversation_id = cA and estado = 'abierta');
  perform tests.ok((select ordinal = 2 and origen = 'carrito' from public.cc_conversation_sessions where id = ses_b), 'CI1-17 · sesión 2 (ordinales consecutivos)');
  -- (+1 notificación por episodio nuevo: se prueba en ci1_concurrency.sh con transacciones separadas; aquí now() es
  --  constante y la llave de CHV2-A 'asignacion:<conv>:<vendedor>:<epoch>' deduplica dentro de la misma transacción)
  perform tests.eq((select count(*)::int from public.cc_conversation_events where conversation_id = cA and tipo = 'human_assigned'), 2, 'CI1-14 · el episodio nuevo vuelve a asignar (2 asignaciones)');
  perform tests.eq((select count(*)::int from public.cc_conversations where profile_id = dA), 1, 'CI1-18 · sin segunda conversación permanente');
  perform tests.ok((select to_jsonb(s) from public.cc_conversation_sessions s where id = ses_a) = ses1, 'CI1-25 · la sesión 1 (cerrada) no cambió');
  perform tests.ok((select count(*) = 2 from public.cc_conversation_events where session_id = ses_b and tipo in ('human_handoff_requested', 'human_assigned'))
                   and (select count(*) = 2 from public.cc_conversation_events where session_id = ses_a and tipo in ('human_handoff_requested', 'human_assigned')), 'CI1-19 · cada episodio con sus eventos en SU sesión (2 + 2)');
  perform tests.ok((select count(*) = max(seq) and count(distinct seq) = count(*) from public.cc_messages where conversation_id = cA), 'CI1-20 · seq contiguo, sin huecos ni duplicados');

  -- ══ CI1-02 + caso DAVID · 'solicitado' heredado de una sesión CERRADA, carrito con producto, ai_active, sin sesión abierta ══
  kD := (public.cc_carrito_abrir('doctor', null, dD) ->> 'cart_id')::uuid;
  r := public.cc_carrito_agregar(kD, 'doctor', null, dD, pA, 1, 'd-1');
  cD := (r -> 'handoff' ->> 'conversation_id')::uuid;
  perform public.cc_iniciar_asesoria(cD, s2);
  m := public.cc_enviar_mensaje(cD, 'seller', null, s2, 'd-s1', 'Hola doctor');
  perform public.cc_terminar_asesoria(cD, s2);
  perform tests.act_as_owner();
  update public.cc_carts set handoff_session_id = null where id = kD;   -- igual que producción: fila previa a la 128 (sin relación)
  perform tests.act_as_service();
  perform tests.ok((select k.handoff_estado = 'solicitado' and k.handoff_session_id is null and (select count(*) from public.cc_cart_items i where i.cart_id = k.id) = 1 from public.cc_carts k where k.id = kD)
                   and (select modo = 'ai_active' and seller_profile_id is null from public.cc_conversations where id = cD)
                   and not exists (select 1 from public.cc_conversation_sessions where conversation_id = cD and estado = 'abierta')
                   and exists (select 1 from public.cc_cartera where profile_id = dD and seller_profile_id = s2), 'DAVID · premisa: solicitado heredado, 1 producto, ai_active, sin sesión, cartera s2');
  ses1 := (select to_jsonb(s) from public.cc_conversation_sessions s where conversation_id = cD and ordinal = 1);
  n_notif := (select count(*) from public.notifications where conversation_id = cD and kind = 'handoff_asignado');
  r := public.cc_carrito_actualizar(kD, 'doctor', null, dD, pA, 2, 'd-2');   -- la señal fuerte real de David: subir cantidad
  perform tests.ok(r -> 'handoff' ->> 'estado' = 'solicitado' and (r -> 'handoff' ->> 'conversation_id')::uuid = cD, 'CI1-02 / DAVID · nueva señal fuerte → episodio nuevo, MISMA conversación');
  perform tests.ok((select count(*) = 1 and bool_and(ordinal = 2 and origen = 'carrito') from public.cc_conversation_sessions where conversation_id = cD and estado = 'abierta'), 'DAVID · sesión 2 abierta (origen carrito)');
  perform tests.eq((select count(*)::int from public.cc_messages where conversation_id = cD and client_message_id like 'sys:handoff:%'), 2, 'DAVID · un aviso NUEVO (el del episodio 1 no lo absorbe)');
  perform tests.ok((select modo = 'human_assigned' and seller_profile_id = s2 from public.cc_conversations where id = cD), 'DAVID · ruteado al MISMO vendedor de cartera');
  perform tests.eq((select count(*)::int from public.cc_conversation_events where conversation_id = cD and tipo = 'human_assigned'), 2, 'DAVID · una asignación nueva (la notificación se prueba en ci1_concurrency.sh)');
  perform tests.ok((select to_jsonb(s) from public.cc_conversation_sessions s where conversation_id = cD and ordinal = 1) = ses1, 'DAVID · sesión 1 intacta');
  perform tests.eq((select count(*)::int from public.cc_cartera where profile_id = dD), 1, 'DAVID · cartera sin cambios');

  -- ══ CI1-03 + rechazo · rechazo en el episodio ACTUAL bloquea; tras cerrar la sesión se rearma ══
  kR := (public.cc_carrito_abrir('doctor', null, dR) ->> 'cart_id')::uuid;
  r := public.cc_carrito_agregar(kR, 'doctor', null, dR, pA, 1, 'r-1');
  cR := (r -> 'handoff' ->> 'conversation_id')::uuid;
  r := public.cc_handoff_rechazar(cR, 'doctor', null, dR);
  perform tests.ok((r ->> 'rechazado')::boolean and (select handoff_estado = 'rechazado' and handoff_session_id = (select id from public.cc_conversation_sessions where conversation_id = cR and estado = 'abierta') from public.cc_carts where id = kR), 'rechazo · ligado a la sesión del episodio actual');
  r := public.cc_carrito_actualizar(kR, 'doctor', null, dR, pA, 3, 'r-2');
  r := public.cc_carrito_agregar(kR, 'doctor', null, dR, pB, 1, 'r-3');
  perform tests.ok((select modo = 'ai_active' from public.cc_conversations where id = cR) and (select count(*) = 1 from public.notifications where conversation_id = cR and kind = 'handoff_asignado'), 'rechazo · en el episodio actual, subir/agregar NO vuelve a avisar (sin acoso)');
  perform tests.act_as_owner();
  perform public._cc_sesion_cerrar_con(cR, 'inactividad', 'system', null, '{}'::jsonb);   -- C2 cierra la sesión
  perform tests.act_as_service();
  r := public.cc_carrito_actualizar(kR, 'doctor', null, dR, pA, 4, 'r-4');
  perform tests.ok(r -> 'handoff' ->> 'estado' = 'solicitado' and (select modo = 'human_assigned' from public.cc_conversations where id = cR), 'CI1-03 · rechazo de una sesión CERRADA → la siguiente señal fuerte rearma');
  perform tests.ok((select count(*) = 1 and bool_and(ordinal = 2) from public.cc_conversation_sessions where conversation_id = cR and estado = 'abierta'), 'CI1-03 · episodio en la sesión 2');
  -- un segundo rechazo en otro episodio deja su propio aviso (id por episodio, no absorbido)
  r := public.cc_handoff_rechazar(cR, 'doctor', null, dR);
  perform tests.eq((select count(*)::int from public.cc_messages where conversation_id = cR and client_message_id like 'sys:rechazo:%'), 2, 'rechazo · cada episodio deja su aviso de rechazo');

  -- ══ CI1-04 · human_requested (solicitud explícita sin vendedor elegible) + subir → sin duplicado ══
  kN := (public.cc_carrito_abrir('doctor', null, dN) ->> 'cart_id')::uuid;   -- dN: sin cartera
  r := public.cc_carrito_agregar(kN, 'doctor', null, dN, pA, 1, 'n-1');
  cN := (r -> 'handoff' ->> 'conversation_id')::uuid;
  perform tests.ok((select modo = 'human_requested' and seller_profile_id is null from public.cc_conversations where id = cN), 'CI1-16 · sin cartera: queda solicitado y en cola (ruteo canónico)');
  perform tests.ok(exists (select 1 from public.cc_conversation_events e join public.cc_conversation_sessions s on s.id = e.session_id where e.conversation_id = cN and e.tipo = 'human_handoff_queued' and s.estado = 'abierta'), 'CI1-16 · encolado observable, en su sesión');
  r := public.cc_carrito_actualizar(kN, 'doctor', null, dN, pA, 2, 'n-2');
  perform tests.ok(((r -> 'handoff') is null or jsonb_typeof(r -> 'handoff') = 'null') and (select count(*) = 1 from public.cc_messages where conversation_id = cN and client_message_id like 'sys:handoff:%'), 'CI1-04 · human_requested + subir → sin duplicado');

  -- ══ Solicitud EXPLÍCITA sin sesión abierta: los eventos ya caen en la sesión (P2 corregido); su flujo no cambia ══
  cM := (public.cc_abrir_conversacion(null, dM) ->> 'conversation_id')::uuid;
  r := public.cc_solicitar_asesor(cM, 'doctor', null, dM);
  perform tests.ok((r ->> 'asesor')::boolean and (select modo = 'human_assigned' from public.cc_conversations where id = cM), 'explícita · flujo canónico intacto (asignado por cartera)');
  perform tests.ok((select count(*) = 3 and bool_and(e.session_id is not null and s.estado = 'abierta') from public.cc_conversation_events e left join public.cc_conversation_sessions s on s.id = e.session_id where e.conversation_id = cM and e.tipo in ('session_opened', 'human_requested', 'human_assigned')), 'explícita · session_opened + solicitado + asignado con sesión');
  kM := (public.cc_carrito_abrir('doctor', null, dM) ->> 'cart_id')::uuid;
  r := public.cc_carrito_agregar(kM, 'doctor', null, dM, pA, 1, 'm-1');
  perform tests.ok(((r -> 'handoff') is null or jsonb_typeof(r -> 'handoff') = 'null') and (select count(*) = 1 from public.notifications where conversation_id = cM and kind = 'handoff_asignado'), 'explícita · agregar con una solicitud vigente → sin segundo aviso');

  -- ══ CI1-21 · C2: el aviso del carrito en una sesión YA abierta no renueva la actividad (semántica aprobada) ══
  cI := (public.cc_abrir_conversacion(null, dI) ->> 'conversation_id')::uuid;
  m := public.cc_enviar_mensaje(cI, 'doctor', null, dI, 'i-1', 'Hola, una duda');
  perform tests.act_as_owner();
  update public.cc_conversation_sessions set last_activity_at = now() - interval '2 hours' where conversation_id = cI and estado = 'abierta';
  v_lact := (select last_activity_at from public.cc_conversation_sessions where conversation_id = cI and estado = 'abierta');
  perform tests.act_as_service();
  kI := (public.cc_carrito_abrir('doctor', null, dI) ->> 'cart_id')::uuid;
  r := public.cc_carrito_agregar(kI, 'doctor', null, dI, pA, 1, 'i-2');
  perform tests.ok((select count(*) = 1 and bool_and(ordinal = 1) from public.cc_conversation_sessions where conversation_id = cI), 'CI1-14/17 · con sesión abierta, el episodio NO crea otra sesión');
  perform tests.eq((select last_activity_at from public.cc_conversation_sessions where conversation_id = cI and estado = 'abierta'), v_lact, 'CI1-21 · sys:handoff no renueva la actividad (C2 intacto)');
  perform tests.ok((select bool_and(e.session_id = s.id) from public.cc_conversation_events e join public.cc_conversation_sessions s on s.conversation_id = e.conversation_id and s.estado = 'abierta' where e.conversation_id = cI and e.tipo in ('human_handoff_requested', 'human_assigned')), 'CI1-19 · eventos en la sesión ya abierta');

  -- ══ CI1-22 / 23 / 24 · autoridad de la IA intacta ══
  perform tests.ok(public._cc_ia_puede('ai_active') and public._cc_ia_puede('human_requested') and public._cc_ia_puede('human_assigned') and not public._cc_ia_puede('human_active'), 'CI1-22/23 · _cc_ia_puede sin cambios');
  m := public.cc_enviar_mensaje(cI, 'ai', null, null, 'ai:i:1', 'Mientras tu asesor llega, te ayudo.');
  perform tests.ok((m ->> 'seq')::int > 0 and (select modo = 'human_assigned' from public.cc_conversations where id = cI), 'CI1-22 · la IA responde en human_assigned');
  m := public.cc_enviar_mensaje(cI, 'doctor', null, dI, 'i-3', '¿Y el envío?');
  r := public.cc_ia_turno_reclamar(cI, (m ->> 'seq')::bigint, 'test', 'test');
  turno := (r ->> 'turn_id')::uuid;
  perform public.cc_iniciar_asesoria(cI, s1);
  r := public.cc_ia_turno_responder(turno, 'Respuesta tardía');
  perform tests.ok(not (r ->> 'persistido')::boolean and r ->> 'motivo' = 'takeover_humano', 'CI1-24 · respuesta de IA tras la toma del asesor → descartada (takeover_humano)');
  perform tests.throws(format('select public.cc_enviar_mensaje(%L, ''ai'', null, null, ''ai:i:2'', ''x'')', cI), 'IA_SILENCIADA', 'CI1-23 · human_active → IA silenciada');

  -- ══ Idempotencia por operación (misma petición repetida) ══
  r := public.cc_carrito_actualizar(kD, 'doctor', null, dD, pA, 2, 'd-2');
  perform tests.ok((r ->> 'idempotente')::boolean and (select count(*) = 2 from public.cc_messages where conversation_id = cD and client_message_id like 'sys:handoff:%'), 'CI1-13a · la misma operación repetida no duplica el episodio');
end $t$;
rollback;
