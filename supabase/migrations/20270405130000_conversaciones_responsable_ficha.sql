-- CONV-WHATSAPP · 2 (14 nov 2026) · la vendedora RESPONSABLE (cartera o quien la atendió, _cc_vendedor_conv) ve la ficha y
-- usa el menú «+» de SU conversación aunque hoy la atienda el asistente o haya terminado la asesoría (antes solo la asignada:
-- tras "Terminar" se quedaba sin ficha ni acciones). Dirección sigue viéndolo todo.
do $pre$ begin
  if to_regprocedure('public._cc_puede_ver_conv(uuid)') is null or to_regprocedure('public._cc_vendedor_conv(uuid)') is null then
    raise exception 'CONV-WHATSAPP-2: faltan _cc_puede_ver_conv o _cc_vendedor_conv'; end if;
end $pre$;

create or replace function public._cc_puede_ver_conv(p_conv uuid) returns boolean language sql stable security definer set search_path to 'public' as
$function$ select public.auth_role() = 'admin'
       or exists (select 1 from public.cc_conversations c where c.id = p_conv and c.seller_profile_id = auth.uid() and public._cc_puede_atender(auth.uid()))
       or (public._cc_puede_atender(auth.uid()) and public._cc_vendedor_conv(p_conv) = auth.uid()) $function$;
