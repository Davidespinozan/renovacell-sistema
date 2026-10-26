-- R4-B2-3a · ROLLBACK: vuelven EXACTAMENTE las definiciones de producción del 26 oct 2026 (enrutamiento humano por cada
-- mensaje en activo, sin control de IA por canal, aviso de no disponible en canales) y se retiran los ayudantes.
-- Ejecutar en UNA transacción: psql -1 -v ON_ERROR_STOP=1 -f 99_down.sql
CREATE OR REPLACE FUNCTION public._cc_canal_a_cola(p_conv uuid, p_origen text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c record; hor jsonb; v_conf boolean; v_en boolean; ru jsonb;
begin
  select * into c from public.cc_conversations where id = p_conv for update;
  if c.estado <> 'abierta' or c.modo not in ('ai_active', 'human_offered')
     or (c.asesoria_solicitada_at is not null and c.asesoria_solicitada_at > now() - interval '12 hours') then return; end if;
  hor := public._cc_horario_estado(now()); v_conf := (hor ->> 'configurado')::boolean; v_en := v_conf and coalesce((hor ->> 'abierto')::boolean, false);
  perform public._cc_sistema(p_conv, public._cc_texto_handoff(v_conf, v_en), 'sys:' || p_origen || ':' || c.ultimo_seq);
  perform public._cc_cambiar_modo(p_conv, 'human_requested', 'human_requested', case when c.profile_id is null then 'visitor' else 'doctor' end,
          c.profile_id, c.visitor_id, jsonb_build_object('origen', p_origen, 'fuera_horario', not v_en, 'horario_configurado', v_conf));
  update public.cc_conversations set handoff_origen = 'manual', handoff_cart_id = null, handoff_fuera_horario = not v_en where id = p_conv;
  ru := public._cc_rutear(p_conv);
  if not (ru ->> 'asignado')::boolean then
    perform public._cc_evento(p_conv, 'human_handoff_queued', 'system', null, null, jsonb_build_object('motivo', ru ->> 'motivo', 'fuera_horario', not v_en, 'origen', p_origen));
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._cc_wa_a_cola(p_conv uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c record; hor jsonb; v_conf boolean; v_en boolean; ru jsonb;
begin
  select * into c from public.cc_conversations where id = p_conv for update;
  if c.estado <> 'abierta' or c.modo not in ('ai_active', 'human_offered')
     or (c.asesoria_solicitada_at is not null and c.asesoria_solicitada_at > now() - interval '12 hours') then return; end if;
  hor := public._cc_horario_estado(now()); v_conf := (hor ->> 'configurado')::boolean; v_en := v_conf and coalesce((hor ->> 'abierto')::boolean, false);
  perform public._cc_sistema(p_conv, public._cc_texto_handoff(v_conf, v_en), 'sys:wa:' || c.ultimo_seq);
  perform public._cc_cambiar_modo(p_conv, 'human_requested', 'human_requested', case when c.profile_id is null then 'visitor' else 'doctor' end,
          c.profile_id, c.visitor_id, jsonb_build_object('origen', 'whatsapp', 'fuera_horario', not v_en, 'horario_configurado', v_conf));
  update public.cc_conversations set handoff_origen = 'manual', handoff_cart_id = null, handoff_fuera_horario = not v_en where id = p_conv;
  ru := public._cc_rutear(p_conv);
  if not (ru ->> 'asignado')::boolean then
    perform public._cc_evento(p_conv, 'human_handoff_queued', 'system', null, null, jsonb_build_object('motivo', ru ->> 'motivo', 'fuera_horario', not v_en, 'origen', 'whatsapp'));
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cc_ia_aviso_no_disponible(p_conv uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public._cc_solo_servicio();
  return public.cc_enviar_mensaje(p_conv, 'system', null, null, 'sys:ia_no_disponible', 'No pude consultar al asistente en este momento. Si quieres, puedo pedirte un asesor de Renovacell.');
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cc_ia_turno_reclamar(p_conv uuid, p_trigger_seq bigint, p_provider text, p_model text, p_lease_segs integer DEFAULT 90)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c record; t public.cc_ai_turns%rowtype; v_msg uuid; v_sesion_ok boolean; v_lease interval := make_interval(secs => least(greatest(coalesce(p_lease_segs, 90), 10), 600)); v_prev record;
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
  if c.estado <> 'abierta' or not public._cc_ia_puede(c.modo) or not v_sesion_ok then
    if t.id is null then
      insert into public.cc_ai_turns (conversation_id, trigger_message_id, trigger_seq, operation_id, status, provider, model, error_class, finished_at)
      values (p_conv, v_msg, p_trigger_seq, 'ai:' || p_trigger_seq, 'discarded', p_provider, p_model, case when c.estado <> 'abierta' then 'conversacion_cerrada' when not v_sesion_ok then 'sesion_cambiada' else 'ia_silenciada' end, now()) returning * into t;
    else
      update public.cc_ai_turns set status = 'discarded', error_class = case when c.estado <> 'abierta' then 'conversacion_cerrada' when not v_sesion_ok then 'sesion_cambiada' else 'ia_silenciada' end, finished_at = now(), lease_until = null where id = t.id returning * into t;
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
$function$
;

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
$function$
;

drop function if exists public._cc_canal_transferir(uuid, text, text, text, boolean);
drop function if exists public._cc_texto_atencion_humana(boolean, boolean, text);
drop function if exists public._cc_ia_permitida_en(uuid, boolean);
drop function if exists public._cc_canal_ia_atiende(text);
drop function if exists public._cc_canal_de(uuid);

do $post$ begin
  if md5(pg_get_functiondef('public._cc_wa_a_cola(uuid)'::regprocedure)) <> '1b4ae20c689e0e217f033ecffc4da68c'
     or md5(pg_get_functiondef('public._cc_canal_a_cola(uuid,text)'::regprocedure)) <> 'ddf7851a5128b3f0f7cdf063c8f5b128'
     or md5(pg_get_functiondef('public.cc_ia_turno_reclamar(uuid,bigint,text,text,integer)'::regprocedure)) <> '4a3ddb5cffe2045f544d719fb957b483'
     or md5(pg_get_functiondef('public.cc_ia_turno_responder(uuid,text,text,text[],integer,integer,integer)'::regprocedure)) <> 'e472ac30973392da999f9b7f2477bd27'
     or md5(pg_get_functiondef('public.cc_ia_aviso_no_disponible(uuid)'::regprocedure)) <> 'dcab51ccb18f83b104317320aba50d20' then
    raise exception 'R4-B2-3a down: las funciones no quedaron idénticas a producción';
  end if;
end $post$;
