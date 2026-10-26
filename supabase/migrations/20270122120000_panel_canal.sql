-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- R4-B2-4 · LECTURAS del panel operativo de canales (solo Dirección; solo lectura).
--   · cc_canal_conversacion_control(conv): para UNA conversación de canal, quién la atiende ahora (IA, Dirección que la
--     tomó, vendedor de la asesoría o nadie), si quien pregunta puede tomarla o escribir y por qué no. La pantalla no deduce
--     permisos: los pide aquí (y la escritura la vuelve a validar el trigger de exclusividad de B2-3b).
--   · cc_canal_panel(canal): conversaciones del canal con atención humana pedida o en curso (sin datos de contacto: la
--     bandeja ya los tiene) y los últimos mensajes DESCARTADOS como historial (texto acotado, quién y por qué).
--   No escribe nada, no cambia controles, colas, toma ni asignación, ni abre la compuerta.
--   Rollback: supabase/rollback/panel_canal/99_down.sql
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public.cc_tomar_conversacion(uuid,text)') is null or to_regprocedure('public.cc_salida_revision(text,integer)') is null then
    raise exception 'R4-B2-4: faltan R4-B2-2 / R4-B2-3b';
  end if;
  if to_regprocedure('public.cc_canal_panel(text)') is not null then raise exception 'R4-B2-4: ya aplicada'; end if;
end $pre$;

create function public._cc_nombre_personal(p_id uuid) returns text
  language sql stable security definer set search_path = public as
$$ select coalesce(nullif(btrim(p.meta ->> 'name'), ''), nullif(btrim(p.full_name), ''), 'Personal') from public.profiles p where p.id = p_id $$;

create function public.cc_canal_conversacion_control(p_conv uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_uid uuid := auth.uid(); c record; v_canal text; v_modo_canal text; v_ia boolean; v_pausa boolean;
        v_atiende text; v_nombre text; v_soy boolean := false; v_puede_tomar boolean; v_no_tomar text; v_puede_escribir boolean; v_no_escribir text;
begin
  if v_uid is null or not public._cc_es_admin() then raise exception 'NO_AUTORIZADO: solo Dirección' using errcode = 'insufficient_privilege'; end if;
  select id, modo, estado, seller_profile_id, tomada_por, tomada_at into c from public.cc_conversations where id = p_conv;
  if not found then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  v_canal := public._cc_canal_de(p_conv);
  if v_canal is null then return jsonb_build_object('canal', null); end if;   -- portal: sin control de canal
  if v_canal = 'whatsapp' then select modo, ia_habilitada, envio_pausado into v_modo_canal, v_ia, v_pausa from public.cc_wa_config where id;
  else select modo, ia_habilitada, envio_pausado into v_modo_canal, v_ia, v_pausa from public.cc_meta_config where canal = v_canal; end if;

  if c.modo = 'human_active' and c.tomada_por is not null then v_atiende := 'direccion'; v_nombre := public._cc_nombre_personal(c.tomada_por); v_soy := c.tomada_por = v_uid;
  elsif c.modo = 'human_active' then v_atiende := 'vendedor'; v_nombre := public._cc_nombre_personal(c.seller_profile_id); v_soy := c.seller_profile_id = v_uid;
  elsif c.estado = 'abierta' and v_modo_canal = 'activo' and v_ia and c.modo in ('ai_active', 'human_offered', 'human_requested', 'human_assigned') then v_atiende := 'ia';
  else v_atiende := 'nadie'; end if;

  -- mismas reglas que cc_tomar_conversacion y el trigger de exclusividad (la base vuelve a decidir al actuar)
  v_no_tomar := case when c.estado <> 'abierta' then 'conversacion_cerrada'
                     when v_modo_canal <> 'activo' then 'canal_en_espejo'
                     when c.modo = 'human_active' and c.tomada_por = v_uid then 'ya_es_tuya'
                     when c.modo = 'human_active' then 'atendida_por_otro' end;
  v_puede_tomar := v_no_tomar is null;
  v_no_escribir := case when c.estado <> 'abierta' then 'conversacion_cerrada'
                        when v_modo_canal <> 'activo' then 'canal_en_espejo'
                        when c.modo <> 'human_active' then 'toma_requerida'
                        when c.tomada_por is distinct from v_uid then 'atendida_por_otro' end;
  v_puede_escribir := v_no_escribir is null;

  return jsonb_build_object('canal', v_canal, 'canal_modo', v_modo_canal, 'ia_habilitada', v_ia, 'envio_pausado', v_pausa,
    'modo', c.modo, 'estado', c.estado, 'atiende', v_atiende, 'atiende_nombre', v_nombre, 'soy_yo', v_soy,
    'tomada_at', case when v_atiende = 'direccion' then c.tomada_at end,
    'puede_tomar', v_puede_tomar, 'motivo_no_tomar', v_no_tomar, 'puede_escribir', v_puede_escribir, 'motivo_no_escribir', v_no_escribir);
end;
$$;

create function public.cc_canal_panel(p_canal text) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not public._cc_es_admin() then raise exception 'NO_AUTORIZADO: solo Dirección' using errcode = 'insufficient_privilege'; end if;
  if p_canal is null or p_canal not in ('whatsapp', 'instagram', 'messenger') then raise exception 'CANAL_INVALIDO: %', coalesce(p_canal, 'null') using errcode = 'check_violation'; end if;
  return jsonb_build_object('canal', p_canal,
    'atencion_humana', coalesce((select jsonb_agg(jsonb_build_object('conversation_id', c.id, 'modo', c.modo,
          'atiende', case when c.modo = 'human_active' and c.tomada_por is not null then 'direccion' when c.modo = 'human_active' then 'vendedor' end,
          'atiende_nombre', case when c.modo = 'human_active' then public._cc_nombre_personal(coalesce(c.tomada_por, c.seller_profile_id))
                                 when c.seller_profile_id is not null then public._cc_nombre_personal(c.seller_profile_id) end,
          'soy_yo', coalesce(c.modo = 'human_active' and coalesce(c.tomada_por, c.seller_profile_id) = v_uid, false),
          'desde', coalesce(c.tomada_at, c.asesoria_solicitada_at, c.updated_at)) order by c.asesoria_solicitada_at nulls last)
        from (select * from public.cc_conversations where estado = 'abierta' and modo in ('human_requested', 'human_assigned', 'human_active')
                order by asesoria_solicitada_at nulls last limit 200) c
       where public._cc_canal_de(c.id) = p_canal), '[]'::jsonb),
    'descartados', coalesce((select jsonb_agg(jsonb_build_object('id', d.id, 'conversation_id', d.conversation_id, 'texto', left(d.texto, 120),
          'decidido_at', d.decidido_at, 'decidido_por', public._cc_nombre_personal(d.decidido_por), 'motivo', d.decision_motivo) order by d.decidido_at desc)
        from (select id, conversation_id, texto, decidido_at, decidido_por, decision_motivo from public.cc_wa_salida where p_canal = 'whatsapp' and estado = 'descartado'
              union all
              select id, conversation_id, texto, decidido_at, decidido_por, decision_motivo from public.cc_meta_salida where p_canal <> 'whatsapp' and canal = p_canal and estado = 'descartado'
              order by decidido_at desc limit 20) d), '[]'::jsonb));
end;
$$;

alter function public._cc_nombre_personal(uuid) owner to postgres;
alter function public.cc_canal_conversacion_control(uuid) owner to postgres;
alter function public.cc_canal_panel(text) owner to postgres;
revoke all on function public._cc_nombre_personal(uuid) from public, anon, authenticated;
revoke all on function public.cc_canal_conversacion_control(uuid), public.cc_canal_panel(text) from public, anon;
grant execute on function public.cc_canal_conversacion_control(uuid), public.cc_canal_panel(text) to authenticated;   -- exigen Dirección por dentro

do $post$ begin
  if public._cc_canal_activacion_lista() then raise exception 'R4-B2-4: la compuerta de activación debe seguir cerrada'; end if;
  if has_function_privilege('anon', 'public.cc_canal_panel(text)', 'execute') or has_function_privilege('anon', 'public.cc_canal_conversacion_control(uuid)', 'execute')
     or has_function_privilege('authenticated', 'public._cc_nombre_personal(uuid)', 'execute') then raise exception 'R4-B2-4: permisos de más'; end if;
  if (select provolatile from pg_proc where oid = 'public.cc_canal_panel(text)'::regprocedure) <> 's'
     or (select provolatile from pg_proc where oid = 'public.cc_canal_conversacion_control(uuid)'::regprocedure) <> 's' then raise exception 'R4-B2-4: las lecturas deben ser stable'; end if;
end $post$;
