-- R4-C6 · compuerta ABIERTA solo para WhatsApp: Dirección activa WhatsApp y enciende la IA; Instagram y Messenger siguen
-- bloqueados (RPC); activar no libera lo retenido ni reprocesa lo histórico; pausar, apagar IA y volver a espejo siguen
-- funcionando; el down se niega fuera de espejo y devuelve la compuerta cerrada exacta.
begin;
do $t$
declare v_admin uuid := tests.fixture_admin(); s1 uuid := tests.user('pos'); r jsonb; c uuid; c_hist uuid; n0 bigint; v_ret uuid;
begin
  -- 0 · estado inicial: compuerta abierta, los tres canales en espejo
  perform tests.act_as_owner();
  perform tests.ok(public._cc_canal_activacion_lista(), '0 · compuerta abierta');
  perform tests.ok((select modo = 'espejo' and not ia_habilitada and not envio_pausado from public.cc_wa_config)
               and (select bool_and(modo = 'espejo' and not ia_habilitada) from public.cc_meta_config), '0 · los tres canales en espejo, sin IA');
  perform tests.act_as(v_admin);
  perform tests.ok((public.cc_canal_estado() ->> 'activacion_disponible') = 'true', '0 · el estado reporta la activación disponible');

  -- 1 · histórico previo: un mensaje recibido en espejo y una salida retenida (no deben reprocesarse ni liberarse)
  perform tests.act_as_service();
  r := public.cc_wa_entrante('5216670006001', 'Histórico', 'wamid.C6.H1', 'mensaje viejo en espejo', false);
  c_hist := (r ->> 'conversation_id')::uuid;
  perform tests.ok((r ->> 'activo') = 'false', '1 · en espejo el ingreso no activa nada');
  perform tests.eq((select count(*) from public.cc_wa_salida where conversation_id = c_hist), 0::bigint, '1 · espejo: nada encolado');

  -- 2 · Instagram y Messenger siguen bloqueados con la compuerta abierta
  perform tests.act_as(v_admin);
  perform tests.throws($$select public.cc_canal_cambiar('instagram', '{"modo":"activo"}', 'Activar Instagram')$$, 'ACTIVACION_BLOQUEADA', '2 · activar Instagram: bloqueado');
  perform tests.throws($$select public.cc_canal_cambiar('messenger', '{"modo":"activo","ia_habilitada":true}', 'Activar Messenger con IA')$$, 'ACTIVACION_BLOQUEADA', '2 · activar Messenger con IA: bloqueado');
  perform tests.throws($$select public.cc_canal_cambiar('instagram', '{"ia_habilitada":true}', 'IA en Instagram')$$, 'IA_REQUIERE_ACTIVO', '2 · IA en Instagram (espejo): rechazada');
  perform tests.act_as(s1);
  perform tests.throws($$select public.cc_canal_cambiar('whatsapp', '{"modo":"activo"}', 'Vendedora activa')$$, 'NO_AUTORIZADO', '2 · solo Dirección activa WhatsApp');

  -- 3 · Dirección activa WhatsApp (IA apagada) y luego enciende la IA
  perform tests.act_as(v_admin);
  r := public.cc_canal_cambiar('whatsapp', '{"modo":"activo"}', 'R4-C6 · WhatsApp LIVE');
  perform tests.ok((r ->> 'cambiado')::boolean and (r -> 'despues' ->> 'modo') = 'activo' and (r -> 'despues' ->> 'ia_habilitada') = 'false', '3 · WhatsApp activo, IA apagada');
  r := public.cc_canal_cambiar('whatsapp', '{"ia_habilitada":true}', 'R4-C6 · IA encendida');
  perform tests.ok((r ->> 'cambiado')::boolean and (r -> 'despues' ->> 'ia_habilitada') = 'true' and (r -> 'despues' ->> 'envio_pausado') = 'false', '3 · IA encendida, envíos sin pausa');
  perform tests.throws($$select public.cc_canal_cambiar('instagram', '{"modo":"activo"}', 'Activar Instagram con WhatsApp activo')$$, 'ACTIVACION_BLOQUEADA', '3 · Instagram sigue bloqueado con WhatsApp activo');
  perform tests.act_as_owner();
  perform tests.ok((select bool_and(modo = 'espejo' and not ia_habilitada) from public.cc_meta_config), '3 · Instagram y Messenger siguen en espejo');
  perform tests.ok((select count(*) >= 2 from public.cc_canal_control_hist where canal = 'whatsapp' and origen = 'rpc' and motivo like 'R4-C6%'), '3 · los cambios quedan en el historial');

  -- 4 · lo histórico no se reprocesa: la conversación vieja no gana salidas ni turnos de IA por activar
  perform tests.eq((select count(*) from public.cc_wa_salida where conversation_id = c_hist), 0::bigint, '4 · activar no encola lo recibido en espejo');
  perform tests.eq((select count(*) from public.cc_ai_turns where conversation_id = c_hist), 0::bigint, '4 · activar no crea turnos de IA sobre lo histórico');

  -- 5 · un mensaje NUEVO entra activo (la Edge decide responder con la IA)
  perform tests.act_as_service();
  r := public.cc_wa_entrante('5216670006002', 'Nuevo', 'wamid.C6.N1', 'Hola, ¿qué productos tienen?', false);
  c := (r ->> 'conversation_id')::uuid;
  perform tests.ok((r ->> 'activo') = 'true' and (r ->> 'modo') = 'ai_active' and not (r ->> 'duplicado')::boolean, '5 · ingreso nuevo: activo y la conversación en ai_active (la Edge llama a la IA)');
  r := public.cc_wa_entrante('5216670006002', 'Nuevo', 'wamid.C6.N1', 'Hola, ¿qué productos tienen?', false);
  perform tests.ok((r ->> 'duplicado')::boolean, '5 · el mismo wamid se detecta como duplicado (no se responde dos veces)');

  -- 6 · pausa: lo nuevo nace retenido; reanudar no lo libera
  perform tests.act_as(v_admin);
  perform public.cc_canal_cambiar('whatsapp', '{"envio_pausado":true}', 'R4-C6 · pausa de prueba');
  perform tests.act_as_service();
  perform public.cc_enviar_mensaje(c, 'system', null, null, 'sys:solicitud:c6p1', 'Aviso durante la pausa');
  v_ret := (select s.id from public.cc_wa_salida s join public.cc_messages m on m.id = s.message_id where m.client_message_id = 'sys:solicitud:c6p1');
  perform tests.ok((select estado = 'retenido' from public.cc_wa_salida where id = v_ret), '6 · en pausa nace retenido');
  perform tests.act_as(v_admin);
  perform public.cc_canal_cambiar('whatsapp', '{"envio_pausado":false}', 'R4-C6 · reanudar');
  perform tests.act_as_owner();
  perform tests.ok((select estado = 'retenido' from public.cc_wa_salida where id = v_ret), '6 · reanudar no libera lo retenido');
  perform tests.act_as_service();
  perform tests.eq((select count(*) from public.cc_wa_salida_reclamar(20) x where x.id = v_ret), 0::bigint, '6 · lo retenido no se reclama');

  -- 7 · tras reanudar, un aviso nuevo sale normal (pendiente → reclamado → pasa el último chequeo)
  perform public.cc_enviar_mensaje(c, 'system', null, null, 'sys:solicitud:c6p2', 'Aviso tras reanudar');
  perform tests.ok((select s.estado = 'pendiente' from public.cc_wa_salida s join public.cc_messages m on m.id = s.message_id where m.client_message_id = 'sys:solicitud:c6p2'), '7 · nace pendiente');
  perform tests.eq((select count(*) from public.cc_wa_salida_reclamar(20)), 1::bigint, '7 · se reclama una sola vez');
  perform tests.ok(public.cc_wa_salida_puede_enviar((select s.id from public.cc_wa_salida s join public.cc_messages m on m.id = s.message_id where m.client_message_id = 'sys:solicitud:c6p2')), '7 · pasa el último chequeo antes del POST');

  -- 8 · apagar IA y volver a espejo (Dirección); lo pendiente se retiene al salir de activo
  perform public.cc_enviar_mensaje(c, 'system', null, null, 'sys:solicitud:c6p3', 'Aviso antes de volver a espejo');
  perform tests.act_as(v_admin);
  r := public.cc_canal_cambiar('whatsapp', '{"ia_habilitada":false}', 'R4-C6 · apagar IA');
  perform tests.ok((r -> 'despues' ->> 'ia_habilitada') = 'false' and (r -> 'despues' ->> 'modo') = 'activo', '8 · IA apagada, canal sigue activo');
  r := public.cc_canal_cambiar('whatsapp', '{"modo":"espejo"}', 'R4-C6 · volver a espejo');
  perform tests.ok((r -> 'despues' ->> 'modo') = 'espejo' and (r -> 'despues' ->> 'ia_habilitada') = 'false', '8 · de vuelta en espejo');
  perform tests.act_as_owner();
  perform tests.ok((select s.estado = 'retenido' from public.cc_wa_salida s join public.cc_messages m on m.id = s.message_id where m.client_message_id = 'sys:solicitud:c6p3'), '8 · lo pendiente quedó retenido');
  perform tests.act_as_service();
  perform tests.ok(not public.cc_wa_salida_puede_enviar((select s.id from public.cc_wa_salida s join public.cc_messages m on m.id = s.message_id where m.client_message_id = 'sys:solicitud:c6p2')), '8 · lo reclamado ya no pasa el último chequeo en espejo');

  -- 9 · la guardia permite 'activo' por UPDATE directo (compuerta abierta) y el CHECK sigue impidiendo IA en espejo
  perform tests.act_as_owner();
  update public.cc_wa_config set modo = 'activo' where id;
  perform tests.ok((select modo = 'activo' from public.cc_wa_config), '9 · UPDATE directo a activo: permitido con la compuerta abierta');
  update public.cc_wa_config set modo = 'espejo' where id;
  perform tests.ok((select modo = 'espejo' and not ia_habilitada from public.cc_wa_config), '9 · y de vuelta a espejo');
end $t$;

-- 10 · el down se niega con WhatsApp activo y, en espejo, cierra la compuerta exacta
update public.cc_wa_config set modo = 'activo' where id;
\set ON_ERROR_STOP 0
savepoint antes_down;
\ir ../../../rollback/whatsapp_compuerta_abierta/99_down.sql
rollback to savepoint antes_down;
\set ON_ERROR_STOP 1
do $t$ begin
  perform tests.ok(public._cc_canal_activacion_lista(), '10 · el down se niega con WhatsApp activo (la compuerta sigue abierta)');
end $t$;
update public.cc_wa_config set modo = 'espejo' where id;
\ir ../../../rollback/whatsapp_compuerta_abierta/99_down.sql
do $t$ declare v_admin uuid := tests.fixture_admin(); begin
  perform tests.ok(not public._cc_canal_activacion_lista(), '10 · down: compuerta cerrada');
  perform tests.act_as(v_admin);
  perform tests.throws($$select public.cc_canal_cambiar('whatsapp', '{"modo":"activo"}', 'Tras el down')$$, 'ACTIVACION_BLOQUEADA', '10 · down: activar WhatsApp vuelve a estar bloqueado');
  perform tests.act_as_owner();
  perform tests.throws($$update public.cc_wa_config set modo = 'activo' where id$$, 'ACTIVACION_BLOQUEADA', '10 · down: la guardia vuelve a bloquear el UPDATE directo');
end $t$;
\ir ../../../migrations/20270124120000_whatsapp_compuerta_abierta.sql
do $t$ begin
  perform tests.ok(public._cc_canal_activacion_lista(), '10 · se reaplica: compuerta abierta otra vez');
end $t$;
rollback;
