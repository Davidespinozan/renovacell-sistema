-- META-04 (188) · rollback: cc_wa_entrante vuelve EXACTAMENTE a la 168 y cc_meta_entrante a la 170; se retira el derivado.
-- Ojo: con esto los wamid/mid largos vuelven a fallar (23514). Mensajes ya guardados con el derivado se conservan.
-- Ejecutar en UNA transacción: psql -1 -v ON_ERROR_STOP=1 -f 99_down.sql
create or replace function public.cc_wa_entrante(p_wa_id text, p_nombre text, p_wamid text, p_texto text, p_encolar boolean default false) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare k public.cc_wa_contactos; v_prof uuid; v_hash text; v_conv uuid; r jsonb; v_actor text; v_nombre text := nullif(btrim(left(coalesce(p_nombre, ''), 120)), '');
        v_activo boolean := (select modo = 'activo' from public.cc_wa_config);
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if p_wa_id !~ '^[0-9]{8,15}$' or length(coalesce(p_wamid, '')) not between 8 and 200 then raise exception 'WA_DATOS_INVALIDOS' using errcode = 'check_violation'; end if;
  if nullif(btrim(coalesce(p_texto, '')), '') is null then raise exception 'WA_SIN_TEXTO' using errcode = 'check_violation'; end if;
  if exists (select 1 from public.cc_wa_mensajes where wamid = p_wamid) then
    return jsonb_build_object('duplicado', true, 'conversation_id', (select conversation_id from public.cc_wa_mensajes where wamid = p_wamid));
  end if;

  insert into public.cc_wa_contactos (wa_id, nombre) values (p_wa_id, v_nombre) on conflict (wa_id) do nothing;
  select * into k from public.cc_wa_contactos where wa_id = p_wa_id for update;
  if k.profile_id is null then
    v_prof := public._cc_wa_perfil(p_wa_id);
    if v_prof is not null then update public.cc_wa_contactos set profile_id = v_prof where wa_id = p_wa_id; k.profile_id := v_prof; end if;
  end if;
  -- La ventana de 24 h se abre ANTES de escribir el mensaje: así la respuesta de la IA ya puede salir.
  update public.cc_wa_contactos set ultimo_entrante_at = now(), nombre = coalesce(v_nombre, nombre) where wa_id = p_wa_id;

  if k.profile_id is not null then
    v_actor := 'doctor';
    v_conv := (public.cc_abrir_conversacion(null, k.profile_id) ->> 'conversation_id')::uuid;
    r := public.cc_enviar_mensaje(v_conv, 'doctor', null, k.profile_id, 'wa:' || p_wamid, left(p_texto, 4000));
  else
    v_actor := 'visitor';
    if k.visitor_hash is null then
      v_hash := encode(extensions.digest(gen_random_uuid()::text || clock_timestamp()::text || random()::text, 'sha256'), 'hex');
      update public.cc_wa_contactos set visitor_hash = v_hash,
             visitor_id = (public.cc_visitante_abrir(null, v_hash, '{}'::jsonb, null) ->> 'visitor_id')::uuid
       where wa_id = p_wa_id;
    else v_hash := k.visitor_hash; end if;
    v_conv := (public.cc_abrir_conversacion(v_hash, null) ->> 'conversation_id')::uuid;
    r := public.cc_enviar_mensaje(v_conv, 'visitor', v_hash, null, 'wa:' || p_wamid, left(p_texto, 4000));
  end if;

  insert into public.cc_wa_mensajes (wamid, wa_id, conversation_id, message_id, direccion) values (p_wamid, p_wa_id, v_conv, (r ->> 'id')::uuid, 'in');
  if v_activo or coalesce(p_encolar, false) then perform public._cc_wa_a_cola(v_conv); end if;
  return jsonb_build_object('duplicado', false, 'conversation_id', v_conv, 'message_id', r ->> 'id', 'seq', (r ->> 'seq')::bigint,
                            'actor', v_actor, 'profile_id', k.profile_id, 'visitor_hash', case when v_actor = 'visitor' then v_hash end,
                            'activo', v_activo, 'modo', (select modo from public.cc_conversations where id = v_conv));
end;
$$;

create or replace function public.cc_meta_entrante(p_canal text, p_psid text, p_nombre text, p_mid text, p_texto text, p_encolar boolean default false) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare k public.cc_meta_contactos; v_hash text; v_conv uuid; r jsonb; v_nombre text := nullif(btrim(left(coalesce(p_nombre, ''), 120)), '');
        v_activo boolean; v_nuevo boolean := false;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if p_canal not in ('instagram', 'messenger') or p_psid !~ '^[0-9]{5,40}$' or length(coalesce(p_mid, '')) not between 8 and 200 then
    raise exception 'META_DATOS_INVALIDOS' using errcode = 'check_violation';
  end if;
  if nullif(btrim(coalesce(p_texto, '')), '') is null then raise exception 'META_SIN_TEXTO' using errcode = 'check_violation'; end if;
  select modo = 'activo' into v_activo from public.cc_meta_config where canal = p_canal;
  if exists (select 1 from public.cc_meta_mensajes where mid = p_mid) then
    return jsonb_build_object('duplicado', true, 'conversation_id', (select conversation_id from public.cc_meta_mensajes where mid = p_mid));
  end if;

  insert into public.cc_meta_contactos (canal, psid, nombre) values (p_canal, p_psid, v_nombre) on conflict (canal, psid) do nothing;
  select * into k from public.cc_meta_contactos where canal = p_canal and psid = p_psid for update;
  -- La ventana de 24 h se abre ANTES de escribir el mensaje: así la respuesta de la IA ya puede salir.
  update public.cc_meta_contactos set ultimo_entrante_at = now(), nombre = coalesce(v_nombre, nombre) where canal = p_canal and psid = p_psid;
  if k.visitor_hash is null then
    v_nuevo := true;
    v_hash := encode(extensions.digest(gen_random_uuid()::text || clock_timestamp()::text || random()::text, 'sha256'), 'hex');
    update public.cc_meta_contactos set visitor_hash = v_hash,
           visitor_id = (public.cc_visitante_abrir(null, v_hash, '{}'::jsonb, null) ->> 'visitor_id')::uuid
     where canal = p_canal and psid = p_psid;
  else v_hash := k.visitor_hash; end if;
  v_conv := (public.cc_abrir_conversacion(v_hash, null) ->> 'conversation_id')::uuid;
  r := public.cc_enviar_mensaje(v_conv, 'visitor', v_hash, null, 'meta:' || p_mid, left(p_texto, 4000));

  insert into public.cc_meta_mensajes (mid, canal, psid, conversation_id, message_id, direccion) values (p_mid, p_canal, p_psid, v_conv, (r ->> 'id')::uuid, 'in');
  if coalesce(v_activo, false) or coalesce(p_encolar, false) then perform public._cc_canal_a_cola(v_conv, p_canal); end if;
  return jsonb_build_object('duplicado', false, 'conversation_id', v_conv, 'message_id', r ->> 'id', 'seq', (r ->> 'seq')::bigint,
                            'actor', 'visitor', 'profile_id', null, 'visitor_hash', v_hash, 'nuevo', v_nuevo and k.nombre is null,
                            'activo', coalesce(v_activo, false), 'modo', (select modo from public.cc_conversations where id = v_conv));
end;
$$;

drop function if exists public._cc_client_id_canal(text, text);
