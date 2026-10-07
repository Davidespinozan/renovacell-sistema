-- CHV2-A · Handoff comercial V2 (autoridad backend). Letras = matriz obligatoria del dueño (A..N; M en
-- concurrency/chv2a_concurrency.sh). Decisiones: D-CHV2-01 handler ≠ cartera · 02 alerta solo al vendedor ·
-- 03 umbrales 3/7 · 04 minutos hábiles, fail-closed sin horario · 05 sin pool · 06 IA hasta human_active.
begin;
do $t$
declare
  v_admin uuid := tests.fixture_admin();
  d1 uuid := tests.user('doctor'); d2 uuid := tests.user('doctor'); d3 uuid := tests.user('doctor'); d4 uuid := tests.user('doctor');
  s1 uuid := tests.user('pos'); s2 uuid := tests.user('pos'); s3 uuid := tests.user('pos'); sNo uuid := tests.user('pos'); v_wh uuid := tests.user('warehouse');
  pA uuid; k1 uuid; k2 uuid; k3 uuid; k4 uuid; c1 uuid; c2 uuid; c3 uuid; c4 uuid; r jsonb; a jsonb; n int; n_msgs int; n_items int; cust uuid;
  t_sol timestamptz; t_asig timestamptz; semana jsonb; hoy date; zona text := 'America/Mazatlan'; t0 timestamptz; t1 timestamptz;
begin
  perform tests.act_as_service();
  update public.profiles set meta = coalesce(meta, '{}') || '{"capabilities":["conversaciones","nuevos_clientes"]}' where id in (s1, s2, s3);
  perform tests.cliente(d1); perform tests.cliente(d2); perform tests.cliente(d3); perform tests.cliente(d4);
  pA := tests.producto_cat('Rellenos', 1000); perform tests.stock(pA, 'V2-A', 100);
  insert into public.cc_cartera (profile_id, seller_profile_id) values (d1, s1), (d3, s1), (d4, s1);
  hoy := (now() at time zone zona)::date;

  -- ══ J · SIN horario configurado: estado explícito, cero escalaciones fabricadas ══
  perform tests.eq((public._cc_horario_estado(now()) ->> 'configurado')::boolean, false, 'J · horario sin configurar (premisa)');
  perform tests.ok(public._cc_minutos_habiles(now() - interval '2 hours', now()) is null, 'J · minutos hábiles = NULL sin horario (no se inventan)');
  k4 := (public.cc_carrito_abrir('doctor', null, d4) ->> 'cart_id')::uuid;
  r := public.cc_carrito_agregar(k4, 'doctor', null, d4, pA, 1, 'k4-1');
  c4 := (r -> 'handoff' ->> 'conversation_id')::uuid;
  perform tests.act_as_owner();
  update public.cc_conversations set asesoria_asignada_at = now() - interval '30 minutes', asesoria_solicitada_at = now() - interval '30 minutes' where id = c4;
  a := public._cc_atencion(c4);
  perform tests.eq(a ->> 'estado', 'horario_sin_configurar', 'J · estado explícito horario_sin_configurar');
  perform tests.ok((a ->> 'espera_handler_min')::int >= 30 and (a ->> 'espera_handler_habil_min') is null and (a ->> 'horario_configurado')::boolean = false, 'J · espera wall-clock informativa; hábil NULL');
  perform tests.act_as_service(); r := public.cc_atencion_evaluar(); perform tests.act_as_owner();
  perform tests.eq(r ->> 'omitido', 'horario_sin_configurar', 'J · el evaluador no evalúa sin horario');
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = c4 and kind in ('handoff_aviso', 'handoff_escalado')), 0, 'J · cero avisos/escalaciones fabricadas');
  perform tests.ok((a ->> 'ia_activa')::boolean, 'J · IA sigue disponible');

  -- ══ L (minutos hábiles) · horario 09:00–18:00 todos los días + excepciones ══
  perform tests.act_as(v_admin);
  semana := (select jsonb_agg(jsonb_build_object('dia', g, 'abierto', true, 'abre', '09:00', 'cierra', '18:00')) from generate_series(1, 7) g);
  perform public.cc_horario_guardar(zona, semana);
  perform tests.act_as_owner();   -- los helpers internos se prueban como dueño
  t0 := ('2026-03-02 15:00'::timestamp) at time zone zona; t1 := ('2026-03-03 10:00'::timestamp) at time zone zona;   -- lunes 15:00 → martes 10:00
  perform tests.eq(public._cc_minutos_habiles(t0, t1), 240, 'L · 15:00→18:00 (180) + 09:00→10:00 (60) = 240 min hábiles');
  perform tests.eq(public._cc_minutos_habiles(t1, t0), 0, 'L · intervalo invertido = 0');
  perform tests.eq(public._cc_minutos_habiles(('2026-03-02 20:00'::timestamp) at time zone zona, ('2026-03-02 22:00'::timestamp) at time zone zona), 0, 'L · fuera de horario no suma');
  perform tests.act_as(v_admin); perform public.cc_horario_excepcion_guardar('2026-03-03', 'cerrado', null, null, 'feriado de prueba'); perform tests.act_as_owner();
  perform tests.eq(public._cc_minutos_habiles(t0, t1), 180, 'L · excepción cerrado: el martes no suma');
  perform tests.act_as(v_admin); perform public.cc_horario_excepcion_guardar('2026-03-03', 'horario', '08:00', '12:00', 'horario especial'); perform tests.act_as_owner();
  perform tests.eq(public._cc_minutos_habiles(t0, t1), 300, 'L · excepción horario 08–12: 180 + 120 = 300');
  perform tests.act_as(v_admin); perform public.cc_horario_excepcion_borrar('2026-03-03');
  -- A partir de aquí: siempre en horario (00:00–23:59:59.999999), como en las pruebas CC-7.
  semana := (select jsonb_agg(jsonb_build_object('dia', g, 'abierto', true, 'abre', '00:00', 'cierra', '23:59:59.999999')) from generate_series(1, 7) g);
  perform public.cc_horario_guardar(zona, semana);
  perform tests.act_as_service();

  -- ══ A · asignación inicial: UNA alerta al vendedor, CERO a Dirección, cartera intacta ══
  select count(*) into n from public.notifications;
  k1 := (public.cc_carrito_abrir('doctor', null, d1) ->> 'cart_id')::uuid;
  r := public.cc_carrito_agregar(k1, 'doctor', null, d1, pA, 1, 'k1-1');
  c1 := (r -> 'handoff' ->> 'conversation_id')::uuid;
  perform tests.act_as_owner();
  perform tests.ok((select modo = 'human_assigned' and seller_profile_id = s1 from public.cc_conversations where id = c1), 'A · human_assigned con el vendedor de cartera');
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = c1 and kind = 'handoff_asignado' and user_ids = array[s1]), 1, 'A · exactamente UNA alerta al vendedor asignado');
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = c1 and 'admin' = any(coalesce(roles, '{}'))), 0, 'A · CERO alertas a Dirección (D-CHV2-02)');
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = c1 and body like '%Pedido%'), 0, 'A · la alerta no lleva cuerpos de mensajes');
  perform tests.ok((select body like 'Solicitud de asesor:%' and screen = 'asesorias' and event_key like 'asignacion:%' from public.notifications where conversation_id = c1 and kind = 'handoff_asignado'), 'A · tipo, pantalla y clave de evento');
  perform tests.ok((select seller_profile_id = s1 from public.cc_cartera where profile_id = d1), 'A · cc_cartera intacta');
  perform tests.eq((select count(*)::int from public.cc_conversation_events where conversation_id = c1 and tipo in ('human_handoff_requested', 'human_assigned')), 2, 'A · eventos CC-7 sin cambios (2)');

  -- ══ C · reintento del MISMO handoff: sin alerta duplicada ══
  perform tests.act_as_service();
  r := public.cc_carrito_agregar(k1, 'doctor', null, d1, pA, 1, 'k1-1');
  perform tests.ok((r ->> 'idempotente')::boolean, 'C · replay idempotente');
  r := public.cc_carrito_agregar(k1, 'doctor', null, d1, pA, 2, 'k1-2');   -- segunda mutación (cantidad): no es un handoff nuevo
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = c1), 1, 'C · sigue habiendo UNA sola alerta');

  -- ══ B · sin vendedor elegible: UNA alerta a Dirección, ninguna a vendedores ══
  perform tests.act_as_service();
  k2 := (public.cc_carrito_abrir('doctor', null, d2) ->> 'cart_id')::uuid;
  r := public.cc_carrito_agregar(k2, 'doctor', null, d2, pA, 1, 'k2-1');
  c2 := (r -> 'handoff' ->> 'conversation_id')::uuid;
  perform tests.act_as_owner();
  perform tests.ok((select modo = 'human_requested' and seller_profile_id is null and ruteo_motivo = 'sin_vendedor' from public.cc_conversations where id = c2), 'B · human_requested sin vendedor');
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = c2 and kind = 'handoff_sin_vendedor' and roles = array['admin'] and user_ids is null), 1, 'B · UNA alerta a Dirección');
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = c2 and user_ids is not null), 0, 'B · ninguna alerta a vendedores (sin pool, D-CHV2-05)');
  perform tests.eq(public._cc_atencion(c2) ->> 'estado', 'solicitado_sin_vendedor', 'B · estado derivado');

  -- ══ D · Dirección reasigna SOLO la solicitud: Lucía(s1) → Carlos(s2), motivo obligatorio ══
  select asesoria_solicitada_at, asesoria_asignada_at into t_sol, t_asig from public.cc_conversations where id = c1;
  select count(*) into n_msgs from public.cc_messages where conversation_id = c1;
  select count(*) into n_items from public.cc_cart_items where cart_id = k1;
  select id into cust from public.customers where profile_id = d1;
  perform pg_sleep(0.05);
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.cc_solicitud_reasignar(%L, %L, null)', c1, s2), 'MOTIVO_REQUERIDO', 'D · motivo obligatorio');
  perform tests.throws(format('select public.cc_solicitud_reasignar(%L, %L, ''  '')', c1, s2), 'MOTIVO_REQUERIDO', 'D · motivo en blanco rechazado');
  r := public.cc_solicitud_reasignar(c1, s2, 'Lucía no disponible; Carlos toma la solicitud');
  perform tests.ok((r ->> 'seller')::uuid = s2 and (r ->> 'modo') = 'human_assigned' and (r ->> 'cartera_vendedor')::uuid = s1, 'D · handler Carlos, modo asignado (no activo), cartera reportada Lucía');
  perform tests.act_as_owner();
  perform tests.ok((select seller_profile_id = s2 and id = c1 from public.cc_conversations where id = c1), 'D · misma conversación, handler Carlos');
  perform tests.ok((select seller_profile_id = s1 from public.cc_cartera where profile_id = d1), 'D/I · cc_cartera sigue siendo Lucía (D-CHV2-01)');
  perform tests.eq((select count(*)::int from public.cc_cartera_historial where profile_id = d1), 0, 'I · sin historial de cartera: no hubo cambio de cartera');
  perform tests.eq((select count(*)::int from public.cc_messages where conversation_id = c1), n_msgs, 'D · mensajes intactos');
  perform tests.eq((select count(*)::int from public.cc_cart_items where cart_id = k1), n_items, 'D · carrito intacto');
  perform tests.ok((select id = cust and profile_id = d1 from public.customers where profile_id = d1), 'D · cliente/doctor intactos');
  perform tests.ok((select asesoria_solicitada_at = t_sol and asesoria_asignada_at > t_asig from public.cc_conversations where id = c1), 'D/J · hora de solicitud conservada; handler empieza a esperar desde ahora');
  perform tests.ok(exists (select 1 from public.cc_conversation_events e where e.conversation_id = c1 and e.tipo = 'human_assigned' and e.actor_profile_id = v_admin
                            and (e.detalle ->> 'seller')::uuid = s2 and (e.detalle ->> 'anterior')::uuid = s1 and e.detalle ->> 'motivo' like 'Lucía no disponible%' and e.detalle ->> 'origen' = 'direccion'), 'D · evento append-only con motivo, anterior y origen');
  perform tests.ok(exists (select 1 from public.cc_conversation_events e where e.conversation_id = c1 and e.tipo = 'seller_unassigned' and (e.detalle ->> 'seller')::uuid = s1), 'D · salida de Lucía auditada');
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = c1 and kind = 'handoff_asignado' and user_ids = array[s2]), 1, 'D · UNA alerta a Carlos');
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = c1 and kind = 'handoff_asignado'), 2, 'D · alerta vieja ≠ alerta nueva (eventos distintos)');
  perform tests.ok(public._cc_ia_puede((select modo from public.cc_conversations where id = c1)), 'D/Q · la IA sigue disponible tras reasignar');
  perform tests.ok(not exists (select 1 from public.cc_participants where conversation_id = c1 and profile_id = s1 and rol = 'asesor' and left_at is null), 'D · Lucía ya no participa como asesora');
  -- idempotencia: misma reasignación otra vez → sin evento ni alerta nuevos
  perform tests.act_as(v_admin);
  r := public.cc_solicitud_reasignar(c1, s2, 'repetido');
  perform tests.ok((r ->> 'idempotente')::boolean, 'D · repetir la misma reasignación es idempotente');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = c1 and kind = 'handoff_asignado'), 2, 'D · sin alerta duplicada al repetir');

  -- ══ E · autoridad de reasignar ══
  perform tests.act_as(s1);
  perform tests.throws(format('select public.cc_solicitud_reasignar(%L, %L, ''x'')', c1, s1), 'NO_AUTORIZADO', 'E · el vendedor no reasigna');
  perform tests.act_as(d1);
  perform tests.throws(format('select public.cc_solicitud_reasignar(%L, %L, ''x'')', c1, s1), 'NO_AUTORIZADO', 'E · el doctor no reasigna');
  perform tests.act_as(v_wh);
  perform tests.throws(format('select public.cc_solicitud_reasignar(%L, %L, ''x'')', c1, s1), 'NO_AUTORIZADO', 'E · almacén no reasigna');
  perform tests.act_as_anon();
  perform tests.throws(format('select public.cc_solicitud_reasignar(%L, %L, ''x'')', c1, s1), 'permission denied', 'E · anon no invoca');

  -- ══ F · vendedor inválido ══
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.cc_solicitud_reasignar(%L, %L, ''motivo'')', c1, sNo), 'VENDEDOR_NO_ELEGIBLE', 'F · sin capability "conversaciones"');
  perform tests.throws(format('select public.cc_solicitud_reasignar(%L, %L, ''motivo'')', c1, v_wh), 'VENDEDOR_NO_ELEGIBLE', 'F · rol equivocado');
  perform tests.act_as_service(); update public.profiles set active = false where id = s3; perform tests.act_as(v_admin);   -- suspensión: vía servicio en pruebas (W6-A)
  perform tests.throws(format('select public.cc_solicitud_reasignar(%L, %L, ''motivo'')', c1, s3), 'VENDEDOR_NO_ELEGIBLE', 'F · vendedor inactivo');
  perform tests.act_as_service(); update public.profiles set active = true where id = s3;
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.cc_solicitud_reasignar(%L, %L, ''motivo'')', c1, null), 'VENDEDOR_REQUERIDO', 'F · vendedor obligatorio');
  perform tests.throws(format('select public.cc_solicitud_reasignar(%L, %L, ''motivo'')', gen_random_uuid(), s2), 'SOLICITUD_INEXISTENTE', 'F · solicitud inexistente');

  -- ══ G/H/O/P · 3 min → aviso (vendedor, una vez); 7 min → escalado (Dirección, una vez) ══
  perform tests.act_as_owner();
  perform tests.eq(public._cc_atencion(c1) ->> 'estado', 'asignado_esperando', 'G · recién asignada: esperando');
  update public.cc_conversations set asesoria_asignada_at = now() - interval '4 minutes' where id = c1;
  a := public._cc_atencion(c1);
  perform tests.eq(a ->> 'estado', 'aviso', 'G · a los 3 min hábiles: aviso');
  perform tests.ok((a ->> 'espera_handler_habil_min')::int between 4 and 5 and (a ->> 'umbral_aviso_min')::int = 3 and (a ->> 'umbral_escalamiento_min')::int = 7, 'G · reloj hábil del handler y umbrales 3/7');
  perform tests.act_as_service(); r := public.cc_atencion_evaluar(); perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = c1 and kind = 'handoff_aviso' and user_ids = array[s2]), 1, 'O · recordatorio al vendedor UNA vez');
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = c1 and kind = 'handoff_escalado'), 0, 'G · sin escalación a los 4 min');
  perform tests.act_as_service(); r := public.cc_atencion_evaluar(); perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = c1 and kind = 'handoff_aviso'), 1, 'O · evaluar de nuevo no duplica');
  update public.cc_conversations set asesoria_asignada_at = now() - interval '8 minutes' where id = c1;
  a := public._cc_atencion(c1);
  perform tests.eq(a ->> 'estado', 'escalado', 'H · a los 7 min hábiles: escalado');
  perform tests.ok((a ->> 'ia_activa')::boolean and (a ->> 'modo') = 'human_assigned', 'H/Q · escalado NO cambia el modo ni silencia la IA');
  perform tests.act_as_service(); r := public.cc_atencion_evaluar(); perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = c1 and kind = 'handoff_escalado' and roles = array['admin']), 1, 'P · UNA escalación a Dirección');
  perform tests.ok((select body like 'Solicitud sin atender%' and screen = 'av_atencion' from public.notifications where conversation_id = c1 and kind = 'handoff_escalado'), 'P · texto y destino de la escalación');
  perform tests.act_as_service(); r := public.cc_atencion_evaluar(); perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = c1 and kind in ('handoff_aviso', 'handoff_escalado')), 2, 'P · idempotente: 1 aviso + 1 escalación');
  perform tests.ok((select seller_profile_id = s2 from public.cc_conversations where id = c1) and (select seller_profile_id = s1 from public.cc_cartera where profile_id = d1), 'P · escalar NO reasigna ni toca cartera');
  -- La cola del vendedor y los pendientes de Dirección exponen el estado derivado
  perform tests.act_as(s2);
  perform tests.eq((select q.atencion ->> 'estado' from public.cc_cola_asesorias() q where q.conversation_id = c1), 'escalado', 'H · cc_cola_asesorias expone atencion');
  perform tests.act_as(v_admin);
  perform tests.ok(exists (select 1 from jsonb_array_elements(public.cc_ruteo_pendientes() -> 'conversaciones') x where (x ->> 'conversation_id')::uuid = c1 and x -> 'atencion' ->> 'estado' = 'escalado'), 'H · cc_ruteo_pendientes expone atencion');

  -- ══ I · fuera de horario: el reloj se pausa, sin falsa escalación ══
  perform public.cc_horario_excepcion_guardar(hoy, 'cerrado', null, null, 'cerrado de prueba');
  perform public.cc_horario_excepcion_guardar(hoy - 1, 'cerrado', null, null, 'cerrado de prueba');
  perform tests.act_as_service();
  k3 := (public.cc_carrito_abrir('doctor', null, d3) ->> 'cart_id')::uuid;
  r := public.cc_carrito_agregar(k3, 'doctor', null, d3, pA, 1, 'k3-1');
  c3 := (r -> 'handoff' ->> 'conversation_id')::uuid;
  perform tests.act_as_owner();
  update public.cc_conversations set asesoria_asignada_at = now() - interval '10 minutes' where id = c3;
  a := public._cc_atencion(c3);
  perform tests.eq(a ->> 'estado', 'fuera_de_horario', 'I · fuera de horario: estado explícito');
  perform tests.eq((a ->> 'espera_handler_habil_min')::int, 0, 'I · reloj hábil en 0 (pausado)');
  perform tests.ok((a ->> 'espera_handler_min')::int >= 10, 'I · la espera wall-clock se conserva como información');
  perform tests.act_as_service(); r := public.cc_atencion_evaluar(); perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = c3 and kind in ('handoff_aviso', 'handoff_escalado')), 0, 'I · sin aviso ni escalación fuera de horario');
  perform tests.act_as(v_admin); perform public.cc_horario_excepcion_borrar(hoy); perform public.cc_horario_excepcion_borrar(hoy - 1);

  -- ══ K · el humano entra: sale de pendientes y la IA calla ══
  perform tests.act_as_service();
  r := public.cc_iniciar_asesoria(c1, s2);
  perform tests.act_as_owner();
  a := public._cc_atencion(c1);
  perform tests.ok(a ->> 'estado' = 'activo' and not (a ->> 'ia_activa')::boolean and (a ->> 'iniciado_at') is not null, 'K · activo, IA en silencio, hora de inicio');
  perform tests.act_as_service(); r := public.cc_atencion_evaluar(); perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = c1 and kind in ('handoff_aviso', 'handoff_escalado')), 2, 'K · activa: el evaluador ya no la toca');
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.cc_solicitud_reasignar(%L, %L, ''motivo'')', c1, s1), 'SOLICITUD_NO_REASIGNABLE', 'K · una asesoría activa no se reasigna por encima del humano');

  -- ══ L · falla de notificación: el handoff NO se revierte y queda rastro ══
  perform set_config('app.cc_notif_fallar', 'on', true);
  perform tests.act_as_service();
  r := public.cc_carrito_agregar(k2, 'doctor', null, d2, pA, 3, 'k2-2');   -- d2 sigue sin vendedor; mutación ordinaria sin handoff nuevo
  perform tests.act_as(v_admin);
  r := public.cc_solicitud_reasignar(c2, s2, 'Dirección asigna a Carlos aunque la alerta falle');
  perform tests.act_as_owner();
  perform tests.ok((select modo = 'human_assigned' and seller_profile_id = s2 from public.cc_conversations where id = c2), 'L · el handler cambió aunque la alerta falló');
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = c2 and user_ids = array[s2]), 0, 'L · no se emitió la alerta');
  perform tests.ok(exists (select 1 from public.cc_conversation_events e where e.conversation_id = c2 and e.tipo = 'notificacion_fallida' and e.detalle ->> 'kind' = 'handoff_asignado'), 'L · rastro auditable: notificacion_fallida');
  perform tests.ok(public._cc_ia_puede((select modo from public.cc_conversations where id = c2)), 'L/Q · IA sigue disponible pese a la falla');
  perform set_config('app.cc_notif_fallar', '', true);

  -- ══ Q · continuidad de la IA (política intacta) ══
  perform tests.ok(public._cc_ia_puede('human_requested') and public._cc_ia_puede('human_assigned') and public._cc_ia_puede('ai_active') and public._cc_ia_puede('human_offered'), 'Q · IA permitida en requested/assigned');
  perform tests.ok(not public._cc_ia_puede('human_active') and not public._cc_ia_puede('human_ended'), 'Q · IA en silencio solo con humano activo (y terminada)');

  -- ══ configuración: validaciones, autoridad, historial ══
  perform tests.act_as(v_admin);
  a := public.cc_atencion_config_ver();
  perform tests.ok((a ->> 'aviso_min')::int = 3 and (a ->> 'escalamiento_min')::int = 7 and (a ->> 'pausar_fuera_horario')::boolean, 'config · defaults 3/7/pausa');
  perform tests.throws('select public.cc_atencion_config_guardar(5, 5, true)', 'CONFIG_INVALIDA', 'config · escalamiento > aviso');
  perform tests.throws('select public.cc_atencion_config_guardar(-1, 7, true)', 'CONFIG_INVALIDA', 'config · aviso >= 0');
  perform tests.throws('select public.cc_atencion_config_guardar(3, 2000, true)', 'CONFIG_INVALIDA', 'config · acotado');
  a := public.cc_atencion_config_guardar(2, 6, true);
  perform tests.ok((a ->> 'aviso_min')::int = 2 and (a ->> 'escalamiento_min')::int = 6, 'config · guardada');
  perform tests.act_as_owner();
  perform tests.eq((select count(*)::int from public.cc_atencion_config_hist), 1, 'config · historial append-only');
  perform tests.throws('delete from public.cc_atencion_config_hist', 'APPEND_ONLY', 'config · historial no se borra');
  perform tests.act_as(v_admin); perform public.cc_atencion_config_guardar(3, 7, true);

  -- ══ N · RLS / seguridad ══
  perform tests.act_as(s1);
  perform tests.throws('select public.cc_atencion_config_guardar(1, 2, true)', 'NO_AUTORIZADO', 'N · vendedor no edita SLA');
  perform tests.throws('select public.cc_atencion_config_ver()', 'NO_AUTORIZADO', 'N · vendedor no lee SLA');
  perform tests.throws('select public.cc_ruteo_pendientes()', 'NO_AUTORIZADO', 'N · vendedor no ve la cola de Dirección');
  perform tests.throws('select public.cc_atencion_evaluar()', 'NO_AUTORIZADO', 'N · vendedor no corre el evaluador');
  perform tests.eq((select count(*)::int from public.cc_cola_asesorias() q where q.conversation_id in (c1, c2)), 0, 'N · Lucía ya no ve las solicitudes que pasaron a Carlos');
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = c1 and user_ids = array[s2]), 0, 'N · Lucía no ve las alertas de Carlos');
  perform tests.eq((select count(*)::int from public.notifications where conversation_id in (c1, c2, c3) and 'admin' = any(coalesce(roles, '{}'))), 0, 'N · Lucía no ve las alertas de Dirección');
  perform tests.ok((select count(*) >= 1 from public.notifications where conversation_id = c1 and user_ids = array[s1]), 'N · Lucía sí ve su alerta original');
  perform tests.throws('select * from public.cc_atencion_config', 'permission denied', 'N · tabla de configuración sin acceso directo');
  perform tests.act_as(d1);
  perform tests.throws('select public.cc_atencion_config_ver()', 'NO_AUTORIZADO', 'N · el doctor no ve internos de SLA');
  perform tests.eq((select count(*)::int from public.notifications where conversation_id = c1), 0, 'N · el doctor no ve alertas internas');
  perform tests.act_as(v_wh);
  perform tests.eq((select count(*)::int from public.notifications where kind like 'handoff%'), 0, 'N · almacén no recibe alertas comerciales');
  perform tests.act_as_anon();
  perform tests.throws('select public.cc_atencion_evaluar()', 'permission denied', 'N · anon no evalúa');
end $t$;
rollback;
