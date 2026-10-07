-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- Chat V2-C1 · AUTORIDAD DE SESIONES (migración 125)
--   CONVERSACIÓN = relación permanente doctor/visitante ↔ Renovacell (sin cambios).
--   SESIÓN      = interacción temporal dentro de esa conversación: un RANGO contiguo de mensajes
--                 [first_seq, last_seq] (last_seq NULL mientras está abierta). cc_messages NO se toca:
--                 ni columnas nuevas ni renumeración (es append-only).
--   · Una sola sesión abierta por conversación (índice único parcial).
--   · La abre el PRIMER MENSAJE insertado sin sesión abierta (trigger AFTER INSERT en cc_messages: ningún
--     camino de inserción puede saltársela; todos los llamadores ya bloquean la fila de la conversación).
--     Abrir la UI, navegar o leer NO crea sesión.
--   · cc_terminar_asesoria CIERRA la sesión y libera el estado operativo (modo → ai_active, sin handler/
--     ruteo/handoff/marcas). La cartera, el carrito y los pedidos no cambian.
--   · cc_conversations.modo sigue siendo la máquina de estados, ahora = estado de la SESIÓN ACTUAL.
--   · Contexto de IA = solo la sesión del disparador (cc_ia_contexto); una respuesta tardía de una sesión
--     anterior se descarta ('sesion_cambiada').
--   · Autoridad de historial (para C3, sin UI): cc_sesiones_listar / cc_sesion_leer.
--   NO incluye (C2+): cierre por inactividad, cron de sesiones, timeouts, UI de historial, señal de actividad.
-- Respaldo CONSERVADOR: cada conversación con mensajes recibe la sesión 1 (origen 'migracion'); las abiertas
-- quedan ABIERTAS (no se inventa closed_at). Frontera: ver supabase/rollback/chatv2c1/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════

do $pre$
begin
  if to_regclass('public.cc_conversations') is null or to_regclass('public.cc_messages') is null or to_regclass('public.cc_conversation_events') is null then
    raise exception 'Chat V2-C1: faltan tablas CC-2';
  end if;
  if to_regprocedure('public.cc_atencion_evaluar()') is null then raise exception 'Chat V2-C1: requiere CHV2-A (123/124)'; end if;
  if to_regclass('public.cc_conversation_sessions') is not null then raise exception 'Chat V2-C1: cc_conversation_sessions ya existe'; end if;
end $pre$;

-- ── 1) Sesiones ──────────────────────────────────────────────────────────────────────────────────────
create table public.cc_conversation_sessions (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.cc_conversations(id) on delete restrict,
  ordinal integer not null check (ordinal >= 1),
  estado text not null default 'abierta' constraint ck_ccs_estado check (estado in ('abierta', 'cerrada')),
  origen text not null constraint ck_ccs_origen check (origen in ('cliente', 'carrito', 'asesor', 'sistema', 'migracion')),
  first_seq bigint not null check (first_seq >= 1),
  last_seq bigint,
  opened_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  closed_at timestamptz,
  close_reason text constraint ck_ccs_motivo check (close_reason is null or close_reason in ('asesor_finalizo', 'direccion_finalizo', 'inactividad', 'conversacion_cerrada', 'consolidada')),
  closed_by_actor_type text constraint ck_ccs_actor check (closed_by_actor_type is null or closed_by_actor_type in ('visitor', 'doctor', 'seller', 'admin', 'system')),
  closed_by_profile_id uuid references public.profiles(id) on delete set null,
  asesor_profile_id uuid references public.profiles(id) on delete set null,
  -- Hechos históricos del handoff de ESTA sesión (se fijan al cerrar; mientras está abierta viven en la conversación).
  handoff_origen text constraint ck_ccs_handoff check (handoff_origen is null or handoff_origen in ('carrito', 'manual')),
  handoff_cart_id uuid references public.cc_carts(id) on delete set null,
  asesoria_solicitada_at timestamptz,
  asesoria_asignada_at timestamptz,
  asesoria_iniciada_at timestamptz,
  constraint ck_ccs_cierre check ((estado = 'cerrada') = (closed_at is not null) and (estado = 'cerrada') = (last_seq is not null) and (estado = 'cerrada') = (close_reason is not null)),
  constraint ck_ccs_rango check (last_seq is null or last_seq >= first_seq)
);
create unique index uq_ccs_abierta on public.cc_conversation_sessions (conversation_id) where estado = 'abierta';
create unique index uq_ccs_ordinal on public.cc_conversation_sessions (conversation_id, ordinal);
create index idx_ccs_abiertas_actividad on public.cc_conversation_sessions (last_activity_at) where estado = 'abierta';   -- para el cierre por inactividad (C2)
create index idx_ccs_asesor on public.cc_conversation_sessions (asesor_profile_id) where asesor_profile_id is not null;
alter table public.cc_conversation_sessions enable row level security;
revoke all on public.cc_conversation_sessions from public, anon, authenticated;

-- ── 2) Eventos: session_id opcional para los NUEVOS (los históricos no se reescriben) + tipos ───────────
alter table public.cc_conversation_events add column session_id uuid references public.cc_conversation_sessions(id) on delete restrict;
create index idx_ccce_sesion on public.cc_conversation_events (session_id) where session_id is not null;
alter table public.cc_conversation_events drop constraint ck_ccce_tipo;
alter table public.cc_conversation_events add constraint ck_ccce_tipo check (tipo = any (array['conversation_opened', 'visitor_adopted', 'human_offered', 'human_requested', 'human_assigned', 'seller_unassigned',
  'human_started', 'human_ended', 'ai_resumed', 'conversation_closed', 'conversation_reopened', 'human_handoff_requested', 'human_handoff_queued', 'human_handoff_rejected',
  'notificacion_fallida', 'session_opened', 'session_closed']));

-- ── 3) Respaldo conservador (antes de crear el trigger) ──────────────────────────────────────────────
-- Una sesión 1 por conversación CON mensajes y SIN sesiones (idempotente). Abierta si la conversación está
-- abierta: NO se inventa closed_at. opened_at = apertura de la conversación; last_activity_at = último mensaje
-- real; asesor = actor del último human_started. Los hechos de handoff de una sesión abierta siguen viviendo en
-- la conversación (se copian al cerrarla).
create or replace function public._cc_sesiones_respaldo() returns integer
  language plpgsql set search_path = public as
$$
declare n int;
begin
  insert into public.cc_conversation_sessions (conversation_id, ordinal, estado, origen, first_seq, last_seq, opened_at, last_activity_at, closed_at, close_reason,
                                               closed_by_actor_type, asesor_profile_id, handoff_origen, handoff_cart_id, asesoria_solicitada_at, asesoria_asignada_at, asesoria_iniciada_at)
  select c.id, 1, case when c.estado = 'abierta' then 'abierta' else 'cerrada' end, 'migracion', m.min_seq,
         case when c.estado = 'abierta' then null else c.ultimo_seq end,
         c.created_at,                                      -- evidencia: apertura de la conversación
         m.max_at,                                          -- evidencia: último mensaje real
         case when c.estado = 'abierta' then null else c.closed_at end,
         case when c.estado = 'abierta' then null else 'conversacion_cerrada' end,
         case when c.estado = 'abierta' then null else 'system' end,
         (select e.actor_profile_id from public.cc_conversation_events e where e.conversation_id = c.id and e.tipo = 'human_started' and e.actor_profile_id is not null order by e.created_at desc limit 1),
         case when c.estado = 'abierta' then null else c.handoff_origen end,
         case when c.estado = 'abierta' then null else c.handoff_cart_id end,
         case when c.estado = 'abierta' then null else c.asesoria_solicitada_at end,
         case when c.estado = 'abierta' then null else c.asesoria_asignada_at end,
         case when c.estado = 'abierta' then null else c.asesoria_iniciada_at end
    from public.cc_conversations c
    join (select conversation_id, min(seq) min_seq, max(created_at) max_at from public.cc_messages group by conversation_id) m on m.conversation_id = c.id
   where not exists (select 1 from public.cc_conversation_sessions x where x.conversation_id = c.id);
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public._cc_sesiones_respaldo() from public, anon, authenticated;
select public._cc_sesiones_respaldo();

-- ── 4) Núcleo de sesiones ────────────────────────────────────────────────────────────────────────────
-- ¿El seq pertenece a la sesión ABIERTA? (guardia de respuestas tardías de IA)
create or replace function public._cc_sesion_contiene(p_conv uuid, p_seq bigint) returns boolean
  language sql stable set search_path = public as
$$ select exists (select 1 from public.cc_conversation_sessions s where s.conversation_id = p_conv and s.estado = 'abierta' and s.first_seq <= p_seq) $$;

-- Trigger: el primer mensaje sin sesión abierta la abre; los siguientes solo marcan actividad.
create or replace function public._cc_sesion_mensaje() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare v_id uuid; v_ord int; v_origen text;
begin
  update public.cc_conversation_sessions set last_activity_at = new.created_at where conversation_id = new.conversation_id and estado = 'abierta';
  if found then return null; end if;
  v_origen := case
    when new.actor_type = 'system' and coalesce(new.client_message_id, '') like 'sys:handoff:%' then 'carrito'
    when new.actor_type = 'system' and coalesce(new.client_message_id, '') like 'sys:solicitud:%' then 'cliente'
    when new.actor_type in ('doctor', 'visitor') then 'cliente'
    when new.actor_type in ('seller', 'admin') then 'asesor'
    else 'sistema' end;
  select coalesce(max(ordinal), 0) + 1 into v_ord from public.cc_conversation_sessions where conversation_id = new.conversation_id;
  insert into public.cc_conversation_sessions (conversation_id, ordinal, estado, origen, first_seq, opened_at, last_activity_at)
  values (new.conversation_id, v_ord, 'abierta', v_origen, new.seq, new.created_at, new.created_at) returning id into v_id;
  insert into public.cc_conversation_events (conversation_id, tipo, actor_type, detalle, session_id)
  values (new.conversation_id, 'session_opened', 'system', jsonb_build_object('ordinal', v_ord, 'origen', v_origen, 'first_seq', new.seq), v_id);
  return null;
end;
$$;
create trigger trg_ccm_sesion after insert on public.cc_messages for each row execute function public._cc_sesion_mensaje();

-- Cierra la sesión abierta (el llamador ya bloqueó la conversación). Idempotente: sin sesión abierta → NULL.
create or replace function public._cc_sesion_cerrar(p_conv uuid, p_motivo text, p_actor_type text, p_actor uuid) returns uuid
  language plpgsql set search_path = public as
$$
declare s record; c record;
begin
  select * into s from public.cc_conversation_sessions where conversation_id = p_conv and estado = 'abierta' for update;
  if not found then return null; end if;
  select * into c from public.cc_conversations where id = p_conv;
  insert into public.cc_conversation_events (conversation_id, tipo, actor_type, actor_profile_id, detalle, session_id)
  values (p_conv, 'session_closed', p_actor_type, p_actor, jsonb_build_object('ordinal', s.ordinal, 'motivo', p_motivo, 'first_seq', s.first_seq, 'last_seq', c.ultimo_seq, 'modo', c.modo), s.id);
  update public.cc_conversation_sessions
     set estado = 'cerrada', last_seq = c.ultimo_seq, closed_at = now(), close_reason = p_motivo, closed_by_actor_type = p_actor_type, closed_by_profile_id = p_actor,
         handoff_origen = coalesce(c.handoff_origen, handoff_origen), handoff_cart_id = coalesce(c.handoff_cart_id, handoff_cart_id),
         asesoria_solicitada_at = coalesce(c.asesoria_solicitada_at, asesoria_solicitada_at), asesoria_asignada_at = coalesce(c.asesoria_asignada_at, asesoria_asignada_at),
         asesoria_iniciada_at = coalesce(c.asesoria_iniciada_at, asesoria_iniciada_at)
   where id = s.id;
  return s.id;
end;
$$;

-- ── 5) Funciones existentes ajustadas (texto vigente + cambios marcados "Chat V2-C1") ─────────────────
CREATE OR REPLACE FUNCTION public._cc_evento(p_conv uuid, p_tipo text, p_actor_type text, p_profile uuid, p_visitor uuid, p_detalle jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE sql
 SET search_path TO 'public'
AS $function$ insert into public.cc_conversation_events (conversation_id, tipo, actor_type, actor_profile_id, actor_visitor_id, detalle, session_id) values (p_conv, p_tipo, p_actor_type, p_profile, p_visitor, p_detalle, (select s.id from public.cc_conversation_sessions s where s.conversation_id = p_conv and s.estado = 'abierta')) $function$;

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
    -- Chat V2-C1 · la IA solo responde DENTRO de una sesión abierta: nunca abre una sesión por sí misma.
    if p_actor_type = 'ai' and not exists (select 1 from public.cc_conversation_sessions s where s.conversation_id = p_conv and s.estado = 'abierta') then
      raise exception 'IA_SILENCIADA: sin sesión abierta' using errcode = 'insufficient_privilege';
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
  -- Chat V2-C1 · quién atendió ESTA sesión (dato histórico; el nombre se resuelve al leer).
  update public.cc_conversation_sessions set asesor_profile_id = p_profile where conversation_id = p_conv and estado = 'abierta';
  return jsonb_build_object('modo', 'human_active', 'idempotente', false);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_leer_conversacion(p_conv uuid, p_actor_type text, p_visitor_hash text, p_profile uuid, p_desde_seq bigint DEFAULT 0, p_limite integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_visitor uuid; v_rol text; c record; v_msgs jsonb; v_asesor text; s record; v_desde bigint;
begin
  if p_actor_type = 'visitor' then v_visitor := public._cc_visitor_por_hash(p_visitor_hash); if v_visitor is null then raise exception 'SESION_INVALIDA'; end if; end if;
  v_rol := public._cc_autoridad(p_conv, p_actor_type, v_visitor, p_profile);
  select * into c from public.cc_conversations where id = p_conv;
  -- Chat V2-C1 · la lectura ACTIVA es la sesión actual (o, si no hay abierta, la última cerrada); nunca el transcript eterno.
  select * into s from public.cc_conversation_sessions ss where ss.conversation_id = p_conv order by (ss.estado = 'abierta') desc, ss.ordinal desc limit 1;
  v_desde := greatest(coalesce(p_desde_seq, 0), coalesce(s.first_seq, 1) - 1);
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'seq', m.seq, 'actor', m.actor_type, 'content', m.content, 'created_at', m.created_at,
                                               'propio', (m.actor_visitor_id is not null and m.actor_visitor_id = v_visitor) or (m.actor_profile_id is not null and m.actor_profile_id = p_profile))
                  order by m.seq), '[]'::jsonb)
    into v_msgs
    from (select * from public.cc_messages m where m.conversation_id = p_conv and m.seq > v_desde and (s.id is null or s.last_seq is null or m.seq <= s.last_seq) order by m.seq limit least(greatest(coalesce(p_limite, 100), 1), 200)) m;
  select coalesce(p.full_name, p.meta ->> 'name') into v_asesor from public.profiles p where p.id = c.seller_profile_id;
  return jsonb_build_object('conversation_id', c.id, 'estado', c.estado, 'modo', c.modo, 'rol', v_rol, 'ultimo_seq', c.ultimo_seq,
                            'asesor_nombre', v_asesor, 'asesor_soy_yo', c.seller_profile_id is not null and c.seller_profile_id = p_profile,
                            'mensajes', v_msgs,
                            'sesion', case when s.id is null then null else jsonb_build_object('id', s.id, 'ordinal', s.ordinal, 'estado', s.estado, 'origen', s.origen,
                                                    'first_seq', s.first_seq, 'last_seq', s.last_seq, 'opened_at', s.opened_at, 'closed_at', s.closed_at, 'close_reason', s.close_reason) end,
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
-- Chat V2-C1 · Terminar la atención = CERRAR LA SESIÓN ACTUAL. La conversación (relación permanente), sus
-- mensajes, eventos, la cartera, el carrito y los pedidos NO cambian. Se libera el estado operativo: modo
-- vuelve a ai_active (la IA vuelve a ser elegible) y se limpia quién atiende / ruteo / handoff / marcas.
declare c record; v_rol text; v_actor text; v_sesion uuid; v_ord int;
begin
  v_rol := public._cc_perfil_activo(p_profile);
  if v_rol is null then raise exception 'CUENTA_SUSPENDIDA'; end if;
  select * into c from public.cc_conversations where id = p_conv for update;
  if not found then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  v_actor := case when v_rol = 'admin' then 'admin' else 'seller' end;
  if c.modo not in ('human_active', 'human_ended') then
    -- Idempotencia segura: quien cerró la última sesión (o Dirección) recibe el resultado, sin efectos.
    if c.modo in ('ai_active', 'human_offered')
       and (v_rol = 'admin' or exists (select 1 from public.cc_conversation_sessions s where s.conversation_id = p_conv and s.estado = 'cerrada' and s.closed_by_profile_id = p_profile)) then
      return jsonb_build_object('modo', c.modo, 'idempotente', true);
    end if;
    if not (v_rol = 'admin' or coalesce(c.seller_profile_id = p_profile and public._cc_puede_atender(p_profile), false)) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;   -- NULL-safe (tras un cierre no hay handler)
    raise exception 'TRANSICION_INVALIDA: % → human_ended (la asesoría no está iniciada)', c.modo using errcode = 'check_violation';
  end if;
  if not (v_rol = 'admin' or coalesce(c.seller_profile_id = p_profile and public._cc_puede_atender(p_profile), false)) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;   -- NULL-safe (tras un cierre no hay handler)
  if c.modo = 'human_active' then
    perform public._cc_cambiar_modo(p_conv, 'human_ended', 'human_ended', v_actor, p_profile, null);
  end if;
  -- El aviso de cierre pertenece a la sesión que termina (se inserta ANTES de cerrarla).
  perform public._cc_sistema(p_conv, 'La asesoría terminó. Puedes seguir con el asistente cuando quieras.', 'sys:fin:' || c.ultimo_seq);
  v_sesion := public._cc_sesion_cerrar(p_conv, case when v_rol = 'admin' then 'direccion_finalizo' else 'asesor_finalizo' end, v_actor, p_profile);
  update public.cc_participants set left_at = now() where conversation_id = p_conv and rol = 'asesor' and left_at is null;
  update public.cc_conversations
     set modo = 'ai_active', seller_profile_id = null, ruteo_motivo = null, handoff_origen = null, handoff_cart_id = null, handoff_fuera_horario = null,
         asesoria_solicitada_at = null, asesoria_asignada_at = null, asesoria_iniciada_at = null, asesoria_terminada_at = null, updated_at = now()
   where id = p_conv;
  select ordinal into v_ord from public.cc_conversation_sessions where id = v_sesion;
  return jsonb_build_object('modo', 'ai_active', 'idempotente', false, 'sesion_id', v_sesion, 'sesion_ordinal', v_ord);
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
  -- Chat V2-C1 · cerrar el canal también cierra la sesión abierta (la conversación vuelve con su historial).
  perform public._cc_sesion_cerrar(p_conv, 'conversacion_cerrada', p_actor_type, case when p_actor_type <> 'visitor' then p_profile end);
  return jsonb_build_object('estado', 'cerrada', 'idempotente', false);
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
      perform public._cc_sesion_cerrar(r.id, 'consolidada', 'system', null);   -- Chat V2-C1
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

-- ── 6) Contexto de IA acotado a la sesión (solo servicio; la Edge chat lo usa en vez de leer cc_messages) ─
create or replace function public.cc_ia_contexto(p_conv uuid, p_hasta_seq bigint, p_limite integer default 30) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare s record;
begin
  perform public._cc_solo_servicio();
  select * into s from public.cc_conversation_sessions ss
   where ss.conversation_id = p_conv and ss.first_seq <= p_hasta_seq and (ss.last_seq is null or ss.last_seq >= p_hasta_seq)
   order by ss.ordinal desc limit 1;
  if not found then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('actor', x.actor_type, 'content', x.content, 'seq', x.seq) order by x.seq)
                     from (select m.actor_type, m.content, m.seq from public.cc_messages m
                            where m.conversation_id = p_conv and m.seq >= s.first_seq and m.seq <= p_hasta_seq
                            order by m.seq desc limit least(greatest(coalesce(p_limite, 30), 1), 50)) x), '[]'::jsonb);
end;
$$;

-- ── 7) Autoridad de historial (C3 la usará; sin UI todavía) ──────────────────────────────────────────
--   Doctor / visitante: sus sesiones. Dirección: todas. Vendedor: la sesión ABIERTA si hoy la atiende, todo el
--   historial si es su vendedor de CARTERA, o la sesión que él atendió. Almacén / chofer / anon: nada.
create or replace function public._cc_sesion_rol(p_session uuid, p_actor_type text, p_visitor uuid, p_profile uuid) returns text
  language plpgsql stable set search_path = public as
$$
declare s record; c record; v_rol text;
begin
  select * into s from public.cc_conversation_sessions where id = p_session;
  if not found then return null; end if;
  select * into c from public.cc_conversations where id = s.conversation_id;
  if p_actor_type = 'visitor' then
    return case when p_visitor is not null and c.visitor_id = p_visitor and c.profile_id is null then 'dueno' end;
  end if;
  v_rol := public._cc_perfil_activo(p_profile);
  if v_rol is null then return null; end if;
  if p_actor_type = 'doctor' then return case when v_rol = 'doctor' and c.profile_id = p_profile then 'dueno' end; end if;
  if p_actor_type = 'admin' then return case when v_rol = 'admin' then 'supervisor' end; end if;
  if p_actor_type = 'seller' and v_rol in ('pos', 'billing', 'comm') then
    if s.estado = 'abierta' and c.seller_profile_id = p_profile and public._cc_puede_atender(p_profile) then return 'asesor'; end if;
    if c.profile_id is not null and public._cc_vendedor_de(c.profile_id) = p_profile then return 'cartera'; end if;
    if s.asesor_profile_id = p_profile then return 'asesor_historico'; end if;
  end if;
  return null;
end;
$$;

create or replace function public.cc_sesiones_listar(p_conv uuid, p_actor_type text, p_visitor_hash text, p_profile uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_visitor uuid; c record; v_out jsonb;
begin
  if p_actor_type = 'visitor' then v_visitor := public._cc_visitor_por_hash(p_visitor_hash); if v_visitor is null then raise exception 'SESION_INVALIDA'; end if; end if;
  select * into c from public.cc_conversations where id = p_conv;
  if not found then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;   -- no se revela existencia
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', s.id, 'ordinal', s.ordinal, 'estado', s.estado, 'actual', s.estado = 'abierta', 'origen', s.origen,
           'opened_at', s.opened_at, 'last_activity_at', s.last_activity_at, 'closed_at', s.closed_at, 'close_reason', s.close_reason,
           'n_mensajes', coalesce(s.last_seq, c.ultimo_seq) - s.first_seq + 1,
           'asesor_nombre', (select coalesce(p.meta ->> 'name', p.full_name) from public.profiles p where p.id = s.asesor_profile_id))
         order by s.ordinal desc), '[]'::jsonb)
    into v_out
    from public.cc_conversation_sessions s
   where s.conversation_id = p_conv and public._cc_sesion_rol(s.id, p_actor_type, v_visitor, p_profile) is not null;
  if v_out = '[]'::jsonb and exists (select 1 from public.cc_conversation_sessions where conversation_id = p_conv) then
    raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege';
  end if;
  return jsonb_build_object('conversation_id', p_conv, 'sesiones', v_out);   -- sin fragmentos de mensajes (privacidad)
end;
$$;

create or replace function public.cc_sesion_leer(p_session uuid, p_actor_type text, p_visitor_hash text, p_profile uuid, p_desde_seq bigint default 0, p_limite integer default 100) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_visitor uuid; v_rol text; s record; c record; v_msgs jsonb;
begin
  if p_actor_type = 'visitor' then v_visitor := public._cc_visitor_por_hash(p_visitor_hash); if v_visitor is null then raise exception 'SESION_INVALIDA'; end if; end if;
  v_rol := public._cc_sesion_rol(p_session, p_actor_type, v_visitor, p_profile);
  if v_rol is null then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into s from public.cc_conversation_sessions where id = p_session;
  select * into c from public.cc_conversations where id = s.conversation_id;
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'seq', m.seq, 'actor', m.actor_type, 'content', m.content, 'created_at', m.created_at,
                                               'propio', (m.actor_visitor_id is not null and m.actor_visitor_id = v_visitor) or (m.actor_profile_id is not null and m.actor_profile_id = p_profile))
                  order by m.seq), '[]'::jsonb)
    into v_msgs
    from (select * from public.cc_messages m
           where m.conversation_id = s.conversation_id and m.seq >= s.first_seq and m.seq <= coalesce(s.last_seq, c.ultimo_seq) and m.seq > coalesce(p_desde_seq, 0)
           order by m.seq limit least(greatest(coalesce(p_limite, 100), 1), 200)) m;
  return jsonb_build_object('sesion', jsonb_build_object('id', s.id, 'conversation_id', s.conversation_id, 'ordinal', s.ordinal, 'estado', s.estado, 'origen', s.origen,
                              'opened_at', s.opened_at, 'closed_at', s.closed_at, 'close_reason', s.close_reason, 'first_seq', s.first_seq, 'last_seq', s.last_seq,
                              'asesor_nombre', (select coalesce(p.meta ->> 'name', p.full_name) from public.profiles p where p.id = s.asesor_profile_id)),
                            'rol', v_rol, 'solo_lectura', s.estado = 'cerrada' or v_rol in ('cartera', 'asesor_historico'), 'mensajes', v_msgs);
end;
$$;

-- Frontera de rollback (la usa supabase/rollback/chatv2c1/99_down.sql). Cruzada = ya hay una sesión real
-- cerrada o una sesión con ordinal > 1: desde ahí, FORWARD-FIX ONLY (salvo decisión explícita del dueño).
create or replace function public._cc_chatv2c1_rollback_guard() returns void
  language plpgsql set search_path = public as
$$
begin
  if exists (select 1 from public.cc_conversation_sessions where ordinal > 1 or (estado = 'cerrada' and origen <> 'migracion'))
     and coalesce(current_setting('app.chatv2c1_rollback_forzado', true), '') <> 'on' then
    raise exception 'Chat V2-C1 rollback: ya hay sesiones reales (ordinal > 1 o cerradas). Frontera cruzada: FORWARD-FIX ONLY.';
  end if;
end;
$$;
revoke all on function public._cc_chatv2c1_rollback_guard() from public, anon, authenticated;

-- ── 8) Privilegios ───────────────────────────────────────────────────────────────────────────────────
revoke all on function public._cc_sesion_contiene(uuid, bigint), public._cc_sesion_mensaje(), public._cc_sesion_cerrar(uuid, text, text, uuid),
                       public._cc_sesion_rol(uuid, text, uuid, uuid), public.cc_ia_contexto(uuid, bigint, integer),
                       public.cc_sesiones_listar(uuid, text, text, uuid), public.cc_sesion_leer(uuid, text, text, uuid, bigint, integer) from public, anon, authenticated;
grant execute on function public.cc_ia_contexto(uuid, bigint, integer), public.cc_sesiones_listar(uuid, text, text, uuid),
                          public.cc_sesion_leer(uuid, text, text, uuid, bigint, integer) to service_role;

-- ── 9) Verificación posterior ────────────────────────────────────────────────────────────────────────
do $post$
declare n int;
begin
  select count(*) into n from public.cc_conversations c where exists (select 1 from public.cc_messages m where m.conversation_id = c.id)
     and (select count(*) from public.cc_conversation_sessions s where s.conversation_id = c.id) <> 1;
  if n > 0 then raise exception 'Chat V2-C1: % conversación(es) con mensajes sin exactamente una sesión de respaldo', n; end if;
  select count(*) into n from public.cc_conversations c join public.cc_conversation_sessions s on s.conversation_id = c.id
   where (c.estado = 'abierta') <> (s.estado = 'abierta');
  if n > 0 then raise exception 'Chat V2-C1: % sesión(es) con estado incoherente', n; end if;
  if (select count(*) from public.cc_conversation_sessions where estado = 'abierta' and closed_at is not null) > 0 then raise exception 'Chat V2-C1: closed_at inventado'; end if;
  if not exists (select 1 from pg_trigger where tgname = 'trg_ccm_sesion' and tgrelid = 'public.cc_messages'::regclass) then raise exception 'Chat V2-C1: falta el trigger de sesión'; end if;
end $post$;
