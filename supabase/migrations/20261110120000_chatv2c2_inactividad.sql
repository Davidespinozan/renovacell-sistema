-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- Chat V2-C2 · CIERRE POR INACTIVIDAD (migración 127). INACTIVIDAD CIERRA SESIONES, NO CONVERSACIONES.
--   C2-A · Autoridad de actividad: last_activity_at solo lo renuevan mensajes de personas/IA (doctor,
--          visitor, seller, admin, ai) y los actos explícitos representados por sistema: solicitud de asesor
--          del doctor (sys:solicitud) e inicio de asesoría (sys:inicio). El resto de sys:* (handoff, cola,
--          fin, ia, ia_no_disponible, inactividad) NO renueva. Representación canónica: client_message_id
--          sys:<tipo>:… que fija el servidor (es la llave de idempotencia de cada aviso; ya la usa C1).
--   C2-B · Motor: cc_sesiones_cerrar_inactivas() (solo servicio/cron). Candidatas por idx_ccs_abiertas_actividad,
--          lotes de 200, bloqueo de la conversación FOR UPDATE SKIP LOCKED, relectura y recálculo bajo bloqueo,
--          cierre por la autoridad canónica de C1 (_cc_sesion_cerrar_con).
--          · ai_active / human_offered → cierre SILENCIOSO a sesion_ia_min.
--          · human_active → aviso al asesor a (sesion_humana_min − sesion_aviso_previo_min); a sesion_humana_min:
--            mensaje "Tu asesoría terminó por inactividad…" (no renueva actividad), human_ended, cierre y
--            liberación del estado operativo (modo ai_active). Cartera intacta.
--          · human_requested / human_assigned → a solicitud_expira_min la solicitud expira: cierre
--            ('solicitud_expirada'), liberación y UNA notificación a Dirección. No sustituye el SLA 3/7 de CHV2-A.
--   C2-G · Configuración en cc_atencion_config: NULL = DESACTIVADO. Esta migración NO activa nada.
--   Cron propio renovacell-sesiones-inactivas cada 5 min (tiempo de reloj; independiente del horario).
--   Vista previa de solo lectura: cc_sesiones_inactivas_preview(...) (Dirección/servicio).
-- No toca: conversaciones, mensajes, eventos, cartera, carrito, economía, inventario, cc_terminar_asesoria.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$
begin
  if to_regclass('public.cc_conversation_sessions') is null or to_regprocedure('public._cc_sesion_cerrar(uuid,text,text,uuid)') is null then
    raise exception 'Chat V2-C2: requiere Chat V2-C1 (125)';
  end if;
  if to_regprocedure('public._cc_notificar(text,uuid,uuid[],text[],text,text,text)') is null or to_regclass('public.cc_atencion_config') is null then
    raise exception 'Chat V2-C2: requiere CHV2-A (123)';
  end if;
end $pre$;

-- ── 1) Configuración: NULL = desactivado ─────────────────────────────────────────────────────────────
alter table public.cc_atencion_config
  add column sesion_ia_min integer constraint ck_cac_ses_ia check (sesion_ia_min is null or sesion_ia_min between 1 and 10080),
  add column sesion_humana_min integer constraint ck_cac_ses_humana check (sesion_humana_min is null or sesion_humana_min between 1 and 10080),
  add column sesion_aviso_previo_min integer constraint ck_cac_ses_aviso check (sesion_aviso_previo_min is null or (sesion_aviso_previo_min >= 1 and sesion_humana_min is not null and sesion_aviso_previo_min < sesion_humana_min)),
  add column solicitud_expira_min integer constraint ck_cac_ses_solicitud check (solicitud_expira_min is null or solicitud_expira_min between 1 and 10080);
alter table public.cc_atencion_config_hist
  add column sesion_ia_min integer, add column sesion_humana_min integer, add column sesion_aviso_previo_min integer, add column solicitud_expira_min integer;

alter table public.cc_conversation_sessions drop constraint ck_ccs_motivo;
alter table public.cc_conversation_sessions add constraint ck_ccs_motivo check (close_reason is null or close_reason in
  ('asesor_finalizo', 'direccion_finalizo', 'inactividad', 'conversacion_cerrada', 'consolidada', 'solicitud_expirada'));

-- ── 2) C2-A · ¿este mensaje renueva la actividad de la sesión? ───────────────────────────────────────
create or replace function public._cc_mensaje_renueva(p_actor text, p_client_id text) returns boolean
  language sql immutable set search_path = public as
$$ select p_actor in ('doctor', 'visitor', 'seller', 'admin', 'ai')
       or (p_actor = 'system' and (coalesce(p_client_id, '') like 'sys:solicitud:%' or coalesce(p_client_id, '') like 'sys:inicio:%')) $$;

create or replace function public._cc_sesion_mensaje() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare v_id uuid; v_ord int; v_origen text;
begin
  -- Hay sesión abierta: solo la actividad conversacional real la renueva (Chat V2-C2).
  if exists (select 1 from public.cc_conversation_sessions where conversation_id = new.conversation_id and estado = 'abierta') then
    if public._cc_mensaje_renueva(new.actor_type, new.client_message_id) then
      update public.cc_conversation_sessions set last_activity_at = new.created_at where conversation_id = new.conversation_id and estado = 'abierta';
    end if;
    return null;
  end if;
  -- Sin sesión abierta: el primer mensaje (de cualquier tipo) la abre (Chat V2-C1).
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

-- ── 3) Autoridad canónica de cierre (C1) con detalle de auditoría opcional ───────────────────────────
-- Núcleo ÚNICO. _cc_sesion_cerrar (4 args, usado por C1) queda como envoltura con detalle vacío: misma semántica.
create or replace function public._cc_sesion_cerrar_con(p_conv uuid, p_motivo text, p_actor_type text, p_actor uuid, p_detalle jsonb) returns uuid
  language plpgsql set search_path = public as
$$
declare s record; c record;
begin
  select * into s from public.cc_conversation_sessions where conversation_id = p_conv and estado = 'abierta' for update;
  if not found then return null; end if;
  select * into c from public.cc_conversations where id = p_conv;
  insert into public.cc_conversation_events (conversation_id, tipo, actor_type, actor_profile_id, detalle, session_id)
  values (p_conv, 'session_closed', p_actor_type, p_actor,
          coalesce(p_detalle, '{}'::jsonb) || jsonb_build_object('ordinal', s.ordinal, 'motivo', p_motivo, 'first_seq', s.first_seq, 'last_seq', c.ultimo_seq, 'modo', c.modo), s.id);
  update public.cc_conversation_sessions
     set estado = 'cerrada', last_seq = c.ultimo_seq, closed_at = now(), close_reason = p_motivo, closed_by_actor_type = p_actor_type, closed_by_profile_id = p_actor,
         handoff_origen = coalesce(c.handoff_origen, handoff_origen), handoff_cart_id = coalesce(c.handoff_cart_id, handoff_cart_id),
         asesoria_solicitada_at = coalesce(c.asesoria_solicitada_at, asesoria_solicitada_at), asesoria_asignada_at = coalesce(c.asesoria_asignada_at, asesoria_asignada_at),
         asesoria_iniciada_at = coalesce(c.asesoria_iniciada_at, asesoria_iniciada_at)
   where id = s.id;
  return s.id;
end;
$$;
create or replace function public._cc_sesion_cerrar(p_conv uuid, p_motivo text, p_actor_type text, p_actor uuid) returns uuid
  language sql set search_path = public as
$$ select public._cc_sesion_cerrar_con(p_conv, p_motivo, p_actor_type, p_actor, '{}'::jsonb) $$;

-- Libera el estado operativo tras cerrar (mismo efecto que cc_terminar_asesoria, que no se modifica).
create or replace function public._cc_atencion_liberar(p_conv uuid) returns void
  language sql set search_path = public as
$$
  update public.cc_participants set left_at = now() where conversation_id = p_conv and rol = 'asesor' and left_at is null;
  update public.cc_conversations
     set modo = 'ai_active', seller_profile_id = null, ruteo_motivo = null, handoff_origen = null, handoff_cart_id = null, handoff_fuera_horario = null,
         asesoria_solicitada_at = null, asesoria_asignada_at = null, asesoria_iniciada_at = null, asesoria_terminada_at = null, updated_at = now()
   where id = p_conv;
$$;

-- ── 4) C2-B · Motor de cierre por inactividad ────────────────────────────────────────────────────────
create or replace function public.cc_sesiones_cerrar_inactivas(p_limite integer default 200) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare cfg record; v_min int; r record; c record; s record; v_inact int; v_aviso_en int;
        n int := 0; n_ia int := 0; n_hum int := 0; n_sol int := 0; n_aviso int := 0; n_salto int := 0; v_det jsonb;
begin
  -- Solo el cron (sin claims) o el servicio.
  if coalesce(current_setting('request.jwt.claims', true), '') <> '' and not public._cc_es_service() then
    raise exception 'NO_AUTORIZADO: solo el servidor' using errcode = 'insufficient_privilege';
  end if;
  select * into cfg from public.cc_atencion_config where id = 1;
  v_min := least(cfg.sesion_ia_min, cfg.sesion_humana_min - coalesce(cfg.sesion_aviso_previo_min, 0), cfg.solicitud_expira_min);
  if v_min is null then return jsonb_build_object('omitido', 'desactivado'); end if;   -- NULL = DESACTIVADO
  for r in select ss.id, ss.conversation_id from public.cc_conversation_sessions ss
            where ss.estado = 'abierta' and ss.last_activity_at <= now() - make_interval(mins => v_min)
            order by ss.last_activity_at limit least(greatest(coalesce(p_limite, 200), 1), 1000) loop
    n := n + 1;
    -- Bloqueo de la autoridad (la conversación, como todos los caminos de escritura). Ocupada = alguien actúa: siguiente corrida.
    select * into c from public.cc_conversations where id = r.conversation_id for update skip locked;
    if not found then n_salto := n_salto + 1; continue; end if;
    -- Relectura bajo bloqueo: la MISMA sesión sigue abierta y sigue vencida para el estado ACTUAL.
    select * into s from public.cc_conversation_sessions where id = r.id and estado = 'abierta' for update;
    if not found then continue; end if;
    v_inact := floor(extract(epoch from (now() - s.last_activity_at)) / 60)::int;
    v_det := jsonb_build_object('modo_al_cerrar', c.modo, 'inactiva_desde', s.last_activity_at, 'inactivo_min', v_inact);

    if c.modo in ('ai_active', 'human_offered') then
      if cfg.sesion_ia_min is not null and v_inact >= cfg.sesion_ia_min then
        perform public._cc_sesion_cerrar_con(c.id, 'inactividad', 'system', null, v_det || jsonb_build_object('umbral_min', cfg.sesion_ia_min));   -- silencioso
        n_ia := n_ia + 1;
      end if;

    elsif c.modo = 'human_active' then
      if cfg.sesion_humana_min is not null and v_inact >= cfg.sesion_humana_min then
        -- El aviso pertenece a la sesión que cierra y NO renueva la actividad (C2-A).
        perform public._cc_sistema(c.id, 'Tu asesoría terminó por inactividad. Puedes escribir cuando quieras.', 'sys:inactividad:' || c.ultimo_seq);
        perform public._cc_cambiar_modo(c.id, 'human_ended', 'human_ended', 'system', null, null, jsonb_build_object('motivo', 'inactividad'));
        perform public._cc_sesion_cerrar_con(c.id, 'inactividad', 'system', null, v_det || jsonb_build_object('umbral_min', cfg.sesion_humana_min));
        perform public._cc_atencion_liberar(c.id);
        n_hum := n_hum + 1;
      elsif cfg.sesion_humana_min is not null and cfg.sesion_aviso_previo_min is not null and c.seller_profile_id is not null then
        v_aviso_en := cfg.sesion_humana_min - cfg.sesion_aviso_previo_min;
        if v_inact >= v_aviso_en then
          -- Llave por (sesión, last_activity_at): actividad nueva = ciclo nuevo; el aviso viejo no cierra nada.
          if public._cc_notificar('sesion_por_cerrar', c.id, array[c.seller_profile_id], null,
               format('La asesoría con %s se cerrará por inactividad en %s min si no hay actividad.', public._cc_nombre_dueno(c.id), cfg.sesion_aviso_previo_min), 'asesorias',
               'cierre_aviso:' || s.id::text || ':' || floor(extract(epoch from s.last_activity_at))::bigint::text) = 'emitida' then n_aviso := n_aviso + 1; end if;
        end if;
      end if;

    elsif c.modo in ('human_requested', 'human_assigned') then
      if cfg.solicitud_expira_min is not null and v_inact >= cfg.solicitud_expira_min then
        perform public._cc_sesion_cerrar_con(c.id, 'solicitud_expirada', 'system', null, v_det || jsonb_build_object('umbral_min', cfg.solicitud_expira_min));
        perform public._cc_atencion_liberar(c.id);
        perform public._cc_notificar('solicitud_expirada', c.id, null, array['admin'],
          format('Solicitud de asesor expiró sin atenderse (%s h sin actividad): %s', round(v_inact / 60.0, 1), public._cc_nombre_dueno(c.id)), 'av_atencion',
          'solicitud_expirada:' || s.id::text);
        n_sol := n_sol + 1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('evaluadas', n, 'cerradas_ia', n_ia, 'cerradas_humanas', n_hum, 'solicitudes_expiradas', n_sol, 'avisos', n_aviso, 'saltadas_ocupadas', n_salto);
end;
$$;

-- ── 5) Vista previa de SOLO LECTURA (Dirección/servicio). Parámetros opcionales simulan umbrales. ────
create or replace function public.cc_sesiones_inactivas_preview(p_ia integer default null, p_humana integer default null, p_aviso integer default null, p_solicitud integer default null)
  returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare cfg record; v_ia int; v_hum int; v_av int; v_sol int;
begin
  perform public._cc7_direccion();
  select * into cfg from public.cc_atencion_config where id = 1;
  v_ia := coalesce(p_ia, cfg.sesion_ia_min); v_hum := coalesce(p_humana, cfg.sesion_humana_min);
  v_av := coalesce(p_aviso, cfg.sesion_aviso_previo_min); v_sol := coalesce(p_solicitud, cfg.solicitud_expira_min);
  return jsonb_build_object(
    'umbrales', jsonb_build_object('ia_min', v_ia, 'humana_min', v_hum, 'aviso_previo_min', v_av, 'solicitud_min', v_sol,
                                   'simulado', p_ia is not null or p_humana is not null or p_aviso is not null or p_solicitud is not null,
                                   'configurado', jsonb_build_object('ia_min', cfg.sesion_ia_min, 'humana_min', cfg.sesion_humana_min, 'aviso_previo_min', cfg.sesion_aviso_previo_min, 'solicitud_min', cfg.solicitud_expira_min)),
    'sesiones', coalesce((select jsonb_agg(x order by x ->> 'inactivo_min' desc) from (
      select jsonb_build_object('session_id', s.id, 'conversation_id', s.conversation_id, 'ordinal', s.ordinal, 'dueno', case when c.profile_id is null then 'visitante' else 'doctor' end,
               'modo', c.modo, 'last_activity_at', s.last_activity_at, 'inactivo_min', a.inact,
               'umbral_min', case when c.modo in ('ai_active', 'human_offered') then v_ia when c.modo = 'human_active' then v_hum when c.modo in ('human_requested', 'human_assigned') then v_sol end,
               'accion', case
                  when c.modo in ('ai_active', 'human_offered') and v_ia is not null and a.inact >= v_ia then 'cerrar_ia_silencioso'
                  when c.modo = 'human_active' and v_hum is not null and a.inact >= v_hum then 'cerrar_humana'
                  when c.modo = 'human_active' and v_hum is not null and v_av is not null and c.seller_profile_id is not null and a.inact >= v_hum - v_av then 'avisar_asesor'
                  when c.modo in ('human_requested', 'human_assigned') and v_sol is not null and a.inact >= v_sol then 'expirar_solicitud'
                  else 'ninguna' end,
               'aviso_ya_emitido', exists (select 1 from public.notifications nn where nn.event_key = 'cierre_aviso:' || s.id::text || ':' || floor(extract(epoch from s.last_activity_at))::bigint::text)) as x
        from public.cc_conversation_sessions s
        join public.cc_conversations c on c.id = s.conversation_id
        cross join lateral (select floor(extract(epoch from (now() - s.last_activity_at)) / 60)::int as inact) a
       where s.estado = 'abierta') q), '[]'::jsonb));
end;
$$;

-- ── 6) Configuración (Dirección): ver + guardar con historial ────────────────────────────────────────
create or replace function public.cc_atencion_config_ver() returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare cfg record;
begin
  perform public._cc7_direccion();
  select * into cfg from public.cc_atencion_config where id = 1;
  return jsonb_build_object('aviso_min', cfg.aviso_min, 'escalamiento_min', cfg.escalamiento_min, 'pausar_fuera_horario', cfg.pausar_fuera_horario, 'updated_at', cfg.updated_at,
                            'horario', public._cc_horario_estado(now()),
                            -- Chat V2-C2 · ciclo de vida de sesiones (NULL = desactivado; tiempo de reloj)
                            'sesiones', jsonb_build_object('ia_min', cfg.sesion_ia_min, 'humana_min', cfg.sesion_humana_min, 'aviso_previo_min', cfg.sesion_aviso_previo_min, 'solicitud_min', cfg.solicitud_expira_min));
end;
$$;

create or replace function public.cc_sesiones_config_guardar(p_ia integer, p_humana integer, p_aviso integer, p_solicitud integer) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare cfg record;
begin
  perform public._cc7_direccion();
  if p_aviso is not null and (p_humana is null or p_aviso >= p_humana) then
    raise exception 'CONFIG_INVALIDA: el aviso previo debe ser menor que el cierre humano' using errcode = 'check_violation';
  end if;
  update public.cc_atencion_config set sesion_ia_min = p_ia, sesion_humana_min = p_humana, sesion_aviso_previo_min = p_aviso, solicitud_expira_min = p_solicitud,
         updated_at = now(), updated_by = auth.uid() where id = 1 returning * into cfg;
  insert into public.cc_atencion_config_hist (aviso_min, escalamiento_min, pausar_fuera_horario, actor_profile_id, sesion_ia_min, sesion_humana_min, sesion_aviso_previo_min, solicitud_expira_min)
  values (cfg.aviso_min, cfg.escalamiento_min, cfg.pausar_fuera_horario, auth.uid(), p_ia, p_humana, p_aviso, p_solicitud);
  return public.cc_atencion_config_ver();
end;
$$;

-- ── 7) Privilegios ───────────────────────────────────────────────────────────────────────────────────
revoke all on function public._cc_mensaje_renueva(text, text), public._cc_sesion_cerrar_con(uuid, text, text, uuid, jsonb), public._cc_atencion_liberar(uuid),
                       public.cc_sesiones_cerrar_inactivas(integer), public.cc_sesiones_inactivas_preview(integer, integer, integer, integer),
                       public.cc_sesiones_config_guardar(integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public._cc_sesion_cerrar(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.cc_sesiones_cerrar_inactivas(integer) to service_role;
grant execute on function public.cc_sesiones_inactivas_preview(integer, integer, integer, integer), public.cc_sesiones_config_guardar(integer, integer, integer, integer) to authenticated, service_role;

-- ── 8) Cron propio (firma exacta: lección de la 124) ─────────────────────────────────────────────────
do $cron$
declare v_n int; v_ok boolean;
begin
  if to_regprocedure('cron.schedule(text,text,text)') is null or to_regprocedure('cron.unschedule(text)') is null then
    raise exception 'Chat V2-C2: falta pg_cron (cron.schedule(text,text,text) / cron.unschedule(text))';
  end if;
  select count(*), bool_and(schedule = '*/5 * * * *' and command = 'select public.cc_sesiones_cerrar_inactivas();' and active)
    into v_n, v_ok from cron.job where jobname = 'renovacell-sesiones-inactivas';
  if v_n = 1 and v_ok then return; end if;
  if v_n > 0 then perform cron.unschedule('renovacell-sesiones-inactivas'); end if;
  perform cron.schedule('renovacell-sesiones-inactivas', '*/5 * * * *', 'select public.cc_sesiones_cerrar_inactivas();');
end $cron$;

-- ── 9) Verificación posterior: NADA activado ─────────────────────────────────────────────────────────
do $post$
begin
  if exists (select 1 from public.cc_atencion_config where sesion_ia_min is not null or sesion_humana_min is not null or sesion_aviso_previo_min is not null or solicitud_expira_min is not null) then
    raise exception 'Chat V2-C2: la configuración de sesiones debe llegar en NULL (desactivada)';
  end if;
  if (select count(*) from cron.job where jobname = 'renovacell-sesiones-inactivas' and schedule = '*/5 * * * *' and active) <> 1 then
    raise exception 'Chat V2-C2: el job renovacell-sesiones-inactivas no quedó programado exactamente una vez';
  end if;
  if (public.cc_sesiones_cerrar_inactivas() ->> 'omitido') is distinct from 'desactivado' then
    raise exception 'Chat V2-C2: el motor no está desactivado';
  end if;
end $post$;
