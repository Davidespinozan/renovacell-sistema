-- ============================================================================
-- VERIFICACIÓN POR WHATSAPP + SEÑALES AL HUMANO (2 nov 2026). Dueño: la IA atiende de punta a punta ("demostrarles que
-- la IA puede ser más eficiente"), precios SOLO a verificados, y "siempre que haya una señal de interés se le hable al
-- asesor humano".
--   1) La IA verifica dentro de WhatsApp: pide nombre, cédula profesional, correo y foto de su cédula; registra una
--      solicitud (cc_ia_solicitar_alta). El responsable comercial (o Dirección) recibe alarma, la revisa en el chat y la
--      aprueba con un toque (Edge alta-whatsapp: ficha verificada + cuenta + vínculo del WhatsApp, cc_alta_wa_cerrar) o la
--      rechaza. La verificación sigue siendo manual del personal (decisión del dueño); la IA solo junta los datos.
--   2) Señal de interés → humano, siempre: una intención de compra en un canal ya no le quita la conversación a la IA;
--      el responsable recibe "señal de compra" (alarma + push) y entra si quiere (cc_senal_interes).
-- ============================================================================
create table if not exists public.cc_solicitudes_alta (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.cc_conversations(id) on delete cascade,
  nombre text not null, cedula text not null, email text not null, especialidad text, ciudad text,
  adjuntos uuid[] not null default '{}',
  estado text not null default 'pendiente' check (estado in ('pendiente', 'aprobada', 'rechazada')),
  motivo text, customer_id uuid references public.customers(id), profile_id uuid references public.profiles(id),
  resuelta_por uuid, resuelta_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create unique index if not exists cc_solicitudes_alta_pendiente on public.cc_solicitudes_alta (conversation_id) where estado = 'pendiente';
alter table public.cc_solicitudes_alta enable row level security;
revoke all on public.cc_solicitudes_alta from public, anon, authenticated;

-- A quién avisarle: el responsable comercial de la conversación o, si no hay, Dirección.
create or replace function public._cc_avisar_responsable(p_conv uuid, p_kind text, p_texto text, p_llave text) returns text
  language plpgsql security definer set search_path = public as
$$
declare v_s uuid := public._cc_responsable_comercial(p_conv);
begin
  if v_s is not null then return public._cc_notificar(p_kind, p_conv, array[v_s], null, p_texto, 'asesorias', p_llave); end if;
  return public._cc_notificar(p_kind, p_conv, null, array['admin'], p_texto, 'av_atencion', p_llave);
end;
$$;

-- ── 1 · La IA registra la solicitud de verificación (servidor) ────────────────────────────────────
create or replace function public.cc_ia_solicitar_alta(p_conv uuid, p_nombre text, p_cedula text, p_email text, p_especialidad text default null, p_ciudad text default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare c record; v_nombre text := btrim(regexp_replace(coalesce(p_nombre, ''), '\s+', ' ', 'g'));
  v_ced text := regexp_replace(coalesce(p_cedula, ''), '[^0-9]', '', 'g'); v_mail text := nullif(lower(btrim(coalesce(p_email, ''))), '');
  v_adj uuid[]; v_id uuid; v_dup boolean;
begin
  perform public._cc_solo_servicio();
  select * into c from public.cc_conversations where id = p_conv;
  if not found or c.estado <> 'abierta' then return jsonb_build_object('registrada', false, 'campo', 'conversacion'); end if;
  if c.profile_id is not null or c.customer_id is not null or public.cc_ia_identidad_canal(p_conv) is not null then
    return jsonb_build_object('registrada', false, 'campo', 'ya_identificado');
  end if;
  if char_length(v_nombre) < 5 or v_nombre !~ '\S+\s+\S+' or char_length(v_nombre) > 120 then return jsonb_build_object('registrada', false, 'campo', 'nombre'); end if;
  if v_ced !~ '^[0-9]{7,8}$' then return jsonb_build_object('registrada', false, 'campo', 'cedula'); end if;
  if v_mail is null or v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return jsonb_build_object('registrada', false, 'campo', 'email'); end if;
  v_dup := exists (select 1 from public.customers x where lower(x.email) = v_mail or x.meta ->> 'cedula' = v_ced)
        or exists (select 1 from public.profiles p where lower(p.email) = v_mail or p.meta ->> 'cedula' = v_ced);
  -- Fotos que mandó esta persona en esta conversación (cédula / INE), las más recientes primero.
  select coalesce(array_agg(ad.id order by ad.created_at desc), '{}') into v_adj
    from public.cc_adjuntos ad join public.cc_messages m on m.id = ad.message_id
   where ad.conversation_id = p_conv and m.actor_type = 'visitor' and ad.created_at > now() - interval '7 days';
  insert into public.cc_solicitudes_alta (conversation_id, nombre, cedula, email, especialidad, ciudad, adjuntos)
  values (p_conv, v_nombre, v_ced, v_mail, nullif(btrim(coalesce(p_especialidad, '')), ''), nullif(btrim(coalesce(p_ciudad, '')), ''), v_adj[1:4])
  on conflict (conversation_id) where estado = 'pendiente'
  do update set nombre = excluded.nombre, cedula = excluded.cedula, email = excluded.email, especialidad = coalesce(excluded.especialidad, cc_solicitudes_alta.especialidad),
               ciudad = coalesce(excluded.ciudad, cc_solicitudes_alta.ciudad), adjuntos = excluded.adjuntos, updated_at = now()
  returning id into v_id;
  perform public._cc_avisar_responsable(p_conv, 'verificacion_wa',
    v_nombre || ' pide verificarse para comprar (cédula ••' || right(v_ced, 3) || case when v_dup then '; puede que ya sea cliente' else '' end
    || case when coalesce(array_length(v_adj, 1), 0) = 0 then '; aún sin foto' else '' end || '). Revísalo y apruébalo en su chat.',
    'verificacion_wa:' || v_id || ':' || coalesce(array_length(v_adj, 1), 0));
  return jsonb_build_object('registrada', true, 'fotos', coalesce(array_length(v_adj, 1), 0), 'posible_cliente', v_dup);
end;
$$;

-- ── 2 · El personal la ve, la cierra (Edge alta-whatsapp) o la rechaza ────────────────────────────
create or replace function public.cc_solicitud_alta_de(p_conv uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
begin
  if not public._cc_puede_ver_conv(p_conv) or public.auth_role() not in ('admin', 'pos') then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  return (select jsonb_build_object('id', s.id, 'estado', s.estado, 'nombre', s.nombre, 'cedula', s.cedula, 'email', s.email, 'especialidad', s.especialidad, 'ciudad', s.ciudad,
            'adjuntos', to_jsonb(s.adjuntos), 'created_at', s.created_at, 'motivo', s.motivo,
            'posible_cliente', exists (select 1 from public.customers x where lower(x.email) = s.email or x.meta ->> 'cedula' = s.cedula))
            from public.cc_solicitudes_alta s where s.conversation_id = p_conv order by s.created_at desc limit 1);
end;
$$;

create or replace function public.cc_alta_wa_cerrar(p_solicitud uuid, p_customer uuid, p_profile uuid, p_actor uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare s public.cc_solicitudes_alta; v_wa text; v_nombre text; v_t text; v_seq bigint;
begin
  perform public._cc_solo_servicio();
  select * into s from public.cc_solicitudes_alta where id = p_solicitud for update;
  if not found or s.estado <> 'pendiente' then raise exception 'SOLICITUD_NO_PENDIENTE' using errcode = 'check_violation'; end if;
  update public.cc_solicitudes_alta set estado = 'aprobada', customer_id = p_customer, profile_id = p_profile, resuelta_por = p_actor, resuelta_at = now(), updated_at = now() where id = s.id;
  v_wa := (public._cc_wa_contacto_de(s.conversation_id)).wa_id;
  if v_wa is not null and p_profile is not null then
    update public.cc_wa_contactos set vinculo_profile_id = p_profile, vinculado_at = now(), vinculado_via = 'personal', vinculado_por = p_actor where wa_id = v_wa;
  end if;
  v_nombre := public._cc_primer_nombre(s.nombre);
  v_t := '¡Listo' || coalesce(', ' || v_nombre, '') || '! Ya quedaste verificado(a) en Renovacell. Desde ahora te doy tus precios, te cotizo y armamos tu pedido por aquí mismo. ¿Te cotizo lo que me pediste?';
  update public.cc_conversations set ultimo_seq = ultimo_seq + 1, last_message_at = now(), updated_at = now() where id = s.conversation_id returning ultimo_seq into v_seq;
  insert into public.cc_messages (conversation_id, seq, actor_type, client_message_id, content, content_hash)
  values (s.conversation_id, v_seq, 'ai', 'tpl:alta_wa:' || s.id, v_t, md5(v_t)) on conflict do nothing;
  return jsonb_build_object('aprobada', true, 'vinculado', v_wa is not null and p_profile is not null);
end;
$$;

create or replace function public.cc_solicitud_alta_rechazar(p_solicitud uuid, p_motivo text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare s public.cc_solicitudes_alta; v_t text; v_seq bigint;
begin
  select * into s from public.cc_solicitudes_alta where id = p_solicitud for update;
  if not found or not public._cc_puede_ver_conv(s.conversation_id) or public.auth_role() not in ('admin', 'pos') then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if s.estado <> 'pendiente' then raise exception 'SOLICITUD_NO_PENDIENTE' using errcode = 'check_violation'; end if;
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then raise exception 'MOTIVO_REQUERIDO' using errcode = 'check_violation'; end if;
  update public.cc_solicitudes_alta set estado = 'rechazada', motivo = left(p_motivo, 300), resuelta_por = auth.uid(), resuelta_at = now(), updated_at = now() where id = s.id;
  v_t := 'Gracias por tus datos. Por ahora no pudimos completar tu verificación: ' || left(p_motivo, 200) || '. Si quieres, mándame una foto clara de tu cédula profesional y lo revisamos de nuevo.';
  update public.cc_conversations set ultimo_seq = ultimo_seq + 1, last_message_at = now(), updated_at = now() where id = s.conversation_id returning ultimo_seq into v_seq;
  insert into public.cc_messages (conversation_id, seq, actor_type, client_message_id, content, content_hash)
  values (s.conversation_id, v_seq, 'ai', 'tpl:alta_wa_no:' || s.id, v_t, md5(v_t)) on conflict do nothing;
  return jsonb_build_object('rechazada', true);
end;
$$;

-- ── 3 · Señal de interés → el humano se entera (sin quitarle la conversación a la IA) ─────────────
create or replace function public.cc_senal_interes(p_conv uuid, p_motivo text) returns text
  language plpgsql security definer set search_path = public as
$$
begin
  perform public._cc_solo_servicio();
  return public._cc_avisar_responsable(p_conv, 'senal_compra',
    public._cc_nombre_dueno(p_conv) || ' muestra interés de compra (' || left(coalesce(p_motivo, 'compra'), 40) || '); la IA lo está atendiendo. Entra si quieres tomarlo.',
    'senal_compra:' || p_conv || ':' || to_char(now() at time zone 'America/Mazatlan', 'YYYYMMDDHH24'));
end;
$$;

-- Las alertas nuevas también suenan y llegan como push urgente.
create or replace function public.aviso_push_carga(p_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare n public.notifications; v_perfiles uuid[];
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into n from public.notifications where id = p_id;
  if not found then return null; end if;
  v_perfiles := coalesce(n.user_ids, '{}') || coalesce((select array_agg(p.id) from public.profiles p where p.active and p.role_id = any (coalesce(n.roles, '{}'))), '{}');
  if coalesce(array_length(v_perfiles, 1), 0) = 0 then return null; end if;
  return jsonb_build_object('perfiles', to_jsonb(v_perfiles), 'kind', n.kind, 'body', n.body, 'conversation_id', n.conversation_id,
    'title', case n.kind when 'handoff_asignado' then '🔔 Cliente esperando' when 'retoma' then '🔔 Tu cliente volvió a escribir'
                         when 'cliente_escribe' then '💬 Tu cliente está escribiendo' when 'handoff_escalado' then '⚠️ Cliente sin atender'
                         when 'handoff_sin_vendedor' then '⚠️ Solicitud sin vendedor' when 'handoff_aviso' then '⏰ Cliente esperando'
                         when 'senal_compra' then '🛒 Señal de compra' when 'verificacion_wa' then '🪪 Verificar a un cliente' else 'Renovacell' end);
end;
$$;
drop trigger if exists cc_aviso_push on public.notifications;
create trigger cc_aviso_push after insert on public.notifications for each row
  when (new.kind in ('handoff_asignado', 'handoff_aviso', 'handoff_escalado', 'handoff_sin_vendedor', 'retoma', 'cliente_escribe', 'senal_compra', 'verificacion_wa'))
  execute function public._cc_aviso_push_tr();

do $g$ begin
  execute 'revoke all on function public._cc_avisar_responsable(uuid, text, text, text), public.cc_ia_solicitar_alta(uuid, text, text, text, text, text), public.cc_alta_wa_cerrar(uuid, uuid, uuid, uuid), public.cc_senal_interes(uuid, text), public.cc_solicitud_alta_de(uuid), public.cc_solicitud_alta_rechazar(uuid, text) from public, anon, authenticated';
  execute 'grant execute on function public.cc_ia_solicitar_alta(uuid, text, text, text, text, text), public.cc_alta_wa_cerrar(uuid, uuid, uuid, uuid), public.cc_senal_interes(uuid, text) to service_role';
  execute 'grant execute on function public.cc_solicitud_alta_de(uuid), public.cc_solicitud_alta_rechazar(uuid, text) to authenticated';
end $g$;
