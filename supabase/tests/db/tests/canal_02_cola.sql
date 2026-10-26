-- R4-B2-2 · cola y despacho seguro: avisos de sistema permitidos/prohibidos, pausa (retiene lo pendiente y lo nuevo, no
-- se reclama, la verificación previa dice que no), reanudar sin liberar, espejo, resolución por clase (nueva y heredada),
-- 'enviando' colgado → incierto sin reintento, decisiones de Dirección (liberar/descartar, ventana, canal, estado, permisos,
-- auditoría), revisión sin números completos y aislamiento entre canales.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); s1 uuid := tests.user('pos'); r jsonb; c uuid; cig uuid; v_seq bigint; n bigint; v_id uuid; v_ids uuid[]; vg record;
begin
  -- preparación: WhatsApp e Instagram activos (IA apagada: el ingreso pide asesor y su aviso sys:… se encola)
  perform tests.act_as_owner();
  alter table public.cc_wa_config disable trigger trg_cc_wa_config_guardia; update public.cc_wa_config set modo = 'activo', ia_habilitada = false, envio_pausado = false where id;
  update public.cc_meta_config set modo = 'activo', ia_habilitada = false, envio_pausado = false where canal = 'instagram';
  perform tests.act_as_service();
  r := public.cc_wa_entrante('5216670002001', 'Cola WA', 'wamid.B22.W1', 'Hola', false);
  c := (r ->> 'conversation_id')::uuid;
  r := public.cc_meta_entrante('instagram', '17841400000222001', null, 'mid.B22.I1', 'hola ig', false);
  cig := (r ->> 'conversation_id')::uuid;

  -- 1 · avisos de sistema: solo los autorizados salen por el canal
  perform tests.ok((select count(*) = 1 from public.cc_wa_salida s join public.cc_messages m on m.id = s.message_id where s.conversation_id = c and m.client_message_id like 'sys:wa:%'), '1 · el aviso sys:wa: del enrutamiento se encola');
  perform public.cc_enviar_mensaje(c, 'system', null, null, 'sys:solicitud:900', 'Pediste hablar con un asesor.');
  perform public.cc_enviar_mensaje(c, 'system', null, null, 'sys:falla_ia:901', 'No pudimos responder tu mensaje automáticamente.');
  perform public.cc_enviar_mensaje(c, 'system', null, null, 'sys:ia_no_disponible', 'No pude consultar al asistente.');
  perform public.cc_enviar_mensaje(c, 'system', null, null, 'sys:handoff:902', 'aviso interno');
  perform public.cc_enviar_mensaje(c, 'system', null, null, 'sys:instagram:903', 'prefijo de otro canal');
  perform public.cc_enviar_mensaje(c, 'system', null, null, null, 'sin identificador');
  perform tests.ok(exists (select 1 from public.cc_wa_salida s join public.cc_messages m on m.id = s.message_id where m.client_message_id = 'sys:solicitud:900')
               and exists (select 1 from public.cc_wa_salida s join public.cc_messages m on m.id = s.message_id where m.client_message_id = 'sys:falla_ia:901'), '1 · sys:solicitud: y sys:falla_ia: se encolan');
  perform tests.ok(not exists (select 1 from public.cc_wa_salida s join public.cc_messages m on m.id = s.message_id
                               where m.conversation_id = c and (m.client_message_id in ('sys:ia_no_disponible', 'sys:handoff:902', 'sys:instagram:903') or (m.actor_type = 'system' and m.client_message_id is null))),
                   '1 · los demás sys: (y sin identificador) NO salen por WhatsApp');
  perform public.cc_enviar_mensaje(cig, 'system', null, null, 'sys:messenger:904', 'prefijo de otro canal');
  perform tests.ok(exists (select 1 from public.cc_meta_salida s join public.cc_messages m on m.id = s.message_id where m.conversation_id = cig and m.client_message_id like 'sys:instagram:%')
               and not exists (select 1 from public.cc_meta_salida s join public.cc_messages m on m.id = s.message_id where m.client_message_id = 'sys:messenger:904'), '1 · Instagram: su prefijo sí, el de Messenger no');
  perform tests.ok((select count(*) from public.cc_wa_salida where conversation_id = c and estado = 'pendiente') = 3, '1 · tres salidas pendientes de WhatsApp');

  -- 2 · pausa: lo pendiente pasa a retenido en el mismo cambio; lo nuevo nace retenido; nada se reclama
  perform tests.act_as_owner(); update public.cc_wa_config set envio_pausado = true where id;
  perform tests.ok((select count(*) = 3 and bool_and(retenido_at is not null and resultado ->> 'retenido_por' = 'pausa') from public.cc_wa_salida where conversation_id = c and estado = 'retenido'), '2 · al pausar, los 3 pendientes quedan retenidos');
  perform tests.ok((select count(*) = 1 from public.cc_meta_salida where conversation_id = cig and estado = 'pendiente'), '2 · aislamiento: Instagram no se tocó');
  perform tests.act_as_service();
  perform public.cc_enviar_mensaje(c, 'system', null, null, 'sys:solicitud:905', 'otro aviso durante la pausa');
  perform tests.ok((select estado = 'retenido' from public.cc_wa_salida s join public.cc_messages m on m.id = s.message_id where m.client_message_id = 'sys:solicitud:905'), '2 · lo nuevo durante la pausa nace retenido');
  perform tests.eq((select count(*) from public.cc_wa_salida_reclamar(20)), 0::bigint, '2 · con pausa no se reclama nada');

  -- 3 · reanudar NO libera ni descarta
  perform tests.act_as_owner(); update public.cc_wa_config set envio_pausado = false where id;
  perform tests.ok((select count(*) = 4 from public.cc_wa_salida where conversation_id = c and estado = 'retenido') and not exists (select 1 from public.cc_wa_salida where conversation_id = c and estado = 'pendiente'), '3 · al reanudar, los 4 siguen retenidos');
  perform tests.act_as_service();
  perform tests.eq((select count(*) from public.cc_wa_salida_reclamar(20)), 0::bigint, '3 · y no se reclaman');

  -- 4 · decisiones de Dirección
  perform tests.act_as(s1);
  perform tests.throws(format('select public.cc_salida_decidir(%L, array[%L]::uuid[], %L, %L)', 'whatsapp', gen_random_uuid(), 'liberar', 'prueba vendedora'), 'NO_AUTORIZADO', '4 · solo Dirección decide');
  perform tests.throws($$select public.cc_salida_revision('whatsapp')$$, 'NO_AUTORIZADO', '4 · solo Dirección revisa');
  perform tests.act_as_owner();
  v_ids := array(select id from public.cc_wa_salida where conversation_id = c and estado = 'retenido' order by created_at);
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.cc_salida_decidir(%L, %L::uuid[], %L, %L)', 'whatsapp', v_ids, 'liberar', 'no'), 'MOTIVO_REQUERIDO', '4 · motivo obligatorio');
  perform tests.throws(format('select public.cc_salida_decidir(%L, %L::uuid[], %L, %L)', 'whatsapp', v_ids, 'reenviar', 'acción rara'), 'ACCION_INVALIDA', '4 · acción inválida');
  perform tests.throws(format('select public.cc_salida_decidir(%L, %L::uuid[], %L, %L)', 'whatsapp', '{}', 'liberar', 'vacío'), 'SELECCION_INVALIDA', '4 · selección vacía');
  perform tests.throws(format('select public.cc_salida_decidir(%L, %L::uuid[], %L, %L)', 'sms', v_ids, 'liberar', 'canal raro'), 'CANAL_INVALIDO', '4 · canal inválido');
  r := public.cc_salida_revision('whatsapp');
  perform tests.ok((r -> 'conteos' ->> 'retenido')::int = 4 and jsonb_array_length(r -> 'por_decidir') = 4 and (r -> 'por_decidir' -> 0 ->> 'contacto') = '…2001'
                   and not (r::text ~ '5216670002001'), '4 · revisión: 4 por decidir, contacto enmascarado');
  -- liberar 2 (dentro de ventana) y descartar 1; el resto queda
  r := public.cc_salida_decidir('whatsapp', v_ids[1:2], 'liberar', 'Revisado: liberar avisos vigentes');
  perform tests.act_as_owner();
  perform tests.ok((r ->> 'aplicados')::int = 2 and (select count(*) = 2 from public.cc_wa_salida where id = any (v_ids[1:2]) and estado = 'pendiente' and decidido_por = v_admin), '4 · liberar: 2 a pendiente, con responsable');
  perform tests.act_as(v_admin);
  r := public.cc_salida_decidir('whatsapp', array[v_ids[3]], 'descartar', 'Aviso obsoleto: no enviar');
  perform tests.act_as_owner();
  perform tests.ok((select estado = 'descartado' and decidido_at is not null and decision_motivo = 'Aviso obsoleto: no enviar' from public.cc_wa_salida where id = v_ids[3]), '4 · descartar: descartado con motivo');
  perform tests.eq((select count(*) from public.cc_salida_decisiones where salida_id = any (v_ids[1:3])), 3::bigint, '4 · auditoría: una fila por mensaje decidido');
  perform tests.ok((select count(distinct lote) = 2 from public.cc_salida_decisiones where salida_id = any (v_ids[1:3])), '4 · dos operaciones (lotes) distintas');
  v_id := (select id from public.cc_meta_salida where conversation_id = cig limit 1);
  perform tests.act_as(v_admin);
  r := public.cc_salida_decidir('whatsapp', array[v_ids[1], v_ids[3], v_ids[4], gen_random_uuid(), v_id], 'liberar', 'Lote mixto de prueba');
  perform tests.ok((r ->> 'aplicados')::int = 1 and (r ->> 'total')::int = 5
                   and (select bool_and(case x ->> 'id' when v_ids[1]::text then x ->> 'resultado' = 'estado_invalido' when v_ids[3]::text then x ->> 'resultado' = 'estado_invalido'
                                                       when v_ids[4]::text then x ->> 'resultado' = 'liberado' else x ->> 'resultado' in ('no_encontrado', 'otro_canal') end)
                        from jsonb_array_elements(r -> 'resultados') x)
                   and exists (select 1 from jsonb_array_elements(r -> 'resultados') x where x ->> 'resultado' = 'otro_canal'), '4 · lote mixto: resultados parciales explícitos (ya decidido, descartado, otro canal, no existe)');
  -- fuera de ventana: no se libera
  perform tests.act_as_owner(); update public.cc_wa_salida set estado = 'retenido', retenido_at = now(), decidido_at = null, decidido_por = null, decision_motivo = null where id = v_ids[4];
  update public.cc_wa_contactos set ultimo_entrante_at = now() - interval '25 hours' where wa_id = '5216670002001';
  perform tests.act_as(v_admin);
  r := public.cc_salida_decidir('whatsapp', array[v_ids[4]], 'liberar', 'Intento fuera de ventana');
  perform tests.act_as_owner();
  perform tests.ok((r -> 'resultados' -> 0 ->> 'resultado') = 'fuera_de_ventana' and (select estado = 'retenido' from public.cc_wa_salida where id = v_ids[4]), '4 · fuera de la ventana de 24 h: no se libera');
  update public.cc_wa_contactos set ultimo_entrante_at = now() where wa_id = '5216670002001';
  -- con pausa o en espejo no se libera
  update public.cc_wa_config set envio_pausado = true where id;
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.cc_salida_decidir(%L, array[%L]::uuid[], %L, %L)', 'whatsapp', v_ids[4], 'liberar', 'Liberar en pausa'), 'CANAL_NO_HABILITADO', '4 · con pausa no se libera');
  r := public.cc_salida_decidir('whatsapp', array[v_ids[4]], 'descartar', 'Descartar durante la pausa');
  perform tests.ok((r ->> 'aplicados')::int = 1, '4 · descartar sí se permite con pausa');
  perform tests.act_as_owner(); update public.cc_wa_config set envio_pausado = false, modo = 'espejo' where id;
  perform tests.act_as(v_admin);
  perform tests.throws(format('select public.cc_salida_decidir(%L, array[%L]::uuid[], %L, %L)', 'whatsapp', v_ids[2], 'liberar', 'Liberar en espejo'), 'CANAL_NO_HABILITADO', '4 · en espejo no se libera');

  -- 5 · espejo: lo pendiente pasa a retenido y nada se reclama
  perform tests.act_as_owner();
  perform tests.ok((select count(*) = 2 from public.cc_wa_salida where id = any (v_ids[1:2]) and estado = 'retenido' and resultado ->> 'retenido_por' = 'pausa'), '5 · lo liberado que aún no salía quedó retenido por la pausa (y sigue así en espejo)');
  alter table public.cc_wa_config disable trigger trg_cc_wa_config_guardia; update public.cc_wa_config set modo = 'activo' where id;
  perform tests.act_as_service();
  perform tests.eq((select count(*) from public.cc_wa_salida_reclamar(20)), 0::bigint, '5 · al volver a activo nada sale solo');
  perform public.cc_enviar_mensaje(c, 'system', null, null, 'sys:solicitud:930', 'pendiente antes de espejo');
  v_id := (select s.id from public.cc_wa_salida s join public.cc_messages m on m.id = s.message_id where m.client_message_id = 'sys:solicitud:930');
  perform tests.act_as_owner(); update public.cc_wa_config set modo = 'espejo' where id;
  perform tests.ok((select estado = 'retenido' and resultado ->> 'retenido_por' = 'canal_no_activo' from public.cc_wa_salida where id = v_id), '5 · pasar a espejo retiene lo pendiente (canal_no_activo)');
  alter table public.cc_wa_config disable trigger trg_cc_wa_config_guardia; update public.cc_wa_config set modo = 'activo' where id;

  -- 6 · resolución por clase (Edge nueva y heredada)
  perform tests.act_as_owner();
  update public.cc_wa_salida set estado = 'pendiente', retenido_at = null where id = any (v_ids[1:2]);
  perform tests.act_as_service();
  perform tests.eq((select count(*) from public.cc_wa_salida_reclamar(20)), 2::bigint, '6 · canal habilitado: se reclaman los 2 pendientes');
  perform tests.ok(public.cc_wa_salida_puede_enviar(v_ids[1]), '6 · verificación previa: puede enviar');
  perform public.cc_wa_salida_resolver(v_ids[1], false, null, 'incierto|sin respuesta de Meta (timeout)');
  perform public.cc_wa_salida_resolver(v_ids[2], false, null, 'sin respuesta de Meta (timeout)');   -- Edge anterior
  perform tests.ok((select count(*) = 2 and bool_and(incierto_at is not null and resultado ->> 'clase' = 'incierto') from public.cc_wa_salida where id = any (v_ids[1:2]) and estado = 'incierto'), '6 · timeout (nuevo y heredado) → incierto');
  perform tests.eq((select count(*) from public.cc_wa_salida_reclamar(20)), 0::bigint, '6 · un incierto nunca se re-reclama');
  -- definitivo / reintentable / retener / enviado, con mensajes nuevos
  for vg in select g from generate_series(1, 5) g loop perform public.cc_enviar_mensaje(c, 'system', null, null, 'sys:solicitud:91' || vg.g, 'aviso ' || vg.g); end loop;
  v_ids := array(select s.id from public.cc_wa_salida s join public.cc_messages m on m.id = s.message_id where m.client_message_id like 'sys:solicitud:91%' order by m.client_message_id);
  perform tests.eq((select count(*) from public.cc_wa_salida_reclamar(20)), 5::bigint, '6 · 5 reclamados');
  perform public.cc_wa_salida_resolver(v_ids[1], false, null, 'definitivo|Meta 400 (131047): Re-engagement message');
  perform public.cc_wa_salida_resolver(v_ids[2], false, null, 'Meta 400 (10): Application does not have permission');   -- Edge anterior
  perform public.cc_wa_salida_resolver(v_ids[3], false, null, 'reintentable|Meta 429: rate limit');
  perform public.cc_wa_salida_resolver(v_ids[4], false, null, 'retener|canal pausado o fuera de activo antes del envío');
  perform public.cc_wa_salida_resolver(v_ids[5], true, 'wamid.B22.OUT5', null);
  perform tests.ok((select estado = 'fallido' and error like 'Meta 400 (131047)%' from public.cc_wa_salida where id = v_ids[1])
               and (select estado = 'fallido' and resultado ->> 'clase' = 'definitivo' from public.cc_wa_salida where id = v_ids[2]), '6 · rechazo definitivo (nuevo y heredado) → fallido, sin reintento');
  perform tests.ok((select estado = 'pendiente' from public.cc_wa_salida where id = v_ids[3]), '6 · reintentable con el canal habilitado → pendiente');
  perform tests.ok((select estado = 'retenido' and retenido_at is not null from public.cc_wa_salida where id = v_ids[4]), '6 · retener → retenido');
  perform tests.ok((select estado = 'enviado' and wamid = 'wamid.B22.OUT5' and resultado ->> 'clase' = 'enviado' from public.cc_wa_salida where id = v_ids[5])
               and exists (select 1 from public.cc_wa_mensajes where wamid = 'wamid.B22.OUT5' and direccion = 'out'), '6 · aceptado → enviado + registro de salida');
  perform public.cc_wa_salida_resolver(v_ids[5], false, null, 'definitivo|tarde');
  perform tests.ok((select estado = 'enviado' from public.cc_wa_salida where id = v_ids[5]), '6 · una resolución tardía no altera un enviado');
  -- reintentable con el canal pausado → retenido (no queda pendiente para salir sola al reanudar)
  perform tests.eq((select count(*) from public.cc_wa_salida_reclamar(20)), 1::bigint, '6 · el reintentable se vuelve a reclamar');
  perform tests.act_as_owner(); update public.cc_wa_config set envio_pausado = true where id;
  perform tests.act_as_service();
  perform tests.ok(not public.cc_wa_salida_puede_enviar(v_ids[3]), '6 · con la pausa confirmada, la verificación previa dice que no');
  perform public.cc_wa_salida_resolver(v_ids[3], false, null, 'reintentable|Meta 429: rate limit');
  perform tests.ok((select estado = 'retenido' from public.cc_wa_salida where id = v_ids[3]), '6 · reintentable con pausa → retenido');
  perform tests.act_as_owner(); update public.cc_wa_config set envio_pausado = false where id;

  -- 7 · 'enviando' colgado > 5 min → incierto en el siguiente reclamo (nunca se re-reclama)
  perform tests.act_as_service();
  perform public.cc_enviar_mensaje(c, 'system', null, null, 'sys:solicitud:920', 'colgado');
  v_id := (select s.id from public.cc_wa_salida s join public.cc_messages m on m.id = s.message_id where m.client_message_id = 'sys:solicitud:920');
  perform tests.eq((select count(*) from public.cc_wa_salida_reclamar(20)), 1::bigint, '7 · reclamado');
  perform tests.act_as_owner(); update public.cc_wa_salida set reclamado_at = now() - interval '6 minutes' where id = v_id;
  perform tests.act_as_service();
  perform tests.ok(not public.cc_wa_salida_puede_enviar(v_id), '7 · reclamo vencido: la verificación previa dice que no');
  perform tests.eq((select count(*) from public.cc_wa_salida_reclamar(20)), 0::bigint, '7 · no se re-reclama');
  perform tests.ok((select estado = 'incierto' and resultado ->> 'detalle' like 'sin resolución%' from public.cc_wa_salida where id = v_id), '7 · queda incierto');
  -- un incierto no se libera; sí se descarta
  perform tests.act_as(v_admin);
  r := public.cc_salida_decidir('whatsapp', array[v_id], 'liberar', 'Intento de reenvío ciego');
  perform tests.ok((r -> 'resultados' -> 0 ->> 'resultado') = 'estado_invalido', '7 · un incierto NO se libera (sin reenvío a ciegas)');
  r := public.cc_salida_decidir('whatsapp', array[v_id], 'descartar', 'Verificado en el teléfono: no reenviar');
  perform tests.act_as_owner();
  perform tests.ok((select estado = 'descartado' from public.cc_wa_salida where id = v_id), '7 · un incierto sí se descarta');

  -- 8 · Meta: el reclamo solo toma canales habilitados; acceso directo cerrado
  perform tests.act_as_owner(); update public.cc_meta_config set envio_pausado = true where canal = 'instagram';
  perform tests.ok((select count(*) = 1 from public.cc_meta_salida where conversation_id = cig and estado = 'retenido'), '8 · pausa de Instagram retiene su pendiente');
  perform tests.act_as_service();
  perform tests.eq((select count(*) from public.cc_meta_salida_reclamar(20)), 0::bigint, '8 · Instagram en pausa: nada se reclama');
  perform tests.act_as(v_admin);
  perform tests.throws($$select count(*) from public.cc_salida_decisiones$$, 'permission denied', '8 · la auditoría no se lee directo');
  perform tests.throws($$select count(*) from public.cc_wa_salida$$, 'permission denied', '8 · la cola no se lee directo');
  perform tests.throws(format('select public.cc_wa_salida_puede_enviar(%L)', v_id), 'permission denied', '8 · la verificación previa es solo del servidor');
  -- estado inválido por CHECK: descartado sin decisión
  perform tests.act_as_owner();
  perform tests.ok(not public._cc_canal_activacion_lista(), '8 · compuerta de activación cerrada');
  perform tests.throws(format('update public.cc_wa_salida set estado = %L, decidido_at = null where id = %L', 'descartado', v_ids[1]), 'ck_wa_salida_descartado_decidido', '8 · CHECK: un descartado exige decisión');
end $t$;
rollback;
