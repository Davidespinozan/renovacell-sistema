-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- BANDEJA · VENDEDORA RESPONSABLE (15 nov 2026, dueño: "¿por qué Kitzia Dajimer Alacio León no tiene vendedor? ya está en
-- una conversación con uno"). La Bandeja de Dirección solo devolvía quién está ASIGNADO a la conversación ahora
-- (seller_profile_id); una conversación que atiende el asistente salía "sin vendedor" aunque el cliente es de la cartera de
-- alguien. Ahora devuelve también la responsable (_cc_vendedor_conv: cartera del cliente o del prospecto) y el nombre ya no
-- cae en "Visitante" (usa _cc_contacto_conv). El resto de la función queda igual.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public._cc_vendedor_conv(uuid)') is null or to_regprocedure('public._cc_contacto_conv(uuid)') is null then
    raise exception 'BANDEJA-RESPONSABLE: faltan CONV-WHATSAPP'; end if;
end $pre$;

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
                       else coalesce((select cu.full_name from public.customers cu where cu.id = o.customer_id), (select r.nombre from public.cc_prerregistros r where r.visitor_id = o.visitor_id), public._cc_contacto_conv(o.id) ->> 'nombre') end,
        'customer_id', coalesce(o.customer_id, (select cu.id from public.customers cu where cu.profile_id = o.profile_id limit 1)),
        'seller_id', o.seller_profile_id, 'seller_nombre', (select coalesce(s.meta ->> 'name', s.full_name) from public.profiles s where s.id = o.seller_profile_id),
        -- BANDEJA-RESPONSABLE · la vendedora de su cartera (aunque hoy no esté asignada a la conversación)
        'responsable_id', public._cc_vendedor_conv(o.id), 'responsable_nombre', public._cc_nombre_personal(public._cc_vendedor_conv(o.id)),
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
