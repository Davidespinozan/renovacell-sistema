-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- R4-B2-3a · IA PRIMERO en canales (WhatsApp, Instagram, Messenger) y respaldo humano
--   1. Enrutamiento: con el canal activo y la IA ENCENDIDA (cc_*_config.ia_habilitada), un mensaje entrante ya NO pide
--      asesor: atiende la IA (la transferencia la decide ella con solicitar_asesor). Con la IA APAGADA se conserva la cola
--      humana de siempre (respiro de 12 h), con un aviso que no promete al asistente. Espejo: sin cambios (no se llama).
--   2. IA apagada: cc_ia_turno_reclamar y cc_ia_turno_responder exigen la IA del canal encendida (bloqueo compartido de
--      la configuración: un apagado concurrente o gana antes o el turno ya quedó guardado; nunca a medias). La IA del
--      portal no tiene control aquí (sin canal ⇒ permitida, como hoy).
--   3. Falla de la IA (sin llave, error o timeout del proveedor): cc_ia_aviso_no_disponible —punto único de ambos
--      caminos— en una conversación de canal ACTIVO transfiere a un asesor UNA vez (bajo el bloqueo de la conversación;
--      si ya está transferida/atendida, o hay otro turno de IA en curso, no hace nada). El portal conserva su aviso.
--   No toca funciones del trabajo CV ni abre la compuerta _cc_canal_activacion_lista() de R4-B2-1.
--   Rollback: supabase/rollback/ia_primero_enrutamiento/99_down.sql
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.cc_canal_control_hist') is null or to_regprocedure('public._cc_canal_activacion_lista()') is null then raise exception 'R4-B2-3a: falta R4-B2-1 (controles por canal)'; end if;
  if to_regprocedure('public._cc_ia_permitida_en(uuid,boolean)') is not null then raise exception 'R4-B2-3a: ya aplicada'; end if;
  if md5(pg_get_functiondef('public._cc_wa_a_cola(uuid)'::regprocedure)) <> '1b4ae20c689e0e217f033ecffc4da68c'
     or md5(pg_get_functiondef('public._cc_canal_a_cola(uuid,text)'::regprocedure)) <> 'ddf7851a5128b3f0f7cdf063c8f5b128'
     or md5(pg_get_functiondef('public.cc_ia_turno_reclamar(uuid,bigint,text,text,integer)'::regprocedure)) <> '4a3ddb5cffe2045f544d719fb957b483'
     or md5(pg_get_functiondef('public.cc_ia_turno_responder(uuid,text,text,text[],integer,integer,integer)'::regprocedure)) <> 'e472ac30973392da999f9b7f2477bd27'
     or md5(pg_get_functiondef('public.cc_ia_aviso_no_disponible(uuid)'::regprocedure)) <> 'dcab51ccb18f83b104317320aba50d20' then
    raise exception 'R4-B2-3a: alguna función a modificar no tiene la definición esperada (producción 26 oct 2026)';
  end if;
end $pre$;

-- ── Ayudantes ────────────────────────────────────────────────────────────────────────────────────────
-- Canal de una conversación ('whatsapp' | 'instagram' | 'messenger'), o null si es del portal.
create function public._cc_canal_de(p_conv uuid) returns text
  language sql stable security definer set search_path = public as
$$ select coalesce(case when (public._cc_wa_contacto_de(p_conv)).wa_id is not null then 'whatsapp' end, (public._cc_meta_contacto_de(p_conv)).canal) $$;

-- ¿La IA atiende en este canal? (control de Dirección: canal activo y IA encendida).
create function public._cc_canal_ia_atiende(p_canal text) returns boolean
  language sql stable security definer set search_path = public as
$$ select coalesce(case when p_canal = 'whatsapp' then (select modo = 'activo' and ia_habilitada from public.cc_wa_config where id)
                        when p_canal in ('instagram', 'messenger') then (select modo = 'activo' and ia_habilitada from public.cc_meta_config where canal = p_canal) end, false) $$;

-- ¿Puede la IA trabajar en esta conversación? Portal: sí (sin control de canal aquí). Canal: solo si su IA está encendida.
-- p_bloquear: toma un bloqueo COMPARTIDO de la configuración del canal (serializa contra cc_canal_cambiar, FOR UPDATE).
create function public._cc_ia_permitida_en(p_conv uuid, p_bloquear boolean default false) returns boolean
  language plpgsql security definer set search_path = public as
$$
declare v_canal text := public._cc_canal_de(p_conv);
begin
  if v_canal is null then return true; end if;
  if p_bloquear then
    if v_canal = 'whatsapp' then perform 1 from public.cc_wa_config where id for share;
    else perform 1 from public.cc_meta_config where canal = v_canal for share; end if;
  end if;
  return public._cc_canal_ia_atiende(v_canal);
end;
$$;

-- Aviso al cliente cuando lo atenderá una PERSONA (IA apagada o falla de la IA): no menciona al asistente ni promete tiempos.
create function public._cc_texto_atencion_humana(p_configurado boolean, p_en_horario boolean, p_motivo text) returns text
  language sql immutable set search_path = public as
$$
  select case when p_motivo = 'falla_ia' then 'No pudimos responder tu mensaje automáticamente. ' else '' end ||
         case when not coalesce(p_configurado, false) then 'Registramos tu mensaje para que un asesor de Renovacell te atienda.'
              when p_en_horario then 'Un asesor de Renovacell revisará tu mensaje.'
              else 'Nuestro equipo de asesores no está disponible en este momento. Tu mensaje quedó registrado para atenderlo cuando vuelva a estar disponible.' end
$$;

-- Núcleo de la transferencia de canal (antes duplicado en _cc_wa_a_cola y _cc_canal_a_cola). Bajo el bloqueo de la
-- conversación: solo desde ai_active / human_offered (si ya pidió, está asignada o atendida, no hace nada → sin duplicados).
-- p_respiro: el enrutamiento por mensaje respeta 12 h desde la última solicitud (como siempre); la falla de la IA no.
create function public._cc_canal_transferir(p_conv uuid, p_origen text, p_prefijo text, p_motivo text, p_respiro boolean) returns boolean
  language plpgsql security definer set search_path = public as
$$
declare c record; hor jsonb; v_conf boolean; v_en boolean; ru jsonb;
begin
  select * into c from public.cc_conversations where id = p_conv for update;
  if not found or c.estado <> 'abierta' or c.modo not in ('ai_active', 'human_offered')
     or (p_respiro and c.asesoria_solicitada_at is not null and c.asesoria_solicitada_at > now() - interval '12 hours') then return false; end if;
  hor := public._cc_horario_estado(now()); v_conf := (hor ->> 'configurado')::boolean; v_en := v_conf and coalesce((hor ->> 'abierto')::boolean, false);
  perform public._cc_sistema(p_conv, public._cc_texto_atencion_humana(v_conf, v_en, p_motivo), 'sys:' || p_prefijo || ':' || c.ultimo_seq);
  perform public._cc_cambiar_modo(p_conv, 'human_requested', 'human_requested', case when c.profile_id is null then 'visitor' else 'doctor' end,
          c.profile_id, c.visitor_id, jsonb_build_object('origen', p_origen, 'motivo', p_motivo, 'fuera_horario', not v_en, 'horario_configurado', v_conf));
  update public.cc_conversations set handoff_origen = 'manual', handoff_cart_id = null, handoff_fuera_horario = not v_en where id = p_conv;
  ru := public._cc_rutear(p_conv);
  if not (ru ->> 'asignado')::boolean then
    perform public._cc_evento(p_conv, 'human_handoff_queued', 'system', null, null, jsonb_build_object('motivo', ru ->> 'motivo', 'fuera_horario', not v_en, 'origen', p_origen, 'causa', p_motivo));
  end if;
  return true;
end;
$$;

-- ── 1. Enrutamiento IA primero ──────────────────────────────────────────────────────────────────────
create or replace function public._cc_wa_a_cola(p_conv uuid) returns void
  language plpgsql security definer set search_path = public as
$$
begin
  if public._cc_canal_ia_atiende('whatsapp') then return; end if;   -- IA primero: el mensaje no pide asesor; atiende la IA
  perform public._cc_canal_transferir(p_conv, 'whatsapp', 'wa', 'ia_apagada', true);
end;
$$;

create or replace function public._cc_canal_a_cola(p_conv uuid, p_origen text) returns void
  language plpgsql security definer set search_path = public as
$$
begin
  if p_origen in ('instagram', 'messenger') and public._cc_canal_ia_atiende(p_origen) then return; end if;
  perform public._cc_canal_transferir(p_conv, p_origen, p_origen, 'ia_apagada', true);
end;
$$;

-- ── 3. Falla de la IA ───────────────────────────────────────────────────────────────────────────────
create or replace function public.cc_ia_aviso_no_disponible(p_conv uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_canal text; v_t boolean;
begin
  perform public._cc_solo_servicio();
  v_canal := public._cc_canal_de(p_conv);
  if v_canal is null then   -- portal: sin cambios
    return public.cc_enviar_mensaje(p_conv, 'system', null, null, 'sys:ia_no_disponible', 'No pude consultar al asistente en este momento. Si quieres, puedo pedirte un asesor de Renovacell.');
  end if;
  -- canal: transferencia automática (sin ofrecerla). Mismo bloqueo que reclamar/responder: decide sobre el estado vigente.
  perform 1 from public.cc_conversations where id = p_conv for update;
  if not found then return jsonb_build_object('transferido', false, 'motivo', 'sin_conversacion'); end if;
  if v_canal = 'whatsapp' and (select modo from public.cc_wa_config where id) <> 'activo'
     or v_canal <> 'whatsapp' and coalesce((select modo from public.cc_meta_config where canal = v_canal), 'espejo') <> 'activo' then
    return jsonb_build_object('transferido', false, 'motivo', 'canal_no_activo');
  end if;
  if exists (select 1 from public.cc_ai_turns where conversation_id = p_conv and status = 'provider_running' and lease_until > now()) then
    return jsonb_build_object('transferido', false, 'motivo', 'otro_turno_en_curso');   -- la respuesta vendrá de ese turno
  end if;
  v_t := public._cc_canal_transferir(p_conv, v_canal, 'falla_ia', 'falla_ia', false);
  return jsonb_build_object('transferido', v_t, 'motivo', case when v_t then 'falla_ia' else 'ya_transferida_o_atendida' end);
end;
$$;

-- ── 2. IA apagada en reclamo y persistencia (texto vigente de chatv2c1 con los cambios marcados R4-B2-3a) ──
CREATE OR REPLACE FUNCTION public.cc_ia_turno_reclamar(p_conv uuid, p_trigger_seq bigint, p_provider text, p_model text, p_lease_segs integer DEFAULT 90)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c record; t public.cc_ai_turns%rowtype; v_msg uuid; v_sesion_ok boolean; v_ia_ok boolean; v_lease interval := make_interval(secs => least(greatest(coalesce(p_lease_segs, 90), 10), 600)); v_prev record;
begin
  perform public._cc_solo_servicio();
  select * into c from public.cc_conversations where id = p_conv for update;
  if not found then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select id into v_msg from public.cc_messages where conversation_id = p_conv and seq = p_trigger_seq;
  if v_msg is null then raise exception 'DISPARADOR_INEXISTENTE' using errcode = 'check_violation'; end if;

  select * into t from public.cc_ai_turns where conversation_id = p_conv and trigger_seq = p_trigger_seq for update;
  if found then
    if t.status in ('completed', 'discarded') then
      return jsonb_build_object('estado', case when t.status = 'completed' then 'ya_completado' else 'silenciado' end, 'turn_id', t.id, 'operation_id', t.operation_id, 'result_message_id', t.result_message_id);
    end if;
    if t.status = 'provider_running' and t.lease_until > now() then
      return jsonb_build_object('estado', 'en_curso', 'turn_id', t.id, 'operation_id', t.operation_id, 'lease_until', t.lease_until);
    end if;
    -- failed / unknown / arrendamiento vencido → se re-reclama (mismo operation_id → mismo mensaje)
  end if;

  -- Chat V2-C1 · el disparador debe pertenecer a la SESIÓN ABIERTA: un turno de una sesión ya cerrada nunca
  -- responde (ni abre una sesión nueva con una respuesta vieja).
  v_sesion_ok := public._cc_sesion_contiene(p_conv, p_trigger_seq);
  -- R4-B2-3a · la IA del canal debe estar encendida (control de Dirección); el portal no tiene control propio aquí.
  v_ia_ok := public._cc_ia_permitida_en(p_conv, true);
  if c.estado <> 'abierta' or not public._cc_ia_puede(c.modo) or not v_sesion_ok or not v_ia_ok then
    if t.id is null then
      insert into public.cc_ai_turns (conversation_id, trigger_message_id, trigger_seq, operation_id, status, provider, model, error_class, finished_at)
      values (p_conv, v_msg, p_trigger_seq, 'ai:' || p_trigger_seq, 'discarded', p_provider, p_model, case when c.estado <> 'abierta' then 'conversacion_cerrada' when not v_sesion_ok then 'sesion_cambiada' when not v_ia_ok then 'ia_apagada' else 'ia_silenciada' end, now()) returning * into t;
    else
      update public.cc_ai_turns set status = 'discarded', error_class = case when c.estado <> 'abierta' then 'conversacion_cerrada' when not v_sesion_ok then 'sesion_cambiada' when not v_ia_ok then 'ia_apagada' else 'ia_silenciada' end, finished_at = now(), lease_until = null where id = t.id returning * into t;
    end if;
    return jsonb_build_object('estado', 'silenciado', 'turn_id', t.id, 'operation_id', t.operation_id, 'modo', c.modo);
  end if;

  -- Orden por conversación: si ya hay un turno MÁS NUEVO reclamado o completado, este queda superado.
  select id, trigger_seq into v_prev from public.cc_ai_turns where conversation_id = p_conv and trigger_seq > p_trigger_seq and status in ('provider_running', 'completed') order by trigger_seq desc limit 1;
  if v_prev.id is not null then
    if t.id is null then
      insert into public.cc_ai_turns (conversation_id, trigger_message_id, trigger_seq, operation_id, status, provider, model, error_class, finished_at)
      values (p_conv, v_msg, p_trigger_seq, 'ai:' || p_trigger_seq, 'discarded', p_provider, p_model, 'superado', now()) returning * into t;
    else
      update public.cc_ai_turns set status = 'discarded', error_class = 'superado', finished_at = now(), lease_until = null where id = t.id returning * into t;
    end if;
    return jsonb_build_object('estado', 'superado', 'turn_id', t.id, 'operation_id', t.operation_id, 'superado_por_seq', v_prev.trigger_seq);
  end if;

  if t.id is null then
    insert into public.cc_ai_turns (conversation_id, trigger_message_id, trigger_seq, operation_id, status, provider, model, lease_until)
    values (p_conv, v_msg, p_trigger_seq, 'ai:' || p_trigger_seq, 'provider_running', p_provider, p_model, now() + v_lease) returning * into t;
  else
    update public.cc_ai_turns set status = 'provider_running', attempts = attempts + 1, lease_until = now() + v_lease, started_at = now(), finished_at = null, error_class = null, provider = p_provider, model = p_model
     where id = t.id returning * into t;
  end if;
  return jsonb_build_object('estado', 'reclamado', 'turn_id', t.id, 'operation_id', t.operation_id, 'attempts', t.attempts, 'modo', c.modo);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_ia_turno_responder(p_turn uuid, p_content text, p_intent text DEFAULT NULL::text, p_evidencia text[] DEFAULT '{}'::text[], p_tool_rounds integer DEFAULT NULL::integer, p_input_tokens integer DEFAULT NULL::integer, p_output_tokens integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t public.cc_ai_turns%rowtype; c record; r jsonb; v_motivo text;
begin
  perform public._cc_solo_servicio();
  select * into t from public.cc_ai_turns where id = p_turn for update;
  if not found then raise exception 'TURNO_INEXISTENTE' using errcode = 'check_violation'; end if;
  if t.status = 'completed' then return jsonb_build_object('persistido', true, 'idempotente', true, 'message_id', t.result_message_id); end if;
  if t.status = 'discarded' then return jsonb_build_object('persistido', false, 'motivo', t.error_class, 'idempotente', true); end if;
  select * into c from public.cc_conversations where id = t.conversation_id for update;
  v_motivo := case when c.estado <> 'abierta' then 'conversacion_cerrada'
                   when not public._cc_ia_puede(c.modo) then 'takeover_humano'
                   when not public._cc_ia_permitida_en(t.conversation_id, true) then 'ia_apagada'   -- R4-B2-3a · Dirección la apagó durante el turno
                   when not public._cc_sesion_contiene(t.conversation_id, t.trigger_seq) then 'sesion_cambiada'   -- Chat V2-C1 · respuesta tardía de otra sesión
                   when exists (select 1 from public.cc_ai_turns n where n.conversation_id = t.conversation_id and n.trigger_seq > t.trigger_seq and n.status in ('provider_running', 'completed')) then 'superado'
                   end;
  if v_motivo is not null then
    update public.cc_ai_turns set status = 'discarded', error_class = v_motivo, finished_at = now(), lease_until = null,
           intent = coalesce(p_intent, intent), evidencia = coalesce(p_evidencia, evidencia), tool_rounds = coalesce(p_tool_rounds, tool_rounds), input_tokens = p_input_tokens, output_tokens = p_output_tokens
     where id = p_turn;
    return jsonb_build_object('persistido', false, 'motivo', v_motivo, 'modo', c.modo);
  end if;
  r := public.cc_enviar_mensaje(t.conversation_id, 'ai', null, null, t.operation_id, left(p_content, 4000));
  update public.cc_ai_turns set status = 'completed', result_message_id = (r ->> 'id')::uuid, finished_at = now(), lease_until = null,
         intent = coalesce(p_intent, intent), evidencia = coalesce(p_evidencia, evidencia), tool_rounds = coalesce(p_tool_rounds, tool_rounds), input_tokens = p_input_tokens, output_tokens = p_output_tokens
   where id = p_turn;
  return jsonb_build_object('persistido', true, 'idempotente', (r ->> 'idempotente')::boolean, 'message_id', r ->> 'id', 'seq', (r ->> 'seq')::bigint);
end;
$function$;

alter function public._cc_canal_de(uuid) owner to postgres;
alter function public._cc_canal_ia_atiende(text) owner to postgres;
alter function public._cc_ia_permitida_en(uuid, boolean) owner to postgres;
alter function public._cc_texto_atencion_humana(boolean, boolean, text) owner to postgres;
alter function public._cc_canal_transferir(uuid, text, text, text, boolean) owner to postgres;
revoke all on function public._cc_canal_de(uuid), public._cc_canal_ia_atiende(text), public._cc_ia_permitida_en(uuid, boolean),
  public._cc_texto_atencion_humana(boolean, boolean, text), public._cc_canal_transferir(uuid, text, text, text, boolean) from public, anon, authenticated;

do $post$ begin
  if public._cc_canal_activacion_lista() then raise exception 'R4-B2-3a: la compuerta de activación debe seguir cerrada'; end if;
  if position('_cc_ia_permitida_en' in pg_get_functiondef('public.cc_ia_turno_reclamar(uuid,bigint,text,text,integer)'::regprocedure)) = 0
     or position('_cc_ia_permitida_en' in pg_get_functiondef('public.cc_ia_turno_responder(uuid,text,text,text[],integer,integer,integer)'::regprocedure)) = 0 then
    raise exception 'R4-B2-3a: reclamar/responder sin el control de IA';
  end if;
  if has_function_privilege('authenticated', 'public._cc_canal_transferir(uuid,text,text,text,boolean)', 'execute')
     or has_function_privilege('authenticated', 'public._cc_ia_permitida_en(uuid,boolean)', 'execute')
     or has_function_privilege('authenticated', 'public.cc_ia_aviso_no_disponible(uuid)', 'execute') then raise exception 'R4-B2-3a: permisos de más'; end if;
  if public._cc_texto_atencion_humana(true, true, 'ia_apagada') ~* 'asistente' or public._cc_texto_atencion_humana(true, false, 'falla_ia') ~* 'asistente' then
    raise exception 'R4-B2-3a: el aviso de atención humana no debe mencionar al asistente';
  end if;
end $post$;
