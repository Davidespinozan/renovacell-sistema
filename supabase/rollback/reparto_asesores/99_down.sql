-- REPARTO DE ASESORÍAS · rollback de la 181: se retiran el reparto y su configuración; _cc_rutear, cc_atencion_evaluar,
-- _cc_atencion, cc_atencion_config_ver, cc_iniciar_asesoria y cc_ruteo_resumen vuelven al texto EXACTO anterior (md5 pineados
-- en la 181). Las solicitudes repartidas que estén esperando quedan asignadas a su vendedor actual (ruteo_motivo se limpia).
-- Ejecutar en UNA transacción:  psql -1 -v ON_ERROR_STOP=1 -f 99_down.sql
drop function public.cc_atencion_reparto_guardar(boolean, integer, boolean);
drop function public._cc_reparto_asignar(uuid, uuid);
drop function public._cc_reparto_elegir(uuid);
update public.cc_conversations set ruteo_motivo = null where ruteo_motivo = 'reparto';
alter table public.cc_conversations drop constraint ck_ccc_ruteo;
alter table public.cc_conversations add constraint ck_ccc_ruteo check (ruteo_motivo is null or ruteo_motivo in ('sin_vendedor', 'vendedor_no_elegible', 'visitante'));
alter table public.cc_conversations drop column reparto_probados, drop column reparto_at;
alter table public.cc_atencion_config drop column reparto_activo, drop column reparto_min, drop column reparto_fija_cartera;
-- Textos exactos anteriores (pg_get_functiondef de producción, 18 oct 2026):
CREATE OR REPLACE FUNCTION public._cc_atencion(p_conv uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

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
$function$
;

CREATE OR REPLACE FUNCTION public.cc_atencion_config_ver()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare cfg record;
begin
  perform public._cc7_direccion();
  select * into cfg from public.cc_atencion_config where id = 1;
  return jsonb_build_object('aviso_min', cfg.aviso_min, 'escalamiento_min', cfg.escalamiento_min, 'pausar_fuera_horario', cfg.pausar_fuera_horario, 'updated_at', cfg.updated_at,
                            'horario', public._cc_horario_estado(now()),
                            -- Chat V2-C2 · ciclo de vida de sesiones (NULL = desactivado; tiempo de reloj)
                            'sesiones', jsonb_build_object('ia_min', cfg.sesion_ia_min, 'humana_min', cfg.sesion_humana_min, 'aviso_previo_min', cfg.sesion_aviso_previo_min, 'solicitud_min', cfg.solicitud_expira_min));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.cc_atencion_evaluar()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$
;

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
$function$
;

CREATE OR REPLACE FUNCTION public.cc_ruteo_resumen()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public._cc7_direccion();
  return jsonb_build_object(
    'horario', public._cc_horario_estado(now()),
    'sin_vendedor', (select count(*) from public.profiles p where p.role_id = 'doctor' and p.active and not exists (select 1 from public.cc_cartera k where k.profile_id = p.id)),
    'reasignacion', (select count(*) from public.cc_cartera k where not public._cc_vendedor_elegible(k.seller_profile_id, false)),
    'handoffs_sin_asignar', (select count(*) from public.cc_conversations c where c.estado = 'abierta' and c.modo = 'human_requested' and c.seller_profile_id is null),
    'handoffs_pendientes', (select count(*) from public.cc_carts k where k.estado = 'active' and k.handoff_estado = 'pendiente'),
    'vendedores_elegibles', (select count(*) from public.profiles p where p.role_id = 'pos' and public._cc_vendedor_elegible(p.id, false)));
end;
$function$
;

