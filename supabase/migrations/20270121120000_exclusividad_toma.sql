-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- R4-B2-3b · EXCLUSIVIDAD IA / PERSONA y TOMA FORMAL POR DIRECCIÓN (conversaciones de WhatsApp, Instagram y Messenger)
--   · cc_conversations.tomada_por / tomada_at: quién de Dirección tomó la conversación (no sobrescribe seller_profile_id
--     ni la cartera). Se limpian solas cuando la conversación sale de human_active o se cierra.
--   · Trigger BEFORE INSERT en cc_messages, SOLO para mensajes de personal ('admin' / 'seller') en conversaciones de canal.
--     Esos tipos solo los escribe cc_enviar_mensaje (security definer, identidad validada por la Edge; 'authenticated' no
--     inserta directo). Reglas: canal en espejo → CANAL_EN_ESPEJO; Dirección sin tomar → TOMA_REQUERIDA; escribir en una
--     atención de otra persona → ATENDIDA_POR_OTRO. Mensajes del cliente, del sistema y de la IA no pasan por aquí; el
--     portal no cambia (su IA y su personal tienen controles propios).
--   · Defensa en la salida: un mensaje de IA NO se encola si la IA del canal está apagada o la conversación está en
--     human_active (cubre rutas que insertan IA directo, p. ej. el saludo comercial).
--   · cc_tomar_conversacion(conv, motivo): solo Dirección; bloqueo de la conversación; usa transiciones existentes
--     (→ human_assigned → human_active) en una transacción; no crea solicitud ni reparto; registra quién, cuándo y desde
--     qué estado. La IA en curso se descarta al guardarse (takeover_humano, B2-3a/CC-7).
--   No toca funciones del trabajo CV (cc_enviar_mensaje, _cc_sesion_mensaje, _cc_atencion, cc_cola_asesorias) ni abre la
--   compuerta de activación. Rollback: supabase/rollback/exclusividad_toma/99_down.sql
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.cc_salida_decisiones') is null or to_regprocedure('public._cc_canal_de(uuid)') is null then raise exception 'R4-B2-3b: faltan R4-B2-2 / R4-B2-3a'; end if;
  if to_regprocedure('public.cc_tomar_conversacion(uuid,text)') is not null then raise exception 'R4-B2-3b: ya aplicada'; end if;
  if not public._cc_transicion_valida('human_assigned', 'human_active') or not public._cc_transicion_valida('ai_active', 'human_assigned') then
    raise exception 'R4-B2-3b: las transiciones de asesoría no son las esperadas';
  end if;
end $pre$;

alter table public.cc_conversations
  add column tomada_por uuid references public.profiles(id) on delete set null,
  add column tomada_at timestamptz;
comment on column public.cc_conversations.tomada_por is 'R4-B2-3b · Dirección que tomó formalmente la conversación (solo en human_active).';

-- La toma solo vive mientras la atención humana está activa y la conversación abierta.
create function public._cc_conv_toma_limpiar() returns trigger
  language plpgsql set search_path = public as
$$
begin
  if new.modo <> 'human_active' or new.estado <> 'abierta' then new.tomada_por := null; new.tomada_at := null; end if;
  return new;
end;
$$;
create trigger trg_ccc_toma_limpiar before update on public.cc_conversations for each row
  when (new.tomada_por is not null) execute function public._cc_conv_toma_limpiar();

-- Exclusividad de escritura del PERSONAL en conversaciones de canal.
create function public._cc_exclusividad_canal() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare v_canal text; v_modo_canal text; c record;
begin
  if new.actor_type not in ('admin', 'seller') then return new; end if;
  v_canal := public._cc_canal_de(new.conversation_id);
  if v_canal is null then return new; end if;   -- portal: sin cambios
  -- candado compartido: un cambio a espejo en curso se ordena con esta escritura (o ya se ve, o espera a que termine)
  if v_canal = 'whatsapp' then select modo into v_modo_canal from public.cc_wa_config where id for share;
  else select modo into v_modo_canal from public.cc_meta_config where canal = v_canal for share; end if;
  if v_modo_canal is distinct from 'activo' then
    raise exception 'CANAL_EN_ESPEJO: el canal % no está activo; no se envían respuestas', v_canal using errcode = 'check_violation';
  end if;
  select modo, seller_profile_id, tomada_por into c from public.cc_conversations where id = new.conversation_id;
  if new.actor_type = 'admin' then
    if c.modo <> 'human_active' then raise exception 'TOMA_REQUERIDA: toma la conversación antes de responder' using errcode = 'insufficient_privilege'; end if;
    if c.tomada_por is distinct from new.actor_profile_id then raise exception 'ATENDIDA_POR_OTRO: otra persona atiende esta conversación' using errcode = 'insufficient_privilege'; end if;
  else
    if c.modo <> 'human_active' then raise exception 'ASESORIA_NO_INICIADA: modo %', c.modo using errcode = 'insufficient_privilege'; end if;
    if c.tomada_por is not null or c.seller_profile_id is distinct from new.actor_profile_id then
      raise exception 'ATENDIDA_POR_OTRO: otra persona atiende esta conversación' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_ccm_exclusividad_canal before insert on public.cc_messages for each row execute function public._cc_exclusividad_canal();

-- Defensa en la salida: lo que escribe la IA solo se encola si su canal la permite y nadie del personal atiende.
create function public._cc_salida_filtrar_ia() returns trigger
  language plpgsql security definer set search_path = public as
$$
begin
  if (select actor_type from public.cc_messages where id = new.message_id) = 'ai'
     and (not public._cc_ia_permitida_en(new.conversation_id) or (select modo from public.cc_conversations where id = new.conversation_id) = 'human_active') then
    return null;   -- no sale; el mensaje queda en la conversación para el personal
  end if;
  return new;
end;
$$;
create trigger trg_cc_wa_salida_filtrar_ia before insert on public.cc_wa_salida for each row execute function public._cc_salida_filtrar_ia();
create trigger trg_cc_meta_salida_filtrar_ia before insert on public.cc_meta_salida for each row execute function public._cc_salida_filtrar_ia();

-- Toma formal por Dirección.
create function public.cc_tomar_conversacion(p_conv uuid, p_motivo text default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_uid uuid := auth.uid(); v_mot text := nullif(btrim(coalesce(p_motivo, '')), ''); c record; v_canal text; v_nombre text;
begin
  if v_uid is null or not public._cc_es_admin() then raise exception 'NO_AUTORIZADO: solo Dirección' using errcode = 'insufficient_privilege'; end if;
  if v_mot is not null and length(v_mot) > 500 then raise exception 'MOTIVO_LARGO: máximo 500 caracteres' using errcode = 'check_violation'; end if;
  select * into c from public.cc_conversations where id = p_conv for update;
  if not found then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  v_canal := public._cc_canal_de(p_conv);
  if v_canal is null then raise exception 'NO_ES_CANAL: la toma aplica a conversaciones de WhatsApp, Instagram o Messenger' using errcode = 'check_violation'; end if;
  if c.estado <> 'abierta' then raise exception 'CONVERSACION_CERRADA' using errcode = 'check_violation'; end if;
  if c.modo = 'human_active' then
    if c.tomada_por = v_uid then return jsonb_build_object('modo', 'human_active', 'tomada_por', v_uid, 'idempotente', true); end if;
    raise exception 'ATENDIDA_POR_OTRO: otra persona atiende esta conversación' using errcode = 'insufficient_privilege';
  end if;
  -- transiciones existentes, en esta misma transacción: sin solicitud nueva ni reparto; la cartera no se toca
  if c.modo <> 'human_assigned' then
    perform public._cc_cambiar_modo(p_conv, 'human_assigned', 'human_assigned', 'admin', v_uid, null, jsonb_build_object('toma_direccion', true));
  end if;
  perform public._cc_cambiar_modo(p_conv, 'human_active', 'human_started', 'admin', v_uid, null,
          jsonb_build_object('toma_direccion', true, 'desde', c.modo, 'canal', v_canal, 'motivo', v_mot));
  update public.cc_conversations set tomada_por = v_uid, tomada_at = now() where id = p_conv;
  update public.cc_conversation_sessions set asesor_profile_id = v_uid where conversation_id = p_conv and estado = 'abierta';
  select coalesce(p.meta ->> 'name', p.full_name, 'Dirección') into v_nombre from public.profiles p where p.id = v_uid;
  perform public._cc_sistema(p_conv, coalesce(v_nombre, 'Dirección') || ' se unió a la conversación.', 'sys:toma:' || c.ultimo_seq);
  return jsonb_build_object('modo', 'human_active', 'tomada_por', v_uid, 'desde', c.modo, 'idempotente', false);
end;
$$;

alter function public._cc_conv_toma_limpiar() owner to postgres;
alter function public._cc_exclusividad_canal() owner to postgres;
alter function public._cc_salida_filtrar_ia() owner to postgres;
alter function public.cc_tomar_conversacion(uuid, text) owner to postgres;
revoke all on function public._cc_conv_toma_limpiar(), public._cc_exclusividad_canal(), public._cc_salida_filtrar_ia() from public, anon, authenticated;
revoke all on function public.cc_tomar_conversacion(uuid, text) from public, anon;
grant execute on function public.cc_tomar_conversacion(uuid, text) to authenticated;   -- exige Dirección por dentro

do $post$ begin
  if public._cc_canal_activacion_lista() then raise exception 'R4-B2-3b: la compuerta de activación debe seguir cerrada'; end if;
  if (select count(*) from pg_trigger where not tgisinternal and tgname in ('trg_ccm_exclusividad_canal', 'trg_ccc_toma_limpiar', 'trg_cc_wa_salida_filtrar_ia', 'trg_cc_meta_salida_filtrar_ia')) <> 4 then
    raise exception 'R4-B2-3b: faltan triggers';
  end if;
  if has_function_privilege('anon', 'public.cc_tomar_conversacion(uuid,text)', 'execute') or has_function_privilege('authenticated', 'public._cc_exclusividad_canal()', 'execute') then
    raise exception 'R4-B2-3b: permisos de más';
  end if;
end $post$;
