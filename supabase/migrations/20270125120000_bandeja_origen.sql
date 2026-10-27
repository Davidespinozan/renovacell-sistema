-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- BANDEJA-1 · Cada solicitud de la Bandeja dice de DÓNDE viene (WhatsApp, Instagram, Messenger, enlace de contacto o portal),
-- el nombre real del contacto (perfil de WhatsApp/Meta o prerregistro del enlace), su número y el último mensaje del cliente.
-- Solo lectura: una función nueva (_cc_contacto_conversacion, interna) y una clave nueva 'contacto' en cc_ruteo_pendientes
-- (definición tomada de prod; única línea cambiada). No cambia estados, permisos ni datos.
-- Reversión: supabase/rollback/bandeja_origen/99_down.sql
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$
begin
  if md5(pg_get_functiondef('public.cc_ruteo_pendientes()'::regprocedure)) <> '843495c70f9c09689f18cf9781542427' then raise exception 'BANDEJA-1: cc_ruteo_pendientes no es la esperada'; end if;
end $pre$;

create or replace function public._cc_contacto_conversacion(p_conv uuid) returns jsonb
  language sql stable security definer set search_path to 'public' as
$f$
  with c as (select id, visitor_id from public.cc_conversations where id = p_conv),
  wa as (select k.wa_id, k.nombre from public.cc_wa_mensajes w join public.cc_wa_contactos k on k.wa_id = w.wa_id where w.conversation_id = p_conv order by w.created_at desc limit 1),
  mt as (select m.canal, k.nombre from public.cc_meta_mensajes m left join public.cc_meta_contactos k on k.canal = m.canal and k.psid = m.psid where m.conversation_id = p_conv order by m.created_at desc limit 1),
  pr as (select r.nombre, r.telefono from public.cc_prerregistros r join c on r.visitor_id = c.visitor_id limit 1),
  ult as (select left(m.content, 160) as texto, m.created_at as at_ from public.cc_messages m where m.conversation_id = p_conv and m.actor_type in ('visitor', 'doctor') order by m.seq desc limit 1)
  select jsonb_build_object(
    'fuente', case when exists (select 1 from wa) then 'whatsapp' when exists (select 1 from mt) then (select canal from mt) when exists (select 1 from pr) then 'enlace' else 'portal' end,
    'nombre', coalesce((select nullif(btrim(nombre), '') from wa), (select nullif(btrim(nombre), '') from mt), (select nullif(btrim(nombre), '') from pr)),
    'detalle', coalesce((select '+' || wa_id from wa), (select telefono from pr)),
    'ultimo_texto', (select texto from ult), 'ultimo_at', (select at_ from ult))
$f$;
alter function public._cc_contacto_conversacion(uuid) owner to postgres;
revoke all on function public._cc_contacto_conversacion(uuid) from public, anon, authenticated;

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
             'profile_id', c.profile_id, 'nombre', case when c.profile_id is not null then (select coalesce(p.full_name, p.meta ->> 'name') from public.profiles p where p.id = c.profile_id) else coalesce((select r.nombre from public.cc_prerregistros r where r.visitor_id = c.visitor_id), 'Visitante') end,
             'modo', c.modo, 'seller_id', c.seller_profile_id, 'seller_nombre', (select coalesce(s.meta ->> 'name', s.full_name) from public.profiles s where s.id = c.seller_profile_id),
             'ruteo_motivo', c.ruteo_motivo, 'origen', c.handoff_origen, 'fuera_horario', c.handoff_fuera_horario, 'solicitado_at', c.asesoria_solicitada_at,
             'edad_min', case when c.asesoria_solicitada_at is null then null else (extract(epoch from (now() - c.asesoria_solicitada_at)) / 60)::int end,
             'iniciada', c.modo = 'human_active', 'cart_id', c.handoff_cart_id,
             'n_items', (select count(*) from public.cc_cart_items i where i.cart_id = c.handoff_cart_id),
             'atencion', public._cc_atencion(c.id), 'contacto', public._cc_contacto_conversacion(c.id)) as x   -- BANDEJA-1 · origen, nombre, número y último mensaje
        from public.cc_conversations c
       where c.estado = 'abierta' and c.modo in ('human_requested', 'human_assigned', 'human_active')
       limit 300) s), '[]'::jsonb),
    'carritos_pendientes', coalesce((select jsonb_agg(jsonb_build_object('cart_id', k.id, 'profile_id', k.profile_id, 'visitante', k.profile_id is null, 'desde', k.handoff_at, 'error', k.handoff_error,
             'n_items', (select count(*) from public.cc_cart_items i where i.cart_id = k.id)))
        from public.cc_carts k where k.estado = 'active' and k.handoff_estado = 'pendiente'), '[]'::jsonb));
end;
$function$;
