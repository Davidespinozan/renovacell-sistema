-- WHATSAPP DE IDA Y VUELTA · rollback de la migración 168: vuelve cc_wa_entrante de la 167, se va la cola de salida.
select cron.unschedule('renovacell-whatsapp');
drop function public._whatsapp_despachar();
drop trigger trg_cc_wa_encolar on public.cc_messages;
drop function public.cc_wa_conversacion(uuid);
drop function public.cc_wa_estado(text, text, text);
drop function public.cc_wa_salida_resolver(uuid, boolean, text, text);
drop function public.cc_wa_salida_reclamar(int);
drop function public._cc_wa_encolar();
drop function public._cc_wa_contacto_de(uuid);
drop table public.cc_wa_salida;
drop table public.cc_wa_config;
create or replace function public.cc_wa_entrante(p_wa_id text, p_nombre text, p_wamid text, p_texto text, p_encolar boolean default false) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare k public.cc_wa_contactos; v_prof uuid; v_hash text; v_conv uuid; r jsonb; v_actor text; v_nombre text := nullif(btrim(left(coalesce(p_nombre, ''), 120)), '');
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if p_wa_id !~ '^[0-9]{8,15}$' or length(coalesce(p_wamid, '')) not between 8 and 200 then raise exception 'WA_DATOS_INVALIDOS' using errcode = 'check_violation'; end if;
  if nullif(btrim(coalesce(p_texto, '')), '') is null then raise exception 'WA_SIN_TEXTO' using errcode = 'check_violation'; end if;
  -- Un reintento de Meta del MISMO mensaje no hace nada (ni duplica ni vuelve a encolar).
  if exists (select 1 from public.cc_wa_mensajes where wamid = p_wamid) then
    return jsonb_build_object('duplicado', true, 'conversation_id', (select conversation_id from public.cc_wa_mensajes where wamid = p_wamid));
  end if;

  insert into public.cc_wa_contactos (wa_id, nombre) values (p_wa_id, v_nombre) on conflict (wa_id) do nothing;
  select * into k from public.cc_wa_contactos where wa_id = p_wa_id for update;
  -- Si todavía no es de una cuenta, se vuelve a buscar (pudo registrarse después con ese celular).
  if k.profile_id is null then
    v_prof := public._cc_wa_perfil(p_wa_id);
    if v_prof is not null then update public.cc_wa_contactos set profile_id = v_prof where wa_id = p_wa_id; k.profile_id := v_prof; end if;
  end if;

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
  update public.cc_wa_contactos set ultimo_entrante_at = now(), nombre = coalesce(v_nombre, nombre) where wa_id = p_wa_id;
  if coalesce(p_encolar, false) then perform public._cc_wa_a_cola(v_conv); end if;
  return jsonb_build_object('duplicado', false, 'conversation_id', v_conv, 'message_id', r ->> 'id', 'seq', (r ->> 'seq')::bigint,
                            'actor', v_actor, 'profile_id', k.profile_id, 'modo', (select modo from public.cc_conversations where id = v_conv));
end;
$$;
revoke all on function public.cc_wa_entrante(text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.cc_wa_entrante(text, text, text, text, boolean) to service_role;
