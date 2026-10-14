-- CX-ENLACE-2 · rollback de la migración 151. Aplicar en UNA transacción.
do $pre$ begin
  if to_regprocedure('public.cc_enlace_auto_asesor(uuid,text)') is null then raise exception 'CX-ENLACE-2 rollback: la migración no está aplicada'; end if;
  if md5(pg_get_functiondef('public.cc_ruteo_pendientes()'::regprocedure)) <> '843495c70f9c09689f18cf9781542427' then raise exception 'CX-ENLACE-2 rollback: cc_ruteo_pendientes no es la de la migración 151'; end if;
end $pre$;

drop function public.cc_enlace_auto_asesor(uuid, text);

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
             'n_items', (select count(*) from public.cc_cart_items i where i.cart_id = c.handoff_cart_id),
             'atencion', public._cc_atencion(c.id)) as x
        from public.cc_conversations c
       where c.estado = 'abierta' and c.modo in ('human_requested', 'human_assigned', 'human_active')
       limit 300) s), '[]'::jsonb),
    'carritos_pendientes', coalesce((select jsonb_agg(jsonb_build_object('cart_id', k.id, 'profile_id', k.profile_id, 'visitante', k.profile_id is null, 'desde', k.handoff_at, 'error', k.handoff_error,
             'n_items', (select count(*) from public.cc_cart_items i where i.cart_id = k.id)))
        from public.cc_carts k where k.estado = 'active' and k.handoff_estado = 'pendiente'), '[]'::jsonb));
end;
$function$;

do $post$ begin
  if md5(pg_get_functiondef('public.cc_ruteo_pendientes()'::regprocedure)) <> '4389eb3daea9923e321b71a6ad199408' then raise exception 'CX-ENLACE-2 rollback: cc_ruteo_pendientes no volvió a su versión anterior'; end if;
end $post$;
