-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- BANDEJA-2 · Bandeja ÚNICA de Dirección: todas las conversaciones abiertas de cualquier origen (WhatsApp, Instagram,
-- Messenger, enlace de contacto, portal) en una lista, clasificadas por lo que hay que hacer:
--   · por_atender  → piden una persona (human_requested / human_assigned sin iniciar) o el cliente quedó sin respuesta
--                    (su último mensaje lleva ≥ 3 min sin contestar y sigue dentro de las 24 h en que se le puede escribir)
--   · en_atencion  → un vendedor o Dirección ya la está atendiendo (human_active)
--   · ia           → la está resolviendo el asistente
-- Ordenada por urgencia (por atender primero, luego lo más reciente). Solo lectura y solo Dirección (_cc7_direccion).
-- Nueva función; no cambia ninguna existente. Reversión: supabase/rollback/bandeja_unificada/99_down.sql
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$
begin
  if to_regprocedure('public._cc_contacto_conversacion(uuid)') is null then raise exception 'BANDEJA-2 requiere BANDEJA-1 (20270125120000)'; end if;
end $pre$;

create or replace function public.cc_bandeja_unificada(p_limite integer default 300) returns jsonb
  language plpgsql stable security definer set search_path to 'public' as
$f$
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
$f$;
alter function public.cc_bandeja_unificada(integer) owner to postgres;
revoke all on function public.cc_bandeja_unificada(integer) from public, anon;
grant execute on function public.cc_bandeja_unificada(integer) to authenticated, service_role;
