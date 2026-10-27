-- R4-B2-3a · IA primero en canales: con la IA encendida el mensaje NO pide asesor; apagada, cola humana con aviso sin
-- "asistente"; espejo sin atención; la IA apagada no reclama ni guarda (también si se apaga durante el turno); la falla de
-- la IA transfiere UNA vez (no si ya está transferida/atendida, ni con otro turno en curso, ni en espejo); independencia
-- por canal; el portal sin cambios; sin vincular por teléfono (R4-B1).
begin;
\ir ../../../rollback/whatsapp_compuerta_abierta/99_down.sql   -- R4-C6: contrato con la compuerta CERRADA (abierta: canal_06)
do $t$
declare v_admin uuid := tests.fixture_admin(); d uuid := tests.user('doctor'); r jsonb; t jsonb; c1 uuid; c2 uuid; c3 uuid; c4 uuid; c5 uuid; c6 uuid; c7 uuid; cp uuid; n bigint; v_turn uuid;
begin
  -- A · canal activo + IA encendida: el primer mensaje NO pide asesor y la IA trabaja
  perform tests.act_as_owner(); alter table public.cc_wa_config disable trigger trg_cc_wa_config_guardia; update public.cc_wa_config set modo = 'activo', ia_habilitada = true where id;
  perform tests.act_as_service();
  r := public.cc_wa_entrante('5216670001001', 'Cliente A', 'wamid.B23A.A1', 'Hola, ¿qué es el S2RM?', false);
  c1 := (r ->> 'conversation_id')::uuid;
  perform tests.ok((select modo = 'ai_active' and seller_profile_id is null and asesoria_solicitada_at is null from public.cc_conversations where id = c1), 'A · IA encendida: el mensaje no pide asesor (ai_active, sin asignar)');
  perform tests.ok(not exists (select 1 from public.cc_messages where conversation_id = c1 and actor_type = 'system'), 'A · sin aviso de transferencia');
  perform tests.ok(r ->> 'actor' = 'visitor' and r ->> 'profile_id' is null, 'A · R4-B1: sigue siendo visitante (sin vincular por teléfono)');
  t := public.cc_ia_turno_reclamar(c1, (r ->> 'seq')::bigint, 'anthropic', 'modelo-prueba');
  perform tests.eq(t ->> 'estado', 'reclamado', 'A · la IA reclama el turno');
  t := public.cc_ia_turno_responder((t ->> 'turn_id')::uuid, 'El S2RM es…', 'PRODUCT_INFO');
  perform tests.ok((t ->> 'persistido')::boolean, 'A · y su respuesta se guarda');

  -- B · canal activo + IA apagada: cola humana con aviso sin "asistente"; la IA no reclama
  perform tests.act_as_owner(); update public.cc_wa_config set ia_habilitada = false where id;
  perform tests.act_as_service();
  r := public.cc_wa_entrante('5216670001002', 'Cliente B', 'wamid.B23A.B1', 'Hola', false);
  c2 := (r ->> 'conversation_id')::uuid;
  perform tests.ok((select modo in ('human_requested', 'human_assigned') from public.cc_conversations where id = c2), 'B · IA apagada: se pide asesor');
  perform tests.ok((select count(*) = 1 and bool_and(content !~* 'asistente') and bool_and(client_message_id like 'sys:wa:%') from public.cc_messages where conversation_id = c2 and actor_type = 'system'), 'B · un aviso, sin prometer al asistente');
  t := public.cc_ia_turno_reclamar(c2, (r ->> 'seq')::bigint, 'anthropic', 'modelo-prueba');
  perform tests.ok(t ->> 'estado' = 'silenciado' and (select error_class = 'ia_apagada' from public.cc_ai_turns where id = (t ->> 'turn_id')::uuid), 'B · la IA apagada no reclama (ia_apagada)');
  r := public.cc_wa_entrante('5216670001002', null, 'wamid.B23A.B2', '¿Me atienden?', false);
  perform tests.eq((select count(*) from public.cc_messages where conversation_id = c2 and actor_type = 'system'), 1::bigint, 'B · segundo mensaje: solicitud existente, sin duplicar aviso');

  -- C · espejo: sin atención (no se pide asesor) y la IA no trabaja
  perform tests.act_as_owner(); update public.cc_wa_config set modo = 'espejo' where id;
  perform tests.act_as_service();
  r := public.cc_wa_entrante('5216670001003', 'Cliente C', 'wamid.B23A.C1', 'Hola', false);
  c3 := (r ->> 'conversation_id')::uuid;
  perform tests.ok((select modo = 'ai_active' and asesoria_solicitada_at is null from public.cc_conversations where id = c3), 'C · espejo: no se pide asesor');
  t := public.cc_ia_turno_reclamar(c3, (r ->> 'seq')::bigint, 'anthropic', 'modelo-prueba');
  perform tests.eq(t ->> 'estado', 'silenciado', 'C · espejo: la IA no reclama');
  t := public.cc_ia_aviso_no_disponible(c3);
  perform tests.ok(not (t ->> 'transferido')::boolean and t ->> 'motivo' = 'canal_no_activo', 'C · espejo: una falla no transfiere');

  -- D · falla definitiva de la IA (activo + IA encendida): UNA transferencia, auditable
  perform tests.act_as_owner(); alter table public.cc_wa_config disable trigger trg_cc_wa_config_guardia; update public.cc_wa_config set modo = 'activo', ia_habilitada = true where id;
  perform tests.act_as_service();
  r := public.cc_wa_entrante('5216670001004', 'Cliente D', 'wamid.B23A.D1', 'Hola', false);
  c4 := (r ->> 'conversation_id')::uuid;
  t := public.cc_ia_turno_reclamar(c4, (r ->> 'seq')::bigint, 'anthropic', 'modelo-prueba');
  perform public.cc_ia_turno_fallar((t ->> 'turn_id')::uuid, 'provider_5xx', false);
  t := public.cc_ia_aviso_no_disponible(c4);
  perform tests.ok((t ->> 'transferido')::boolean and (select modo in ('human_requested', 'human_assigned') from public.cc_conversations where id = c4), 'D · la falla transfiere a un asesor');
  perform tests.ok((select count(*) = 1 and bool_and(content like 'No pudimos responder tu mensaje automáticamente.%' and content !~* 'asistente') from public.cc_messages where conversation_id = c4 and client_message_id like 'sys:falla_ia:%'), 'D · un aviso de falla, sin prometer al asistente');
  perform tests.ok(exists (select 1 from public.cc_conversation_events where conversation_id = c4 and tipo = 'human_requested' and detalle ->> 'motivo' = 'falla_ia'), 'D · auditado: evento human_requested con motivo falla_ia');
  perform tests.ok(not exists (select 1 from public.cc_messages where conversation_id = c4 and client_message_id = 'sys:ia_no_disponible'), 'D · en canal ya no se ofrece "puedo pedirte un asesor"');
  t := public.cc_ia_aviso_no_disponible(c4);
  perform tests.ok(not (t ->> 'transferido')::boolean and (select count(*) = 1 from public.cc_messages where conversation_id = c4 and client_message_id like 'sys:falla_ia:%'), 'D · segunda falla: sin segunda transferencia ni aviso');
  -- E · falla sin turno (p. ej. sin llave del proveedor): misma transferencia única
  r := public.cc_wa_entrante('5216670001005', 'Cliente E', 'wamid.B23A.E1', 'Hola', false);
  c5 := (r ->> 'conversation_id')::uuid;
  t := public.cc_ia_aviso_no_disponible(c5);
  perform tests.ok((t ->> 'transferido')::boolean, 'E · falla sin turno (sin llave): transfiere');
  -- F · otro turno en curso: no se transfiere (la respuesta vendrá de ese turno)
  r := public.cc_wa_entrante('5216670001006', 'Cliente F', 'wamid.B23A.F1', 'Hola', false);
  c6 := (r ->> 'conversation_id')::uuid;
  t := public.cc_ia_turno_reclamar(c6, (r ->> 'seq')::bigint, 'anthropic', 'modelo-prueba');
  perform tests.eq(t ->> 'estado', 'reclamado', 'F · turno en curso');
  t := public.cc_ia_aviso_no_disponible(c6);
  perform tests.ok(not (t ->> 'transferido')::boolean and t ->> 'motivo' = 'otro_turno_en_curso', 'F · con otro turno en curso no transfiere');
  -- I · Dirección apaga la IA DURANTE el turno: la respuesta no se guarda
  perform tests.act_as_owner(); update public.cc_wa_config set ia_habilitada = false where id;
  perform tests.act_as_service();
  r := public.cc_ia_turno_responder((select id from public.cc_ai_turns where conversation_id = c6 order by created_at desc limit 1), 'respuesta tardía', 'GENERAL_CHAT');
  perform tests.ok(not (r ->> 'persistido')::boolean and r ->> 'motivo' = 'ia_apagada', 'I · IA apagada durante el turno: la respuesta se descarta (ia_apagada)');
  perform tests.ok(not exists (select 1 from public.cc_messages where conversation_id = c6 and actor_type = 'ai'), 'I · ningún mensaje de IA guardado');
  -- H · con envíos pausados la falla igual transfiere (el aviso lo retendrá la cola desde B2-2)
  perform tests.act_as_owner(); update public.cc_wa_config set ia_habilitada = true, envio_pausado = true where id;
  perform tests.act_as_service();
  r := public.cc_wa_entrante('5216670001007', 'Cliente H', 'wamid.B23A.H1', 'Hola', false);
  c7 := (r ->> 'conversation_id')::uuid;
  t := public.cc_ia_aviso_no_disponible(c7);
  perform tests.ok((t ->> 'transferido')::boolean, 'H · envíos pausados: la falla transfiere (el envío lo decide la pausa)');

  -- J · atención humana activa: la IA no responde y la falla no reasigna
  perform tests.act_as_owner(); update public.cc_wa_config set envio_pausado = false where id; update public.cc_conversations set modo = 'human_active' where id = c1;
  perform tests.act_as_service();
  r := public.cc_wa_entrante('5216670001001', null, 'wamid.B23A.A2', 'otra pregunta', false);
  t := public.cc_ia_turno_reclamar(c1, (r ->> 'seq')::bigint, 'anthropic', 'modelo-prueba');
  perform tests.eq(t ->> 'estado', 'silenciado', 'J · human_active: la IA no reclama');
  t := public.cc_ia_aviso_no_disponible(c1);
  perform tests.ok(not (t ->> 'transferido')::boolean and (select modo = 'human_active' from public.cc_conversations where id = c1), 'J · human_active: la falla no toca la atención humana');

  -- L · independencia por canal: Instagram con IA (no pide asesor), Messenger sin IA (cola humana)
  perform tests.act_as_owner();
  update public.cc_meta_config set modo = 'activo', ia_habilitada = true where canal = 'instagram';
  update public.cc_meta_config set modo = 'activo', ia_habilitada = false where canal = 'messenger';
  perform tests.act_as_service();
  r := public.cc_meta_entrante('instagram', '17841400000999001', null, 'mid.B23A.IG1', 'hola por instagram', false);
  perform tests.ok((select modo = 'ai_active' and asesoria_solicitada_at is null from public.cc_conversations where id = (r ->> 'conversation_id')::uuid), 'L · Instagram con IA: no pide asesor');
  r := public.cc_meta_entrante('messenger', '27841400000999002', null, 'mid.B23A.FB1', 'hola por messenger', false);
  perform tests.ok((select modo in ('human_requested', 'human_assigned') from public.cc_conversations where id = (r ->> 'conversation_id')::uuid)
    and exists (select 1 from public.cc_messages where conversation_id = (r ->> 'conversation_id')::uuid and client_message_id like 'sys:messenger:%' and content !~* 'asistente'), 'L · Messenger sin IA: cola humana con aviso sin asistente');
  perform tests.ok((select modo = 'activo' and ia_habilitada from public.cc_wa_config), 'L · WhatsApp no cambió');

  -- M · portal: sin control de canal (la IA trabaja aunque los canales estén apagados) y su aviso no cambia
  perform tests.act_as_owner();
  update public.cc_wa_config set modo = 'espejo' where id; update public.cc_meta_config set modo = 'espejo' where canal in ('instagram', 'messenger');
  perform tests.act_as_service();
  cp := (public.cc_abrir_conversacion(null, d) ->> 'conversation_id')::uuid;
  r := public.cc_enviar_mensaje(cp, 'doctor', null, d, 'b23a-portal-1', 'Hola desde el portal');
  t := public.cc_ia_turno_reclamar(cp, (r ->> 'seq')::bigint, 'anthropic', 'modelo-prueba');
  perform tests.eq(t ->> 'estado', 'reclamado', 'M · portal: la IA trabaja con los canales en espejo');
  perform public.cc_ia_turno_fallar((t ->> 'turn_id')::uuid, 'provider_5xx', false);
  perform public.cc_ia_aviso_no_disponible(cp);
  perform tests.ok(exists (select 1 from public.cc_messages where conversation_id = cp and client_message_id = 'sys:ia_no_disponible')
    and (select modo = 'ai_active' from public.cc_conversations where id = cp), 'M · portal: mismo aviso de siempre y sin transferencia automática');

  -- N · ayudantes no expuestos; compuerta de R4-B2-1 sigue cerrada
  perform tests.ok(not public._cc_canal_activacion_lista(), 'N · compuerta de activación cerrada');
  perform tests.act_as(v_admin);
  perform tests.throws($$select public._cc_canal_transferir(gen_random_uuid(), 'whatsapp', 'wa', 'x', true)$$, 'permission denied', 'N · nadie llama la transferencia directo');
  perform tests.throws($$select public.cc_ia_aviso_no_disponible(gen_random_uuid())$$, 'permission denied', 'N · ni el aviso de falla');
end $t$;
rollback;
