-- WHATSAPP EN EL CHAT · rollback de la migración 167. Las conversaciones y mensajes que ya entraron se quedan; se pierde
-- solo la liga número ↔ contacto y el registro de wamid.
drop function public.cc_wa_entrante(text, text, text, text, boolean);
drop function public._cc_wa_a_cola(uuid);
drop function public._cc_wa_perfil(text);
CREATE OR REPLACE FUNCTION public._cc_nombre_dueno(p_conv uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select case when c.profile_id is not null then coalesce((select coalesce(p.meta ->> 'name', p.full_name) from public.profiles p where p.id = c.profile_id), 'Doctor') else coalesce((select r.nombre || case when r.posible_customer_id is not null then ' (posible cliente, sin confirmar)' else ' (prerregistro)' end from public.cc_prerregistros r where r.visitor_id = c.visitor_id), 'Visitante') end
     from public.cc_conversations c where c.id = p_conv $function$;
drop table public.cc_wa_mensajes;
drop table public.cc_wa_contactos;
