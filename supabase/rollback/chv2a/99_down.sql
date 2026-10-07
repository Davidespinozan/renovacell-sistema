-- ============================================================================
-- CHV2-A (123) · ROLLBACK. Devuelve _cc_rutear, cc_asignar_asesor, cc_cartera_asignar, cc_cola_asesorias y
-- cc_ruteo_pendientes al texto EXACTO de 122 (CC-7/UX); retira configuración, evaluador, cron y las columnas
-- nuevas de notifications. No borra conversaciones, mensajes, eventos ni cartera. Las notificaciones ya
-- emitidas se conservan como notificaciones normales (pierden kind/referencia).
-- Ejecutar en UNA transacción:  psql -1 -v ON_ERROR_STOP=1 -f 99_down.sql
-- ============================================================================
-- Job del evaluador, por FIRMA EXACTA (to_regproc es ambiguo con las sobrecargas de pg_cron; ver 124).
do $$
begin
  if to_regprocedure('cron.unschedule(text)') is null then
    raise notice 'pg_cron no disponible: retirar renovacell-atencion-comercial aparte.';
    return;
  end if;
  if exists (select 1 from cron.job where jobname = 'renovacell-atencion-comercial') then
    perform cron.unschedule('renovacell-atencion-comercial'::text);
  end if;
end $$;
drop function if exists public.cc_atencion_evaluar(), public.cc_solicitud_reasignar(uuid, uuid, text), public.cc_atencion_config_guardar(integer, integer, boolean), public.cc_atencion_config_ver();
drop function if exists public.cc_cola_asesorias();
CREATE OR REPLACE FUNCTION public.cc_cola_asesorias()
 RETURNS TABLE(conversation_id uuid, modo text, seller_profile_id uuid, asesoria_solicitada_at timestamp with time zone, last_message_at timestamp with time zone, es_mia boolean, sin_leer bigint, dueno text, handoff_origen text, fuera_horario boolean, ruteo_motivo text, cart_id uuid, n_items integer, edad_min integer, iniciada boolean)
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
         c.modo = 'human_active'
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
             'n_items', (select count(*) from public.cc_cart_items i where i.cart_id = c.handoff_cart_id)) as x
        from public.cc_conversations c
       where c.estado = 'abierta' and c.modo in ('human_requested', 'human_assigned', 'human_active')
       limit 300) s), '[]'::jsonb),
    'carritos_pendientes', coalesce((select jsonb_agg(jsonb_build_object('cart_id', k.id, 'profile_id', k.profile_id, 'visitante', k.profile_id is null, 'desde', k.handoff_at, 'error', k.handoff_error,
             'n_items', (select count(*) from public.cc_cart_items i where i.cart_id = k.id)))
        from public.cc_carts k where k.estado = 'active' and k.handoff_estado = 'pendiente'), '[]'::jsonb));
end;
$function$;

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
    return jsonb_build_object('asignado', true, 'seller', s);
  end if;
  -- Sin vendedor elegible: NUNCA se reasigna al azar. Se libera un asesor que ya no puede atender y se encola para Dirección.
  if c.seller_profile_id is not null then
    update public.cc_participants set left_at = now() where conversation_id = p_conv and profile_id = c.seller_profile_id and rol = 'asesor';
    perform public._cc_evento(p_conv, 'seller_unassigned', 'system', null, null, jsonb_build_object('seller', c.seller_profile_id, 'motivo', v_motivo));
  end if;
  update public.cc_conversations set seller_profile_id = null, ruteo_motivo = v_motivo, updated_at = now() where id = p_conv;
  return jsonb_build_object('asignado', false, 'motivo', v_motivo);
end;
$function$;

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
  if c.seller_profile_id is not distinct from p_seller then
    return jsonb_build_object('modo', c.modo, 'seller', c.seller_profile_id, 'idempotente', true);
  end if;
  if p_seller is null then
    update public.cc_conversations set seller_profile_id = null, updated_at = now() where id = p_conv;
    update public.cc_participants set left_at = now() where conversation_id = p_conv and profile_id = c.seller_profile_id and rol = 'asesor';
    perform public._cc_evento(p_conv, 'seller_unassigned', 'admin', p_actor_profile, null, jsonb_build_object('seller', c.seller_profile_id));
    if c.modo in ('human_assigned', 'human_active') then
      perform public._cc_cambiar_modo(p_conv, 'human_requested', 'human_requested', 'admin', p_actor_profile, null, jsonb_build_object('motivo', 'liberada'));
      perform public._cc_sistema(p_conv, 'Tu conversación volvió a la cola de asesores.', 'sys:cola:' || c.ultimo_seq);
    end if;
  else
    if c.seller_profile_id is not null then
      update public.cc_participants set left_at = now() where conversation_id = p_conv and profile_id = c.seller_profile_id and rol = 'asesor';
      perform public._cc_evento(p_conv, 'seller_unassigned', case when v_rol = 'admin' then 'admin' else 'seller' end, p_actor_profile, null, jsonb_build_object('seller', c.seller_profile_id, 'motivo', 'reasignada'));
    end if;
    update public.cc_conversations set seller_profile_id = p_seller, updated_at = now() where id = p_conv;
    perform public._cc_participante(p_conv, 'seller', null, p_seller, 'asesor');
    if c.modo <> 'human_assigned' then
      perform public._cc_cambiar_modo(p_conv, 'human_assigned', 'human_assigned', case when v_rol = 'admin' then 'admin' else 'seller' end, p_actor_profile, null, jsonb_build_object('seller', p_seller));
    else
      perform public._cc_evento(p_conv, 'human_assigned', case when v_rol = 'admin' then 'admin' else 'seller' end, p_actor_profile, null, jsonb_build_object('seller', p_seller, 'motivo', 'reasignada'));
    end if;
  end if;
  select * into c from public.cc_conversations where id = p_conv;
  return jsonb_build_object('modo', c.modo, 'seller', c.seller_profile_id, 'idempotente', false);
end;
$function$;

revoke all on function public.cc_asignar_asesor(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.cc_asignar_asesor(uuid, uuid, uuid) to service_role;
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
      if c.seller_profile_id is not null then
        update public.cc_participants set left_at = now() where conversation_id = c.id and profile_id = c.seller_profile_id and rol = 'asesor';
        perform public._cc_evento(c.id, 'seller_unassigned', 'admin', auth.uid(), null, jsonb_build_object('seller', c.seller_profile_id, 'motivo', 'cartera'));
      end if;
      if p_vendedor is not null then
        update public.cc_conversations set seller_profile_id = p_vendedor, ruteo_motivo = null, updated_at = now() where id = c.id;
        perform public._cc_participante(c.id, 'seller', null, p_vendedor, 'asesor');
        perform public._cc_evento(c.id, 'human_assigned', 'admin', auth.uid(), null, jsonb_build_object('seller', p_vendedor, 'origen', 'cartera', 'motivo', 'reasignada'));
      else
        update public.cc_conversations set seller_profile_id = null, ruteo_motivo = 'sin_vendedor', updated_at = now() where id = c.id;
        perform public._cc_cambiar_modo(c.id, 'human_requested', 'human_requested', 'admin', auth.uid(), null, jsonb_build_object('motivo', 'cartera_retirada'));
      end if;
    end if;
    select * into c from public.cc_conversations where id = c.id;
  end if;
  return jsonb_build_object('cliente', p_cliente, 'vendedor', p_vendedor, 'anterior', ant.seller_profile_id, 'idempotente', false,
                            'conversacion', case when c.id is null then null else jsonb_build_object('id', c.id, 'modo', c.modo, 'asignada', c.seller_profile_id is not null) end);
end;
$function$;

drop function if exists public._cc_atencion(uuid), public._cc_handler_asignar(uuid, uuid, text, uuid, text, text), public._cc_notificar(text, uuid, uuid[], text[], text, text, text),
  public._cc_nombre_perfil(uuid), public._cc_nombre_dueno(uuid), public._cc_minutos_habiles(timestamptz, timestamptz);
drop table if exists public.cc_atencion_config_hist, public.cc_atencion_config;
drop index if exists public.uq_notifications_event_key;
drop index if exists public.idx_notifications_conversation;
alter table public.notifications drop column if exists event_key, drop column if exists conversation_id, drop column if exists kind;
do $k$
declare v_hay boolean;
begin
  alter table public.cc_conversation_events drop constraint ck_ccce_tipo;
  -- Append-only: cualquier fila fuera de la lista de la 122 (notificacion_fallida de CHV2-A o session_* de Chat V2-C1)
  -- obliga a restaurar el CHECK como NOT VALID (no se borra historia).
  select exists (select 1 from public.cc_conversation_events where tipo not in ('conversation_opened', 'visitor_adopted', 'human_offered', 'human_requested', 'human_assigned', 'seller_unassigned', 'human_started', 'human_ended', 'ai_resumed', 'conversation_closed', 'conversation_reopened', 'human_handoff_requested', 'human_handoff_queued', 'human_handoff_rejected')) into v_hay;
  if v_hay then
    alter table public.cc_conversation_events add constraint ck_ccce_tipo check (tipo in ('conversation_opened', 'visitor_adopted', 'human_offered', 'human_requested', 'human_assigned', 'seller_unassigned', 'human_started', 'human_ended', 'ai_resumed', 'conversation_closed', 'conversation_reopened', 'human_handoff_requested', 'human_handoff_queued', 'human_handoff_rejected')) not valid;
  else
    alter table public.cc_conversation_events add constraint ck_ccce_tipo check (tipo in ('conversation_opened', 'visitor_adopted', 'human_offered', 'human_requested', 'human_assigned', 'seller_unassigned', 'human_started', 'human_ended', 'ai_resumed', 'conversation_closed', 'conversation_reopened', 'human_handoff_requested', 'human_handoff_queued', 'human_handoff_rejected'));
  end if;
end $k$;
