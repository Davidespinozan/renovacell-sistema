-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- WHATSAPP · BANDEJA (migración 169) · DIRECCIÓN VE LOS CHATS DE WHATSAPP
--   Hallazgo (15 oct 2026, primer WhatsApp real): en modo espejo el mensaje entra a la base, pero NO se ve en ninguna
--   pantalla: las listas del personal (cc_cola_asesorias, cc_ruteo_pendientes) solo muestran conversaciones que pidieron
--   asesor o ya tienen vendedor, y en espejo nada se encola. Dirección necesita verlos para comprobar que el canal
--   funciona antes de apagar Leadsales, y después como vista general del canal.
--   · cc_wa_bandeja()   NUEVA (Dirección). Un renglón por contacto de WhatsApp con su conversación: nombre, número,
--                       si ya es cliente, último mensaje, cuántos mensajes y si el último lo escribió el cliente.
--   NO cambia: la entrada (167), la salida (168), el chat ni quién puede contestar. Solo lectura.
--   Depende de la 168. Aplicar en UNA transacción. Rollback: supabase/rollback/whatsapp_bandeja/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public.cc_wa_bandeja()') is not null then raise exception 'WHATSAPP-BANDEJA: ya aplicada'; end if;
  if to_regclass('public.cc_wa_config') is null or to_regprocedure('public._cc_wa_contacto_de(uuid)') is null then raise exception 'WHATSAPP-BANDEJA: falta la 168'; end if;
  if to_regprocedure('public._cc7_direccion()') is null then raise exception 'WHATSAPP-BANDEJA: falta _cc7_direccion'; end if;
end $pre$;

create function public.cc_wa_bandeja() returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
-- Dirección: todos los chats de WhatsApp, el más reciente primero. Solo lectura; abrir uno usa el chat de siempre
-- (Dirección lee cualquier conversación como supervisor). En espejo se ven; en activo además se contestan.
begin
  perform public._cc7_direccion();
  return jsonb_build_object(
    'modo', (select modo from public.cc_wa_config),
    'chats', coalesce((select jsonb_agg(x order by x.ultimo_at desc nulls last) from (
      select w.wa_id, w.nombre, w.ultimo_entrante_at, w.ultimo_entrante_at > now() - interval '24 hours' as ventana_abierta,
             w.profile_id is not null as cliente,
             (select coalesce(p.meta ->> 'name', p.full_name) from public.profiles p where p.id = w.profile_id) as cliente_nombre,
             c.id as conversation_id, c.modo, c.estado,
             (select coalesce(s.meta ->> 'name', s.full_name) from public.profiles s where s.id = c.seller_profile_id) as vendedor,
             (select count(*) from public.cc_wa_mensajes m where m.wa_id = w.wa_id)::int as n_mensajes,
             u.content as ultimo_texto, u.actor_type as ultimo_actor, u.created_at as ultimo_at,
             greatest(0, floor(extract(epoch from (now() - u.created_at)) / 60))::int as hace_min,   -- reloj del servidor
             u.actor_type in ('visitor', 'doctor') as sin_responder
        from public.cc_wa_contactos w
        left join lateral (select c.* from public.cc_conversations c
                            where (w.profile_id is not null and c.profile_id = w.profile_id) or (w.profile_id is null and c.visitor_id = w.visitor_id)
                            order by (c.estado = 'abierta') desc, c.last_message_at desc nulls last limit 1) c on true
        left join lateral (select left(m.content, 160) as content, m.actor_type, m.created_at from public.cc_messages m
                            where m.conversation_id = c.id and m.actor_type <> 'system' order by m.seq desc limit 1) u on true
       order by u.created_at desc nulls last limit 300) x), '[]'::jsonb));
end;
$$;
comment on function public.cc_wa_bandeja() is 'WHATSAPP · Dirección: lista de chats de WhatsApp con su conversación y último mensaje. Solo lectura.';
alter function public.cc_wa_bandeja() owner to postgres;
revoke all on function public.cc_wa_bandeja() from public, anon;
grant execute on function public.cc_wa_bandeja() to authenticated, service_role;   -- la función exige Dirección por dentro

do $post$ begin
  if has_function_privilege('anon', 'public.cc_wa_bandeja()', 'execute') or not has_function_privilege('authenticated', 'public.cc_wa_bandeja()', 'execute') then
    raise exception 'WHATSAPP-BANDEJA: permisos inesperados';
  end if;
end $post$;
