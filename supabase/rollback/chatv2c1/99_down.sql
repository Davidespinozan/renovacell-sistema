-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- ROLLBACK · Chat V2-C1 (migración 125) — restaura la arquitectura de la 124.
--
-- FRONTERA (no ocultarla):
--   · ANTES de que producción CIERRE una primera sesión real o ABRA una sesión con ordinal > 1, este down es
--     estructuralmente viable: los mensajes nunca se tocaron (modelo de rangos) y solo existen las sesiones
--     de respaldo ('migracion').
--   · DESPUÉS de ese punto: FORWARD-FIX ONLY. Un down borraría la historia de sesiones (cuándo terminó cada
--     atención, quién la cerró) y el estado operativo ya liberado (modo/handler limpiados por el cierre) NO
--     volvería a su valor anterior. Los mensajes seguirían intactos, pero la frontera de sesiones se perdería.
--   Este archivo ABORTA si detecta sesiones con ordinal > 1 o cerradas por un motivo distinto del respaldo,
--   salvo que se ejecute con SET app.chatv2c1_rollback_forzado = 'on' (decisión explícita del dueño).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
select public._cc_chatv2c1_rollback_guard();   -- aborta si la frontera ya se cruzó (ver arriba)

drop trigger if exists trg_ccm_sesion on public.cc_messages;

-- Funciones restauradas al texto vigente en la 124.
CREATE OR REPLACE FUNCTION public._cc_evento(p_conv uuid, p_tipo text, p_actor_type text, p_profile uuid, p_visitor uuid, p_detalle jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$ insert into public.cc_conversation_events (conversation_id, tipo, actor_type, actor_profile_id, actor_visitor_id, detalle) values (p_conv, p_tipo, p_actor_type, p_profile, p_visitor, p_detalle) $function$;

CREATE OR REPLACE FUNCTION public.cc_enviar_mensaje(p_conv uuid, p_actor_type text, p_visitor_hash text, p_profile uuid, p_client_id text, p_content text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_visitor uuid; c record; v_rol text; v_seq bigint; v_id uuid; v_hash text; e record; v_prof uuid; v_modo text;
begin
  if p_content is null or btrim(p_content) = '' then raise exception 'CONTENIDO_VACIO' using errcode = 'check_violation'; end if;
  if length(p_content) > 4000 then raise exception 'CONTENIDO_LARGO' using errcode = 'check_violation'; end if;
  if p_actor_type not in ('visitor', 'doctor', 'seller', 'admin', 'ai', 'system') then raise exception 'ACTOR_INVALIDO' using errcode = 'check_violation'; end if;
  if p_actor_type in ('ai', 'system') then
    if p_profile is not null or p_visitor_hash is not null then raise exception 'ACTOR_INVALIDO' using errcode = 'check_violation'; end if;
    select * into c from public.cc_conversations where id = p_conv for update;
    if not found then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
    if p_actor_type = 'ai' and not public._cc_ia_puede(c.modo) then
      raise exception 'IA_SILENCIADA: modo %', c.modo using errcode = 'insufficient_privilege';
    end if;
  else
    if p_actor_type = 'visitor' then
      v_visitor := public._cc_visitor_por_hash(p_visitor_hash); if v_visitor is null then raise exception 'SESION_INVALIDA'; end if;
      -- Orden de locks = el de la adopción (visitante → conversación): sin ciclos. Si una adopción
      -- está en curso, esperamos a que termine y la autoridad se re-evalúa ya adoptado.
      perform 1 from public.cc_visitors where id = v_visitor for key share;
    end if;
    v_rol := public._cc_autoridad(p_conv, p_actor_type, v_visitor, p_profile);
    select * into c from public.cc_conversations where id = p_conv for update;
    v_rol := public._cc_autoridad(p_conv, p_actor_type, v_visitor, p_profile);   -- re-verificación bajo lock
    if p_actor_type = 'seller' and c.modo <> 'human_active' then raise exception 'ASESORIA_NO_INICIADA: modo %', c.modo using errcode = 'insufficient_privilege'; end if;
    v_prof := case when p_actor_type <> 'visitor' then p_profile end;
  end if;
  if c.estado <> 'abierta' then raise exception 'CONVERSACION_CERRADA' using errcode = 'check_violation'; end if;

  v_hash := md5(p_content);
  if p_client_id is not null then
    select * into e from public.cc_messages m where m.conversation_id = p_conv and m.actor_type = p_actor_type
       and coalesce(m.actor_profile_id::text, m.actor_visitor_id::text, '') = coalesce(v_prof::text, v_visitor::text, '') and m.client_message_id = p_client_id;
    if found then
      if e.content_hash <> v_hash then raise exception 'IDEMPOTENCIA_CONFLICTO' using errcode = 'unique_violation'; end if;
      return jsonb_build_object('id', e.id, 'seq', e.seq, 'idempotente', true, 'modo', c.modo);
    end if;
  end if;
  update public.cc_conversations set ultimo_seq = ultimo_seq + 1, last_message_at = now(), updated_at = now() where id = p_conv returning ultimo_seq into v_seq;
  insert into public.cc_messages (conversation_id, seq, actor_type, actor_visitor_id, actor_profile_id, client_message_id, content, content_hash)
  values (p_conv, v_seq, p_actor_type, v_visitor, v_prof, p_client_id, p_content, v_hash) returning id into v_id;
  -- Quien escribe ya leyó hasta aquí.
  if p_actor_type in ('visitor', 'doctor', 'seller', 'admin') then
    perform public._cc_participante(p_conv, p_actor_type, v_visitor, v_prof, case when p_actor_type = 'seller' then 'asesor' when p_actor_type = 'admin' then 'supervisor' else 'dueno' end);
    update public.cc_participants set last_read_seq = greatest(last_read_seq, v_seq), last_read_at = now()
     where conversation_id = p_conv and coalesce(profile_id::text, visitor_id::text) = coalesce(v_prof::text, v_visitor::text);
  end if;
  -- CC-7 · canal permanente: si la asesoría terminó y el dueño vuelve a escribir, la IA retoma sola.
  v_modo := c.modo;
  if p_actor_type in ('visitor', 'doctor') and c.modo = 'human_ended' then
    perform public._cc_cambiar_modo(p_conv, 'ai_active', 'ai_resumed', p_actor_type, v_prof, v_visitor, jsonb_build_object('auto', true));
    v_modo := 'ai_active';
  end if;
  return jsonb_build_object('id', v_id, 'seq', v_seq, 'idempotente', false, 'modo', v_modo);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_ia_turno_reclamar(p_conv uuid, p_trigger_seq bigint, p_provider text, p_model text, p_lease_segs integer DEFAULT 90)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c record; t public.cc_ai_turns%rowtype; v_msg uuid; v_lease interval := make_interval(secs => least(greatest(coalesce(p_lease_segs, 90), 10), 600)); v_prev record;
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

  if c.estado <> 'abierta' or not public._cc_ia_puede(c.modo) then
    if t.id is null then
      insert into public.cc_ai_turns (conversation_id, trigger_message_id, trigger_seq, operation_id, status, provider, model, error_class, finished_at)
      values (p_conv, v_msg, p_trigger_seq, 'ai:' || p_trigger_seq, 'discarded', p_provider, p_model, case when c.estado <> 'abierta' then 'conversacion_cerrada' else 'ia_silenciada' end, now()) returning * into t;
    else
      update public.cc_ai_turns set status = 'discarded', error_class = case when c.estado <> 'abierta' then 'conversacion_cerrada' else 'ia_silenciada' end, finished_at = now(), lease_until = null where id = t.id returning * into t;
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

CREATE OR REPLACE FUNCTION public.cc_iniciar_asesoria(p_conv uuid, p_profile uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c record; v_nombre text;
begin
  perform public._cc_autoridad(p_conv, 'seller', null, p_profile);
  select * into c from public.cc_conversations where id = p_conv for update;
  if c.estado <> 'abierta' then raise exception 'CONVERSACION_CERRADA' using errcode = 'check_violation'; end if;
  if c.modo = 'human_active' then return jsonb_build_object('modo', c.modo, 'idempotente', true); end if;
  perform public._cc_cambiar_modo(p_conv, 'human_active', 'human_started', 'seller', p_profile, null);
  select coalesce(p.meta ->> 'name', p.full_name, 'Un asesor') into v_nombre from public.profiles p where p.id = p_profile;
  perform public._cc_sistema(p_conv, v_nombre || ' se unió a la conversación.', 'sys:inicio:' || c.ultimo_seq);
  return jsonb_build_object('modo', 'human_active', 'idempotente', false);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_leer_conversacion(p_conv uuid, p_actor_type text, p_visitor_hash text, p_profile uuid, p_desde_seq bigint DEFAULT 0, p_limite integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_visitor uuid; v_rol text; c record; v_msgs jsonb; v_asesor text;
begin
  if p_actor_type = 'visitor' then v_visitor := public._cc_visitor_por_hash(p_visitor_hash); if v_visitor is null then raise exception 'SESION_INVALIDA'; end if; end if;
  v_rol := public._cc_autoridad(p_conv, p_actor_type, v_visitor, p_profile);
  select * into c from public.cc_conversations where id = p_conv;
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'seq', m.seq, 'actor', m.actor_type, 'content', m.content, 'created_at', m.created_at,
                                               'propio', (m.actor_visitor_id is not null and m.actor_visitor_id = v_visitor) or (m.actor_profile_id is not null and m.actor_profile_id = p_profile))
                  order by m.seq), '[]'::jsonb)
    into v_msgs
    from (select * from public.cc_messages m where m.conversation_id = p_conv and m.seq > coalesce(p_desde_seq, 0) order by m.seq limit least(greatest(coalesce(p_limite, 100), 1), 200)) m;
  select coalesce(p.full_name, p.meta ->> 'name') into v_asesor from public.profiles p where p.id = c.seller_profile_id;
  return jsonb_build_object('conversation_id', c.id, 'estado', c.estado, 'modo', c.modo, 'rol', v_rol, 'ultimo_seq', c.ultimo_seq,
                            'asesor_nombre', v_asesor, 'asesor_soy_yo', c.seller_profile_id is not null and c.seller_profile_id = p_profile,
                            'mensajes', v_msgs,
                            -- UX-1 · cursor de lectura del actor (autoridad: cc_participants.last_read_seq); el badge del portal no inventa estado
                            'leido_hasta', coalesce((select p.last_read_seq from public.cc_participants p where p.conversation_id = c.id
                                                       and ((p_profile is not null and p.profile_id = p_profile) or (v_visitor is not null and p.visitor_id = v_visitor))
                                                     order by p.last_read_seq desc nulls last limit 1), 0),
                            -- CC-7 · estado del handoff (sin datos del vendedor más allá del nombre ya expuesto)
                            'handoff', jsonb_build_object('origen', c.handoff_origen, 'cart_id', c.handoff_cart_id, 'fuera_horario', c.handoff_fuera_horario,
                                                          'asignado', c.seller_profile_id is not null and c.modo in ('human_assigned', 'human_active'),
                                                          'puede_rechazar', v_rol = 'dueno' and c.modo in ('human_requested', 'human_assigned') and c.handoff_origen is not null));
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_terminar_asesoria(p_conv uuid, p_profile uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c record; v_rol text;
begin
  v_rol := public._cc_perfil_activo(p_profile);
  if v_rol is null then raise exception 'CUENTA_SUSPENDIDA'; end if;
  select * into c from public.cc_conversations where id = p_conv for update;
  if not found then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if not (v_rol = 'admin' or (c.seller_profile_id = p_profile and public._cc_puede_atender(p_profile))) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if c.modo = 'human_ended' then return jsonb_build_object('modo', c.modo, 'idempotente', true); end if;
  perform public._cc_cambiar_modo(p_conv, 'human_ended', 'human_ended', case when v_rol = 'admin' then 'admin' else 'seller' end, p_profile, null);
  perform public._cc_sistema(p_conv, 'La asesoría terminó. Puedes seguir con el asistente cuando quieras.', 'sys:fin:' || c.ultimo_seq);
  return jsonb_build_object('modo', 'human_ended', 'idempotente', false);
end;
$function$;

CREATE OR REPLACE FUNCTION public._cc_adoptar_conversaciones(p_visitor uuid, p_profile uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare r record; v_abierta uuid; n int := 0;
begin
  select id into v_abierta from public.cc_conversations where profile_id = p_profile and estado = 'abierta';
  for r in select * from public.cc_conversations where visitor_id = p_visitor and profile_id is null order by created_at for update loop
    if r.estado = 'abierta' and v_abierta is not null and v_abierta <> r.id then
      update public.cc_conversations set profile_id = p_profile, estado = 'cerrada', closed_at = now(), updated_at = now() where id = r.id;
      perform public._cc_evento(r.id, 'conversation_closed', 'system', null, null, jsonb_build_object('motivo', 'consolidada', 'en', v_abierta));
    else
      update public.cc_conversations set profile_id = p_profile, updated_at = now() where id = r.id;
      if r.estado = 'abierta' then v_abierta := r.id; end if;
    end if;
    perform public._cc_participante(r.id, 'doctor', null, p_profile, 'dueno');
    perform public._cc_evento(r.id, 'visitor_adopted', 'doctor', p_profile, p_visitor);
    n := n + 1;
  end loop;
  return n;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_cerrar_conversacion(p_conv uuid, p_actor_type text, p_visitor_hash text, p_profile uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_visitor uuid; c record;
begin
  if p_actor_type = 'visitor' then v_visitor := public._cc_visitor_por_hash(p_visitor_hash); if v_visitor is null then raise exception 'SESION_INVALIDA'; end if; end if;
  perform public._cc_autoridad(p_conv, p_actor_type, v_visitor, p_profile);
  select * into c from public.cc_conversations where id = p_conv for update;
  if c.estado = 'cerrada' then return jsonb_build_object('estado', 'cerrada', 'idempotente', true); end if;
  update public.cc_conversations set estado = 'cerrada', closed_at = now(), updated_at = now() where id = p_conv;
  perform public._cc_evento(p_conv, 'conversation_closed', p_actor_type, case when p_actor_type <> 'visitor' then p_profile end, v_visitor);
  return jsonb_build_object('estado', 'cerrada', 'idempotente', false);
end;
$function$
;

drop function if exists public.cc_sesion_leer(uuid, text, text, uuid, bigint, integer);
drop function if exists public.cc_sesiones_listar(uuid, text, text, uuid);
drop function if exists public._cc_sesion_rol(uuid, text, uuid, uuid);
drop function if exists public.cc_ia_contexto(uuid, bigint, integer);
drop function if exists public._cc_sesion_cerrar(uuid, text, text, uuid);
drop function if exists public._cc_sesion_mensaje();
drop function if exists public._cc_sesion_contiene(uuid, bigint);
drop function if exists public._cc_sesiones_respaldo();
drop function if exists public._cc_chatv2c1_rollback_guard();

alter table public.cc_conversation_events drop constraint if exists ck_ccce_tipo;
do $tipo$
begin
  -- Los eventos son append-only: si ya hay session_* el CHECK se restaura NOT VALID (no se borra historia).
  if exists (select 1 from public.cc_conversation_events where tipo in ('session_opened', 'session_closed')) then
    alter table public.cc_conversation_events add constraint ck_ccce_tipo check (tipo = any (array['conversation_opened', 'visitor_adopted', 'human_offered', 'human_requested', 'human_assigned', 'seller_unassigned',
      'human_started', 'human_ended', 'ai_resumed', 'conversation_closed', 'conversation_reopened', 'human_handoff_requested', 'human_handoff_queued', 'human_handoff_rejected', 'notificacion_fallida'])) not valid;
  else
    alter table public.cc_conversation_events add constraint ck_ccce_tipo check (tipo = any (array['conversation_opened', 'visitor_adopted', 'human_offered', 'human_requested', 'human_assigned', 'seller_unassigned',
      'human_started', 'human_ended', 'ai_resumed', 'conversation_closed', 'conversation_reopened', 'human_handoff_requested', 'human_handoff_queued', 'human_handoff_rejected', 'notificacion_fallida']));
  end if;
end $tipo$;
drop index if exists public.idx_ccce_sesion;
alter table public.cc_conversation_events drop column if exists session_id;
drop table if exists public.cc_conversation_sessions;
