-- Chat V2-C1 · Autoridad de sesiones. Números = matriz obligatoria del dueño (1..24; 3 en
-- concurrency/chatv2c1_concurrency.sh; 25 en rollback/chatv2c1_rollback.sql).
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin();
  d1 uuid := tests.user('doctor'); d2 uuid := tests.user('doctor'); dD uuid := tests.user('doctor');
  s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos'); sD uuid := tests.user('pos'); v_wh uuid := tests.user('warehouse'); v_drv uuid := tests.user('driver');
  pA uuid; pB uuid; k1 uuid; kD uuid; c1 uuid; cD uuid; c2 uuid; r jsonb; n int; s1id uuid; s2id uuid; t uuid; t2 uuid; v_seq bigint; v_last bigint;
  antes_msgs text; antes_ev int; antes_cursor bigint; semana jsonb;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id in (s1, s2, sD);
  perform tests.cliente(d1); perform tests.cliente(d2); perform tests.cliente(dD);
  pA := tests.producto_cat('Rellenos', 1000); perform tests.stock(pA, 'C1-A', 100);
  pB := tests.producto_cat('Rellenos', 800); perform tests.stock(pB, 'C1-B', 100);
  insert into public.cc_cartera (profile_id, seller_profile_id) values (d1, s1), (dD, sD);
  perform tests.act_as(v_admin);
  semana := (select jsonb_agg(jsonb_build_object('dia', g, 'abierto', true, 'abre', '00:00', 'cierra', '23:59:59.999999')) from generate_series(1, 7) g);
  perform public.cc_horario_guardar('America/Mazatlan', semana);
  perform tests.act_as_service();

  -- ══ 1/2 · abrir/leer NO crea sesión; el primer mensaje abre la 1; el segundo usa la misma ══
  c2 := (public.cc_abrir_conversacion(null, d2) ->> 'conversation_id')::uuid;
  perform public.cc_leer_conversacion(c2, 'doctor', null, d2, 0, 100);
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.cc_conversation_sessions where conversation_id = c2), 0, '1 · abrir y leer la conversación NO crean sesión');
  perform tests.act_as_service();
  r := public.cc_enviar_mensaje(c2, 'doctor', null, d2, 'c2-1', 'Hola');
  perform tests.act_as_owner();
  perform tests.ok((select count(*) = 1 and bool_and(ordinal = 1 and estado = 'abierta' and origen = 'cliente' and first_seq = (r ->> 'seq')::bigint and last_seq is null and closed_at is null)
                      from public.cc_conversation_sessions where conversation_id = c2), '1 · primer mensaje → sesión 1 abierta (origen cliente, first_seq = su seq)');
  perform tests.eq((select count(*)::int from public.cc_conversation_events where conversation_id = c2 and tipo = 'session_opened' and session_id is not null), 1, '1 · evento session_opened con session_id');
  perform tests.act_as_service();
  perform public.cc_enviar_mensaje(c2, 'doctor', null, d2, 'c2-2', '¿Precio?');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.cc_conversation_sessions where conversation_id = c2), 1, '2 · segundo mensaje → MISMA sesión');
  perform tests.ok((select last_activity_at = (select max(created_at) from public.cc_messages where conversation_id = c2) from public.cc_conversation_sessions where conversation_id = c2), '2 · last_activity_at sigue al último mensaje');

  -- ══ 4 · nunca dos sesiones abiertas (índice único) ══
  perform tests.throws(format('insert into public.cc_conversation_sessions (conversation_id, ordinal, estado, origen, first_seq) values (%L, 9, %L, %L, 99)', c2, 'abierta', 'cliente'), 'uq_ccs_abierta', '4 · una segunda sesión abierta es imposible');

  -- ══ handoff por carrito: la sesión nace con el aviso del handoff (origen carrito) ══
  perform tests.act_as_service();
  k1 := (public.cc_carrito_abrir('doctor', null, d1) ->> 'cart_id')::uuid;
  r := public.cc_carrito_agregar(k1, 'doctor', null, d1, pA, 1, 'k1-1');
  c1 := (r -> 'handoff' ->> 'conversation_id')::uuid;
  perform tests.act_as_owner();
  perform tests.ok((select origen = 'carrito' and estado = 'abierta' from public.cc_conversation_sessions where conversation_id = c1), 'sesión abierta por el handoff del carrito (origen carrito)');
  perform tests.ok((select modo = 'human_assigned' and seller_profile_id = s1 from public.cc_conversations where id = c1), 'handoff asignado a la cartera (CC-7 intacto)');

  -- ══ 14 (preparación) · turno de IA reclamado en la sesión 1 mientras la IA aún puede responder ══
  perform tests.act_as_service();
  r := public.cc_enviar_mensaje(c1, 'doctor', null, d1, 'c1-1', '¿Cuánto tarda el envío?');
  v_seq := (r ->> 'seq')::bigint;
  r := public.cc_ia_turno_reclamar(c1, v_seq, 'prueba', 'modelo');
  perform tests.eq(r ->> 'estado', 'reclamado', '14 · turno reclamado en la sesión 1 (human_assigned: la IA aún responde)');
  t := (r ->> 'turn_id')::uuid;

  -- ══ 15 · human_active → la IA sigue silenciada ══
  r := public.cc_iniciar_asesoria(c1, s1);
  perform tests.eq(r ->> 'modo', 'human_active', '15 · asesoría iniciada');
  perform tests.act_as_owner();
  perform tests.ok((select asesor_profile_id = s1 from public.cc_conversation_sessions where conversation_id = c1 and estado = 'abierta'), '15 · la sesión registra quién la atiende (asesor_profile_id)');
  perform tests.act_as_service();
  perform tests.throws(format('select public.cc_enviar_mensaje(%L, ''ai'', null, null, ''ai:900'', ''x'')', c1), 'IA_SILENCIADA', '15 · IA silenciada en human_active');
  perform public.cc_enviar_mensaje(c1, 'seller', null, s1, 's1-1', 'Hola, soy tu asesor.');
  perform public.cc_enviar_mensaje(c1, 'doctor', null, d1, 'c1-2', 'Gracias');

  -- estado antes de terminar (para 8/9/10)
  perform tests.act_as_owner();
  select string_agg(id::text || ':' || seq || ':' || content_hash, ',' order by seq) into antes_msgs from public.cc_messages where conversation_id = c1;
  select seller_profile_id into s1id from public.cc_cartera where profile_id = d1;
  select count(*) into n from public.cc_cart_items where cart_id = k1;

  -- ══ 5/6/7/8/9/10 · terminar asesoría = cerrar la sesión y liberar el estado operativo ══
  perform tests.act_as_service();
  perform tests.throws(format('select public.cc_terminar_asesoria(%L, %L)', c1, s2), 'NO_AUTORIZADO', '5 · otro vendedor no puede terminar');
  r := public.cc_terminar_asesoria(c1, s1);
  perform tests.eq(r ->> 'modo', 'ai_active', '6 · terminar → modo ai_active');
  perform tests.eq((r ->> 'sesion_ordinal')::int, 1, '5 · se cerró la sesión 1');
  perform tests.act_as_owner();
  perform tests.ok((select estado = 'cerrada' and closed_at is not null and close_reason = 'asesor_finalizo' and closed_by_profile_id = s1 and closed_by_actor_type = 'seller'
                           and last_seq = (select ultimo_seq from public.cc_conversations where id = c1) and asesor_profile_id = s1
                           and handoff_origen = 'carrito' and handoff_cart_id = k1 and asesoria_iniciada_at is not null
                      from public.cc_conversation_sessions where conversation_id = c1 and ordinal = 1), '5 · sesión cerrada: last_seq, closed_at real, motivo, quién, asesor y handoff históricos');
  perform tests.eq((select count(*)::int from public.cc_conversation_sessions where conversation_id = c1 and estado = 'abierta'), 0, '5 · ninguna sesión abierta tras terminar');
  perform tests.ok((select modo = 'ai_active' and seller_profile_id is null and ruteo_motivo is null and handoff_origen is null and handoff_cart_id is null
                           and asesoria_solicitada_at is null and asesoria_asignada_at is null and asesoria_iniciada_at is null and estado = 'abierta'
                      from public.cc_conversations where id = c1), '7 · vendedor operativo, ruteo, handoff y marcas liberados; la conversación sigue abierta (permanente)');
  perform tests.eq((select seller_profile_id from public.cc_cartera where profile_id = d1), s1id, '8 · la cartera NO cambia');
  perform tests.eq((select string_agg(id::text || ':' || seq || ':' || content_hash, ',' order by seq) from public.cc_messages where conversation_id = c1 and seq <= (select last_seq - 1 from public.cc_conversation_sessions where conversation_id = c1 and ordinal = 1)), antes_msgs, '9 · mensajes previos intactos (mismos id/seq/contenido)');
  perform tests.ok((select content like 'La asesoría terminó%' from public.cc_messages where conversation_id = c1 and seq = (select last_seq from public.cc_conversation_sessions where conversation_id = c1 and ordinal = 1)), '9 · el aviso de cierre pertenece a la sesión que termina');
  perform tests.ok((select estado = 'active' and handoff_estado = 'solicitado' from public.cc_carts where id = k1) and (select count(*) from public.cc_cart_items where cart_id = k1) = n, '10 · el carrito permanece (activo, mismo handoff, mismos artículos)');
  perform tests.eq((select count(*)::int from public.cc_conversation_events where conversation_id = c1 and tipo = 'session_closed' and session_id is not null), 1, '5 · evento session_closed con session_id');
  perform tests.ok(public._cc_atencion(c1) ->> 'estado' = 'ia', 'CHV2 · la atención derivada vuelve a "ia"');
  perform tests.act_as(s1);
  perform tests.eq((select count(*)::int from public.cc_cola_asesorias() where conversation_id = c1), 0, 'CHV2 · desaparece de la cola del vendedor');
  perform tests.act_as(v_admin);
  perform tests.eq((select count(*)::int from jsonb_array_elements(public.cc_ruteo_pendientes() -> 'conversaciones') e where e ->> 'conversation_id' = c1::text), 0, 'CHV2 · desaparece de los pendientes de Dirección');

  -- ══ 11 · terminar repetido: idempotente y seguro ══
  perform tests.act_as_service();
  r := public.cc_terminar_asesoria(c1, s1);
  perform tests.ok((r ->> 'idempotente')::boolean and r ->> 'modo' = 'ai_active', '11 · el mismo vendedor repite → idempotente');
  r := public.cc_terminar_asesoria(c1, v_admin);
  perform tests.ok((r ->> 'idempotente')::boolean, '11 · Dirección repite → idempotente');
  perform tests.throws(format('select public.cc_terminar_asesoria(%L, %L)', c1, s2), 'NO_AUTORIZADO', '11 · un tercero no obtiene nada');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.cc_conversation_events where conversation_id = c1 and tipo = 'session_closed'), 1, '11 · sin cierre duplicado');

  -- ══ 14 · respuesta tardía de la sesión 1 → descartada; no abre una sesión nueva ══
  perform tests.act_as_service();
  r := public.cc_ia_turno_responder(t, 'Respuesta vieja');
  perform tests.ok(not (r ->> 'persistido')::boolean and r ->> 'motivo' = 'sesion_cambiada', '14 · respuesta tardía de otra sesión descartada (sesion_cambiada)');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.cc_conversation_sessions where conversation_id = c1), 1, '14 · la respuesta vieja NO abrió una sesión');
  perform tests.eq((select count(*)::int from public.cc_messages where conversation_id = c1 and content = 'Respuesta vieja'), 0, '14 · y no se insertó');

  -- ══ 12/13/16 · nueva actividad → sesión 2; la IA vuelve a responder y solo ve la sesión 2 ══
  select last_seq into v_last from public.cc_conversation_sessions where conversation_id = c1 and ordinal = 1;
  perform tests.act_as_service();
  r := public.cc_enviar_mensaje(c1, 'doctor', null, d1, 'c1-3', 'Otra consulta al día siguiente');
  perform tests.eq(r ->> 'modo', 'ai_active', '16 · la nueva actividad llega con la IA disponible');
  v_seq := (r ->> 'seq')::bigint;
  perform tests.act_as_owner();
  perform tests.ok((select ordinal = 2 and estado = 'abierta' and first_seq = v_last + 1 and origen = 'cliente' and asesor_profile_id is null from public.cc_conversation_sessions where conversation_id = c1 and estado = 'abierta'), '12 · mensaje tras el cierre → sesión ordinal 2 (first_seq = last_seq anterior + 1)');
  perform tests.act_as_service();
  r := public.cc_ia_contexto(c1, v_seq, 30);
  perform tests.eq(jsonb_array_length(r), 1, '13 · el contexto de IA es SOLO la sesión 2 (1 mensaje)');
  perform tests.eq(r -> 0 ->> 'content', 'Otra consulta al día siguiente', '13 · sin transcript de la sesión anterior');
  r := public.cc_ia_turno_reclamar(c1, v_seq, 'prueba', 'modelo');
  perform tests.eq(r ->> 'estado', 'reclamado', '16 · la IA puede responder en la sesión nueva');
  t2 := (r ->> 'turn_id')::uuid;
  r := public.cc_ia_turno_responder(t2, 'Claro, te ayudo.');
  perform tests.ok((r ->> 'persistido')::boolean, '16 · respuesta de IA persistida');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.cc_conversation_sessions where conversation_id = c1), 2, '16 · la respuesta cae en la sesión 2 (no abre otra)');

  -- lectura ACTIVA = sesión actual
  perform tests.act_as_service();
  r := public.cc_leer_conversacion(c1, 'doctor', null, d1, 0, 100);
  perform tests.ok(jsonb_array_length(r -> 'mensajes') = 2 and (r -> 'sesion' ->> 'ordinal')::int = 2 and r -> 'sesion' ->> 'estado' = 'abierta', 'leer (activa) = solo la sesión 2, con su metadata');

  -- ══ 17 · (CI-1, 128) mismo carrito con un handoff de la sesión 1 YA CERRADA: una señal fuerte en la sesión 2
  --        abre un EPISODIO nuevo dentro de la sesión 2 (rearme por episodio; antes "un ciclo por carrito") ══
  perform tests.act_as_owner(); select count(*) into n from public.cc_conversation_events where conversation_id = c1 and tipo = 'human_handoff_requested'; perform tests.act_as_service();
  perform public.cc_carrito_quitar(k1, 'doctor', null, d1, pA, 'k1-2');
  r := public.cc_carrito_agregar(k1, 'doctor', null, d1, pB, 1, 'k1-3');
  perform tests.ok(r -> 'handoff' ->> 'estado' = 'solicitado', '17 · CI-1: handoff de una sesión cerrada → la señal fuerte abre un episodio nuevo');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.cc_conversation_events where conversation_id = c1 and tipo = 'human_handoff_requested'), n + 1, '17 · un evento de handoff nuevo');
  perform tests.ok((select modo = 'human_assigned' from public.cc_conversations where id = c1)
                   and (select count(*) = 2 from public.cc_conversation_events e join public.cc_conversation_sessions s on s.id = e.session_id where e.conversation_id = c1 and s.ordinal = 2 and e.tipo in ('human_handoff_requested', 'human_assigned')), '17 · episodio en la sesión 2 (asignado por cartera, eventos con su sesión)');
  -- la solicitud MANUAL con el episodio vigente es idempotente (reglas CC-7)
  perform tests.act_as_service();
  r := public.cc_solicitar_asesor(c1, 'doctor', null, d1);
  perform tests.ok(r ->> 'modo' = 'human_assigned' and (r ->> 'idempotente')::boolean, '17 · solicitud manual con episodio vigente → idempotente, asignada por cartera');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.cc_conversation_sessions where conversation_id = c1), 2, '17 · la solicitud manual no abre otra sesión');

  -- ══ 18..22 · autoridad de historial ══
  select id into s1id from public.cc_conversation_sessions where conversation_id = c1 and ordinal = 1;
  select id into s2id from public.cc_conversation_sessions where conversation_id = c1 and ordinal = 2;
  perform tests.act_as_service();
  r := public.cc_sesiones_listar(c1, 'seller', null, s1);
  perform tests.eq(jsonb_array_length(r -> 'sesiones'), 2, '18 · vendedor de cartera ve todo el historial del cliente');
  perform tests.ok(not ((r -> 'sesiones' -> 0) ? 'content') and (r -> 'sesiones' -> 1 ->> 'n_mensajes')::int >= 6 and (r -> 'sesiones' -> 1 ->> 'asesor_nombre') is not null, '18 · lista sin fragmentos; con conteo y asesor (resuelto por FK)');
  r := public.cc_sesion_leer(s1id, 'seller', null, s1, 0, 100);
  perform tests.ok(r ->> 'rol' = 'cartera' and (r ->> 'solo_lectura')::boolean and jsonb_array_length(r -> 'mensajes') >= 6, '18 · lee la sesión histórica, solo lectura');
  perform tests.throws(format('select public.cc_sesiones_listar(%L, ''seller'', null, %L)', c1, s2), 'NO_AUTORIZADO', '19 · vendedor ajeno no lista');
  perform tests.throws(format('select public.cc_sesion_leer(%L, ''seller'', null, %L, 0, 100)', s1id, s2), 'NO_AUTORIZADO', '19 · vendedor ajeno no lee');
  r := public.cc_sesiones_listar(c1, 'doctor', null, d1);
  perform tests.eq(jsonb_array_length(r -> 'sesiones'), 2, '20 · el doctor ve sus sesiones');
  perform tests.throws(format('select public.cc_sesion_leer(%L, ''doctor'', null, %L, 0, 100)', s1id, d2), 'NO_AUTORIZADO', '20 · otro doctor no lee');
  perform tests.throws(format('select public.cc_sesiones_listar(%L, ''doctor'', null, %L)', c1, d2), 'NO_AUTORIZADO', '20 · ni lista');
  perform tests.throws(format('select public.cc_sesion_leer(%L, ''seller'', null, %L, 0, 100)', s1id, v_wh), 'NO_AUTORIZADO', '21 · almacén no lee transcript');
  perform tests.throws(format('select public.cc_sesion_leer(%L, ''seller'', null, %L, 0, 100)', s1id, v_drv), 'NO_AUTORIZADO', '21 · chofer no lee transcript');
  perform tests.throws(format('select public.cc_sesion_leer(%L, ''visitor'', %L, null, 0, 100)', s1id, 'hash-falso'), 'SESION_INVALIDA', '21 · visitante sin token válido no lee');
  perform tests.act_as_anon();
  perform tests.throws(format('select public.cc_sesion_leer(%L, ''doctor'', null, %L, 0, 100)', s1id, d1), 'permission denied', '21 · anon no puede invocar la RPC');
  perform tests.throws('select count(*) from public.cc_conversation_sessions', 'permission denied', '21 · anon no lee la tabla');
  perform tests.act_as(d1);
  perform tests.throws(format('select public.cc_sesiones_listar(%L, ''doctor'', null, %L)', c1, d1), 'permission denied', '21 · sin acceso directo desde el frontend (solo Edge/servicio)');
  perform tests.act_as_service();
  r := public.cc_sesiones_listar(c1, 'admin', null, v_admin);
  perform tests.eq(jsonb_array_length(r -> 'sesiones'), 2, '22 · Dirección ve todo');
  r := public.cc_sesion_leer(s2id, 'admin', null, v_admin, 0, 100);
  perform tests.eq(r ->> 'rol', 'supervisor', '22 · Dirección lee como supervisor');
  -- vendedor que atendió una sesión histórica pero ya no es de cartera: solo esa sesión
  r := public.cc_sesion_leer(s2id, 'seller', null, s1, 0, 100);
  perform tests.eq(r ->> 'rol', 'asesor', '18b · quien atiende HOY la sesión abierta la lee como asesor');
  -- Dirección pasa SOLO la solicitud a s2 y luego la cartera también: s1 queda como asesor histórico de la sesión 1.
  perform tests.act_as(v_admin); perform public.cc_solicitud_reasignar(c1, s2, 'cubre la solicitud');
  perform tests.act_as_owner(); update public.cc_cartera set seller_profile_id = s2 where profile_id = d1; perform tests.act_as_service();
  r := public.cc_sesion_leer(s1id, 'seller', null, s1, 0, 100);
  perform tests.eq(r ->> 'rol', 'asesor_historico', '18b · quien atendió la sesión 1 la sigue leyendo');
  perform tests.throws(format('select public.cc_sesion_leer(%L, ''seller'', null, %L, 0, 100)', s2id, s1), 'NO_AUTORIZADO', '18b · pero no la sesión 2, que no atendió');
  perform tests.act_as_owner(); update public.cc_cartera set seller_profile_id = s1 where profile_id = d1;

  -- ══ 23/24 · respaldo conservador de un caso como David (conversación previa a la 125) ══
  alter table public.cc_messages disable trigger trg_ccm_sesion;
  perform tests.act_as_service();
  kD := (public.cc_carrito_abrir('doctor', null, dD) ->> 'cart_id')::uuid;
  r := public.cc_carrito_agregar(kD, 'doctor', null, dD, pA, 1, 'kD-1');
  cD := (r -> 'handoff' ->> 'conversation_id')::uuid;
  perform public.cc_enviar_mensaje(cD, 'doctor', null, dD, 'cD-1', 'Hola');
  perform public.cc_iniciar_asesoria(cD, sD);
  perform public.cc_enviar_mensaje(cD, 'seller', null, sD, 'sD-1', 'Hola doctor');
  perform public.cc_enviar_mensaje(cD, 'doctor', null, dD, 'cD-2', 'Perfecto');
  perform tests.act_as_owner();
  delete from public.cc_conversation_sessions where conversation_id = cD;   -- (sin trigger no hubo; asegura el estado "pre-125")
  select string_agg(id::text || ':' || seq || ':' || content_hash, ',' order by seq) into antes_msgs from public.cc_messages where conversation_id = cD;
  select count(*) into antes_ev from public.cc_conversation_events where conversation_id = cD;
  select max(last_read_seq) into antes_cursor from public.cc_participants where conversation_id = cD;
  alter table public.cc_messages enable trigger trg_ccm_sesion;
  n := public._cc_sesiones_respaldo();
  perform tests.ok(n >= 1, '23 · el respaldo crea la sesión faltante');
  perform tests.ok((select count(*) = 1 and bool_and(ordinal = 1 and estado = 'abierta' and origen = 'migracion' and first_seq = 1 and last_seq is null
                                                  and asesor_profile_id = sD
                                                  and opened_at = (select created_at from public.cc_conversations where id = cD)
                                                  and last_activity_at = (select max(created_at) from public.cc_messages where conversation_id = cD))
                      from public.cc_conversation_sessions where conversation_id = cD), '23 · sesión 1 ABIERTA, first_seq 1, origen migracion, asesor por human_started, fechas por evidencia');
  perform tests.ok((select closed_at is null and close_reason is null from public.cc_conversation_sessions where conversation_id = cD), '24 · NO inventa closed_at ni motivo');
  perform tests.eq((select string_agg(id::text || ':' || seq || ':' || content_hash, ',' order by seq) from public.cc_messages where conversation_id = cD), antes_msgs, '23 · mismos mensajes y seq');
  perform tests.eq((select count(*)::int from public.cc_conversation_events where conversation_id = cD), antes_ev, '23 · mismos eventos (el respaldo no escribe eventos)');
  perform tests.eq((select max(last_read_seq) from public.cc_participants where conversation_id = cD), antes_cursor, '23 · mismo cursor');
  perform tests.ok((select modo = 'human_active' and seller_profile_id = sD from public.cc_conversations where id = cD), '23 · sigue human_active con el mismo asesor');
  perform tests.eq((select seller_profile_id from public.cc_cartera where profile_id = dD), sD, '23 · misma cartera');
  perform tests.eq(public._cc_sesiones_respaldo(), 0, '23 · el respaldo es idempotente');
  perform tests.act_as_service();
  r := public.cc_leer_conversacion(cD, 'doctor', null, dD, 0, 100);
  perform tests.ok(jsonb_array_length(r -> 'mensajes') = (select count(*) from public.cc_messages where conversation_id = cD) and r -> 'sesion' ->> 'origen' = 'migracion', '23 · la lectura activa muestra la sesión respaldada completa');
end $t$;
rollback;
