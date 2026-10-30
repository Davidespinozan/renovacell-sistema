-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- CONTACTO CONVERSACIONAL (30 oct 2026). El dueño de Renovacell: en el enlace del chat no quiere un formulario de nombre,
--   correo y número; "prefiere que la misma IA te lo pida conversacionalmente para eliminar fricción, que parezca que
--   entraron directo a un chat".
--   · cc_ia_contacto_pendiente: ¿este visitante aún no deja sus datos? y con quién va a hablar (enlace del vendedor o
--     recomendación) para que la IA lo diga.
--   · cc_bienvenida_contacto: al abrir, el asistente YA saludó y pidió el nombre (mensaje guardado, idempotente). La IA
--     lo ve en su historial; quien entra ve un chat que ya le habla.
--   · cc_ia_registrar_contacto: la herramienta de la IA. Mismas reglas que el formulario (cc_visitante_prerregistrar:
--     prospecto, coincidencia con cartera, enlace del vendedor, aviso); un dato inválido vuelve como campo para que la
--     IA lo pida de nuevo. Consentimiento: el aviso de privacidad está a la vista junto al redactor y la persona da sus
--     datos al escribirlos (datos de contacto, no sensibles); queda constancia de esa forma en el prospecto. Al quedar
--     registrado, la conversación entra a la cola de su vendedor como antes.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public.cc_ia_registrar_contacto(uuid,text,text,text,text,boolean,text)') is not null then raise exception 'CONTACTO-CONV: ya aplicada'; end if;
  if to_regprocedure('public.cc_visitante_prerregistrar(text,text,text,text,boolean,text,boolean)') is null or to_regprocedure('public.cc_enlace_auto_asesor(uuid,text)') is null
     or to_regprocedure('public.cc_enlace_publico(text)') is null then
    raise exception 'CONTACTO-CONV: faltan CX-ENLACE (150/151) o ENLACE-VENDEDOR (20270211)'; end if;
end $pre$;

-- ¿Le faltan los datos de contacto? Y lo público de su enlace (asesor y quién lo recomendó), si llegó por uno.
create function public.cc_ia_contacto_pendiente(p_hash text) returns jsonb language plpgsql stable security definer set search_path = public as
$$
declare v public.cc_visitors; e jsonb;
begin
  select * into v from public.cc_visitors where id = public._cc_visitor_por_hash(p_hash);
  if not found then return jsonb_build_object('pendiente', false); end if;
  e := case when v.enlace_codigo is not null then public.cc_enlace_publico(v.enlace_codigo) end;
  return jsonb_build_object('pendiente', not exists (select 1 from public.cc_prerregistros r where r.visitor_id = v.id),
    'asesor', e -> 'asesor' ->> 'primer_nombre', 'recomienda', e ->> 'recomienda');
end;
$$;
revoke all on function public.cc_ia_contacto_pendiente(text) from public, anon, authenticated;
grant execute on function public.cc_ia_contacto_pendiente(text) to service_role;

-- Texto del saludo (sin datos de nadie más que el asesor y el primer nombre de quien recomienda).
create function public._cc_texto_bienvenida(p_asesor text, p_recomienda text) returns text language sql immutable set search_path = public as
$$
  select 'Hola, te damos la bienvenida a Renovacell.'
    || case when p_recomienda is not null then ' Qué gusto que vengas de parte de ' || p_recomienda || '.' else '' end
    || case when p_asesor is not null then ' Soy el asistente y te acompaño mientras ' || p_asesor || ', tu asesor, se une a la conversación.'
            else ' Soy el asistente y estoy aquí para ayudarte.' end
    || ' Para empezar, ¿cómo te llamas?'
$$;

-- Al abrir: si aún no hay mensajes y faltan sus datos, el asistente saluda y pide el nombre. Una sola vez por conversación.
create function public.cc_bienvenida_contacto(p_conv uuid, p_hash text) returns boolean language plpgsql security definer set search_path = public as
$$
declare v_id uuid; c record; p jsonb; v_texto text; v_seq bigint; v_cid text := 'tpl:bienvenida:' || p_conv::text;
begin
  v_id := public._cc_visitor_por_hash(p_hash);
  if v_id is null then raise exception 'SESION_INVALIDA'; end if;
  perform public._cc_autoridad(p_conv, 'visitor', v_id, null);
  select * into c from public.cc_conversations where id = p_conv for update;
  if c.estado <> 'abierta' or c.profile_id is not null then return false; end if;
  p := public.cc_ia_contacto_pendiente(p_hash);
  if not (p ->> 'pendiente')::boolean then return false; end if;
  if exists (select 1 from public.cc_messages where conversation_id = p_conv and (client_message_id = v_cid or actor_type <> 'system')) then return false; end if;
  v_texto := public._cc_texto_bienvenida(p ->> 'asesor', p ->> 'recomienda');
  update public.cc_conversations set ultimo_seq = ultimo_seq + 1, last_message_at = now(), updated_at = now() where id = p_conv returning ultimo_seq into v_seq;
  insert into public.cc_messages (conversation_id, seq, actor_type, client_message_id, content, content_hash)
  values (p_conv, v_seq, 'ai', v_cid, v_texto, md5(v_texto));
  return true;
end;
$$;
revoke all on function public.cc_bienvenida_contacto(uuid, text) from public, anon, authenticated;
grant execute on function public.cc_bienvenida_contacto(uuid, text) to service_role;

-- La IA registra los datos que la persona le dio en la conversación. Nunca lanza por un dato inválido: devuelve el
-- campo para que la IA lo pida otra vez. Solo el visitante de ESTA conversación.
create function public.cc_ia_registrar_contacto(p_conv uuid, p_hash text, p_nombre text, p_telefono text, p_email text, p_es_medico boolean, p_cedula text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_id uuid; r jsonb; v_campo text; c record;
begin
  v_id := public._cc_visitor_por_hash(p_hash);
  if v_id is null then raise exception 'SESION_INVALIDA'; end if;
  perform public._cc_autoridad(p_conv, 'visitor', v_id, null);
  begin
    r := public.cc_visitante_prerregistrar(p_hash, p_nombre, p_telefono, p_email, coalesce(p_es_medico, false), p_cedula, true);
  exception when others then
    v_campo := substring(sqlerrm from 'PRERREGISTRO_INVALIDO: ([a-z]+)');
    return jsonb_build_object('registrado', false, 'campo', coalesce(v_campo, 'desconocido'));
  end;
  if r ->> 'estado' = 'ya_registrado' then return jsonb_build_object('registrado', true, 'ya_estaba', true, 'nombre', r ->> 'nombre'); end if;
  update public.prospects set meta = jsonb_set(meta, '{consentimiento,forma}', '"al escribir sus datos en el chat, con el aviso de privacidad a la vista"')
   where id = (select prospect_id from public.cc_prerregistros where visitor_id = v_id) and meta ? 'consentimiento';
  -- Ya con datos: la conversación entra a la cola de su vendedor (o Dirección), como tras el formulario.
  begin perform public.cc_enlace_auto_asesor(p_conv, p_hash); exception when others then null; end;
  select seller_profile_id into c from public.cc_conversations where id = p_conv;
  return jsonb_build_object('registrado', true, 'nombre', r ->> 'nombre', 'asesor_asignado', c.seller_profile_id is not null);
end;
$$;
revoke all on function public.cc_ia_registrar_contacto(uuid, text, text, text, text, boolean, text) from public, anon, authenticated;
grant execute on function public.cc_ia_registrar_contacto(uuid, text, text, text, text, boolean, text) to service_role;
revoke all on function public._cc_texto_bienvenida(text, text) from public, anon, authenticated;

do $post$ begin
  if to_regprocedure('public.cc_ia_registrar_contacto(uuid,text,text,text,text,boolean,text)') is null or to_regprocedure('public.cc_bienvenida_contacto(uuid,text)') is null then
    raise exception 'CONTACTO-CONV: no quedó aplicada'; end if;
end $post$;
