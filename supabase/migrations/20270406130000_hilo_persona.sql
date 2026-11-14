-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- HILO POR PERSONA (14 nov 2026, dueño: "empieza a hablar por WhatsApp, la verifican, entra al portal y se generan dos
-- conversaciones… dentro debería aparecer el historial unificado, identificado por canal, y que el vendedor pueda elegir
-- por cuál canal hablarle").
--   La conversación sigue siendo por canal (WhatsApp, Instagram, Facebook, portal): así sale cada mensaje por donde
--   debe. Lo nuevo es la PERSONA: su cuenta del portal (directa, por su ficha de cliente o por el vínculo del número).
--   · _cc_persona_conv(conv)   la cuenta de la persona detrás de la conversación (o null si aún no se sabe).
--   · _cc_contacto_conv        suma 'persona'; cola y mis conversaciones la devuelven para agrupar a la persona una vez.
--   · cc_hilo_persona(conv)    para el personal que YA puede ver esa conversación: las demás conversaciones abiertas de
--                              la misma persona (con su canal) y sus mensajes recientes, de solo lectura.
-- No cambia quién puede escribir en cada conversación.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public.cc_hilo_persona(uuid,integer)') is not null then raise exception 'HILO-PERSONA: ya aplicada'; end if;
  if to_regprocedure('public._cc_contacto_conv(uuid)') is null or to_regprocedure('public._cc_puede_ver_conv(uuid)') is null then
    raise exception 'HILO-PERSONA: faltan CONV-WHATSAPP'; end if;
end $pre$;

create function public._cc_persona_conv(p_conv uuid) returns uuid language sql stable security definer set search_path = public as
$$
  select coalesce(c.profile_id,
                  (select cu.profile_id from public.customers cu where cu.id = c.customer_id),
                  (select coalesce(w.vinculo_profile_id, w.profile_id) from public.cc_wa_contactos w where c.visitor_id is not null and w.visitor_id = c.visitor_id limit 1))
    from public.cc_conversations c where c.id = p_conv
$$;
revoke all on function public._cc_persona_conv(uuid) from public, anon, authenticated;

create or replace function public._cc_contacto_conv(p_conv uuid) returns jsonb language sql stable security definer set search_path = public as
$$
  select jsonb_build_object(
    'nombre', case when c.profile_id is not null
                   then coalesce((select coalesce(nullif(btrim(p.meta ->> 'name'), ''), p.full_name) from public.profiles p where p.id = c.profile_id), 'Doctor')
                   else coalesce((select nullif(btrim(cu.full_name), '') from public.customers cu where cu.id = c.customer_id),
                                 (select nullif(btrim(r.nombre), '') from public.cc_prerregistros r where r.visitor_id = c.visitor_id limit 1),
                                 (select coalesce(nullif(btrim(w.nombre), ''), '+' || w.wa_id) from public.cc_wa_contactos w where c.visitor_id is not null and w.visitor_id = c.visitor_id limit 1),
                                 (select coalesce(nullif(btrim(m.nombre), ''), case m.canal when 'instagram' then 'Contacto de Instagram' else 'Contacto de Facebook' end)
                                    from public.cc_meta_contactos m where c.visitor_id is not null and m.visitor_id = c.visitor_id limit 1),
                                 'Contacto sin nombre') end,
    'telefono', coalesce(
                  (select '+' || w.wa_id from public.cc_wa_contactos w where c.visitor_id is not null and w.visitor_id = c.visitor_id limit 1),
                  (select coalesce((select nullif(btrim(t.numero), '') from public.customer_phones t where t.customer_id = cu.id and t.activo order by t.es_principal desc, t.created_at limit 1),
                                   nullif(btrim(cu.phone), ''))
                     from public.customers cu
                    where cu.id = c.customer_id or (c.customer_id is null and c.profile_id is not null and cu.profile_id = c.profile_id)
                    order by (cu.id = c.customer_id) desc limit 1),
                  (select nullif(btrim(r.telefono), '') from public.cc_prerregistros r where r.visitor_id = c.visitor_id limit 1)),
    'canal', case when exists (select 1 from public.cc_wa_contactos w where c.visitor_id is not null and w.visitor_id = c.visitor_id) then 'whatsapp'
                  else (select m.canal from public.cc_meta_contactos m where c.visitor_id is not null and m.visitor_id = c.visitor_id limit 1) end,
    'persona', public._cc_persona_conv(c.id))
    from public.cc_conversations c where c.id = p_conv
$$;

-- cola: + persona (para mostrar a la persona una sola vez)
drop function public.cc_cola_asesorias();
create function public.cc_cola_asesorias()
 returns table(conversation_id uuid, modo text, seller_profile_id uuid, asesoria_solicitada_at timestamptz, last_message_at timestamptz, es_mia boolean, sin_leer bigint, dueno text,
               handoff_origen text, fuera_horario boolean, ruteo_motivo text, cart_id uuid, n_items integer, edad_min integer, iniciada boolean, atencion jsonb,
               telefono text, canal text, ultimo jsonb, persona uuid)
 language sql stable security definer set search_path to 'public' as
$function$
  select c.id, c.modo, c.seller_profile_id, c.asesoria_solicitada_at, c.last_message_at,
         c.seller_profile_id = auth.uid() as es_mia,
         greatest(c.ultimo_seq - coalesce((select p.last_read_seq from public.cc_participants p where p.conversation_id = c.id and p.profile_id = auth.uid()), 0), 0) as sin_leer,
         ct ->> 'nombre',
         c.handoff_origen, c.handoff_fuera_horario, c.ruteo_motivo,
         k.id, (select count(*)::int from public.cc_cart_items i where i.cart_id = k.id),
         case when c.asesoria_solicitada_at is null then null else (extract(epoch from (now() - c.asesoria_solicitada_at)) / 60)::int end,
         c.modo = 'human_active',
         public._cc_atencion(c.id),
         ct ->> 'telefono', ct ->> 'canal',
         (select jsonb_build_object('actor', m.actor_type, 'texto', left(m.content, 140), 'at', m.created_at)
            from public.cc_messages m where m.conversation_id = c.id and m.actor_type <> 'system' order by m.seq desc limit 1),
         (ct ->> 'persona')::uuid
    from public.cc_conversations c
    cross join lateral (select public._cc_contacto_conv(c.id) as ct) x
    left join lateral (select kk.id from public.cc_carts kk where kk.estado = 'active'
                         and (case when c.profile_id is not null then kk.profile_id = c.profile_id else kk.visitor_id = c.visitor_id and kk.profile_id is null end) limit 1) k on true
   where c.estado = 'abierta' and c.modo in ('human_requested', 'human_assigned', 'human_active', 'human_ended')
     and public._cc_puede_atender(auth.uid())
     and (public.auth_role() = 'admin' or c.seller_profile_id = auth.uid())
   order by c.last_message_at desc nulls last
$function$;
revoke all on function public.cc_cola_asesorias() from public, anon;
grant execute on function public.cc_cola_asesorias() to authenticated, service_role;

-- mis conversaciones: + persona
create or replace function public.cc_mis_conversaciones() returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not public._cc_puede_atender(v_uid) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'conversation_id', c.id, 'modo', c.modo, 'last_message_at', c.last_message_at,
             'dueno', ct ->> 'nombre', 'telefono', ct ->> 'telefono', 'persona', ct ->> 'persona',
             'prospecto', c.profile_id is null and c.customer_id is null, 'dias_restantes', public._cc_cartera_dias_conv(c.id),
             'canal', ct ->> 'canal',
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
      cross join lateral (select public._cc_contacto_conv(c.id) as ct) x
     where c.estado = 'abierta' and c.last_message_at > now() - interval '30 days'
       and public._cc_vendedor_conv(c.id) = v_uid
       and not (c.seller_profile_id = v_uid and c.modo in ('human_requested', 'human_assigned', 'human_active', 'human_ended'))), '[]'::jsonb);
end;
$$;

-- el hilo de la persona: sus otras conversaciones abiertas y sus mensajes (solo lectura)
create function public.cc_hilo_persona(p_conv uuid, p_limite integer default 300) returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare v_uid uuid := auth.uid(); v_persona uuid; v_convs jsonb; v_msgs jsonb;
begin
  if v_uid is null or not public._cc_puede_ver_conv(p_conv) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  v_persona := public._cc_persona_conv(p_conv);
  if v_persona is null then return jsonb_build_object('persona', null, 'conversaciones', '[]'::jsonb, 'mensajes', '[]'::jsonb); end if;
  with hermanas as (
    select c.id, coalesce(public._cc_contacto_conv(c.id) ->> 'canal', 'portal') canal, c.modo, c.last_message_at
      from public.cc_conversations c
     where c.estado = 'abierta' and public._cc_persona_conv(c.id) = v_persona)
  select coalesce(jsonb_agg(jsonb_build_object('conversation_id', h.id, 'canal', h.canal, 'modo', h.modo, 'last_message_at', h.last_message_at, 'actual', h.id = p_conv)
                            order by h.last_message_at desc nulls last), '[]'::jsonb),
         coalesce((select jsonb_agg(x order by (x ->> 'created_at')) from (
           select jsonb_build_object('id', m.id, 'seq', m.seq, 'actor', m.actor_type, 'content', m.content, 'created_at', m.created_at,
                                     'propio', m.actor_profile_id is not null and m.actor_profile_id = v_uid, 'conversation_id', m.conversation_id, 'canal', h2.canal) x
             from public.cc_messages m join hermanas h2 on h2.id = m.conversation_id
            where m.conversation_id <> p_conv and m.actor_type <> 'system'
            order by m.created_at desc limit least(greatest(coalesce(p_limite, 300), 1), 500)) s), '[]'::jsonb)
    into v_convs, v_msgs from hermanas h;
  return jsonb_build_object('persona', v_persona, 'conversaciones', v_convs, 'mensajes', v_msgs);
end;
$$;
revoke all on function public.cc_hilo_persona(uuid, integer) from public, anon;
grant execute on function public.cc_hilo_persona(uuid, integer) to authenticated;

do $post$ begin
  if to_regprocedure('public.cc_hilo_persona(uuid,integer)') is null or has_function_privilege('authenticated', 'public._cc_persona_conv(uuid)', 'execute') then
    raise exception 'HILO-PERSONA: no quedó aplicada'; end if;
end $post$;
