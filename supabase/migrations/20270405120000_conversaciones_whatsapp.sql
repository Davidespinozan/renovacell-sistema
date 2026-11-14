-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- CONVERSACIONES COMO WHATSAPP (14 nov 2026, dueño: "aparecen como visitantes", "cerré el chat y ya no lo pude volver a
-- abrir", "no se puede ver el número", "se tiene que sentir tal cual como WhatsApp").
--   · _cc_contacto_conv(conv)   nombre y teléfono de quien escribe, UNA sola regla: cuenta → ficha → prerregistro →
--                               WhatsApp (nombre o +número) → Instagram/Facebook. Nunca "Visitante".
--   · cc_cola_asesorias()       el nombre sale de esa regla y suma teléfono, canal y el último mensaje (vista previa).
--   · cc_mis_conversaciones()   igual: nombre y teléfono de la misma regla.
--   · cc_leer_conversacion()    el vendedor RESPONSABLE (cartera o quien la atendió, _cc_vendedor_conv) puede LEER su
--                               conversación aunque hoy la atienda el asistente o ya haya terminado la asesoría
--                               (rol 'responsable', solo lectura; escribir sigue exigiendo retomar). Al personal le
--                               devuelve también `contacto` (nombre y teléfono).
--   · _cc_sesion_rol()          el responsable también lee sesiones anteriores de prospectos y fichas sin cuenta
--                               (antes solo de doctores con cuenta), para el hilo continuo.
-- No cambia quién puede ESCRIBIR, asignar, iniciar ni terminar.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public._cc_contacto_conv(uuid)') is not null then raise exception 'CONV-WHATSAPP: ya aplicada'; end if;
  if to_regprocedure('public._cc_vendedor_conv(uuid)') is null or to_regprocedure('public._cc_sesion_rol(uuid,text,uuid,uuid)') is null
     or to_regprocedure('public.cc_leer_conversacion(uuid,text,text,uuid,bigint,integer)') is null or to_regprocedure('public.cc_mis_conversaciones()') is null
     or to_regclass('public.cc_wa_contactos') is null or to_regclass('public.cc_meta_contactos') is null or to_regclass('public.customer_phones') is null then
    raise exception 'CONV-WHATSAPP: faltan mis conversaciones, sesiones o canales'; end if;
end $pre$;

create function public._cc_contacto_conv(p_conv uuid) returns jsonb language sql stable security definer set search_path = public as
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
                  else (select m.canal from public.cc_meta_contactos m where c.visitor_id is not null and m.visitor_id = c.visitor_id limit 1) end)
    from public.cc_conversations c where c.id = p_conv
$$;
revoke all on function public._cc_contacto_conv(uuid) from public, anon, authenticated;

-- ── cola: nombre real, teléfono, canal y último mensaje ──────────────────────────────────────────────
drop function public.cc_cola_asesorias();
create function public.cc_cola_asesorias()
 returns table(conversation_id uuid, modo text, seller_profile_id uuid, asesoria_solicitada_at timestamptz, last_message_at timestamptz, es_mia boolean, sin_leer bigint, dueno text,
               handoff_origen text, fuera_horario boolean, ruteo_motivo text, cart_id uuid, n_items integer, edad_min integer, iniciada boolean, atencion jsonb,
               telefono text, canal text, ultimo jsonb)
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
            from public.cc_messages m where m.conversation_id = c.id and m.actor_type <> 'system' order by m.seq desc limit 1)
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

-- ── mis conversaciones: misma regla de nombre + teléfono ────────────────────────────────────────────
create or replace function public.cc_mis_conversaciones() returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not public._cc_puede_atender(v_uid) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'conversation_id', c.id, 'modo', c.modo, 'last_message_at', c.last_message_at,
             'dueno', ct ->> 'nombre', 'telefono', ct ->> 'telefono',
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

-- ── leer: el responsable lee (solo lectura) + contacto para el personal ─────────────────────────────
create or replace function public.cc_leer_conversacion(p_conv uuid, p_actor_type text, p_visitor_hash text, p_profile uuid, p_desde_seq bigint default 0, p_limite integer default 100)
 returns jsonb language plpgsql security definer set search_path to 'public' as
$function$
declare v_visitor uuid; v_rol text; c record; v_msgs jsonb; v_asesor text; s record; v_desde bigint;
begin
  if p_actor_type = 'visitor' then v_visitor := public._cc_visitor_por_hash(p_visitor_hash); if v_visitor is null then raise exception 'SESION_INVALIDA'; end if; end if;
  begin
    v_rol := public._cc_autoridad(p_conv, p_actor_type, v_visitor, p_profile);
  exception when insufficient_privilege then
    -- CONV-WHATSAPP · su vendedor responsable la abre aunque hoy no la atienda (solo lectura: escribir exige retomar).
    if p_actor_type = 'seller' and p_profile is not null and public._cc_perfil_activo(p_profile) in ('pos', 'billing', 'comm')
       and public._cc_puede_atender(p_profile) and public._cc_vendedor_conv(p_conv) = p_profile then
      v_rol := 'responsable';
    else
      raise;
    end if;
  end;
  select * into c from public.cc_conversations where id = p_conv;
  -- Chat V2-C1 · la lectura ACTIVA es la sesión actual (o, si no hay abierta, la última cerrada); nunca el transcript eterno.
  select * into s from public.cc_conversation_sessions ss where ss.conversation_id = p_conv order by (ss.estado = 'abierta') desc, ss.ordinal desc limit 1;
  v_desde := greatest(coalesce(p_desde_seq, 0), coalesce(s.first_seq, 1) - 1);
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'seq', m.seq, 'actor', m.actor_type, 'content', m.content, 'created_at', m.created_at,
                                               'propio', (m.actor_visitor_id is not null and m.actor_visitor_id = v_visitor) or (m.actor_profile_id is not null and m.actor_profile_id = p_profile))
                  order by m.seq), '[]'::jsonb)
    into v_msgs
    from (select * from public.cc_messages m where m.conversation_id = p_conv and m.seq > v_desde and (s.id is null or s.last_seq is null or m.seq <= s.last_seq) order by m.seq limit least(greatest(coalesce(p_limite, 100), 1), 200)) m;
  select coalesce(p.full_name, p.meta ->> 'name') into v_asesor from public.profiles p where p.id = c.seller_profile_id;
  return jsonb_build_object('conversation_id', c.id, 'estado', c.estado, 'modo', c.modo, 'rol', v_rol, 'ultimo_seq', c.ultimo_seq,
                            'asesor_nombre', v_asesor, 'asesor_soy_yo', c.seller_profile_id is not null and c.seller_profile_id = p_profile,
                            'mensajes', v_msgs,
                            'contacto', case when v_rol in ('asesor', 'supervisor', 'responsable') then public._cc_contacto_conv(p_conv) end,
                            'sesion', case when s.id is null then null else jsonb_build_object('id', s.id, 'ordinal', s.ordinal, 'estado', s.estado, 'origen', s.origen,
                                                    'first_seq', s.first_seq, 'last_seq', s.last_seq, 'opened_at', s.opened_at, 'closed_at', s.closed_at, 'close_reason', s.close_reason) end,
                            'leido_hasta', coalesce((select p.last_read_seq from public.cc_participants p where p.conversation_id = c.id
                                                       and ((p_profile is not null and p.profile_id = p_profile) or (v_visitor is not null and p.visitor_id = v_visitor))
                                                     order by p.last_read_seq desc nulls last limit 1), 0),
                            'handoff', jsonb_build_object('origen', c.handoff_origen, 'cart_id', c.handoff_cart_id, 'fuera_horario', c.handoff_fuera_horario,
                                                          'asignado', c.seller_profile_id is not null and c.modo in ('human_assigned', 'human_active'),
                                                          'puede_rechazar', v_rol = 'dueno' and c.modo in ('human_requested', 'human_assigned') and c.handoff_origen is not null));
end;
$function$;

-- ── sesiones anteriores: también las del responsable de prospectos / fichas sin cuenta ──────────────
create or replace function public._cc_sesion_rol(p_session uuid, p_actor_type text, p_visitor uuid, p_profile uuid)
 returns text language plpgsql stable set search_path to 'public' as
$function$
declare s record; c record; v_rol text;
begin
  select * into s from public.cc_conversation_sessions where id = p_session;
  if not found then return null; end if;
  select * into c from public.cc_conversations where id = s.conversation_id;
  if p_actor_type = 'visitor' then
    return case when p_visitor is not null and c.visitor_id = p_visitor and c.profile_id is null then 'dueno' end;
  end if;
  v_rol := public._cc_perfil_activo(p_profile);
  if v_rol is null then return null; end if;
  if p_actor_type = 'doctor' then return case when v_rol = 'doctor' and c.profile_id = p_profile then 'dueno' end; end if;
  if p_actor_type = 'admin' then return case when v_rol = 'admin' then 'supervisor' end; end if;
  if p_actor_type = 'seller' and v_rol in ('pos', 'billing', 'comm') then
    if s.estado = 'abierta' and c.seller_profile_id = p_profile and public._cc_puede_atender(p_profile) then return 'asesor'; end if;
    if c.profile_id is not null and public._cc_vendedor_de(c.profile_id) = p_profile then return 'cartera'; end if;
    if s.asesor_profile_id = p_profile then return 'asesor_historico'; end if;
    if public._cc_vendedor_conv(c.id) = p_profile then return 'cartera'; end if;   -- CONV-WHATSAPP
  end if;
  return null;
end;
$function$;

do $post$ begin
  if to_regprocedure('public._cc_contacto_conv(uuid)') is null or has_function_privilege('authenticated', 'public._cc_contacto_conv(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.cc_cola_asesorias()', 'execute') then
    raise exception 'CONV-WHATSAPP: no quedó aplicada'; end if;
end $post$;
