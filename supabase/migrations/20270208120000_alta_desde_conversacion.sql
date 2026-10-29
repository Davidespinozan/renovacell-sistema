-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- ALTA-DESDE-CONVERSACIÓN (29 oct 2026) · bloque 2 del expediente del vendedor.
--   · Fotos de WhatsApp: hasta hoy la imagen que mandaba el cliente solo la veía la IA en ese turno y se perdía. Ahora la
--     Edge (meta-webhook) la guarda en el bucket privado `chat` y la registra con SU mensaje (cc_adjunto_registrar_wa):
--     queda en la conversación para el personal (INE, comprobante, foto de un producto).
--   · Alta de un cliente NUEVO desde la conversación (cc_alta_cliente_conversacion): quien escribe aún no tiene ficha;
--     el vendedor (o Dirección) le pide nombre, cédula y correo por el chat, revisa su INE (fotos de la conversación) y
--     lo da de alta: ficha con su número de WhatsApp, verificación registrada (decisión del dueño: la verificación de
--     identidad es manual, del personal), en la cartera del vendedor y ligada a esta conversación. Después, "Mandar
--     acceso al portal" (invitación existente) le crea su cuenta ya verificada y ligada a su ficha.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════

-- ── 1) Foto entrante de WhatsApp con su mensaje ───────────────────────────────────────────────────────
create function public.cc_adjunto_registrar_wa(p_message uuid, p_ruta text, p_tipo text, p_bytes integer) returns jsonb
  language plpgsql security definer set search_path = public as
$$
-- La imagen va con SU mensaje entrante de WhatsApp (client id 'wa:', texto "Envió una imagen por WhatsApp.").
declare m record; a public.cc_adjuntos;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into a from public.cc_adjuntos where message_id = p_message;
  if found then return jsonb_build_object('id', a.id, 'idempotente', true); end if;
  select id, conversation_id, client_message_id, actor_type, content into m from public.cc_messages where id = p_message;
  if not found or coalesce(m.client_message_id, '') not like 'wa:%' or m.actor_type not in ('visitor', 'doctor')
     or m.content not like 'Envió una imagen por WhatsApp.%' then
    raise exception 'ADJUNTO_INVALIDO: el mensaje no es una imagen de WhatsApp' using errcode = 'check_violation';
  end if;
  if split_part(p_ruta, '/', 1) <> m.conversation_id::text then raise exception 'ADJUNTO_INVALIDO: ruta de otra conversación' using errcode = 'check_violation'; end if;
  insert into public.cc_adjuntos (message_id, conversation_id, ruta, tipo, bytes) values (p_message, m.conversation_id, p_ruta, p_tipo, p_bytes) returning * into a;
  return jsonb_build_object('id', a.id, 'idempotente', false);
end;
$$;
alter function public.cc_adjunto_registrar_wa(uuid, text, text, integer) owner to postgres;
revoke all on function public.cc_adjunto_registrar_wa(uuid, text, text, integer) from public, anon, authenticated;
grant execute on function public.cc_adjunto_registrar_wa(uuid, text, text, integer) to service_role;

-- ── 2) Alta de cliente nuevo desde la conversación ────────────────────────────────────────────────────
create function public.cc_alta_cliente_conversacion(p_conv uuid, p_nombre text, p_cedula text, p_email text default null, p_ciudad text default null,
                                                    p_ine_frente uuid default null, p_ine_reverso uuid default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare c record; v_rol text := public.auth_role(); v_nombre text := btrim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g'));
  v_ced text := regexp_replace(coalesce(p_cedula, ''), '[^0-9]', '', 'g'); v_mail text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_tel text; v_id uuid; s uuid; v_ine uuid;
begin
  if not public._cc_puede_ver_conv(p_conv) or v_rol not in ('admin', 'pos') then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into c from public.cc_conversations where id = p_conv for update;
  if c.estado <> 'abierta' then raise exception 'CONVERSACION_CERRADA' using errcode = 'check_violation'; end if;
  if c.profile_id is not null then raise exception 'CONVERSACION_CON_CUENTA: esta persona ya tiene cuenta; su ficha se liga sola' using errcode = 'check_violation'; end if;
  if c.customer_id is not null then raise exception 'YA_VINCULADA: esta conversación ya tiene ficha' using errcode = 'check_violation'; end if;
  if char_length(v_nombre) < 5 or v_nombre !~ '\S+\s+\S+' or char_length(v_nombre) > 120 then raise exception 'DATO_INVALIDO:nombre' using errcode = 'check_violation'; end if;
  if v_ced !~ '^[0-9]{7,8}$' then raise exception 'DATO_INVALIDO:cedula' using errcode = 'check_violation'; end if;
  if v_mail is not null and v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'DATO_INVALIDO:email' using errcode = 'check_violation'; end if;
  -- Ya existe (por correo o cédula): se vincula esa ficha, no se duplica (sin revelar de quién es).
  if exists (select 1 from public.customers x where (v_mail is not null and lower(x.email) = v_mail) or x.meta ->> 'cedula' = v_ced)
     or exists (select 1 from public.profiles p where p.meta ->> 'cedula' = v_ced) then
    raise exception 'POSIBLE_DUPLICADO: ya hay una ficha con ese correo o cédula; búscala y vincúlala' using errcode = 'check_violation';
  end if;
  -- INE: fotos de ESTA conversación que mandó quien escribe.
  foreach v_ine in array array_remove(array[p_ine_frente, p_ine_reverso], null) loop
    if not exists (select 1 from public.cc_adjuntos ad join public.cc_messages m on m.id = ad.message_id
                    where ad.id = v_ine and ad.conversation_id = p_conv and m.actor_type = 'visitor') then
      raise exception 'ADJUNTO_NO_ES_DEL_CLIENTE: la foto de la INE debe ser una que mandó esta persona en esta conversación' using errcode = 'check_violation';
    end if;
  end loop;
  select public.norm_telefono_mx(w.wa_id) into v_tel from public.cc_wa_contactos w where w.visitor_id = c.visitor_id order by w.ultimo_entrante_at desc nulls last limit 1;
  if v_tel is null then select public.norm_telefono_mx(r.telefono) into v_tel from public.cc_prerregistros r where r.visitor_id = c.visitor_id; end if;

  insert into public.customers (full_name, email, phone, city, source, active, meta)
  values (v_nombre, v_mail, v_tel, nullif(btrim(coalesce(p_ciudad, '')), ''), 'conversacion', true,
          jsonb_build_object('cedula', v_ced, 'alta', jsonb_build_object('por', auth.uid(), 'at', now(), 'conversacion', p_conv, 'ine', p_ine_frente is not null or p_ine_reverso is not null)))
  returning id into v_id;
  perform public._c360_evento(v_id, 'verificacion_aprobada', jsonb_build_object('cedula', '••••' || right(v_ced, 3), 'origen', 'conversacion',
          'ine_frente', p_ine_frente is not null, 'ine_reverso', p_ine_reverso is not null), case when v_rol = 'admin' then 'direccion' else 'vendedor' end);
  update public.cc_adjuntos set uso = 'ine-front', usado_por = auth.uid(), usado_at = now() where id = p_ine_frente;
  update public.cc_adjuntos set uso = 'ine-back', usado_por = auth.uid(), usado_at = now() where id = p_ine_reverso;

  -- Cartera: el vendedor que lo atiende (quien lo da de alta, o el asignado a la conversación si lo da de alta Dirección).
  s := case when v_rol = 'pos' then auth.uid() else c.seller_profile_id end;
  if s is not null then
    insert into public.cc_cartera_clientes (customer_id, seller_profile_id, asignado_at, asignado_por, motivo) values (v_id, s, now(), auth.uid(), 'Alta desde una conversación');
    insert into public.cc_cartera_clientes_historial (customer_id, seller_anterior, seller_nuevo, actor_profile_id, motivo) values (v_id, null, s, auth.uid(), 'Alta desde una conversación');
    perform public._c360_evento(v_id, 'vendedor_asignado', jsonb_build_object('vendedor', s, 'por', 'alta_conversacion'), case when v_rol = 'admin' then 'direccion' else 'vendedor' end);
  end if;
  update public.cc_conversations set customer_id = v_id, updated_at = now() where id = p_conv;
  insert into public.cc_conversacion_cliente_hist (conversation_id, customer_anterior, customer_nuevo, actor_profile_id, detalle)
  values (p_conv, null, v_id, auth.uid(), jsonb_build_object('accion', 'alta', 'cartera', s));
  return jsonb_build_object('customer_id', v_id, 'nombre', v_nombre, 'vendedor', s);
end;
$$;
revoke all on function public.cc_alta_cliente_conversacion(uuid, text, text, text, text, uuid, uuid) from public, anon;
grant execute on function public.cc_alta_cliente_conversacion(uuid, text, text, text, text, uuid, uuid) to authenticated, service_role;
