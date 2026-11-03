-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- MIS CLIENTES Y PROSPECTOS (3 nov 2026, Alejandra vía el dueño: "las conversaciones que he tenido con prospectos no
-- quedan visibles… en Conversaciones no me aparecen; solo si las busco, pero no me aparece hábil para chatear").
--   Causa: la lista del vendedor (cc_cola_asesorias) solo trae asesorías con modo humano asignadas a él. Al cerrarse la
--   asesoría por inactividad (8 h), la conversación vuelve a la IA sin vendedor y desaparece; para volver a escribir
--   había que pedírsela a Dirección.
--   · _cc_vendedor_conv(conv)      el responsable comercial de la conversación: la cartera (de la cuenta o de la ficha)
--                                  y, sin cartera, quien la atendió por última vez (ultimo_asesor_id). Gana la cartera.
--   · cc_mis_conversaciones()      las conversaciones abiertas de las que soy responsable y que no están ya en mi lista
--                                  de asesorías (últimos 30 días), con quién las atiende hoy y el último mensaje.
--   · cc_retomar_conversacion(c)   el responsable la retoma él mismo: se le asigna y se inicia la asesoría en un paso
--                                  (mismas reglas: _cc_handler_asignar + cc_iniciar_asesoria). No si otra persona la
--                                  está atendiendo en este momento (asesoría activa de otro o tomada por Dirección).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public.cc_retomar_conversacion(uuid)') is not null then raise exception 'MIS-CONVERSACIONES: ya aplicada'; end if;
  if to_regprocedure('public._cc_handler_asignar(uuid,uuid,text,uuid,text,text)') is null or to_regprocedure('public.cc_iniciar_asesoria(uuid,uuid)') is null
     or to_regprocedure('public._cc_vendedor_de_cliente(uuid)') is null
     or not exists (select 1 from information_schema.columns where table_name = 'cc_conversations' and column_name = 'ultimo_asesor_id') then
    raise exception 'MIS-CONVERSACIONES: faltan CHV2-A, la retoma o la cartera de clientes'; end if;
end $pre$;

create function public._cc_vendedor_conv(p_conv uuid) returns uuid language sql stable security definer set search_path = public as
$$
  select coalesce((select k.seller_profile_id from public.cc_cartera k where c.profile_id is not null and k.profile_id = c.profile_id),
                  case when c.customer_id is not null then public._cc_vendedor_de_cliente(c.customer_id) end,
                  c.ultimo_asesor_id)
    from public.cc_conversations c where c.id = p_conv
$$;

create function public.cc_mis_conversaciones() returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not public._cc_puede_atender(v_uid) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'conversation_id', c.id, 'modo', c.modo, 'last_message_at', c.last_message_at,
             'dueno', case when c.profile_id is not null then coalesce((select coalesce(pr.meta ->> 'name', pr.full_name) from public.profiles pr where pr.id = c.profile_id), 'Doctor')
                           else coalesce((select cu.full_name from public.customers cu where cu.id = c.customer_id),
                                         (select r.nombre from public.cc_prerregistros r where r.visitor_id = c.visitor_id),
                                         (select 'WhatsApp …' || right(w.wa_id, 4) || coalesce(' · ' || w.nombre, '') from public.cc_wa_contactos w where c.visitor_id is not null and w.visitor_id = c.visitor_id limit 1),
                                         'Prospecto') end,
             'prospecto', c.profile_id is null,
             'canal', case when exists (select 1 from public.cc_wa_contactos w where c.visitor_id is not null and w.visitor_id = c.visitor_id) then 'whatsapp' end,
             'atiende', case when c.modo = 'human_active' and c.tomada_por is not null then 'direccion'
                             when c.modo in ('human_active', 'human_assigned') and c.seller_profile_id is not null and c.seller_profile_id <> v_uid then 'otro'
                             when c.modo in ('ai_active', 'human_offered', 'human_requested', 'human_ended') then 'ia' else 'nadie' end,
             'atiende_nombre', case when c.modo = 'human_active' and c.tomada_por is not null then public._cc_nombre_personal(c.tomada_por)
                                    when c.seller_profile_id is not null and c.seller_profile_id <> v_uid then public._cc_nombre_personal(c.seller_profile_id) end,
             'puede_retomar', not (c.modo = 'human_active' and (c.tomada_por is not null or c.seller_profile_id is distinct from v_uid)),
             'ultimo', (select jsonb_build_object('actor', m.actor_type, 'texto', left(m.content, 140), 'at', m.created_at)
                          from public.cc_messages m where m.conversation_id = c.id and m.actor_type <> 'system' order by m.seq desc limit 1))
           order by c.last_message_at desc nulls last)
      from public.cc_conversations c
     where c.estado = 'abierta' and c.last_message_at > now() - interval '30 days'
       and public._cc_vendedor_conv(c.id) = v_uid
       and not (c.seller_profile_id = v_uid and c.modo in ('human_requested', 'human_assigned', 'human_active', 'human_ended'))), '[]'::jsonb);
end;
$$;

create function public.cc_retomar_conversacion(p_conv uuid) returns jsonb language plpgsql security definer set search_path = public as
$$
declare v_uid uuid := auth.uid(); c record; r jsonb;
begin
  if v_uid is null or not public._cc_puede_atender(v_uid) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into c from public.cc_conversations where id = p_conv for update;
  if not found or public._cc_vendedor_conv(p_conv) is distinct from v_uid then
    raise exception 'NO_AUTORIZADO: no es tu cliente ni la atendiste tú' using errcode = 'insufficient_privilege'; end if;
  if c.estado <> 'abierta' then raise exception 'CONVERSACION_CERRADA' using errcode = 'check_violation'; end if;
  if c.modo = 'human_active' and c.tomada_por is null and c.seller_profile_id = v_uid then
    return jsonb_build_object('conversation_id', p_conv, 'modo', c.modo, 'idempotente', true); end if;
  if c.modo = 'human_active' then
    raise exception 'ATENDIDA_POR_OTRO: % la está atendiendo ahora', coalesce(public._cc_nombre_personal(coalesce(c.tomada_por, c.seller_profile_id)), 'otra persona') using errcode = 'check_violation'; end if;
  perform public._cc_handler_asignar(p_conv, v_uid, 'seller', v_uid, 'retoma_vendedor', 'vendedor');
  -- La asignación avisa "Solicitud de asesor" a quien la recibe; aquí la pidió él mismo: ese aviso sobra.
  delete from public.notifications n where n.kind = 'handoff_asignado' and n.conversation_id = p_conv and n.user_ids = array[v_uid]
     and n.event_key like 'asignacion:' || p_conv::text || ':' || v_uid::text || ':%' and n.created_at >= now() - interval '1 minute';
  r := public.cc_iniciar_asesoria(p_conv, v_uid);
  return jsonb_build_object('conversation_id', p_conv, 'modo', r ->> 'modo', 'idempotente', false);
end;
$$;

revoke all on function public._cc_vendedor_conv(uuid) from public, anon, authenticated;
revoke all on function public.cc_mis_conversaciones(), public.cc_retomar_conversacion(uuid) from public, anon;
grant execute on function public.cc_mis_conversaciones(), public.cc_retomar_conversacion(uuid) to authenticated;

do $post$ begin
  if to_regprocedure('public.cc_retomar_conversacion(uuid)') is null or has_function_privilege('authenticated', 'public._cc_vendedor_conv(uuid)', 'execute') then
    raise exception 'MIS-CONVERSACIONES: no quedó aplicada'; end if;
end $post$;
