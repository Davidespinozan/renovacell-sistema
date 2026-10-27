-- R4-C5-A2 · modo PRUEBA por contacto (solo WhatsApp): solo un contacto autorizado y vigente es atendido; el resto sigue en
-- espejo. Se comprueba al recibir, al decidir la IA, al encolar, al reclamar, en el último chequeo antes del POST y al escribir
-- el personal. Vencer o revocar bloquea también lo pendiente; la compuerta de 'activo' sigue cerrada (RPC y UPDATE directo);
-- Instagram y Messenger no cambian; "volver a espejo" apaga la IA, retiene y revoca sin borrar; permisos inmutables.
begin;
\ir ../../../rollback/whatsapp_compuerta_abierta/99_down.sql   -- R4-C6: contrato con la compuerta CERRADA (abierta: canal_06)
do $t$
declare v_admin uuid := tests.fixture_admin(); s1 uuid := tests.user('pos'); a2 uuid; r jsonb; t jsonb; e jsonb;
        ca uuid; cb uuid; ha text; hb text; n bigint; v_id uuid; v_turn uuid; v_hist bigint;
begin
  -- preparación: dos contactos de WhatsApp que ya escribieron en espejo (A se autorizará, B no)
  perform tests.act_as_service();
  a2 := tests.user('admin');
  r := public.cc_wa_entrante('5216670009001', 'Autorizado', 'wamid.C5.A0', 'mensaje histórico de A', false); ca := (r ->> 'conversation_id')::uuid; ha := r ->> 'visitor_hash';
  r := public.cc_wa_entrante('5216670009002', 'Ajeno', 'wamid.C5.B0', 'mensaje histórico de B', false); cb := (r ->> 'conversation_id')::uuid; hb := r ->> 'visitor_hash';
  perform tests.ok(not (r ->> 'activo')::boolean, '0 · espejo: B no activo');

  -- 1 · instalación inerte y compuerta global cerrada (RPC y UPDATE directo)
  perform tests.act_as_owner();
  perform tests.ok((select modo = 'espejo' and not ia_habilitada and not envio_pausado from public.cc_wa_config) and not exists (select 1 from public.cc_canal_prueba), '1 · instalar no cambia el estado: espejo, IA apagada, 0 permisos');
  perform tests.throws($$update public.cc_wa_config set modo = 'activo' where id$$, 'ACTIVACION_BLOQUEADA', '1 · UPDATE directo a activo: bloqueado por la guardia');
  perform tests.throws($$update public.cc_wa_config set modo = 'prueba' where id$$, 'PRUEBA_SIN_PERMISOS', '1 · prueba sin permisos vigentes: bloqueado');
  perform tests.throws($$update public.cc_meta_config set modo = 'prueba' where canal = 'instagram'$$, 'cc_meta_config_modo_check', '1 · Instagram no admite prueba');
  perform tests.act_as(v_admin);
  perform tests.throws($$select public.cc_canal_cambiar('whatsapp', '{"modo":"activo"}', 'Intento de activar')$$, 'ACTIVACION_BLOQUEADA', '1 · RPC a activo: bloqueado');
  perform tests.throws($$select public.cc_canal_cambiar('instagram', '{"modo":"prueba"}', 'Intento en Instagram')$$, 'PRUEBA_SOLO_WHATSAPP', '1 · RPC prueba en Instagram: rechazado');
  perform tests.throws($$select public.cc_canal_cambiar('whatsapp', '{"modo":"prueba"}', 'Sin permisos aún')$$, 'PRUEBA_SIN_PERMISOS', '1 · RPC prueba sin permisos: rechazado');

  -- 2 · autorizar: solo Dirección, por conversación, con límites; tabla cerrada
  perform tests.act_as(s1);
  perform tests.throws(format('select public.cc_canal_prueba_autorizar(%L, 60, %L)', ca, 'Vendedora intenta'), 'NO_AUTORIZADO', '2 · vendedora no autoriza');
  perform tests.throws($$select count(*) from public.cc_canal_prueba$$, 'permission denied', '2 · la tabla no se lee directo');
  perform tests.act_as_anon();
  perform tests.throws(format('select public.cc_canal_prueba_autorizar(%L, 60, %L)', ca, 'Anónimo intenta'), 'permission denied', '2 · anónimo sin ejecución');
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.cc_canal_prueba_autorizar(%L, 1, %L)', ca, 'Muy corto'), 'PRUEBA_MINUTOS', '2 · minutos fuera de rango');
  perform tests.throws(format('select public.cc_canal_prueba_autorizar(%L, 60, %L)', ca, 'no'), 'MOTIVO_REQUERIDO', '2 · motivo obligatorio');
  r := public.cc_canal_prueba_autorizar(ca, 60, 'Prueba controlada R4-C5');
  perform tests.ok(r ->> 'contacto' = '…9001' and (r ->> 'vence_at')::timestamptz > now() + interval '59 minutes', '2 · autorizado A (número enmascarado, vence en 60 min)');
  perform tests.throws(format('select public.cc_canal_prueba_autorizar(%L, 60, %L)', ca, 'Otra vez'), 'PRUEBA_YA_AUTORIZADA', '2 · sin duplicar permiso vigente');
  perform tests.throws(format('select public.cc_canal_prueba_autorizar(%L, 60, %L)', gen_random_uuid(), 'Sin conversación de WA'), 'PRUEBA_NO_WHATSAPP', '2 · solo conversaciones de WhatsApp');
  perform tests.act_as_owner();
  perform tests.throws($$insert into public.cc_canal_prueba (contacto, autorizado_por, motivo, vence_at) values ('5216670009999', (select id from public.profiles limit 1), 'Contacto que no existe', now() + interval '30 minutes')$$, 'PRUEBA_CONTACTO_INEXISTENTE', '2 · solo contactos de WhatsApp existentes (también por SQL directo)');
  perform tests.throws($$insert into public.cc_canal_prueba (canal, contacto, autorizado_por, motivo, vence_at) values ('instagram', '5216670009001', (select id from public.profiles limit 1), 'Otro canal', now() + interval '30 minutes')$$, 'cc_canal_prueba_canal_check', '2 · ningún otro canal');
  perform tests.throws($$insert into public.cc_canal_prueba (contacto, autorizado_por, motivo, vence_at) values ('5216670009001', (select id from public.profiles limit 1), 'Vence en 3 días', now() + interval '3 days')$$, 'PRUEBA_VENCIMIENTO_INVALIDO', '2 · vencimiento máximo 24 h');
  perform tests.act_as(v_admin);

  -- 3 · modo prueba con IA apagada: A pasa a una persona (un aviso que SÍ sale); B sigue en espejo (nada)
  r := public.cc_canal_cambiar('whatsapp', '{"modo":"prueba"}', 'Inicio de la prueba controlada');
  perform tests.ok((r ->> 'cambiado')::boolean, '3 · modo prueba aceptado con permiso vigente');
  perform tests.act_as_service();
  perform tests.ok(not exists (select 1 from public.cc_wa_salida where conversation_id in (ca, cb)), '3 · entrar en prueba no responde mensajes históricos');
  r := public.cc_wa_entrante('5216670009001', null, 'wamid.C5.A1', 'Hola, prueba', false);
  perform tests.ok((r ->> 'activo')::boolean, '3 · A autorizado: activo');
  perform tests.ok((select modo in ('human_requested', 'human_assigned') from public.cc_conversations where id = ca), '3 · A con IA apagada: pasa a una persona');
  perform tests.ok((select count(*) = 1 and bool_and(estado = 'pendiente') from public.cc_wa_salida where conversation_id = ca), '3 · A: un aviso encolado para salir');
  r := public.cc_wa_entrante('5216670009002', null, 'wamid.C5.B1', 'Hola desde B', false);
  perform tests.ok(not (r ->> 'activo')::boolean, '3 · B no autorizado: no activo');
  perform tests.ok((select modo = 'ai_active' and asesoria_solicitada_at is null from public.cc_conversations where id = cb), '3 · B: sin ruteo ni solicitud');
  perform tests.ok(not exists (select 1 from public.cc_wa_salida where conversation_id = cb), '3 · B: nada encolado');
  r := public.cc_wa_entrante('5216670009001', null, 'wamid.C5.A1', 'Hola, prueba', false);
  perform tests.ok((r ->> 'duplicado')::boolean and (select count(*) from public.cc_wa_mensajes where wamid = 'wamid.C5.A1') = 1, '3 · webhook repetido: un solo mensaje');

  -- 4 · reclamo y último chequeo antes del POST: solo filas de A
  perform tests.eq((select count(*) from public.cc_wa_salida_reclamar(20)), 1::bigint, '4 · se reclama solo lo de A');
  v_id := (select id from public.cc_wa_salida where conversation_id = ca and estado = 'enviando');
  perform tests.ok(public.cc_wa_salida_puede_enviar(v_id), '4 · último chequeo: A puede enviarse');
  perform public.cc_wa_salida_resolver(v_id, true, 'wamid.C5.OUT1', null);
  perform tests.ok((select estado = 'enviado' from public.cc_wa_salida where id = v_id), '4 · enviado una vez');
  -- una fila de B insertada a mano (no debería existir) nunca se reclama ni pasa el último chequeo
  perform tests.act_as_owner();
  insert into public.cc_wa_salida (message_id, conversation_id, wa_id, texto, estado)
  select message_id, cb, '5216670009002', 'fila manual de B', 'pendiente' from public.cc_wa_mensajes where wamid = 'wamid.C5.B1';
  perform tests.ok(exists (select 1 from public.cc_wa_salida where texto = 'fila manual de B' and estado = 'pendiente'), '4 · (preparación) fila manual de B insertada');
  perform tests.act_as_service();
  perform tests.eq((select count(*) from public.cc_wa_salida_reclamar(20)), 0::bigint, '4 · la fila manual de B no se reclama');
  perform tests.ok((select estado = 'retenido' and resultado ->> 'retenido_por' = 'sin_permiso_prueba' from public.cc_wa_salida where texto = 'fila manual de B'), '4 · y queda retenida (no sale después)');
  perform tests.act_as_owner(); update public.cc_wa_salida set estado = 'enviando', reclamado_at = now(), intentos = intentos + 1 where texto = 'fila manual de B'; perform tests.act_as_service();
  perform tests.ok(not public.cc_wa_salida_puede_enviar((select id from public.cc_wa_salida where texto = 'fila manual de B')), '4 · último chequeo: B NUNCA puede enviarse');
  perform tests.act_as_owner(); update public.cc_wa_salida set estado = 'retenido' where texto = 'fila manual de B'; perform tests.act_as_service();

  -- 5 · IA encendida (permitida en prueba): A atendido por IA; B no
  perform tests.act_as(v_admin);
  r := public.cc_canal_cambiar('whatsapp', '{"ia_habilitada":true}', 'Encender IA para la prueba');
  perform tests.ok((r ->> 'cambiado')::boolean, '5 · IA encendida en prueba (sin abrir la compuerta)');
  perform tests.act_as_service();
  r := public.cc_wa_entrante('5216670009001', null, 'wamid.C5.A2', '¿Qué es el S2RM?', false);
  t := public.cc_ia_turno_reclamar(ca, (r ->> 'seq')::bigint, 'anthropic', 'modelo-prueba');
  perform tests.eq(t ->> 'estado', 'reclamado', '5 · la IA reclama el turno de A');
  t := public.cc_ia_turno_responder((t ->> 'turn_id')::uuid, 'Respuesta de prueba', 'PRODUCT_INFO');
  perform tests.ok((t ->> 'persistido')::boolean and exists (select 1 from public.cc_wa_salida s join public.cc_messages m on m.id = s.message_id where m.conversation_id = ca and m.actor_type = 'ai'), '5 · respuesta de IA de A guardada y encolada');
  r := public.cc_wa_entrante('5216670009002', null, 'wamid.C5.B2', '¿Y yo?', false);
  t := public.cc_ia_turno_reclamar(cb, (r ->> 'seq')::bigint, 'anthropic', 'modelo-prueba');
  perform tests.ok(t ->> 'estado' = 'silenciado' and (select error_class = 'ia_apagada' from public.cc_ai_turns where id = (t ->> 'turn_id')::uuid), '5 · B: la IA no reclama (sigue en espejo)');
  perform tests.ok((select json_build_object('a', public.cc_wa_conversacion(ca) ->> 'modo', 'b', public.cc_wa_conversacion(cb) ->> 'modo')::text) = '{"a" : "activo", "b" : "espejo"}', '5 · la conversación muestra el modo efectivo (A activo, B espejo)');

  -- 6 · atención humana: Dirección toma A; la IA calla; B queda en espejo para el personal
  perform tests.act_as(v_admin);
  e := public.cc_canal_conversacion_control(ca);
  perform tests.ok((e ->> 'puede_tomar')::boolean and e ->> 'canal_modo' = 'activo', '6 · control: A se puede tomar');
  e := public.cc_canal_conversacion_control(cb);
  perform tests.ok(not (e ->> 'puede_tomar')::boolean and e ->> 'motivo_no_tomar' = 'canal_en_espejo', '6 · control: B en espejo, no se toma');
  perform public.cc_tomar_conversacion(ca, 'Dirección atiende la prueba');
  perform tests.act_as_service();
  r := public.cc_enviar_mensaje(ca, 'admin', null, v_admin, 'c5:adm:1', 'Hola, soy Dirección');
  perform tests.ok(exists (select 1 from public.cc_wa_salida where message_id = (r ->> 'id')::uuid), '6 · Dirección responde a A y se encola');
  perform tests.throws(format('select public.cc_enviar_mensaje(%L, %L, null, %L, %L, %L)', cb, 'admin', v_admin, 'c5:adm:2', 'Intento en B'), 'CANAL_EN_ESPEJO', '6 · en B el personal no escribe (espejo)');
  r := public.cc_wa_entrante('5216670009001', null, 'wamid.C5.A3', 'Gracias', false);
  t := public.cc_ia_turno_reclamar(ca, (r ->> 'seq')::bigint, 'anthropic', 'modelo-prueba');
  perform tests.eq(t ->> 'estado', 'silenciado', '6 · tras la toma, la IA no responde a A');

  -- 7 · pausa y reanudación: retiene y NO libera
  perform tests.act_as(v_admin);
  perform public.cc_canal_cambiar('whatsapp', '{"envio_pausado":true}', 'Pausa de prueba');
  perform tests.act_as_service();
  perform tests.ok(not exists (select 1 from public.cc_wa_salida where conversation_id = ca and estado = 'pendiente') and exists (select 1 from public.cc_wa_salida where conversation_id = ca and estado = 'retenido'), '7 · pausa: lo pendiente de A queda retenido');
  perform tests.eq((select count(*) from public.cc_wa_salida_reclamar(20)), 0::bigint, '7 · en pausa no se reclama');
  perform tests.act_as(v_admin);
  perform public.cc_canal_cambiar('whatsapp', '{"envio_pausado":false}', 'Reanudar prueba');
  perform tests.act_as_service();
  perform tests.ok(not exists (select 1 from public.cc_wa_salida where conversation_id = ca and estado = 'pendiente'), '7 · reanudar no libera lo retenido');

  -- 8 · revocación: lo pendiente se retiene en el acto; lo ya reclamado no pasa el último chequeo; A deja de ser atendido
  r := public.cc_enviar_mensaje(ca, 'admin', null, v_admin, 'c5:adm:3', 'Pendiente antes de revocar');
  r := public.cc_enviar_mensaje(ca, 'admin', null, v_admin, 'c5:adm:4', 'Reclamado antes de revocar');
  perform tests.ok((select count(*) = 2 from public.cc_wa_salida s join public.cc_messages m on m.id = s.message_id where m.client_message_id in ('c5:adm:3', 'c5:adm:4') and s.estado = 'pendiente'), '8 · dos salidas pendientes de A');
  perform tests.act_as_owner(); update public.cc_wa_salida s set estado = 'enviando', reclamado_at = now(), intentos = intentos + 1 from public.cc_messages m where m.id = s.message_id and m.client_message_id = 'c5:adm:4'; perform tests.act_as_service();
  perform tests.act_as(v_admin);
  r := public.cc_canal_prueba_revocar(ca, 'Fin anticipado de la prueba');
  perform tests.ok((r ->> 'revocados')::int = 1 and (r ->> 'vigentes_restantes')::int = 0, '8 · revocado A');
  perform tests.act_as_service();
  perform tests.ok((select s.estado = 'retenido' and s.resultado ->> 'retenido_por' = 'permiso_revocado' from public.cc_wa_salida s join public.cc_messages m on m.id = s.message_id where m.client_message_id = 'c5:adm:3'), '8 · lo pendiente se retuvo en la misma transacción');
  perform tests.ok(not public.cc_wa_salida_puede_enviar((select s.id from public.cc_wa_salida s join public.cc_messages m on m.id = s.message_id where m.client_message_id = 'c5:adm:4')), '8 · lo ya reclamado NO pasa el último chequeo tras revocar');
  r := public.cc_wa_entrante('5216670009001', null, 'wamid.C5.A4', 'Sigo aquí', false);
  perform tests.ok(not (r ->> 'activo')::boolean, '8 · A revocado: ya no se atiende');
  perform tests.throws(format('select public.cc_enviar_mensaje(%L, %L, null, %L, %L, %L)', ca, 'admin', v_admin, 'c5:adm:5', 'Tras revocar'), 'CANAL_EN_ESPEJO', '8 · tras revocar el personal ya no escribe en A');

  -- 9 · vencimiento: estado administrativo 'prueba' pero inoperante; el reclamo retiene lo del contacto vencido
  perform tests.act_as(v_admin);
  r := public.cc_canal_prueba_autorizar(cb, 5, 'Segunda prueba (B)');
  e := public.cc_canal_estado();
  perform tests.ok((e -> 'prueba' ->> 'operativa')::boolean and (e -> 'prueba' ->> 'vigentes')::int = 1 and e -> 'prueba' -> 'permisos' -> 0 ->> 'contacto' = '…9002', '9 · estado: prueba operativa, 1 vigente (…9002)');
  perform tests.act_as_service();
  r := public.cc_wa_entrante('5216670009002', null, 'wamid.C5.B3', 'Ahora sí', false);
  perform tests.ok((r ->> 'activo')::boolean, '9 · B autorizado: activo');
  r := public.cc_enviar_mensaje(cb, 'system', null, null, 'sys:solicitud:c5', 'Aviso de prueba para B');
  perform tests.ok(exists (select 1 from public.cc_wa_salida where message_id = (r ->> 'id')::uuid and estado = 'pendiente'), '9 · un aviso de B pendiente');
  perform tests.act_as_owner();
  alter table public.cc_canal_prueba disable trigger trg_ccp_guardia;   -- solo en la prueba: simula que pasó el tiempo
  update public.cc_canal_prueba set creado_at = now() - interval '2 hours', vence_at = now() - interval '1 second' where contacto = '5216670009002' and revocado_at is null;
  alter table public.cc_canal_prueba enable trigger trg_ccp_guardia;
  perform tests.act_as_service();
  perform tests.eq((select count(*) from public.cc_wa_salida_reclamar(20)), 0::bigint, '9 · vencido: no se reclama');
  perform tests.ok((select estado = 'retenido' and resultado ->> 'retenido_por' = 'sin_permiso_prueba' from public.cc_wa_salida where message_id = (r ->> 'id')::uuid), '9 · vencido: lo pendiente queda retenido');
  r := public.cc_wa_entrante('5216670009002', null, 'wamid.C5.B4', 'Después del vencimiento', false);
  perform tests.ok(not (r ->> 'activo')::boolean, '9 · vencido: B ya no se atiende');
  perform tests.act_as(v_admin);
  e := public.cc_canal_estado();
  perform tests.ok(e -> 'prueba' ->> 'modo_whatsapp' = 'prueba' and not (e -> 'prueba' ->> 'operativa')::boolean and (e -> 'prueba' ->> 'vigentes')::int = 0, '9 · estado: sigue en prueba pero INOPERANTE (0 vigentes)');

  -- 10 · volver a espejo (lo que hace el botón): apaga la IA, retiene, revoca vigentes y conserva el historial
  r := public.cc_canal_prueba_autorizar(ca, 30, 'Tercera ronda (A)');
  perform tests.act_as_service();
  r := public.cc_wa_entrante('5216670009001', null, 'wamid.C5.A5', 'Ronda tres', false);
  perform tests.act_as_owner(); select count(*) into v_hist from public.cc_canal_prueba; perform tests.act_as(v_admin);
  r := public.cc_canal_cambiar('whatsapp', '{"modo":"espejo"}', 'Cierre de la prueba');
  perform tests.act_as_owner();
  perform tests.ok((select modo = 'espejo' and not ia_habilitada from public.cc_wa_config), '10 · volver a espejo: canal en espejo e IA apagada');
  perform tests.ok(not exists (select 1 from public.cc_canal_prueba where revocado_at is null) and (select count(*) from public.cc_canal_prueba) = v_hist, '10 · permisos revocados y conservados (no se borra nada)');
  perform tests.ok(not exists (select 1 from public.cc_wa_salida where estado in ('pendiente', 'enviando') and conversation_id in (ca, cb) and texto <> 'Reclamado antes de revocar'), '10 · nada pendiente tras el cierre');
  perform tests.throws($$delete from public.cc_canal_prueba$$, 'PRUEBA_INMUTABLE', '10 · los permisos no se borran');
  perform tests.throws($$update public.cc_canal_prueba set vence_at = now() + interval '1 hour'$$, 'PRUEBA_INMUTABLE', '10 · un permiso revocado no se reactiva');

  -- 11 · cierre de emergencia por SQL (30_parada_emergencia nivel 3) también desde prueba
  perform tests.act_as(v_admin); r := public.cc_canal_prueba_autorizar(ca, 30, 'Cuarta ronda (A)');
  perform public.cc_canal_cambiar('whatsapp', '{"modo":"prueba","ia_habilitada":true}', 'Reabrir para probar el cierre');
  perform tests.act_as_owner();
  update public.cc_wa_config set modo = 'espejo' where id;   -- cierre de emergencia directo
  perform tests.ok((select modo = 'espejo' and not ia_habilitada from public.cc_wa_config) and not exists (select 1 from public.cc_canal_prueba where revocado_at is null), '11 · cierre directo: espejo, IA apagada y permisos revocados');
  perform tests.ok((select count(*) from public.cc_canal_control_hist where despues ->> 'modo' = 'espejo' and antes ->> 'modo' = 'prueba') >= 2, '11 · los cierres quedan en el historial de controles');

  -- 12 · Instagram y Messenger sin cambios; compuerta cerrada; R4-B1 intacta
  perform tests.ok((select bool_and(modo = 'espejo' and not ia_habilitada) from public.cc_meta_config), '12 · Instagram y Messenger siguen en espejo');
  perform tests.ok(not public._cc_canal_activacion_lista(), '12 · compuerta global cerrada');
  perform tests.ok(not exists (select 1 from public.cc_wa_contactos where wa_id in ('5216670009001', '5216670009002') and profile_id is not null), '12 · R4-B1: ningún contacto vinculado a un doctor');
end $t$;
rollback;
