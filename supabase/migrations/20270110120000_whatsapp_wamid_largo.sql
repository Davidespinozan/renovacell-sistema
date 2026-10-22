-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- META-04 · HOTFIX WhatsApp: identificadores wamid largos (migración 188)
--   Hecho (22 oct 2026, logs de meta-webhook v32 + reproducción local): Meta emite para el número de la empresa wamids de ≈ 82
--   caracteres; cc_wa_entrante guardaba el mensaje con client_message_id = 'wa:' || wamid, que supera el límite de 80 de
--   ck_ccm_client_id (cc_messages) → 23514 → la Edge responde 500 → Meta reintenta durante horas y descarta: TODOS los WhatsApp
--   nuevos se perdían desde el 20 oct 22:30Z. Los 23 guardados tenían wamids de 62–66.
--   Corrección mínima: el client_message_id pasa a ser un derivado de LONGITUD FIJA y resistente a colisiones
--   ('wa:' || sha256(wamid) = 67 caracteres) en cc_wa_entrante; el wamid COMPLETO sigue siendo la autoridad de deduplicación en
--   cc_wa_mensajes (hasta 200). Mismo defecto latente en cc_meta_entrante ('meta:' || mid; los mid de Instagram miden > 100):
--   se corrige igual. Mensajes históricos intactos (conservan su client_message_id); nada lee ese prefijo fuera de estas funciones.
--   Rollback: supabase/rollback/whatsapp_wamid_largo/99_down.sql (restaura las definiciones de la 168 y la 170).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public.cc_wa_entrante(text,text,text,text,boolean)') is null then raise exception 'META-04: falta la 168 (cc_wa_entrante)'; end if;
  if to_regprocedure('public.cc_meta_entrante(text,text,text,text,text,boolean)') is null then raise exception 'META-04: falta la 170 (cc_meta_entrante)'; end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_ccm_client_id') then raise exception 'META-04: falta ck_ccm_client_id'; end if;
  if to_regprocedure('public._cc_client_id_canal(text,text)') is not null then raise exception 'META-04: ya aplicada'; end if;
end $pre$;

-- Derivado determinista de longitud fija (prefijo + ':' + sha256 hex = prefijo + 65): mismo id de origen → mismo client_message_id
-- (la idempotencia de cc_enviar_mensaje sigue funcionando en un reintento); ids distintos → ids distintos.
create function public._cc_client_id_canal(p_prefijo text, p_id text) returns text
  language sql immutable parallel safe set search_path = public as
$$ select p_prefijo || ':' || encode(extensions.digest(coalesce(p_id, ''), 'sha256'), 'hex') $$;
revoke all on function public._cc_client_id_canal(text, text) from public, anon, authenticated;

-- cc_wa_entrante: texto de la 168 con el client_message_id derivado (dos líneas).
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
    r := public.cc_enviar_mensaje(v_conv, 'doctor', null, k.profile_id, public._cc_client_id_canal('wa', p_wamid), left(p_texto, 4000));
  else
    v_actor := 'visitor';
    if k.visitor_hash is null then
      v_hash := encode(extensions.digest(gen_random_uuid()::text || clock_timestamp()::text || random()::text, 'sha256'), 'hex');
      update public.cc_wa_contactos set visitor_hash = v_hash,
             visitor_id = (public.cc_visitante_abrir(null, v_hash, '{}'::jsonb, null) ->> 'visitor_id')::uuid
       where wa_id = p_wa_id;
    else v_hash := k.visitor_hash; end if;
    v_conv := (public.cc_abrir_conversacion(v_hash, null) ->> 'conversation_id')::uuid;
    r := public.cc_enviar_mensaje(v_conv, 'visitor', v_hash, null, public._cc_client_id_canal('wa', p_wamid), left(p_texto, 4000));
  end if;

  insert into public.cc_wa_mensajes (wamid, wa_id, conversation_id, message_id, direccion) values (p_wamid, p_wa_id, v_conv, (r ->> 'id')::uuid, 'in');
  if v_activo or coalesce(p_encolar, false) then perform public._cc_wa_a_cola(v_conv); end if;
  return jsonb_build_object('duplicado', false, 'conversation_id', v_conv, 'message_id', r ->> 'id', 'seq', (r ->> 'seq')::bigint,
                            'actor', v_actor, 'profile_id', k.profile_id, 'visitor_hash', case when v_actor = 'visitor' then v_hash end,
                            'activo', v_activo, 'modo', (select modo from public.cc_conversations where id = v_conv));
end;
$$;

-- cc_meta_entrante: texto de la 170 con el client_message_id derivado (una línea).
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
  r := public.cc_enviar_mensaje(v_conv, 'visitor', v_hash, null, public._cc_client_id_canal('meta', p_mid), left(p_texto, 4000));

  insert into public.cc_meta_mensajes (mid, canal, psid, conversation_id, message_id, direccion) values (p_mid, p_canal, p_psid, v_conv, (r ->> 'id')::uuid, 'in');
  if coalesce(v_activo, false) or coalesce(p_encolar, false) then perform public._cc_canal_a_cola(v_conv, p_canal); end if;
  return jsonb_build_object('duplicado', false, 'conversation_id', v_conv, 'message_id', r ->> 'id', 'seq', (r ->> 'seq')::bigint,
                            'actor', 'visitor', 'profile_id', null, 'visitor_hash', v_hash, 'nuevo', v_nuevo and k.nombre is null,
                            'activo', coalesce(v_activo, false), 'modo', (select modo from public.cc_conversations where id = v_conv));
end;
$$;

do $post$ begin
  if position('_cc_client_id_canal' in pg_get_functiondef('public.cc_wa_entrante(text,text,text,text,boolean)'::regprocedure)) = 0 then raise exception 'META-04: cc_wa_entrante sin el derivado'; end if;
  if position('_cc_client_id_canal' in pg_get_functiondef('public.cc_meta_entrante(text,text,text,text,text,boolean)'::regprocedure)) = 0 then raise exception 'META-04: cc_meta_entrante sin el derivado'; end if;
  if length(public._cc_client_id_canal('wa', repeat('x', 200))) <> 67 or length(public._cc_client_id_canal('meta', repeat('y', 200))) <> 69 then raise exception 'META-04: longitud del derivado'; end if;
  if public._cc_client_id_canal('wa', 'a') = public._cc_client_id_canal('wa', 'b') then raise exception 'META-04: derivado no distingue'; end if;
end $post$;
