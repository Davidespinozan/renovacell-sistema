-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- REPARTO DE ASESORÍAS (migración 181) · dueño (18 oct 2026, por Renovacell): "cuando se pida un asesor y el cliente NO tenga
--   vendedor asignado, que se reparta al azar entre los vendedores; no es necesario que pase por Dirección; si uno no la
--   agarra, la agarra otro".
--   Hasta hoy (CC-7 / CHV2-A, D-CHV2-05 "sin pool"): sin vendedor de cartera → cola de Dirección. Ahora, con el reparto
--   activo (cc_atencion_config.reparto_activo), la solicitud se asigna AL AZAR a un vendedor elegible para clientes nuevos
--   (rol ventas + "Atender conversaciones" + "Recibir clientes nuevos"); si no la inicia en `reparto_min` minutos hábiles,
--   el evaluador (cron) la pasa a otro vendedor que aún no la haya tenido; agotados los vendedores, vuelve a la cola de
--   Dirección como antes. La cartera NO cambia por el reparto; cuando el vendedor INICIA la asesoría de un doctor sin
--   cartera, se le fija la cartera (reparto_fija_cartera, apagable) para que la próxima vez le llegue directo.
--   · cc_atencion_config         + reparto_activo (false; la 182 lo enciende en prod), reparto_min (5), reparto_fija_cartera (true)
--   · cc_conversations           + reparto_probados uuid[] (a quiénes ya se les ofreció), reparto_at; ruteo_motivo admite 'reparto'
--   · _cc_reparto_elegir         vendedor al azar entre los elegibles para nuevos que no la hayan tenido
--   · _cc_reparto_asignar        asigna por el núcleo CHV2-A (_cc_handler_asignar: alerta al vendedor, auditoría) y marca el reparto
--   · _cc_rutear                 sin vendedor de cartera → reparto (si está activo y hay quién); si no, Dirección como antes
--   · cc_atencion_evaluar        rota la solicitud repartida que nadie inició; agotados → Dirección (handoff_sin_vendedor)
--   · _cc_atencion               estado 'reparto' + bloque 'reparto' (intento, umbral)
--   · cc_iniciar_asesoria        fija la cartera al vendedor que la toma (doctor sin cartera, reparto_fija_cartera)
--   · cc_atencion_config_ver     + 'reparto'; cc_atencion_reparto_guardar(p_activo, p_min, p_fija) para Dirección
--   · cc_ruteo_resumen           + reparto_en_curso, vendedores_elegibles_nuevos, reparto_activo
--   Depende de la 180. Rollback: supabase/rollback/reparto_asesores/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.flyers') is null then raise exception 'REPARTO: falta la 180'; end if;
  if exists (select 1 from information_schema.columns where table_name = 'cc_atencion_config' and column_name = 'reparto_activo') then raise exception 'REPARTO: ya aplicada'; end if;
  if md5(pg_get_functiondef('public._cc_rutear(uuid)'::regprocedure)) <> 'aee657ea83e0cbff9ce673b3fd6ef25e' then raise exception 'REPARTO: _cc_rutear no es la versión auditada (150)'; end if;
  if md5(pg_get_functiondef('public.cc_atencion_evaluar()'::regprocedure)) <> '8065aeee3b8f31dced9b1f0ca77b6963' then raise exception 'REPARTO: cc_atencion_evaluar no es la versión auditada (123)'; end if;
  if md5(pg_get_functiondef('public._cc_atencion(uuid)'::regprocedure)) <> '7f6d6c3c5f65d2463766b17e9c02484b' then raise exception 'REPARTO: _cc_atencion no es la versión auditada (123)'; end if;
  if md5(pg_get_functiondef('public.cc_atencion_config_ver()'::regprocedure)) <> '87052e507ae90134b0aeb590bf251610' then raise exception 'REPARTO: cc_atencion_config_ver no es la versión auditada (127)'; end if;
  if md5(pg_get_functiondef('public.cc_iniciar_asesoria(uuid,uuid)'::regprocedure)) <> '35dbad3d69dc1bf2288309a19adee3bc' then raise exception 'REPARTO: cc_iniciar_asesoria no es la versión auditada (125, Chat V2-C1)'; end if;
  if md5(pg_get_functiondef('public.cc_ruteo_resumen()'::regprocedure)) <> '40a5a685d6ca0451bf23d0ed591f4497' then raise exception 'REPARTO: cc_ruteo_resumen no es la versión auditada (119)'; end if;
end $pre$;

-- ── 1) Configuración y columnas ──────────────────────────────────────────────────────────────────────
alter table public.cc_atencion_config
  add column reparto_activo boolean not null default false,
  add column reparto_min integer not null default 5 constraint ck_cac_reparto_min check (reparto_min between 1 and 1440),
  add column reparto_fija_cartera boolean not null default true;
alter table public.cc_conversations
  add column reparto_probados uuid[] not null default '{}',
  add column reparto_at timestamptz;
alter table public.cc_conversations drop constraint ck_ccc_ruteo;
alter table public.cc_conversations add constraint ck_ccc_ruteo check (ruteo_motivo is null or ruteo_motivo in ('sin_vendedor', 'vendedor_no_elegible', 'visitante', 'reparto'));
comment on column public.cc_conversations.reparto_probados is 'REPARTO · vendedores a los que ya se les ofreció esta solicitud (no se repite); se limpia al iniciar o cerrar.';

-- ── 2) Elegir y asignar por reparto ──────────────────────────────────────────────────────────────────
-- Al azar entre los vendedores elegibles para clientes NUEVOS que todavía no hayan tenido esta solicitud.
create function public._cc_reparto_elegir(p_conv uuid) returns uuid
  language sql stable set search_path = public as
$$
  select p.id from public.profiles p
   where p.role_id = 'pos' and public._cc_vendedor_elegible(p.id, true)
     and not (p.id = any (coalesce((select c.reparto_probados from public.cc_conversations c where c.id = p_conv), '{}')))
   order by random() limit 1
$$;

create function public._cc_reparto_asignar(p_conv uuid, p_seller uuid) returns jsonb
  language plpgsql set search_path = public as
$$
declare r jsonb; v_intento int;
begin
  -- Núcleo CHV2-A: una sola autoridad para asignar (handler, participante, modo, auditoría y alerta al vendedor).
  r := public._cc_handler_asignar(p_conv, p_seller, 'system', null, 'reparto', 'reparto');
  update public.cc_conversations
     set ruteo_motivo = 'reparto', reparto_probados = array_append(reparto_probados, p_seller), reparto_at = clock_timestamp(), updated_at = now()
   where id = p_conv returning cardinality(reparto_probados) into v_intento;
  perform public._cc_evento(p_conv, 'human_assigned', 'system', null, null, jsonb_build_object('seller', p_seller, 'origen', 'reparto', 'intento', v_intento));
  return r || jsonb_build_object('reparto', true, 'intento', v_intento);
end;
$$;

-- ── 3) Ruteo: cartera primero; sin vendedor → reparto; sin quién → Dirección ─────────────────────────
create or replace function public._cc_rutear(p_conv uuid) returns jsonb
  language plpgsql set search_path = public as
$$
declare c record; s uuid; v_motivo text; cfg record;
begin
  select * into c from public.cc_conversations where id = p_conv for update;
  if c.modo <> 'human_requested' then
    return jsonb_build_object('asignado', c.seller_profile_id is not null and c.modo in ('human_assigned', 'human_active'), 'sin_cambio', true);
  end if;
  if c.profile_id is null then
    -- Visitante: no hay cartera; solo un asesor que Dirección ya le haya puesto a ESTA conversación.
    if c.seller_profile_id is not null and public._cc_puede_atender(c.seller_profile_id) then s := c.seller_profile_id;
    else
      -- CX-ENLACE · su prerregistro coincide con un cliente que tiene vendedor: va a ESE vendedor (posible cliente, sin confirmar).
      select r.posible_seller_id into s from public.cc_prerregistros r
       where r.visitor_id = c.visitor_id and r.posible_seller_id is not null and public._cc_vendedor_elegible(r.posible_seller_id, false);
      if s is null then v_motivo := 'visitante'; end if;
    end if;
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
  -- Sin vendedor de cartera. Se libera un asesor que ya no puede atender.
  if c.seller_profile_id is not null then
    update public.cc_participants set left_at = now() where conversation_id = p_conv and profile_id = c.seller_profile_id and rol = 'asesor';
    perform public._cc_evento(p_conv, 'seller_unassigned', 'system', null, null, jsonb_build_object('seller', c.seller_profile_id, 'motivo', v_motivo));
  end if;
  update public.cc_conversations set seller_profile_id = null, ruteo_motivo = v_motivo, updated_at = now() where id = p_conv;
  -- REPARTO (181) · al azar entre los vendedores elegibles para nuevos; si nadie la inicia, el evaluador la pasa a otro.
  select * into cfg from public.cc_atencion_config where id = 1;
  if cfg.reparto_activo then
    s := public._cc_reparto_elegir(p_conv);
    if s is not null then
      return public._cc_reparto_asignar(p_conv, s) || jsonb_build_object('asignado', true, 'seller', s, 'motivo_original', v_motivo);
    end if;
  end if;
  -- CHV2-A · sin vendedor elegible → Dirección (una vez por solicitud).
  perform public._cc_notificar('handoff_sin_vendedor', p_conv, null, array['admin'], 'Solicitud de asesor sin vendedor: ' || public._cc_nombre_dueno(p_conv), 'av_atencion',
          'sin_vendedor:' || p_conv::text || ':' || coalesce(extract(epoch from c.asesoria_solicitada_at)::bigint::text, 'na'));
  return jsonb_build_object('asignado', false, 'motivo', v_motivo);
end;
$$;

-- ── 4) Evaluador: rota lo repartido que nadie inició; agotados → Dirección ──────────────────────────
create or replace function public.cc_atencion_evaluar() returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare cfg record; hor jsonb; v_conf boolean; r record; n int := 0; n_aviso int := 0; n_esc int := 0; n_rep int := 0; n_agot int := 0; reloj integer; s uuid; v_motivo text;
begin
  if coalesce(current_setting('request.jwt.claims', true), '') <> '' and not (public._cc_es_admin() or public._cc_es_service()) then
    raise exception 'NO_AUTORIZADO: solo Dirección' using errcode = 'insufficient_privilege';
  end if;
  select * into cfg from public.cc_atencion_config where id = 1;
  hor := public._cc_horario_estado(now()); v_conf := coalesce((hor ->> 'configurado')::boolean, false);
  if cfg.pausar_fuera_horario and not v_conf then return jsonb_build_object('evaluadas', 0, 'avisos', 0, 'escalaciones', 0, 'repartos', 0, 'agotados', 0, 'omitido', 'horario_sin_configurar'); end if;
  for r in select c.id, c.seller_profile_id, c.asesoria_asignada_at, c.ruteo_motivo, c.profile_id, c.asesoria_solicitada_at from public.cc_conversations c
            where c.estado = 'abierta' and c.modo = 'human_assigned' and c.seller_profile_id is not null and c.asesoria_asignada_at is not null loop
    n := n + 1;
    reloj := case when cfg.pausar_fuera_horario then public._cc_minutos_habiles(r.asesoria_asignada_at, now()) else floor(extract(epoch from (now() - r.asesoria_asignada_at)) / 60)::int end;
    if reloj is null then continue; end if;
    if r.ruteo_motivo = 'reparto' then
      -- REPARTO · nadie la inició en el plazo: pasa al siguiente vendedor que no la haya tenido; agotados, a Dirección.
      if reloj >= cfg.reparto_min then
        s := public._cc_reparto_elegir(r.id);
        if s is not null then
          perform public._cc_reparto_asignar(r.id, s); n_rep := n_rep + 1;
        else
          v_motivo := case when r.profile_id is null then 'visitante' else 'sin_vendedor' end;
          perform public._cc_handler_asignar(r.id, null, 'system', null, 'reparto_agotado', 'reparto');
          update public.cc_conversations set ruteo_motivo = v_motivo, updated_at = now() where id = r.id;
          perform public._cc_evento(r.id, 'human_handoff_queued', 'system', null, null, jsonb_build_object('motivo', v_motivo, 'origen', 'reparto_agotado'));
          perform public._cc_notificar('handoff_sin_vendedor', r.id, null, array['admin'], 'Nadie tomó la solicitud repartida: ' || public._cc_nombre_dueno(r.id), 'av_atencion',
                  'sin_vendedor:' || r.id::text || ':' || coalesce(extract(epoch from r.asesoria_solicitada_at)::bigint::text, 'na') || ':agotado');
          n_agot := n_agot + 1;
        end if;
      end if;
      continue;
    end if;
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
  return jsonb_build_object('evaluadas', n, 'avisos', n_aviso, 'escalaciones', n_esc, 'repartos', n_rep, 'agotados', n_agot);
end;
$$;

-- ── 5) Estado derivado: 'reparto' mientras la solicitud repartida espera que alguien la tome ─────────
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
    when c.ruteo_motivo = 'reparto' then 'reparto'                                        -- REPARTO (181): la rota el evaluador, no se escala
    when reloj >= cfg.escalamiento_min then 'escalado'
    when reloj >= cfg.aviso_min then 'aviso'
    when v_conf and not v_abierto then 'fuera_de_horario'
    else 'asignado_esperando' end;
  return jsonb_build_object('estado', estado, 'modo', c.modo, 'handoff_estado', v_hand, 'handler_id', c.seller_profile_id, 'ruteo_motivo', c.ruteo_motivo,
    'solicitado_at', c.asesoria_solicitada_at, 'handler_asignado_at', c.asesoria_asignada_at, 'iniciado_at', c.asesoria_iniciada_at, 'terminado_at', c.asesoria_terminada_at,
    'espera_total_min', esp_total, 'espera_total_habil_min', esp_total_hab, 'espera_handler_min', esp_handler, 'espera_handler_habil_min', esp_handler_hab, 'reloj_sla_min', reloj,
    'horario_configurado', v_conf, 'en_horario', case when v_conf then v_abierto end, 'pausa_fuera_horario', cfg.pausar_fuera_horario,
    'umbral_aviso_min', cfg.aviso_min, 'umbral_escalamiento_min', cfg.escalamiento_min, 'ia_activa', public._cc_ia_puede(c.modo),
    'reparto', jsonb_build_object('activo', cfg.reparto_activo, 'umbral_min', cfg.reparto_min, 'intento', cardinality(c.reparto_probados), 'en_reparto', c.ruteo_motivo = 'reparto'));
end;
$$;

-- ── 6) Iniciar la asesoría: el vendedor que la toma se queda con la cartera del doctor sin vendedor ──
create or replace function public.cc_iniciar_asesoria(p_conv uuid, p_profile uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare c record; v_nombre text; cfg record; v_fija boolean := false;
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
  -- REPARTO (181) · la tomó: si el doctor no tiene vendedor y el reparto fija cartera, se queda con él (historial auditable).
  if c.ruteo_motivo = 'reparto' then
    select * into cfg from public.cc_atencion_config where id = 1;
    if cfg.reparto_fija_cartera and c.profile_id is not null and public._cc_vendedor_elegible(p_profile, true)
       and not exists (select 1 from public.cc_cartera k where k.profile_id = c.profile_id) then
      perform pg_advisory_xact_lock(hashtext('cc_dueno:' || c.profile_id::text));
      insert into public.cc_cartera (profile_id, seller_profile_id, asignado_at, asignado_por, motivo)
        values (c.profile_id, p_profile, now(), p_profile, 'Reparto automático: tomó la asesoría')
        on conflict (profile_id) do nothing;
      if found then
        insert into public.cc_cartera_historial (profile_id, seller_anterior, seller_nuevo, actor_profile_id, motivo) values (c.profile_id, null, p_profile, p_profile, 'Reparto automático: tomó la asesoría');
        v_fija := true;
      end if;
    end if;
    update public.cc_conversations set ruteo_motivo = null, updated_at = now() where id = p_conv;
  end if;
  return jsonb_build_object('modo', 'human_active', 'idempotente', false, 'cartera_fijada', v_fija);
end;
$$;

-- ── 7) Configuración para Dirección y resumen ───────────────────────────────────────────────────────
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
                            'sesiones', jsonb_build_object('ia_min', cfg.sesion_ia_min, 'humana_min', cfg.sesion_humana_min, 'aviso_previo_min', cfg.sesion_aviso_previo_min, 'solicitud_min', cfg.solicitud_expira_min),
                            -- REPARTO (181)
                            'reparto', jsonb_build_object('activo', cfg.reparto_activo, 'min', cfg.reparto_min, 'fija_cartera', cfg.reparto_fija_cartera,
                                                          'vendedores_elegibles', (select count(*) from public.profiles p where p.role_id = 'pos' and public._cc_vendedor_elegible(p.id, true))));
end;
$$;

create function public.cc_atencion_reparto_guardar(p_activo boolean, p_min integer, p_fija boolean) returns jsonb
  language plpgsql security definer set search_path = public as
$$
begin
  perform public._cc7_direccion();
  if p_activo is null or p_min is null or p_fija is null then raise exception 'CONFIG_INVALIDA: activo, minutos y cartera son obligatorios' using errcode = 'check_violation'; end if;
  if p_min < 1 or p_min > 1440 then raise exception 'CONFIG_INVALIDA: minutos entre 1 y 1440' using errcode = 'check_violation'; end if;
  update public.cc_atencion_config set reparto_activo = p_activo, reparto_min = p_min, reparto_fija_cartera = p_fija, updated_at = now(), updated_by = auth.uid() where id = 1;
  perform public.log_audit('Reparto de asesorías', case when p_activo then 'activo' else 'apagado' end, format('%s min hábiles · fija cartera: %s', p_min, p_fija), 'Dirección');
  return public.cc_atencion_config_ver();
end;
$$;
alter function public.cc_atencion_reparto_guardar(boolean, integer, boolean) owner to postgres;
revoke all on function public.cc_atencion_reparto_guardar(boolean, integer, boolean) from public, anon;
grant execute on function public.cc_atencion_reparto_guardar(boolean, integer, boolean) to authenticated;
revoke all on function public._cc_reparto_elegir(uuid), public._cc_reparto_asignar(uuid, uuid) from public, anon, authenticated;

create or replace function public.cc_ruteo_resumen() returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
begin
  perform public._cc7_direccion();
  return jsonb_build_object(
    'horario', public._cc_horario_estado(now()),
    'sin_vendedor', (select count(*) from public.profiles p where p.role_id = 'doctor' and p.active and not exists (select 1 from public.cc_cartera k where k.profile_id = p.id)),
    'reasignacion', (select count(*) from public.cc_cartera k where not public._cc_vendedor_elegible(k.seller_profile_id, false)),
    'handoffs_sin_asignar', (select count(*) from public.cc_conversations c where c.estado = 'abierta' and c.modo = 'human_requested' and c.seller_profile_id is null),
    'handoffs_pendientes', (select count(*) from public.cc_carts k where k.estado = 'active' and k.handoff_estado = 'pendiente'),
    'vendedores_elegibles', (select count(*) from public.profiles p where p.role_id = 'pos' and public._cc_vendedor_elegible(p.id, false)),
    -- REPARTO (181)
    'reparto_activo', (select reparto_activo from public.cc_atencion_config where id = 1),
    'reparto_en_curso', (select count(*) from public.cc_conversations c where c.estado = 'abierta' and c.modo = 'human_assigned' and c.ruteo_motivo = 'reparto'),
    'vendedores_elegibles_nuevos', (select count(*) from public.profiles p where p.role_id = 'pos' and public._cc_vendedor_elegible(p.id, true)));
end;
$$;

do $post$ begin
  if has_function_privilege('anon', 'public.cc_atencion_reparto_guardar(boolean,integer,boolean)', 'execute')
     or has_function_privilege('authenticated', 'public._cc_reparto_elegir(uuid)', 'execute') then raise exception 'REPARTO: permisos inesperados'; end if;
  if (select reparto_activo from public.cc_atencion_config where id = 1) then raise exception 'REPARTO: debe quedar apagado hasta la 182'; end if;
end $post$;
