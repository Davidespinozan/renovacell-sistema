-- CC-7 · Canal permanente + handoff comercial automático por carrito + cartera canónica + horario.
-- Escenarios del dueño (numerados como en el bloque): 1–35. Horario determinista: semana 00:00–23:59:59.999999
-- (siempre "en horario") y excepción "cerrado" del día local para "fuera de horario".
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin();
  d1 uuid := tests.user('doctor'); d2 uuid := tests.user('doctor'); d3 uuid := tests.user('doctor'); d4 uuid := tests.user('doctor'); d5 uuid := tests.user('doctor');
  s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos'); s3 uuid := tests.user('pos'); sNo uuid := tests.user('pos'); v_wh uuid := tests.user('warehouse');
  pA uuid; pB uuid; k1 uuid; k1b uuid; k2 uuid; k3 uuid; k4 uuid; kv uuid; kv2 uuid; c1 uuid; c2 uuid; c3 uuid; cv uuid; c4 uuid; c5 uuid; k5 uuid;
  r jsonb; m jsonb; n int; n2 int; hV text := repeat('e', 64); hW text := repeat('f', 64); hoy date; code text; rv uuid; ord uuid; semana jsonb;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id in (s1, s2);
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones"]}' where id = s3;      -- atiende, pero no recibe clientes nuevos
  perform tests.cliente(d1); perform tests.cliente(d2); perform tests.cliente(d3); perform tests.cliente(d4); perform tests.cliente(d5);   -- C360-0
  pA := tests.producto_cat('Rellenos', 1000); pB := tests.producto_cat('Rellenos', 500);
  perform tests.stock(pA, 'L7-A', 50); perform tests.stock(pB, 'L7-B', 50);
  hoy := (now() at time zone 'America/Mazatlan')::date;
  semana := (select jsonb_agg(jsonb_build_object('dia', g, 'abierto', true, 'abre', '00:00', 'cierra', '23:59:59.999999')) from generate_series(1, 7) g);

  -- ══ 31 · horario SIN configurar → disponibilidad desconocida, sin promesa de humano inmediato ══
  perform tests.eq((public._cc_horario_estado(now()) ->> 'configurado')::boolean, false, '31 · horario sin configurar');
  insert into public.cc_cartera (profile_id, seller_profile_id) values (d5, s2);
  k5 := (public.cc_carrito_abrir('doctor', null, d5) ->> 'cart_id')::uuid;
  r := public.cc_carrito_agregar(k5, 'doctor', null, d5, pA, 1, 'k5-1');
  perform tests.eq(r -> 'handoff' ->> 'horario_configurado', 'false', '31 · handoff sabe que no hay horario');
  c5 := (r -> 'handoff' ->> 'conversation_id')::uuid;
  perform tests.ok(exists (select 1 from public.cc_messages where conversation_id = c5 and actor_type = 'system' and content like 'Registramos tu solicitud%'), '31 · mensaje veraz: registrado, sin "ya viene"');
  perform tests.ok(not exists (select 1 from public.cc_messages where conversation_id = c5 and content ilike '%te conectaremos%'), '31 · sin promesa de conexión inmediata');

  -- ══ 29/30 · administración del horario (solo Dirección, auditado) ══════════
  perform tests.act_as(d1);
  perform tests.throws(format('select public.cc_horario_guardar(%L, %L)', 'America/Mazatlan', semana), 'NO_AUTORIZADO', '23 · el doctor no configura horario');
  perform tests.act_as(s1);
  perform tests.throws(format('select public.cc_horario_guardar(%L, %L)', 'America/Mazatlan', semana), 'NO_AUTORIZADO', '23 · el vendedor tampoco');
  perform tests.act_as_anon();
  perform tests.throws(format('select public.cc_horario_guardar(%L, %L)', 'America/Mazatlan', semana), 'permission denied', '23 · anon no muta configuración');
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.cc_horario_guardar(%L, %L)', 'Luna/Base', semana), 'ZONA_INVALIDA', 'zona inválida');
  perform tests.throws(format('select public.cc_horario_guardar(%L, %L)', 'America/Mazatlan', '[]'), 'SEMANA_INVALIDA', 'semana incompleta');
  perform tests.throws(format('select public.cc_horario_guardar(%L, %L)', 'America/Mazatlan',
    (select jsonb_agg(jsonb_build_object('dia', g, 'abierto', true, 'abre', '18:00', 'cierra', '09:00')) from generate_series(1, 7) g)), 'HORARIO_INVALIDO', 'apertura después del cierre');
  r := public.cc_horario_guardar('America/Mazatlan', semana);
  perform tests.ok((r ->> 'configurado')::boolean and (r -> 'estado' ->> 'abierto')::boolean, '29 · configurado y en horario (sin despliegue de código)');
  perform tests.eq(jsonb_array_length(r -> 'semana'), 7, '29 · siete días');
  r := public.cc_horario_excepcion_guardar(hoy, 'cerrado', null, null, 'Inventario');
  perform tests.eq((r -> 'estado' ->> 'abierto')::boolean, false, '30 · cierre excepcional de hoy → fuera de horario');
  perform tests.ok((r -> 'estado' ->> 'proxima_apertura') is not null, '30 · se calcula la próxima apertura');
  r := public.cc_horario_excepcion_guardar(hoy, 'horario', '00:00', '23:59:59.999999', 'Apertura especial');
  perform tests.eq((r -> 'estado' ->> 'abierto')::boolean, true, '30 · apertura excepcional');
  r := public.cc_horario_excepcion_borrar(hoy);
  perform tests.eq((r -> 'estado' ->> 'abierto')::boolean, true, 'borrar excepción regresa al horario semanal');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.cc_horario_eventos), 4, '29 · cada cambio de horario queda auditado (append-only)');
  perform tests.throws('update public.cc_horario_eventos set accion = accion', 'APPEND_ONLY', 'la bitácora de horario no se edita');
  perform tests.act_as_service();

  -- ══ 16 · cliente existente con vendedor elegible, en horario ══════════════
  insert into public.cc_cartera (profile_id, seller_profile_id) values (d1, s1);
  k1 := (public.cc_carrito_abrir('doctor', null, d1) ->> 'cart_id')::uuid;
  r := public.cc_carrito_agregar(k1, 'doctor', null, d1, pA, 2, 'k1-1');
  perform tests.eq(r -> 'handoff' ->> 'estado', 'solicitado', '16 · primer artículo → handoff solicitado (servidor)');
  perform tests.eq((r -> 'handoff' ->> 'asignado')::boolean, true, '16 · ruteado a su vendedor de cartera');
  c1 := (r -> 'handoff' ->> 'conversation_id')::uuid;
  perform tests.ok((select modo = 'human_assigned' and seller_profile_id = s1 and handoff_origen = 'carrito' and handoff_cart_id = k1 and not handoff_fuera_horario from public.cc_conversations where id = c1), '16 · conversación human_assigned con s1');
  perform tests.ok(exists (select 1 from public.cc_messages where conversation_id = c1 and actor_type = 'system' and client_message_id = 'sys:handoff:' || k1 and content like 'Te conectaremos con un asesor personal%'), '1 · aviso durable en horario');
  perform tests.eq((select count(*)::int from public.cc_conversation_events where conversation_id = c1 and tipo in ('human_handoff_requested', 'human_assigned')), 2, '18 · eventos observables (solicitado + asignado)');
  perform tests.eq((select count(*)::int from public.cc_cart_events where cart_id = k1 and tipo in ('first_item_added', 'handoff_requested')), 2, '18 · CART_ACTIVATED + HANDOFF_REQUESTED en el carrito');
  -- 4/5 · reintento con la misma operación y "doble clic" (otra operación): sin duplicados
  r := public.cc_carrito_agregar(k1, 'doctor', null, d1, pA, 2, 'k1-1');
  perform tests.eq((r ->> 'idempotente')::boolean, true, '4 · reintento de la misma mutación: idempotente');
  r := public.cc_carrito_agregar(k1, 'doctor', null, d1, pB, 1, 'k1-2');
  perform tests.ok((r -> 'handoff') is null or jsonb_typeof(r -> 'handoff') = 'null', '5 · segunda adición no vuelve a disparar');
  perform tests.eq((select count(*)::int from public.cc_messages where conversation_id = c1 and client_message_id like 'sys:handoff:%'), 1, '14 · un solo aviso por carrito');
  -- 10 · vaciar y volver a llenar el MISMO carrito: un ciclo por carrito
  perform public.cc_carrito_vaciar(k1, 'doctor', null, d1, 'k1-3');
  perform public.cc_carrito_agregar(k1, 'doctor', null, d1, pA, 1, 'k1-4');
  perform tests.eq((select count(*)::int from public.cc_cart_events where cart_id = k1 and tipo = 'handoff_requested'), 1, '10 · vaciar y reactivar no re-dispara');
  -- la IA sigue hasta HUMAN_ACTIVE
  m := public.cc_enviar_mensaje(c1, 'ai', null, null, 'ai:c1:1', 'Mientras tu asesor se une, te ayudo.');
  perform tests.ok((m ->> 'seq')::int > 0, 'AI continúa en human_assigned');
  perform tests.eq((public.cc_ia_estado_handoff(c1) ->> 'asignado')::boolean, true, 'el orquestador ve "asesor asignado"');
  -- vista del vendedor
  perform tests.act_as(s1);
  perform tests.ok(exists (select 1 from public.cc_cola_asesorias() q where q.conversation_id = c1 and q.es_mia and q.handoff_origen = 'carrito' and q.cart_id = k1 and q.n_items = 1 and not q.iniciada), '18 · Asesorías: mía, carrito, edad, no iniciada');
  perform tests.act_as(s2);
  perform tests.eq((select count(*)::int from public.cc_cola_asesorias() q where q.conversation_id = c1), 0, '23 · otro vendedor no ve la cartera ajena');
  perform tests.act_as_service();
  perform tests.throws(format('select public.cc_leer_conversacion(%L, ''seller'', null, %L)', c1, s2), 'NO_AUTORIZADO', '23 · ni la lee');
  perform tests.throws(format('select public.cc_carrito_agregar(%L, ''seller'', null, %L, %L, 1, ''x'')', k1, s1, pB), 'NO_AUTORIZADO', '18 · el vendedor no altera el carrito');
  -- 13/14/15/34 · humano activo → IA callada; termina → el siguiente mensaje del dueño reanuda la IA
  perform public.cc_iniciar_asesoria(c1, s1);
  perform tests.throws(format('select public.cc_enviar_mensaje(%L, ''ai'', null, null, ''ai:c1:2'', ''x'')', c1), 'IA_SILENCIADA', '13 · con HUMAN_ACTIVE la IA calla');
  r := public.cc_handoff_rechazar(c1, 'doctor', null, d1);
  perform tests.eq(r ->> 'motivo', 'asesor_activo', '22 · no se rechaza una sesión humana ya iniciada');
  perform public.cc_terminar_asesoria(c1, s1);
  m := public.cc_enviar_mensaje(c1, 'doctor', null, d1, 'd1:1', 'Otra duda');
  perform tests.eq(m ->> 'modo', 'ai_active', '34 · human_ended → el siguiente mensaje del dueño reanuda la IA');
  m := public.cc_enviar_mensaje(c1, 'ai', null, null, 'ai:c1:3', 'Claro, te ayudo.');
  perform tests.ok((m ->> 'seq')::int > 0, '15 · la IA responde de nuevo');

  -- ══ 35 · canal permanente: el dueño "cierra" pero no pierde la conversación ═
  perform public.cc_cerrar_conversacion(c1, 'doctor', null, d1);
  r := public.cc_abrir_conversacion(null, d1);
  perform tests.ok((r ->> 'conversation_id')::uuid = c1 and r ->> 'estado' = 'abierta', '35 · abrir reabre la misma conversación con su historial');

  -- ══ 11/24/33 · compra y carrito futuro sobre la MISMA conversación ═════════
  insert into public.doctor_locations (doctor_id, name, line1, postal_code, city, state, is_default) values (d1, 'Consultorio', 'Av. del Mar 1', '82000', 'Mazatlán', 'Sinaloa', true);
  perform tests.act_as(d1);
  r := public.cc_checkout_revisar(k1);
  perform tests.eq((r ->> 'listo')::boolean, true, 'revisión lista');
  r := public.cc_checkout_confirmar((r ->> 'review_id')::uuid, 'op-k1', (r ->> 'cart_rev')::int);
  ord := (r ->> 'order_id')::uuid;
  perform tests.act_as_service();
  perform tests.ok((select shipping_meta ->> 'seller_profile_id' = s1::text and shipping_meta ->> 'seller_origen' = 'cartera' from public.orders where id = ord), '33 · el checkout atribuye con la cartera canónica');
  perform tests.ok((select estado = 'abierta' from public.cc_conversations where id = c1), '9 · la compra no cierra la conversación');
  k1b := (public.cc_carrito_abrir('doctor', null, d1) ->> 'cart_id')::uuid;
  perform tests.ok(k1b <> k1, 'carrito nuevo tras la compra');
  r := public.cc_carrito_agregar(k1b, 'doctor', null, d1, pB, 1, 'k1b-1');
  perform tests.ok(r -> 'handoff' ->> 'estado' = 'solicitado' and (r -> 'handoff' ->> 'conversation_id')::uuid = c1, '24/11 · el carrito futuro re-dispara en la MISMA conversación');
  perform tests.ok((select modo = 'human_assigned' and seller_profile_id = s1 from public.cc_conversations where id = c1), '16 · otra vez con su vendedor');

  -- ══ 22/23 · el doctor rechaza al asesor para ESTE carrito ═════════════════
  r := public.cc_handoff_rechazar(c1, 'doctor', null, d1);
  perform tests.ok((r ->> 'rechazado')::boolean and r ->> 'modo' = 'ai_active', '22 · rechazo → la IA sigue');
  perform tests.ok((select handoff_estado = 'rechazado' from public.cc_carts where id = k1b), '22 · rechazo persistido en el carrito');
  perform tests.ok(exists (select 1 from public.cc_cartera where profile_id = d1 and seller_profile_id = s1), '22 · la cartera NO se toca');
  perform public.cc_carrito_vaciar(k1b, 'doctor', null, d1, 'k1b-2');
  perform public.cc_carrito_agregar(k1b, 'doctor', null, d1, pA, 1, 'k1b-3');
  perform tests.ok((select modo = 'ai_active' from public.cc_conversations where id = c1), '23 · el mismo carrito no re-dispara tras el rechazo');
  r := public.cc_handoff_rechazar(c1, 'doctor', null, d1);
  perform tests.eq((r ->> 'idempotente')::boolean, true, '22 · rechazar de nuevo: idempotente');
  perform tests.throws(format('select public.cc_handoff_rechazar(%L, ''doctor'', null, %L)', c1, d2), 'NO_AUTORIZADO', '23 · otro doctor no rechaza por él');

  -- ══ 17/18/19 · cliente nuevo sin vendedor → cola de Dirección → asignación persistente ═
  k2 := (public.cc_carrito_abrir('doctor', null, d2) ->> 'cart_id')::uuid;
  r := public.cc_carrito_agregar(k2, 'doctor', null, d2, pA, 1, 'k2-1');
  c2 := (r -> 'handoff' ->> 'conversation_id')::uuid;
  perform tests.ok((select modo = 'human_requested' and seller_profile_id is null and ruteo_motivo = 'sin_vendedor' from public.cc_conversations where id = c2), '17 · sin vendedor: cola sin asignar (nada aleatorio)');
  perform tests.ok(exists (select 1 from public.cc_conversation_events where conversation_id = c2 and tipo = 'human_handoff_queued' and detalle ->> 'motivo' = 'sin_vendedor'), '17 · HANDOFF_QUEUED observable');
  perform tests.ok(exists (select 1 from public.cc_messages where conversation_id = c2 and content like 'Te conectaremos con un asesor personal%'), '17 · aviso veraz sin nombrar a nadie');
  perform tests.act_as(s1);
  perform tests.eq((select count(*)::int from public.cc_cola_asesorias() q where q.conversation_id = c2), 0, '17 · ningún vendedor la toma');
  perform tests.act_as(v_admin);
  r := public.cc_ruteo_resumen();
  perform tests.ok((r ->> 'handoffs_sin_asignar')::int >= 1 and (r ->> 'sin_vendedor')::int >= 1, '17 · Bandeja: conteos del servidor');
  perform tests.ok(exists (select 1 from jsonb_array_elements(public.cc_ruteo_pendientes() -> 'conversaciones') x where (x ->> 'conversation_id')::uuid = c2 and x ->> 'ruteo_motivo' = 'sin_vendedor' and (x ->> 'edad_min') is not null), '17 · Dirección ve el pendiente con edad y motivo');
  perform tests.ok(exists (select 1 from jsonb_array_elements(public.cc_cartera_listar('sin_vendedor')) x where (x ->> 'profile_id')::uuid = d2), '6 · lista de clientes sin vendedor');
  perform tests.throws(format('select public.cc_cartera_asignar(%L, %L)', d2, s3), 'VENDEDOR_NO_ELEGIBLE', '21 · vendedor sin "clientes nuevos" no recibe asignaciones nuevas');
  perform tests.throws(format('select public.cc_cartera_asignar(%L, %L)', d2, sNo), 'VENDEDOR_NO_ELEGIBLE', 'vendedor sin "conversaciones" no es elegible');
  perform tests.throws(format('select public.cc_cartera_asignar(%L, %L)', s1, s2), 'CLIENTE_INVALIDO', 'solo doctores tienen cartera');
  r := public.cc_cartera_asignar(d2, s2);
  perform tests.ok((r -> 'conversacion' ->> 'modo') = 'human_assigned' and (r -> 'conversacion' ->> 'asignada')::boolean, '18 · Dirección asigna → la conversación llega al vendedor');
  r := public.cc_cartera_asignar(d2, s2);
  perform tests.eq((r ->> 'idempotente')::boolean, true, '18 · reasignar al mismo: idempotente');
  perform tests.throws(format('select public.cc_cartera_asignar(%L, %L)', d2, s1), 'MOTIVO_REQUERIDO', '19 · reasignar exige motivo');
  r := public.cc_cartera_asignar(d2, s1, 'Zona norte');
  perform tests.ok((select seller_profile_id = s1 from public.cc_conversations where id = c2), '19 · la conversación (aún no iniciada) pasa al nuevo vendedor');
  perform tests.act_as_owner();
  perform tests.ok((select count(*) = 2 and bool_and(actor_profile_id = v_admin) from public.cc_cartera_historial where profile_id = d2)
               and exists (select 1 from public.cc_cartera_historial where profile_id = d2 and seller_anterior = s2 and seller_nuevo = s1 and motivo = 'Zona norte'), '19 · historial auditable (anterior, nuevo, actor, motivo)');
  perform tests.throws('delete from public.cc_cartera_historial', 'APPEND_ONLY', '19 · el historial no se borra');
  perform tests.act_as(d2);
  perform tests.throws(format('select public.cc_cartera_asignar(%L, %L, ''yo'')', d2, s2), 'NO_AUTORIZADO', '23 · el doctor no elige vendedor');
  perform tests.act_as(s2);
  perform tests.throws(format('select public.cc_cartera_asignar(%L, %L, ''mío'')', d2, s2), 'NO_AUTORIZADO', '23 · el vendedor no se toma carteras');
  perform tests.act_as_anon();
  perform tests.throws(format('select public.cc_cartera_asignar(%L, %L)', d2, s2), 'permission denied', 'anon no administra cartera');
  perform tests.act_as_service();

  -- ══ 20 · vendedor asignado ya no elegible → cola de reasignación (no al azar) ═
  perform tests.act_as_owner(); perform tests.suspender(s2, 'prueba cc7'); perform tests.act_as_service();
  insert into public.cc_cartera (profile_id, seller_profile_id) values (d3, s2);
  k3 := (public.cc_carrito_abrir('doctor', null, d3) ->> 'cart_id')::uuid;
  r := public.cc_carrito_agregar(k3, 'doctor', null, d3, pA, 1, 'k3-1');
  c3 := (r -> 'handoff' ->> 'conversation_id')::uuid;
  perform tests.ok((select modo = 'human_requested' and seller_profile_id is null and ruteo_motivo = 'vendedor_no_elegible' from public.cc_conversations where id = c3), '20 · vendedor inactivo → requiere reasignación (IA sigue)');
  perform tests.act_as(v_admin);
  perform tests.ok((public.cc_ruteo_resumen() ->> 'reasignacion')::int >= 1, '20 · Dirección ve "reasignación requerida"');
  perform tests.ok(exists (select 1 from jsonb_array_elements(public.cc_cartera_listar('reasignacion')) x where (x ->> 'profile_id')::uuid = d3 and (x ->> 'requiere_reasignacion')::boolean), '20 · y el motivo por cliente');
  perform tests.act_as_owner(); perform tests.reactivar(s2); perform tests.act_as_service();
  -- 21 · un vendedor sin "clientes nuevos" conserva su cartera existente y la sigue atendiendo
  insert into public.cc_cartera (profile_id, seller_profile_id) values (d4, s3);
  k4 := (public.cc_carrito_abrir('doctor', null, d4) ->> 'cart_id')::uuid;
  r := public.cc_carrito_agregar(k4, 'doctor', null, d4, pA, 1, 'k4-1');
  c4 := (r -> 'handoff' ->> 'conversation_id')::uuid;
  perform tests.ok((select modo = 'human_assigned' and seller_profile_id = s3 from public.cc_conversations where id = c4), '21 · deshabilitado para NUEVOS, no para su cartera');

  -- ══ 2 · fuera de horario (con vendedor): se conserva el destino, sin prometer disponibilidad ═
  perform tests.act_as(v_admin);
  perform public.cc_horario_excepcion_guardar(hoy, 'cerrado', null, null, 'Cierre');
  perform tests.act_as_service();
  perform public.cc_handoff_rechazar(c4, 'doctor', null, d4);   -- cierra el ciclo actual (el carrito queda "rechazado")
  update public.cc_carts set estado = 'closed', closed_at = now() where id = k4;   -- carrito comercialmente distinto
  k4 := (public.cc_carrito_abrir('doctor', null, d4) ->> 'cart_id')::uuid;
  r := public.cc_carrito_agregar(k4, 'doctor', null, d4, pB, 1, 'k4b-1');
  perform tests.eq((r -> 'handoff' ->> 'fuera_horario')::boolean, true, '2 · fuera de horario detectado por el servidor');
  perform tests.ok((select seller_profile_id = s3 and handoff_fuera_horario from public.cc_conversations where id = c4), '2 · destino de cartera preservado');
  perform tests.ok(exists (select 1 from public.cc_messages where conversation_id = c4 and client_message_id = 'sys:handoff:' || k4 and content like 'Nuestro equipo de asesores no está disponible%'), '2 · aviso veraz fuera de horario');
  perform tests.ok(exists (select 1 from public.cc_conversation_events where conversation_id = c4 and tipo = 'human_handoff_requested' and (detalle ->> 'fuera_horario')::boolean), '18 · OUTSIDE_BUSINESS_HOURS observable');
  perform tests.eq((public.cc_ia_estado_handoff(c4) ->> 'en_horario')::boolean, false, 'el orquestador sabe que está fuera de horario');

  -- ══ 27/28/32 · visitante con carrito → cola de leads → adopción conserva carrito/handoff ═
  perform tests.act_as(v_admin);
  code := public.cc_codigo_referido_crear(s1);
  perform public.cc_horario_excepcion_borrar(hoy);
  perform tests.act_as_service();
  perform public.cc_visitante_abrir(null, hV, '{}'::jsonb, code);
  kv := (public.cc_carrito_abrir('visitor', hV, null) ->> 'cart_id')::uuid;
  r := public.cc_carrito_agregar(kv, 'visitor', hV, null, pA, 1, 'kv-1');
  cv := (r -> 'handoff' ->> 'conversation_id')::uuid;
  perform tests.ok((select modo = 'human_requested' and seller_profile_id is null and ruteo_motivo = 'visitante' and profile_id is null from public.cc_conversations where id = cv), '27 · visitante: lead en cola, sin cartera ni identidad inventada');
  perform tests.ok((select seller_preferido_id = s1 from public.cc_conversations where id = cv), '32 · atribución del referido registrada aparte');
  insert into public.cc_cartera (profile_id, seller_profile_id) values (d5, s2) on conflict (profile_id) do update set seller_profile_id = excluded.seller_profile_id;
  -- d5 ya tiene conversación abierta (del escenario 31) → la del visitante se consolida y el handoff se conserva
  r := public.cc_visitante_adoptar(hV, d5);
  perform tests.eq(r ->> 'estado', 'adoptado', '28 · adopción');
  perform tests.ok((select estado = 'cerrada' from public.cc_conversations where id = cv), '28 · conversación del visitante consolidada');
  perform tests.ok((select modo in ('human_requested', 'human_assigned') and seller_profile_id = s2 from public.cc_conversations where id = c5), '28 · la canónica del doctor queda ruteada a su cartera (s2)');
  perform tests.ok((select handoff_estado = 'solicitado' from public.cc_carts where profile_id = d5 and estado = 'active'), '28 · el carrito adoptado conserva su handoff');
  perform tests.ok((select seller_profile_id = s1 from public.cc_visitors where adopted_profile_id = d5), '32 · la atribución de marketing NO se pisa con la cartera');

  -- ══ 19 (falla) · el ruteo falla → el carrito NO falla; queda pendiente y se recupera ═
  perform public.cc_visitante_abrir(null, hW, '{}'::jsonb, null);
  kv2 := (public.cc_carrito_abrir('visitor', hW, null) ->> 'cart_id')::uuid;
  perform set_config('app.cc_handoff_fallar', 'on', true);
  r := public.cc_carrito_agregar(kv2, 'visitor', hW, null, pA, 3, 'kv2-1');
  perform set_config('app.cc_handoff_fallar', 'off', true);
  perform tests.ok((r ->> 'qty_despues')::int = 3 and r -> 'handoff' ->> 'estado' = 'pendiente', '19 · carrito válido aunque el handoff falle');
  perform tests.ok((select handoff_estado = 'pendiente' and handoff_error is not null from public.cc_carts where id = kv2)
               and exists (select 1 from public.cc_cart_events where cart_id = kv2 and tipo = 'handoff_failed'), '19 · fallo observable (sqlstate, sin datos)');
  perform tests.act_as(v_admin);
  perform tests.ok((public.cc_ruteo_resumen() ->> 'handoffs_pendientes')::int >= 1, '19 · Dirección ve el estado sin resolver');
  perform tests.act_as_service();
  r := public.cc_abrir_conversacion(hW, null);
  perform tests.ok((select handoff_estado = 'solicitado' from public.cc_carts where id = kv2), '19 · recuperado al volver el dueño');

  -- ══ checkout del Catálogo: snapshot de dirección + factura (convergencia) ═══
  perform tests.act_as(d4);
  r := public.cc_checkout_revisar(k4, null, '{"line1":"Calle 5 #20","cp":"82010","city":"Mazatlán","state":"Sinaloa","phone":"6690000000"}'::jsonb);
  perform tests.ok((r ->> 'listo')::boolean and r -> 'direccion' ->> 'location_id' is null and r -> 'direccion' -> 'address' ->> 'line1' = 'Calle 5 #20', 'Catálogo: revisión con snapshot de dirección validado');
  rv := (r ->> 'review_id')::uuid;
  perform tests.ok(public.cc_checkout_revisar(k4, null, '{"line1":"Calle 5","cp":"ABC"}'::jsonb) -> 'problemas' @> '["REQUIERE_DIRECCION"]', 'snapshot inválido → REQUIERE_DIRECCION');
  r := public.cc_checkout_confirmar(rv, 'op-k4', (r ->> 'cart_rev')::int, true);
  perform tests.ok((r ->> 'confirmado')::boolean, 'Catálogo: confirmación');
  perform tests.act_as_service();
  perform tests.ok((select invoice_requested and shipping_meta -> 'address' ->> 'cp' = '82010' and shipping_meta ->> 'seller_origen' = 'cartera' from public.orders where id = (r ->> 'order_id')::uuid), 'factura solicitada + dirección snapshot + vendedor de cartera');

  -- ══ seguridad de comandos ═════════════════════════════════════════════════
  perform tests.act_as(d1);
  perform tests.throws(format('select public.cc_handoff_rechazar(%L, ''doctor'', null, %L)', c1, d1), 'permission denied', 'el cliente no llama comandos internos directo (solo la Edge)');
  perform tests.throws(format('select public.cc_ia_estado_handoff(%L)', c1), 'permission denied', 'estado para IA: solo servidor');
  perform tests.throws(format('select public._cc_handoff_carrito(%L)', k1b), 'permission denied', 'el cliente no fabrica handoffs');
  perform tests.throws('select public.cc_ruteo_pendientes()', 'NO_AUTORIZADO', 'el doctor no ve el ruteo');
  perform tests.act_as(v_wh);
  perform tests.throws('select public.cc_vendedores()', 'NO_AUTORIZADO', 'almacén no administra vendedores');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.orders o where o.id <> ord and o.shipping_meta ->> 'source' <> 'cc_checkout'), 0, 'ningún pedido fuera de los checkouts de prueba');
end $t$;
rollback;
