-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- CX-ENLACE-2 (migración 151) · EL CONTACTO DEL ENLACE ENTRA A LA COLA DESDE SU PRIMER MENSAJE
--   Con la 150, quien escribía por el enlace de contacto quedaba como prospecto y con el asistente; su
--   conversación no aparecía en la bandeja de nadie hasta que pidiera un asesor. El enlace se promociona como
--   "chatea con un asesor": la conversación debe llegar sola a su vendedor o a la cola de Dirección.
--   · cc_enlace_auto_asesor   NUEVA (servicio). Tras el primer mensaje de un visitante con prerregistro, registra la
--                             solicitud de asesor y la rutea (vendedor del posible cliente, o Dirección). El
--                             asistente sigue atendiendo mientras tanto. A lo más una vez cada 12 horas.
--   · cc_ruteo_pendientes     un cambio: muestra el nombre del prerregistro en vez de "Visitante".
--   NO cambia: cc_solicitar_asesor, _cc_rutear, la cartera, ni lo que hace un doctor con cuenta.
--   Depende de la 150. Aplicar en UNA transacción. Rollback: supabase/rollback/cx_enlace2/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public.cc_enlace_auto_asesor(uuid,text)') is not null then raise exception 'CX-ENLACE-2: ya aplicada'; end if;
  if to_regclass('public.cc_prerregistros') is null then raise exception 'CX-ENLACE-2: falta la 150 (prerregistro): aplícala antes'; end if;
  if md5(pg_get_functiondef('public.cc_ruteo_pendientes()'::regprocedure)) <> '4389eb3daea9923e321b71a6ad199408'
     or md5(pg_get_functiondef('public._cc_rutear(uuid)'::regprocedure)) <> 'aee657ea83e0cbff9ce673b3fd6ef25e' then
    raise exception 'CX-ENLACE-2: cc_ruteo_pendientes / _cc_rutear no son las versiones auditadas';
  end if;
end $pre$;

create function public.cc_enlace_auto_asesor(p_conv uuid, p_visitor_hash text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
-- El visitante del enlace de contacto acaba de escribir: su conversación entra a la cola humana sin que tenga que
-- pedirlo. Mismo efecto que cc_solicitar_asesor (modo, horario, ruteo, avisos), con un aviso que no dice "pediste".
-- Solo visitantes con prerregistro, solo si la conversación está con el asistente y no se solicitó en las últimas 12 h
-- (quien eligió seguir solo con el asistente no vuelve a entrar a la cola con cada mensaje).
declare v_visitor uuid; c record; hor jsonb; v_conf boolean; v_en boolean; ru jsonb;
begin
  v_visitor := public._cc_visitor_por_hash(p_visitor_hash);
  if v_visitor is null then raise exception 'SESION_INVALIDA'; end if;
  perform public._cc_autoridad(p_conv, 'visitor', v_visitor, null);
  select * into c from public.cc_conversations where id = p_conv for update;
  if c.estado <> 'abierta' or c.profile_id is not null or c.modo not in ('ai_active', 'human_offered')
     or not exists (select 1 from public.cc_prerregistros r where r.visitor_id = v_visitor)
     or (c.asesoria_solicitada_at is not null and c.asesoria_solicitada_at > now() - interval '12 hours') then
    return jsonb_build_object('solicitado', false, 'modo', c.modo);
  end if;
  hor := public._cc_horario_estado(now()); v_conf := (hor ->> 'configurado')::boolean; v_en := v_conf and coalesce((hor ->> 'abierto')::boolean, false);
  perform public._cc_sistema(p_conv, public._cc_texto_handoff(v_conf, v_en), 'sys:enlace:' || c.ultimo_seq);
  perform public._cc_cambiar_modo(p_conv, 'human_requested', 'human_requested', 'visitor', null, v_visitor,
          jsonb_build_object('origen', 'enlace', 'fuera_horario', not v_en, 'horario_configurado', v_conf));
  update public.cc_conversations set handoff_origen = 'manual', handoff_cart_id = null, handoff_fuera_horario = not v_en where id = p_conv;
  ru := public._cc_rutear(p_conv);
  if not (ru ->> 'asignado')::boolean then
    perform public._cc_evento(p_conv, 'human_handoff_queued', 'system', null, null, jsonb_build_object('motivo', ru ->> 'motivo', 'fuera_horario', not v_en, 'origen', 'enlace'));
  end if;
  select * into c from public.cc_conversations where id = p_conv;
  return jsonb_build_object('solicitado', true, 'modo', c.modo, 'asesor', c.seller_profile_id is not null);
end;
$$;
alter function public.cc_enlace_auto_asesor(uuid, text) owner to postgres;
revoke all on function public.cc_enlace_auto_asesor(uuid, text) from public, anon, authenticated;
grant execute on function public.cc_enlace_auto_asesor(uuid, text) to service_role;

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
  if md5(pg_get_functiondef('public.cc_ruteo_pendientes()'::regprocedure)) <> '843495c70f9c09689f18cf9781542427' then raise exception 'CX-ENLACE-2: cc_ruteo_pendientes no quedó con la definición esperada'; end if;
  if has_function_privilege('anon', 'public.cc_enlace_auto_asesor(uuid,text)', 'execute') or has_function_privilege('authenticated', 'public.cc_enlace_auto_asesor(uuid,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.cc_ruteo_pendientes()', 'execute') or has_function_privilege('anon', 'public.cc_ruteo_pendientes()', 'execute') then
    raise exception 'CX-ENLACE-2: permisos inesperados';
  end if;
end $post$;
