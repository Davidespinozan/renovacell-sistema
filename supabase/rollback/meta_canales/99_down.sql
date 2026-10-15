-- CANALES DE META · rollback de la migración 170: se retira todo lo de Instagram/Messenger y _cc_nombre_dueno vuelve a la 167.
drop function public.cc_canales_bandeja();
drop function public.cc_canal_conversacion(uuid);
drop function public.cc_meta_salida_resolver(uuid, boolean, text, text);
drop function public.cc_meta_salida_reclamar(int);
drop trigger trg_cc_meta_encolar on public.cc_messages;
drop function public._cc_meta_encolar();
drop function public.cc_meta_nombre(text, text, text);
drop function public.cc_meta_entrante(text, text, text, text, text, boolean);
drop function public._cc_meta_contacto_de(uuid);
drop function public._cc_canal_a_cola(uuid, text);
drop table public.cc_meta_salida;
drop table public.cc_meta_mensajes;
drop table public.cc_meta_contactos;
drop table public.cc_meta_config;
CREATE OR REPLACE FUNCTION public._cc_nombre_dueno(p_conv uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select case when c.profile_id is not null then coalesce((select coalesce(p.meta ->> 'name', p.full_name) from public.profiles p where p.id = c.profile_id), 'Doctor') else coalesce((select r.nombre || case when r.posible_customer_id is not null then ' (posible cliente, sin confirmar)' else ' (prerregistro)' end from public.cc_prerregistros r where r.visitor_id = c.visitor_id), (select coalesce(w.nombre, '+' || w.wa_id) || ' (WhatsApp)' from public.cc_wa_contactos w where w.visitor_id = c.visitor_id), 'Visitante') end
     from public.cc_conversations c where c.id = p_conv $function$;
do $post$ begin
  if md5(pg_get_functiondef('public._cc_nombre_dueno(uuid)'::regprocedure)) <> '39c39181b7af60d72a4bf0e1f849dae2' then raise exception 'META-CANALES down: _cc_nombre_dueno no quedó como en la 167'; end if;
end $post$;
