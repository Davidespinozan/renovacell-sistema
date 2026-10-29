-- VINCULAR-CLIENTE (20270206) · down: funciones nuevas fuera; ruteo/nombre/bandeja/cola a su definición exacta anterior;
-- se quita la columna y el historial.
CREATE OR REPLACE FUNCTION public._cc_rutear(p_conv uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public._cc_nombre_dueno(p_conv uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select case when c.profile_id is not null then coalesce((select coalesce(p.meta ->> 'name', p.full_name) from public.profiles p where p.id = c.profile_id), 'Doctor') else coalesce((select r.nombre || case when r.posible_customer_id is not null then ' (posible cliente, sin confirmar)' else ' (prerregistro)' end from public.cc_prerregistros r where r.visitor_id = c.visitor_id), (select coalesce(w.nombre, '+' || w.wa_id) || ' (WhatsApp)' from public.cc_wa_contactos w where w.visitor_id = c.visitor_id), (select coalesce(m.nombre, 'Contacto') || case m.canal when 'instagram' then ' (Instagram)' else ' (Facebook)' end from public.cc_meta_contactos m where m.visitor_id = c.visitor_id), 'Visitante') end
     from public.cc_conversations c where c.id = p_conv $function$;

CREATE OR REPLACE FUNCTION public.cc_bandeja_unificada(p_limite integer DEFAULT 300)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare lim int := least(greatest(coalesce(p_limite, 300), 1), 500); v jsonb;
begin
  perform public._cc7_direccion();
  with base as (
    select c.*,
           (select m.actor_type from public.cc_messages m where m.conversation_id = c.id and m.actor_type <> 'system' order by m.seq desc limit 1) as ultimo_actor,
           (select m.created_at from public.cc_messages m where m.conversation_id = c.id and m.actor_type in ('visitor', 'doctor') order by m.seq desc limit 1) as ultimo_cliente_at
      from public.cc_conversations c
     where c.estado = 'abierta'
       and (c.modo in ('human_requested', 'human_assigned', 'human_active') or c.last_message_at > now() - interval '30 days')
  ), clas as (
    select b.*,
           (b.ultimo_actor in ('visitor', 'doctor') and b.ultimo_cliente_at < now() - interval '3 minutes' and b.ultimo_cliente_at > now() - interval '24 hours') as sin_responder,
           case when b.modo = 'human_active' then 'en_atencion'
                when b.modo in ('human_requested', 'human_assigned') then 'por_atender'
                when b.ultimo_actor in ('visitor', 'doctor') and b.ultimo_cliente_at < now() - interval '3 minutes' and b.ultimo_cliente_at > now() - interval '24 hours' then 'por_atender'
                else 'ia' end as grupo
      from base b
  ), orden as (
    select clas.*, row_number() over (order by case grupo when 'por_atender' then 0 when 'en_atencion' then 1 else 2 end,
              case when grupo = 'por_atender' then coalesce(asesoria_solicitada_at, ultimo_cliente_at) end asc nulls last,
              last_message_at desc nulls last, id) as ord
      from clas
  )
  select jsonb_build_object(
    'resumen', jsonb_build_object(
      'por_atender', (select count(*) from clas where grupo = 'por_atender'),
      'en_atencion', (select count(*) from clas where grupo = 'en_atencion'),
      'ia', (select count(*) from clas where grupo = 'ia'),
      'todas', (select count(*) from clas)),
    'conversaciones', coalesce((select jsonb_agg(jsonb_build_object(
        'conversation_id', o.id, 'grupo', o.grupo, 'modo', o.modo, 'dueno', case when o.profile_id is not null then 'doctor' else 'visitante' end, 'profile_id', o.profile_id,
        'nombre', case when o.profile_id is not null then (select coalesce(p.full_name, p.meta ->> 'name') from public.profiles p where p.id = o.profile_id)
                       else coalesce((select r.nombre from public.cc_prerregistros r where r.visitor_id = o.visitor_id), 'Visitante') end,
        'seller_id', o.seller_profile_id, 'seller_nombre', (select coalesce(s.meta ->> 'name', s.full_name) from public.profiles s where s.id = o.seller_profile_id),
        'tomada', o.tomada_por is not null, 'ruteo_motivo', o.ruteo_motivo, 'origen', o.handoff_origen, 'fuera_horario', o.handoff_fuera_horario,
        'solicitado_at', o.asesoria_solicitada_at,
        'edad_min', case when o.asesoria_solicitada_at is null then null else (extract(epoch from (now() - o.asesoria_solicitada_at)) / 60)::int end,
        'iniciada', o.modo = 'human_active', 'cart_id', o.handoff_cart_id, 'n_items', 0,
        'sin_responder', o.sin_responder, 'ultimo_actor', o.ultimo_actor,
        'hace_min', case when o.last_message_at is null then null else (extract(epoch from (now() - o.last_message_at)) / 60)::int end,
        'atencion', case when o.modo in ('human_requested', 'human_assigned', 'human_active') then public._cc_atencion(o.id) end,
        'contacto', public._cc_contacto_conversacion(o.id)) order by o.ord) from orden o where o.ord <= lim), '[]'::jsonb))
    into v;
  return v;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_cola_asesorias()
 RETURNS TABLE(conversation_id uuid, modo text, seller_profile_id uuid, asesoria_solicitada_at timestamp with time zone, last_message_at timestamp with time zone, es_mia boolean, sin_leer bigint, dueno text, handoff_origen text, fuera_horario boolean, ruteo_motivo text, cart_id uuid, n_items integer, edad_min integer, iniciada boolean, atencion jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.id, c.modo, c.seller_profile_id, c.asesoria_solicitada_at, c.last_message_at,
         c.seller_profile_id = auth.uid() as es_mia,
         greatest(c.ultimo_seq - coalesce((select p.last_read_seq from public.cc_participants p where p.conversation_id = c.id and p.profile_id = auth.uid()), 0), 0) as sin_leer,
         case when c.profile_id is not null then coalesce((select coalesce(pr.meta ->> 'name', pr.full_name) from public.profiles pr where pr.id = c.profile_id), 'Doctor') else coalesce((select r.nombre || case when r.posible_customer_id is not null then ' (posible cliente, sin confirmar)' else ' (prerregistro)' end from public.cc_prerregistros r where r.visitor_id = c.visitor_id), 'Visitante') end as dueno,
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

drop function if exists public.cc_cliente_de_conversacion(uuid);
drop function if exists public.cc_desvincular_cliente(uuid);
drop function if exists public.cc_vincular_cliente(uuid, uuid, boolean);
drop function if exists public.cc_cliente_sugerencias(uuid);
drop function if exists public._cc_puede_ver_conv(uuid);
drop function if exists public._cc_vendedor_de_cliente(uuid);
drop function if exists public._cc_txt_norm(text);
drop table if exists public.cc_conversacion_cliente_hist;
alter table public.cc_conversations drop column if exists customer_id;
