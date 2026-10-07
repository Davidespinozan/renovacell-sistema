-- ============================================================================
-- CHV2-A · (123) Handoff comercial V2 — autoridad backend: alertas, SLA en minutos hábiles, handler ≠ cartera
--
-- Qué resuelve (audit "Commercial Handoff V2 + Role Home"): el handoff CC-7 no generaba ninguna alerta real
-- para el vendedor ni escalamiento visible para Dirección. CC-7 sigue siendo LA máquina de estados; aquí
-- solo se DERIVA y se NOTIFICA:
--  · notifications (tabla existente, ya en Realtime) gana kind / conversation_id / event_key (idempotencia).
--  · _cc_notificar: emisión aislada (una falla NUNCA revierte carrito/handoff/ruteo; deja evento auditable).
--  · _cc_handler_asignar: ÚNICA mutación del handler de una solicitud (timestamp propio, auditoría append-only,
--    alerta al nuevo vendedor). La usan cc_asignar_asesor (Edge, compat), cc_solicitud_reasignar (Dirección,
--    motivo obligatorio) y cc_cartera_asignar (cuando la cartera cambia con una solicitud abierta).
--  · D-CHV2-01: reasignar la solicitud NO toca cc_cartera. D-CHV2-02: alerta inicial SOLO al vendedor asignado;
--    Dirección entra si no hay vendedor elegible o al escalar. D-CHV2-05: sin pool de vendedores.
--  · cc_atencion_config (aviso 3 / escalamiento 7 minutos HÁBILES, pausa fuera de horario), Dirección edita.
--  · _cc_minutos_habiles reutiliza el horario CC-7 (zona, semana, excepciones). Sin horario configurado:
--    estado explícito 'horario_sin_configurar' y CERO escalaciones fabricadas (fail-closed).
--  · _cc_atencion: estado derivado (ia, solicitado_sin_vendedor, asignado_esperando, aviso, escalado,
--    fuera_de_horario, horario_sin_configurar, activo, terminado, rechazado) expuesto en cc_cola_asesorias y
--    cc_ruteo_pendientes. cc_atencion_evaluar (pg_cron cada minuto) materializa aviso/escalación una sola vez.
--  · D-CHV2-06: la IA no cambia; sigue hasta human_active (_cc_ia_puede intacto).
-- Rollback: supabase/rollback/chv2a/99_down.sql
-- ============================================================================
do $pre$
begin
  if to_regprocedure('public._cc_rutear(uuid)') is null or to_regclass('public.cc_cartera') is null then raise exception 'CHV2-A: falta CC-7 (119)'; end if;
  if to_regprocedure('public.cc_leer_conversacion(uuid,text,text,uuid,bigint,integer)') is null then raise exception 'CHV2-A: falta 122'; end if;
  if to_regclass('public.notifications') is null or to_regprocedure('public._cc_append_only()') is null then raise exception 'CHV2-A: falta notifications/_cc_append_only'; end if;
end $pre$;

-- ── 1) notifications: tipo estructurado, referencia segura e identidad del evento (idempotencia) ──────
alter table public.notifications
  add column if not exists kind text,
  add column if not exists conversation_id uuid references public.cc_conversations(id) on delete set null,
  add column if not exists event_key text;
create unique index if not exists uq_notifications_event_key on public.notifications (event_key) where event_key is not null;
create index if not exists idx_notifications_conversation on public.notifications (conversation_id) where conversation_id is not null;

-- ── 2) Evento auditable cuando una notificación no pudo emitirse ───────────────────────────────────────
alter table public.cc_conversation_events drop constraint ck_ccce_tipo;
alter table public.cc_conversation_events add constraint ck_ccce_tipo check (tipo in ('conversation_opened', 'visitor_adopted', 'human_offered', 'human_requested', 'human_assigned', 'seller_unassigned', 'human_started', 'human_ended', 'ai_resumed', 'conversation_closed', 'conversation_reopened', 'human_handoff_requested', 'human_handoff_queued', 'human_handoff_rejected', 'notificacion_fallida'));

-- ── 3) Configuración de atención (umbrales en minutos HÁBILES) ─────────────────────────────────────────
create table public.cc_atencion_config (
  id smallint primary key default 1 constraint ck_cac_unica check (id = 1),
  aviso_min integer not null default 3 constraint ck_cac_aviso check (aviso_min between 0 and 1440),
  escalamiento_min integer not null default 7 constraint ck_cac_escalamiento check (escalamiento_min between 1 and 1440),
  pausar_fuera_horario boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id),
  constraint ck_cac_orden check (escalamiento_min > aviso_min)
);
insert into public.cc_atencion_config (id) values (1);
create table public.cc_atencion_config_hist (
  id bigserial primary key, aviso_min integer not null, escalamiento_min integer not null, pausar_fuera_horario boolean not null,
  actor_profile_id uuid, created_at timestamptz not null default now()
);
create trigger trg_cach_append_only before update or delete on public.cc_atencion_config_hist for each row execute function public._cc_append_only();
alter table public.cc_atencion_config enable row level security;
alter table public.cc_atencion_config_hist enable row level security;
revoke all on public.cc_atencion_config, public.cc_atencion_config_hist from public, anon, authenticated;

create or replace function public.cc_atencion_config_ver() returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare cfg record;
begin
  perform public._cc7_direccion();
  select * into cfg from public.cc_atencion_config where id = 1;
  return jsonb_build_object('aviso_min', cfg.aviso_min, 'escalamiento_min', cfg.escalamiento_min, 'pausar_fuera_horario', cfg.pausar_fuera_horario, 'updated_at', cfg.updated_at,
                            'horario', public._cc_horario_estado(now()));
end;
$$;

create or replace function public.cc_atencion_config_guardar(p_aviso integer, p_escalamiento integer, p_pausar boolean) returns jsonb
  language plpgsql security definer set search_path = public as
$$
begin
  perform public._cc7_direccion();
  if p_aviso is null or p_escalamiento is null or p_pausar is null then raise exception 'CONFIG_INVALIDA: aviso, escalamiento y pausa son obligatorios' using errcode = 'check_violation'; end if;
  if p_aviso < 0 or p_aviso > 1440 or p_escalamiento < 1 or p_escalamiento > 1440 then raise exception 'CONFIG_INVALIDA: minutos entre 0 y 1440' using errcode = 'check_violation'; end if;
  if p_escalamiento <= p_aviso then raise exception 'CONFIG_INVALIDA: el escalamiento debe ser mayor que el aviso' using errcode = 'check_violation'; end if;
  update public.cc_atencion_config set aviso_min = p_aviso, escalamiento_min = p_escalamiento, pausar_fuera_horario = p_pausar, updated_at = now(), updated_by = auth.uid() where id = 1;
  insert into public.cc_atencion_config_hist (aviso_min, escalamiento_min, pausar_fuera_horario, actor_profile_id) values (p_aviso, p_escalamiento, p_pausar, auth.uid());
  return public.cc_atencion_config_ver();
end;
$$;

-- ── 4) Minutos hábiles entre dos instantes con el horario CC-7 (zona, semana, excepciones) ────────────
-- NULL si no hay horario configurado (nunca se inventa). La aritmética es en hora local de la zona; los
-- tramos se cortan por día local (Mazatlán no cambia de horario desde 2022; aun así se convierte por zona).
create or replace function public._cc_minutos_habiles(p_desde timestamptz, p_hasta timestamptz) returns integer
  language plpgsql stable security definer set search_path = public as
$$
declare cfg record; ld timestamp; lh timestamp; dd date; ab time; ci time; ex record; s record; a timestamp; b timestamp; tot integer := 0; i integer := 0;
begin
  if p_desde is null or p_hasta is null or p_hasta <= p_desde then return 0; end if;
  select * into cfg from public.cc_horario_config where id = 1;
  if not found or not cfg.configurado then return null; end if;
  ld := p_desde at time zone cfg.zona; lh := p_hasta at time zone cfg.zona;
  dd := ld::date;
  while dd <= lh::date and i < 400 loop
    i := i + 1; ab := null; ci := null;
    select * into ex from public.cc_horario_excepciones where fecha = dd;
    if found then
      if ex.tipo = 'horario' then ab := ex.abre; ci := ex.cierra; end if;      -- 'cerrado': sin tramo
    else
      select * into s from public.cc_horario_semanal where dia = extract(isodow from dd)::int;
      if found and s.abierto then ab := s.abre; ci := s.cierra; end if;
    end if;
    if ab is not null and ci is not null and ci > ab then
      a := greatest(dd + ab, ld); b := least(dd + ci, lh);
      if b > a then tot := tot + floor(extract(epoch from (b - a)) / 60)::int; end if;
    end if;
    dd := dd + 1;
  end loop;
  return tot;
end;
$$;

-- ── 5) Nombres seguros para las alertas (nunca mensajes ni datos de contacto) ──────────────────────────
create or replace function public._cc_nombre_dueno(p_conv uuid) returns text
  language sql stable security definer set search_path = public as
$$ select case when c.profile_id is not null then coalesce((select coalesce(p.meta ->> 'name', p.full_name) from public.profiles p where p.id = c.profile_id), 'Doctor') else 'Visitante' end
     from public.cc_conversations c where c.id = p_conv $$;
create or replace function public._cc_nombre_perfil(p_profile uuid) returns text
  language sql stable security definer set search_path = public as
$$ select coalesce((select coalesce(p.meta ->> 'name', p.full_name) from public.profiles p where p.id = p_profile), 'Vendedor') $$;

-- ── 6) Emisión aislada e idempotente de notificaciones ─────────────────────────────────────────────────
-- Devuelve 'emitida' | 'duplicada' | 'fallida'. Una falla NO sube: la operación comercial canónica continúa y
-- queda el evento 'notificacion_fallida' (más un WARNING en el log) para detectarla.
create or replace function public._cc_notificar(p_kind text, p_conv uuid, p_user_ids uuid[], p_roles text[], p_body text, p_screen text, p_event_key text) returns text
  language plpgsql security definer set search_path = public as
$$
declare v_id uuid; v_state text; v_msg text;
begin
  begin
    if coalesce(current_setting('app.cc_notif_fallar', true), '') = 'on' then raise exception 'FALLO_INYECTADO: notificacion'; end if;   -- solo pruebas
    insert into public.notifications (body, roles, user_ids, screen, created_by, kind, conversation_id, event_key)
    values (left(p_body, 300), p_roles, p_user_ids, p_screen, auth.uid(), p_kind, p_conv, p_event_key)
    on conflict (event_key) where event_key is not null do nothing
    returning id into v_id;
    return case when v_id is null then 'duplicada' else 'emitida' end;
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate, v_msg = message_text;
    begin
      if p_conv is not null then
        perform public._cc_evento(p_conv, 'notificacion_fallida', 'system', null, null, jsonb_build_object('kind', p_kind, 'event_key', p_event_key, 'sqlstate', v_state, 'error', left(v_msg, 200)));
      end if;
    exception when others then null; end;
    raise warning 'CHV2-A: notificación % no emitida (%): %', p_kind, v_state, v_msg;
    return 'fallida';
  end;
end;
$$;

-- ── 7) Núcleo ÚNICO del handler de una solicitud ───────────────────────────────────────────────────────
-- Cambia SOLO cc_conversations.seller_profile_id (+ participantes, evento append-only, alerta). NUNCA toca
-- cc_cartera (D-CHV2-01). El nuevo handler empieza a esperar desde aquí: asesoria_asignada_at = now(); la hora
-- de la solicitud (asesoria_solicitada_at) se conserva. No silencia la IA ni activa la asesoría.
create or replace function public._cc_handler_asignar(p_conv uuid, p_seller uuid, p_actor_type text, p_actor uuid, p_motivo text, p_origen text) returns jsonb
  language plpgsql set search_path = public as
$$
declare c record; v_ts timestamptz := clock_timestamp();   -- el instante REAL de la asignación (no el inicio de la transacción)
begin
  select * into c from public.cc_conversations where id = p_conv for update;
  if not found then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if c.estado <> 'abierta' then raise exception 'CONVERSACION_CERRADA' using errcode = 'check_violation'; end if;
  if c.seller_profile_id is not distinct from p_seller then
    return jsonb_build_object('modo', c.modo, 'seller', c.seller_profile_id, 'idempotente', true, 'asignada_at', c.asesoria_asignada_at);
  end if;
  if p_seller is null then
    update public.cc_conversations set seller_profile_id = null, updated_at = now() where id = p_conv;
    update public.cc_participants set left_at = now() where conversation_id = p_conv and profile_id = c.seller_profile_id and rol = 'asesor';
    perform public._cc_evento(p_conv, 'seller_unassigned', p_actor_type, p_actor, null, jsonb_build_object('seller', c.seller_profile_id, 'motivo', coalesce(p_motivo, 'liberada'), 'origen', p_origen));
    if c.modo in ('human_assigned', 'human_active') then
      perform public._cc_cambiar_modo(p_conv, 'human_requested', 'human_requested', p_actor_type, p_actor, null, jsonb_build_object('motivo', 'liberada'));
      perform public._cc_sistema(p_conv, 'Tu conversación volvió a la cola de asesores.', 'sys:cola:' || c.ultimo_seq);
    end if;
  else
    if c.seller_profile_id is not null then
      update public.cc_participants set left_at = now() where conversation_id = p_conv and profile_id = c.seller_profile_id and rol = 'asesor';
      perform public._cc_evento(p_conv, 'seller_unassigned', p_actor_type, p_actor, null, jsonb_build_object('seller', c.seller_profile_id, 'motivo', 'reasignada', 'origen', p_origen));
    end if;
    update public.cc_conversations set seller_profile_id = p_seller, ruteo_motivo = null, updated_at = now() where id = p_conv;
    perform public._cc_participante(p_conv, 'seller', null, p_seller, 'asesor');
    if c.modo <> 'human_assigned' then
      perform public._cc_cambiar_modo(p_conv, 'human_assigned', 'human_assigned', p_actor_type, p_actor, null, jsonb_build_object('seller', p_seller, 'anterior', c.seller_profile_id, 'motivo', p_motivo, 'origen', p_origen));
    else
      perform public._cc_evento(p_conv, 'human_assigned', p_actor_type, p_actor, null, jsonb_build_object('seller', p_seller, 'anterior', c.seller_profile_id, 'motivo', coalesce(p_motivo, 'reasignada'), 'origen', p_origen));
    end if;
    -- Después del cambio de modo (que estampa now()): el handler NUEVO empieza a esperar en el instante real.
    update public.cc_conversations set asesoria_asignada_at = v_ts where id = p_conv;
    perform public._cc_notificar('handoff_asignado', p_conv, array[p_seller], null,
            'Solicitud de asesor: ' || public._cc_nombre_dueno(p_conv) || case when c.seller_profile_id is not null then ' (reasignada a ti)' else '' end, 'asesorias',
            'asignacion:' || p_conv::text || ':' || p_seller::text || ':' || extract(epoch from v_ts)::bigint::text);
  end if;
  select * into c from public.cc_conversations where id = p_conv;
  return jsonb_build_object('modo', c.modo, 'seller', c.seller_profile_id, 'idempotente', false, 'asignada_at', c.asesoria_asignada_at);
end;
$$;

-- ── 8) Entradas: Edge (compat) y Dirección (motivo obligatorio) ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cc_asignar_asesor(p_conv uuid, p_actor_profile uuid, p_seller uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c record; v_rol text;
begin
  v_rol := public._cc_perfil_activo(p_actor_profile);
  if v_rol is null then raise exception 'CUENTA_SUSPENDIDA'; end if;
  select * into c from public.cc_conversations where id = p_conv for update;
  if not found then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if c.estado <> 'abierta' then raise exception 'CONVERSACION_CERRADA' using errcode = 'check_violation'; end if;
  if p_seller is not null and not public._cc_puede_atender(p_seller) then raise exception 'ASESOR_INVALIDO: no puede atender conversaciones' using errcode = 'check_violation'; end if;
  if v_rol = 'admin' then
    null; -- Dirección asigna/reasigna/libera
  elsif public._cc_puede_atender(p_actor_profile) and p_seller = p_actor_profile and c.seller_profile_id = p_actor_profile then
    return jsonb_build_object('modo', c.modo, 'seller', c.seller_profile_id, 'idempotente', true);
  elsif public._cc_puede_atender(p_actor_profile) and c.seller_profile_id is not null and c.seller_profile_id <> p_actor_profile then
    raise exception 'YA_ASIGNADA' using errcode = 'unique_violation';
  else
    raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege';
  end if;
  -- CHV2-A · una sola autoridad de handler (timestamp, auditoría y alerta): _cc_handler_asignar.
  return public._cc_handler_asignar(p_conv, p_seller, case when v_rol = 'admin' then 'admin' else 'seller' end, p_actor_profile, null, case when v_rol = 'admin' then 'direccion' else 'vendedor' end);
end;
$function$;

create or replace function public.cc_solicitud_reasignar(p_conv uuid, p_vendedor uuid, p_motivo text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_motivo text := nullif(btrim(left(coalesce(p_motivo, ''), 200)), ''); c record; r jsonb;
begin
  perform public._cc7_direccion();
  if v_motivo is null then raise exception 'MOTIVO_REQUERIDO: reasignar una solicitud exige motivo' using errcode = 'check_violation'; end if;
  if p_vendedor is null then raise exception 'VENDEDOR_REQUERIDO: indica a quién pasa la solicitud' using errcode = 'check_violation'; end if;
  if not public._cc_vendedor_elegible(p_vendedor, false) then
    raise exception 'VENDEDOR_NO_ELEGIBLE: activo, de ventas y con "Atender conversaciones"' using errcode = 'check_violation';
  end if;
  select * into c from public.cc_conversations where id = p_conv for update;
  if not found then raise exception 'SOLICITUD_INEXISTENTE' using errcode = 'check_violation'; end if;
  if c.estado <> 'abierta' then raise exception 'CONVERSACION_CERRADA' using errcode = 'check_violation'; end if;
  if c.modo not in ('human_requested', 'human_assigned') then
    raise exception 'SOLICITUD_NO_REASIGNABLE: la solicitud está % (una asesoría activa se termina antes de reasignar)', c.modo using errcode = 'check_violation';
  end if;
  r := public._cc_handler_asignar(p_conv, p_vendedor, 'admin', auth.uid(), v_motivo, 'direccion');
  -- La cartera NO cambia por diseño (D-CHV2-01): se devuelve para que la UI lo muestre explícitamente.
  return r || jsonb_build_object('cartera_vendedor', (select k.seller_profile_id from public.cc_cartera k where k.profile_id = c.profile_id));
end;
$$;

-- ── 9) Ruteo y cartera: mismo comportamiento + alertas + handler único ─────────────────────────────────
CREATE OR REPLACE FUNCTION public._cc_rutear(p_conv uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare c record; s uuid; v_motivo text;
begin
  select * into c from public.cc_conversations where id = p_conv for update;
  if c.modo <> 'human_requested' then
    return jsonb_build_object('asignado', c.seller_profile_id is not null and c.modo in ('human_assigned', 'human_active'), 'sin_cambio', true);
  end if;
  if c.profile_id is null then
    -- Visitante: no hay cartera; solo un asesor que Dirección ya le haya puesto a ESTA conversación.
    if c.seller_profile_id is not null and public._cc_puede_atender(c.seller_profile_id) then s := c.seller_profile_id; else v_motivo := 'visitante'; end if;
  else
    s := public._cc_vendedor_de(c.profile_id);
    if s is null then v_motivo := 'sin_vendedor';
    elsif not public._cc_vendedor_elegible(s, false) then v_motivo := 'vendedor_no_elegible'; s := null;
    end if;
  end if;
  if v_motivo is null then
    if c.seller_profile_id is distinct from s then
      if c.seller_profile_id is not null then
        update public.cc_participants set left_at = now() where conversation_id = p_conv and profile_id = c.seller_profile_id and rol = 'asesor';
        perform public._cc_evento(p_conv, 'seller_unassigned', 'system', null, null, jsonb_build_object('seller', c.seller_profile_id, 'motivo', 'cartera'));
      end if;
      update public.cc_conversations set seller_profile_id = s, updated_at = now() where id = p_conv;
      perform public._cc_participante(p_conv, 'seller', null, s, 'asesor');
    end if;
    update public.cc_conversations set ruteo_motivo = null where id = p_conv;
    perform public._cc_cambiar_modo(p_conv, 'human_assigned', 'human_assigned', 'system', null, null, jsonb_build_object('seller', s, 'origen', case when c.profile_id is null then 'conversacion' else 'cartera' end));
    -- CHV2-A · alerta SOLO al vendedor asignado (D-CHV2-02). Idempotente por asignación; nunca revierte el ruteo.
    perform public._cc_notificar('handoff_asignado', p_conv, array[s], null, 'Solicitud de asesor: ' || public._cc_nombre_dueno(p_conv), 'asesorias',
            'asignacion:' || p_conv::text || ':' || s::text || ':' || extract(epoch from now())::bigint::text);
    return jsonb_build_object('asignado', true, 'seller', s);
  end if;
  -- Sin vendedor elegible: NUNCA se reasigna al azar. Se libera un asesor que ya no puede atender y se encola para Dirección.
  if c.seller_profile_id is not null then
    update public.cc_participants set left_at = now() where conversation_id = p_conv and profile_id = c.seller_profile_id and rol = 'asesor';
    perform public._cc_evento(p_conv, 'seller_unassigned', 'system', null, null, jsonb_build_object('seller', c.seller_profile_id, 'motivo', v_motivo));
  end if;
  update public.cc_conversations set seller_profile_id = null, ruteo_motivo = v_motivo, updated_at = now() where id = p_conv;
  -- CHV2-A · sin vendedor elegible → Dirección (una vez por solicitud; D-CHV2-05: no hay pool de vendedores).
  perform public._cc_notificar('handoff_sin_vendedor', p_conv, null, array['admin'], 'Solicitud de asesor sin vendedor: ' || public._cc_nombre_dueno(p_conv), 'av_atencion',
          'sin_vendedor:' || p_conv::text || ':' || coalesce(extract(epoch from c.asesoria_solicitada_at)::bigint::text, 'na'));
  return jsonb_build_object('asignado', false, 'motivo', v_motivo);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_cartera_asignar(p_cliente uuid, p_vendedor uuid, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_rol text; v_motivo text := nullif(btrim(left(coalesce(p_motivo, ''), 200)), ''); ant record; c record; conv jsonb;
begin
  perform public._cc7_direccion();
  select role_id into v_rol from public.profiles where id = p_cliente;
  if v_rol is distinct from 'doctor' then raise exception 'CLIENTE_INVALIDO: solo doctores tienen cartera' using errcode = 'check_violation'; end if;
  if p_vendedor is not null and not public._cc_vendedor_elegible(p_vendedor, true) then
    raise exception 'VENDEDOR_NO_ELEGIBLE: activo, de ventas, con "Atender conversaciones" y "Recibir clientes nuevos"' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtext('cc_dueno:' || p_cliente::text));
  select * into ant from public.cc_cartera where profile_id = p_cliente for update;
  if ant.seller_profile_id is not distinct from p_vendedor then
    return jsonb_build_object('cliente', p_cliente, 'vendedor', p_vendedor, 'idempotente', true);
  end if;
  if ant.profile_id is not null and v_motivo is null then raise exception 'MOTIVO_REQUERIDO: reasignar o quitar exige motivo' using errcode = 'check_violation'; end if;
  if p_vendedor is null then
    delete from public.cc_cartera where profile_id = p_cliente;
  else
    insert into public.cc_cartera (profile_id, seller_profile_id, asignado_at, asignado_por, motivo) values (p_cliente, p_vendedor, now(), auth.uid(), v_motivo)
    on conflict (profile_id) do update set seller_profile_id = excluded.seller_profile_id, asignado_at = now(), asignado_por = excluded.asignado_por, motivo = excluded.motivo;
  end if;
  insert into public.cc_cartera_historial (profile_id, seller_anterior, seller_nuevo, actor_profile_id, motivo) values (p_cliente, ant.seller_profile_id, p_vendedor, auth.uid(), v_motivo);

  -- Conversación abierta: se rutea al nuevo dueño de cartera SIN interrumpir una sesión humana en curso.
  select * into c from public.cc_conversations where profile_id = p_cliente and estado = 'abierta' for update;
  if found then
    if c.modo = 'human_requested' then
      conv := public._cc_rutear(c.id);
    elsif c.modo = 'human_assigned' and c.seller_profile_id is distinct from p_vendedor then
      if c.seller_profile_id is not null and p_vendedor is null then
        update public.cc_participants set left_at = now() where conversation_id = c.id and profile_id = c.seller_profile_id and rol = 'asesor';
        perform public._cc_evento(c.id, 'seller_unassigned', 'admin', auth.uid(), null, jsonb_build_object('seller', c.seller_profile_id, 'motivo', 'cartera'));
      end if;
      if p_vendedor is not null then
        -- CHV2-A · handler nuevo: timestamp propio, auditoría y alerta al vendedor (una sola autoridad).
        perform public._cc_handler_asignar(c.id, p_vendedor, 'admin', auth.uid(), 'reasignada', 'cartera');
      else
        update public.cc_conversations set seller_profile_id = null, ruteo_motivo = 'sin_vendedor', updated_at = now() where id = c.id;
        perform public._cc_cambiar_modo(c.id, 'human_requested', 'human_requested', 'admin', auth.uid(), null, jsonb_build_object('motivo', 'cartera_retirada'));
        perform public._cc_notificar('handoff_sin_vendedor', c.id, null, array['admin'], 'Solicitud de asesor sin vendedor: ' || public._cc_nombre_dueno(c.id), 'av_atencion',
                'sin_vendedor:' || c.id::text || ':' || coalesce(extract(epoch from c.asesoria_solicitada_at)::bigint::text, 'na'));
      end if;
    end if;
    select * into c from public.cc_conversations where id = c.id;
  end if;
  return jsonb_build_object('cliente', p_cliente, 'vendedor', p_vendedor, 'anterior', ant.seller_profile_id, 'idempotente', false,
                            'conversacion', case when c.id is null then null else jsonb_build_object('id', c.id, 'modo', c.modo, 'asignada', c.seller_profile_id is not null) end);
end;
$function$;

-- ── 10) Estado derivado de atención (sin persistir estados nuevos) ─────────────────────────────────────
create or replace function public._cc_atencion(p_conv uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare c record; cfg record; hor jsonb; v_conf boolean; v_abierto boolean; v_hand text;
        esp_total integer; esp_total_hab integer; esp_handler integer; esp_handler_hab integer; reloj integer; estado text;
begin
  select * into c from public.cc_conversations where id = p_conv;
  if not found then return null; end if;
  select * into cfg from public.cc_atencion_config where id = 1;
  hor := public._cc_horario_estado(now()); v_conf := coalesce((hor ->> 'configurado')::boolean, false); v_abierto := coalesce((hor ->> 'abierto')::boolean, false);
  select handoff_estado into v_hand from public.cc_carts where id = c.handoff_cart_id;
  esp_total := case when c.asesoria_solicitada_at is null then null else floor(extract(epoch from (now() - c.asesoria_solicitada_at)) / 60)::int end;
  esp_handler := case when c.asesoria_asignada_at is null then null else floor(extract(epoch from (now() - c.asesoria_asignada_at)) / 60)::int end;
  if v_conf then
    esp_total_hab := public._cc_minutos_habiles(c.asesoria_solicitada_at, now());
    esp_handler_hab := public._cc_minutos_habiles(c.asesoria_asignada_at, now());
  end if;
  reloj := case when cfg.pausar_fuera_horario then esp_handler_hab else esp_handler end;   -- reloj del SLA: espera del handler ACTUAL
  estado := case
    when c.estado = 'cerrada' then 'cerrada'
    when c.modo = 'human_active' then 'activo'
    when c.modo = 'human_ended' then 'terminado'
    when c.modo in ('ai_active', 'human_offered') then case when v_hand = 'rechazado' then 'rechazado' else 'ia' end
    when c.modo = 'human_requested' then 'solicitado_sin_vendedor'
    when cfg.pausar_fuera_horario and not v_conf then 'horario_sin_configurar'          -- fail-closed: nada de escalaciones inventadas
    when reloj >= cfg.escalamiento_min then 'escalado'
    when reloj >= cfg.aviso_min then 'aviso'
    when v_conf and not v_abierto then 'fuera_de_horario'
    else 'asignado_esperando' end;
  return jsonb_build_object('estado', estado, 'modo', c.modo, 'handoff_estado', v_hand, 'handler_id', c.seller_profile_id, 'ruteo_motivo', c.ruteo_motivo,
    'solicitado_at', c.asesoria_solicitada_at, 'handler_asignado_at', c.asesoria_asignada_at, 'iniciado_at', c.asesoria_iniciada_at, 'terminado_at', c.asesoria_terminada_at,
    'espera_total_min', esp_total, 'espera_total_habil_min', esp_total_hab, 'espera_handler_min', esp_handler, 'espera_handler_habil_min', esp_handler_hab, 'reloj_sla_min', reloj,
    'horario_configurado', v_conf, 'en_horario', case when v_conf then v_abierto end, 'pausa_fuera_horario', cfg.pausar_fuera_horario,
    'umbral_aviso_min', cfg.aviso_min, 'umbral_escalamiento_min', cfg.escalamiento_min, 'ia_activa', public._cc_ia_puede(c.modo));
end;
$$;

-- ── 11) Lecturas: la cola del vendedor y los pendientes de Dirección exponen `atencion` ───────────────
drop function public.cc_cola_asesorias();
CREATE FUNCTION public.cc_cola_asesorias()
 RETURNS TABLE(conversation_id uuid, modo text, seller_profile_id uuid, asesoria_solicitada_at timestamp with time zone, last_message_at timestamp with time zone, es_mia boolean, sin_leer bigint, dueno text, handoff_origen text, fuera_horario boolean, ruteo_motivo text, cart_id uuid, n_items integer, edad_min integer, iniciada boolean, atencion jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.id, c.modo, c.seller_profile_id, c.asesoria_solicitada_at, c.last_message_at,
         c.seller_profile_id = auth.uid() as es_mia,
         greatest(c.ultimo_seq - coalesce((select p.last_read_seq from public.cc_participants p where p.conversation_id = c.id and p.profile_id = auth.uid()), 0), 0) as sin_leer,
         case when c.profile_id is not null then coalesce((select coalesce(pr.meta ->> 'name', pr.full_name) from public.profiles pr where pr.id = c.profile_id), 'Doctor') else 'Visitante' end as dueno,
         c.handoff_origen, c.handoff_fuera_horario, c.ruteo_motivo,
         k.id, (select count(*)::int from public.cc_cart_items i where i.cart_id = k.id),
         case when c.asesoria_solicitada_at is null then null else (extract(epoch from (now() - c.asesoria_solicitada_at)) / 60)::int end,
         c.modo = 'human_active',
         public._cc_atencion(c.id)
    from public.cc_conversations c
    left join lateral (select kk.id from public.cc_carts kk where kk.estado = 'active'
                         and (case when c.profile_id is not null then kk.profile_id = c.profile_id else kk.visitor_id = c.visitor_id and kk.profile_id is null end) limit 1) k on true
   where c.estado = 'abierta' and c.modo in ('human_requested', 'human_assigned', 'human_active', 'human_ended')
     and public._cc_puede_atender(auth.uid())
     and (public.auth_role() = 'admin' or c.seller_profile_id = auth.uid())
   order by case when c.seller_profile_id = auth.uid() then 0 else 1 end, c.asesoria_solicitada_at nulls last
$function$;

revoke all on function public.cc_cola_asesorias() from public, anon;
grant execute on function public.cc_cola_asesorias() to authenticated, service_role;
CREATE OR REPLACE FUNCTION public.cc_ruteo_pendientes()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public._cc7_direccion();
  return jsonb_build_object(
    'resumen', public.cc_ruteo_resumen(),
    'conversaciones', coalesce((select jsonb_agg(x order by (x ->> 'solicitado_at') nulls last) from (
      select jsonb_build_object('conversation_id', c.id, 'dueno', case when c.profile_id is not null then 'doctor' else 'visitante' end,
             'profile_id', c.profile_id, 'nombre', case when c.profile_id is not null then (select coalesce(p.full_name, p.meta ->> 'name') from public.profiles p where p.id = c.profile_id) else 'Visitante' end,
             'modo', c.modo, 'seller_id', c.seller_profile_id, 'seller_nombre', (select coalesce(s.meta ->> 'name', s.full_name) from public.profiles s where s.id = c.seller_profile_id),
             'ruteo_motivo', c.ruteo_motivo, 'origen', c.handoff_origen, 'fuera_horario', c.handoff_fuera_horario, 'solicitado_at', c.asesoria_solicitada_at,
             'edad_min', case when c.asesoria_solicitada_at is null then null else (extract(epoch from (now() - c.asesoria_solicitada_at)) / 60)::int end,
             'iniciada', c.modo = 'human_active', 'cart_id', c.handoff_cart_id,
             'n_items', (select count(*) from public.cc_cart_items i where i.cart_id = c.handoff_cart_id),
             'atencion', public._cc_atencion(c.id)) as x
        from public.cc_conversations c
       where c.estado = 'abierta' and c.modo in ('human_requested', 'human_assigned', 'human_active')
       limit 300) s), '[]'::jsonb),
    'carritos_pendientes', coalesce((select jsonb_agg(jsonb_build_object('cart_id', k.id, 'profile_id', k.profile_id, 'visitante', k.profile_id is null, 'desde', k.handoff_at, 'error', k.handoff_error,
             'n_items', (select count(*) from public.cc_cart_items i where i.cart_id = k.id)))
        from public.cc_carts k where k.estado = 'active' and k.handoff_estado = 'pendiente'), '[]'::jsonb));
end;
$function$;

-- ── 12) Evaluador: materializa aviso (vendedor) y escalación (Dirección) UNA vez por asignación ────────
-- Lo corre pg_cron cada minuto; Dirección/servicio pueden invocarlo. Sin horario configurado (y con pausa
-- activa) no evalúa nada: fail-closed. Nunca reasigna, nunca cambia modo, nunca toca la IA.
create or replace function public.cc_atencion_evaluar() returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare cfg record; hor jsonb; v_conf boolean; r record; n int := 0; n_aviso int := 0; n_esc int := 0; reloj integer;
begin
  if coalesce(current_setting('request.jwt.claims', true), '') <> '' and not (public._cc_es_admin() or public._cc_es_service()) then
    raise exception 'NO_AUTORIZADO: solo Dirección' using errcode = 'insufficient_privilege';
  end if;
  select * into cfg from public.cc_atencion_config where id = 1;
  hor := public._cc_horario_estado(now()); v_conf := coalesce((hor ->> 'configurado')::boolean, false);
  if cfg.pausar_fuera_horario and not v_conf then return jsonb_build_object('evaluadas', 0, 'avisos', 0, 'escalaciones', 0, 'omitido', 'horario_sin_configurar'); end if;
  for r in select c.id, c.seller_profile_id, c.asesoria_asignada_at from public.cc_conversations c
            where c.estado = 'abierta' and c.modo = 'human_assigned' and c.seller_profile_id is not null and c.asesoria_asignada_at is not null loop
    n := n + 1;
    reloj := case when cfg.pausar_fuera_horario then public._cc_minutos_habiles(r.asesoria_asignada_at, now()) else floor(extract(epoch from (now() - r.asesoria_asignada_at)) / 60)::int end;
    if reloj is null then continue; end if;
    if reloj >= cfg.escalamiento_min then
      if public._cc_notificar('handoff_escalado', r.id, null, array['admin'],
           format('Solicitud sin atender %s min hábiles con %s: %s', reloj, public._cc_nombre_perfil(r.seller_profile_id), public._cc_nombre_dueno(r.id)), 'av_atencion',
           'escalacion:' || r.id::text || ':' || extract(epoch from r.asesoria_asignada_at)::bigint::text) = 'emitida' then n_esc := n_esc + 1; end if;
    elsif reloj >= cfg.aviso_min then   -- el recordatorio al vendedor solo ANTES de escalar: escalada, decide Dirección (sin ruido)
      if public._cc_notificar('handoff_aviso', r.id, array[r.seller_profile_id], null,
           format('Recordatorio: %s sigue esperando asesor (%s min)', public._cc_nombre_dueno(r.id), reloj), 'asesorias',
           'aviso:' || r.id::text || ':' || extract(epoch from r.asesoria_asignada_at)::bigint::text) = 'emitida' then n_aviso := n_aviso + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('evaluadas', n, 'avisos', n_aviso, 'escalaciones', n_esc);
end;
$$;
do $$
begin
  if to_regproc('cron.schedule') is null then raise notice 'pg_cron no disponible: agendar "select public.cc_atencion_evaluar()" aparte.'; return; end if;
  if exists (select 1 from cron.job where jobname = 'renovacell-atencion-comercial') then perform cron.unschedule('renovacell-atencion-comercial'); end if;
  perform cron.schedule('renovacell-atencion-comercial', '* * * * *', 'select public.cc_atencion_evaluar();');
exception when others then
  raise notice 'pg_cron no disponible al agendar (%).', sqlerrm;
end $$;

-- ── 13) Privilegios ───────────────────────────────────────────────────────────────────────────────────
revoke all on function public._cc_minutos_habiles(timestamptz, timestamptz), public._cc_nombre_dueno(uuid), public._cc_nombre_perfil(uuid),
  public._cc_notificar(text, uuid, uuid[], text[], text, text, text), public._cc_handler_asignar(uuid, uuid, text, uuid, text, text), public._cc_atencion(uuid)
  from public, anon, authenticated;
revoke all on function public.cc_solicitud_reasignar(uuid, uuid, text), public.cc_atencion_config_ver(), public.cc_atencion_config_guardar(integer, integer, boolean), public.cc_atencion_evaluar() from public, anon;
grant execute on function public.cc_solicitud_reasignar(uuid, uuid, text), public.cc_atencion_config_ver(), public.cc_atencion_config_guardar(integer, integer, boolean), public.cc_atencion_evaluar() to authenticated, service_role;
revoke all on function public.cc_asignar_asesor(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.cc_asignar_asesor(uuid, uuid, uuid) to service_role;

-- ── 14) Verificación ──────────────────────────────────────────────────────────────────────────────────
do $post$
begin
  if has_function_privilege('anon', 'public.cc_solicitud_reasignar(uuid,uuid,text)', 'EXECUTE') then raise exception 'CHV2-A: anon no reasigna'; end if;
  if has_function_privilege('authenticated', 'public._cc_notificar(text,uuid,uuid[],text[],text,text,text)', 'EXECUTE') then raise exception 'CHV2-A: _cc_notificar es interna'; end if;
  if has_function_privilege('authenticated', 'public._cc_handler_asignar(uuid,uuid,text,uuid,text,text)', 'EXECUTE') then raise exception 'CHV2-A: _cc_handler_asignar es interna'; end if;
  if (select count(*) from public.cc_atencion_config) <> 1 then raise exception 'CHV2-A: configuración ausente'; end if;
  if not public._cc_ia_puede('human_assigned') or public._cc_ia_puede('human_active') then raise exception 'CHV2-A: la política de IA cambió'; end if;
  if (select count(*) from information_schema.role_table_grants where table_schema = 'public' and table_name in ('cc_atencion_config', 'cc_atencion_config_hist') and grantee in ('anon', 'authenticated')) <> 0 then raise exception 'CHV2-A: tablas de configuración expuestas'; end if;
end $post$;
