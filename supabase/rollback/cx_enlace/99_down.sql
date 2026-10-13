-- CX-ENLACE · rollback de la migración 150. Devuelve el ruteo, el nombre y la cola a sus versiones anteriores y
-- retira el prerregistro. Los prospectos creados por el enlace se conservan (son datos del negocio).
-- Aplicar en UNA transacción.
do $pre$ begin
  if to_regclass('public.cc_prerregistros') is null then raise exception 'CX-ENLACE rollback: la migración no está aplicada'; end if;
  if md5(pg_get_functiondef('public._cc_rutear(uuid)'::regprocedure)) <> 'aee657ea83e0cbff9ce673b3fd6ef25e'
     or md5(pg_get_functiondef('public._cc_nombre_dueno(uuid)'::regprocedure)) <> '1ebaa87f1e9a1072df6d1eb16b3a0c92'
     or md5(pg_get_functiondef('public.cc_cola_asesorias()'::regprocedure)) <> '6c82ab2d546e3f7cc22b117a0589e7e7' then
    raise exception 'CX-ENLACE rollback: las funciones no son las de la migración 150';
  end if;
end $pre$;

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

CREATE OR REPLACE FUNCTION public._cc_nombre_dueno(p_conv uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select case when c.profile_id is not null then coalesce((select coalesce(p.meta ->> 'name', p.full_name) from public.profiles p where p.id = c.profile_id), 'Doctor') else 'Visitante' end
     from public.cc_conversations c where c.id = p_conv $function$;

CREATE OR REPLACE FUNCTION public.cc_cola_asesorias()
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

drop function public.cc_contacto_de(uuid);
drop function public.cc_puerta_chat(text, uuid);
drop function public.cc_visitante_prerregistrar(text, text, text, text, boolean, text, boolean);
drop function public._cc_prerregistro_coincidencia(text, text);
drop table public.cc_prerregistros;
-- La bitácora de visitantes es de solo anexar: sus filas 'prerregistro' se conservan y la restricción anterior se
-- repone sin revalidar lo ya escrito.
alter table public.cc_visitor_events drop constraint ck_ccve_tipo;
alter table public.cc_visitor_events add constraint ck_ccve_tipo
  check (tipo = any (array['abierto', 'last_touch', 'prospecto', 'registro', 'adoptado', 'conflicto', 'revocado'])) not valid;

do $post$ begin
  if md5(pg_get_functiondef('public._cc_rutear(uuid)'::regprocedure)) <> '4f79575dced5024a14cee0eec3d3d109'
     or md5(pg_get_functiondef('public._cc_nombre_dueno(uuid)'::regprocedure)) <> 'd031a799c72205e532381a3f4a1ec200'
     or md5(pg_get_functiondef('public.cc_cola_asesorias()'::regprocedure)) <> '1a761f28d2137357498534b0524e2039' then
    raise exception 'CX-ENLACE rollback: las funciones no volvieron a su versión anterior';
  end if;
end $post$;
