-- R4-C5-A2 · ROLLBACK EXACTO a B2: restaura las 13 funciones tal como están en producción (definición B2 literal), quita la
-- tabla de permisos, la función central, las guardias y las RPC, y devuelve los CHECK de cc_wa_config.
-- Se NIEGA si WhatsApp está en 'prueba' (primero cerrar: modo espejo) o hay permisos vigentes. Los permisos (auditoría) se
-- copian al historial de controles antes de quitar la tabla. Ejecutar en UNA transacción: psql -1 -v ON_ERROR_STOP=1 -f 99_down.sql
do $pre$ begin
  if to_regclass('public.cc_canal_prueba') is null then raise exception 'R4-C5 down: no está aplicada'; end if;
  if (select modo from public.cc_wa_config where id) = 'prueba' then raise exception 'R4-C5 down: WhatsApp está en prueba; ciérralo primero (espejo)'; end if;
  if exists (select 1 from public.cc_canal_prueba where revocado_at is null and vence_at > now()) then raise exception 'R4-C5 down: hay permisos vigentes; revócalos primero'; end if;
end $pre$;
insert into public.cc_canal_control_hist (canal, antes, despues, origen, motivo)
select 'whatsapp', to_jsonb(p), '{"r4c5_down": true}'::jsonb, 'directo', 'R4-C5 rollback: permiso de prueba archivado' from public.cc_canal_prueba p order by p.id;
drop trigger if exists trg_cc_wa_config_cierre_prueba on public.cc_wa_config;
drop trigger if exists trg_cc_wa_config_guardia on public.cc_wa_config;
CREATE OR REPLACE FUNCTION public.cc_wa_entrante(p_wa_id text, p_nombre text, p_wamid text, p_texto text, p_encolar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public._cc_wa_a_cola(p_conv uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if public._cc_canal_ia_atiende('whatsapp') then return; end if;   -- IA primero: el mensaje no pide asesor; atiende la IA
  perform public._cc_canal_transferir(p_conv, 'whatsapp', 'wa', 'ia_apagada', true);
end;
$function$;

CREATE OR REPLACE FUNCTION public._cc_ia_permitida_en(p_conv uuid, p_bloquear boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_canal text := public._cc_canal_de(p_conv);
begin
  if v_canal is null then return true; end if;
  if p_bloquear then
    if v_canal = 'whatsapp' then perform 1 from public.cc_wa_config where id for share;
    else perform 1 from public.cc_meta_config where canal = v_canal for share; end if;
  end if;
  return public._cc_canal_ia_atiende(v_canal);
end;
$function$;

CREATE OR REPLACE FUNCTION public._cc_wa_encolar()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare k public.cc_wa_contactos; v_modo text; v_pausa boolean; v_estado text;
begin
  if not (new.actor_type in ('seller', 'admin', 'ai') or (new.actor_type = 'system' and public._cc_aviso_canal_permitido(new.client_message_id, 'whatsapp'))) then return new; end if;
  -- candado compartido: se ordena contra una pausa en curso (o ya se ve, o la pausa retiene esta fila al confirmarse)
  select modo, envio_pausado into v_modo, v_pausa from public.cc_wa_config where id for share;
  if v_modo is distinct from 'activo' then return new; end if;
  k := public._cc_wa_contacto_de(new.conversation_id);
  if k.wa_id is null then return new; end if;
  v_estado := case when not (k.ultimo_entrante_at > now() - interval '24 hours') or k.ultimo_entrante_at is null then 'fuera_ventana' when v_pausa then 'retenido' else 'pendiente' end;
  insert into public.cc_wa_salida (message_id, conversation_id, wa_id, texto, estado, retenido_at, resultado)
  values (new.id, new.conversation_id, k.wa_id, left(new.content, 4000), v_estado,
          case when v_estado = 'retenido' then now() end, case when v_estado = 'retenido' then jsonb_build_object('retenido_por', 'pausa') end)
  on conflict (message_id) do nothing;
  return new;
exception when others then
  raise warning 'WA_ENCOLAR_FALLO: % (%)', sqlerrm, new.id;   -- WhatsApp nunca tumba el mensaje del chat
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_wa_salida_reclamar(p_limite integer DEFAULT 20)
 RETURNS SETOF cc_wa_salida
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_ok boolean;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  update public.cc_wa_salida set estado = 'incierto', incierto_at = now(),
         resultado = coalesce(resultado, '{}'::jsonb) || jsonb_build_object('clase', 'incierto', 'detalle', 'sin resolución 5 min después de reclamarse')
   where estado = 'enviando' and reclamado_at < now() - interval '5 minutes';
  v_ok := public._cc_canal_envio_habilitado('whatsapp', true);
  if not v_ok then return; end if;
  return query
  update public.cc_wa_salida s set estado = 'enviando', reclamado_at = now(), intentos = s.intentos + 1
   where s.id in (select x.id from public.cc_wa_salida x
                   where x.estado = 'pendiente' and x.intentos < 5
                   order by x.created_at limit greatest(1, least(coalesce(p_limite, 20), 50)) for update skip locked)
  returning s.*;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_wa_salida_puede_enviar(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  return public._cc_canal_envio_habilitado('whatsapp', true)
     and exists (select 1 from public.cc_wa_salida where id = p_id and estado = 'enviando' and reclamado_at > now() - interval '5 minutes');
end;
$function$;

CREATE OR REPLACE FUNCTION public._cc_canal_retener_pendientes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_motivo text;
begin
  if (new.envio_pausado and not old.envio_pausado) then v_motivo := 'pausa';
  elsif (new.modo <> 'activo' and old.modo = 'activo') then v_motivo := 'canal_no_activo';
  else return null; end if;
  if tg_table_name = 'cc_wa_config' then
    update public.cc_wa_salida set estado = 'retenido', retenido_at = now(), resultado = coalesce(resultado, '{}'::jsonb) || jsonb_build_object('retenido_por', v_motivo)
     where estado = 'pendiente';
  else
    update public.cc_meta_salida set estado = 'retenido', retenido_at = now(), resultado = coalesce(resultado, '{}'::jsonb) || jsonb_build_object('retenido_por', v_motivo)
     where estado = 'pendiente' and canal = (to_jsonb(new) ->> 'canal');
  end if;
  return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public._cc_exclusividad_canal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_canal text; v_modo_canal text; c record;
begin
  if new.actor_type not in ('admin', 'seller') then return new; end if;
  v_canal := public._cc_canal_de(new.conversation_id);
  if v_canal is null then return new; end if;   -- portal: sin cambios
  -- candado compartido: un cambio a espejo en curso se ordena con esta escritura (o ya se ve, o espera a que termine)
  if v_canal = 'whatsapp' then select modo into v_modo_canal from public.cc_wa_config where id for share;
  else select modo into v_modo_canal from public.cc_meta_config where canal = v_canal for share; end if;
  if v_modo_canal is distinct from 'activo' then
    raise exception 'CANAL_EN_ESPEJO: el canal % no está activo; no se envían respuestas', v_canal using errcode = 'check_violation';
  end if;
  select modo, seller_profile_id, tomada_por into c from public.cc_conversations where id = new.conversation_id;
  if new.actor_type = 'admin' then
    if c.modo <> 'human_active' then raise exception 'TOMA_REQUERIDA: toma la conversación antes de responder' using errcode = 'insufficient_privilege'; end if;
    if c.tomada_por is distinct from new.actor_profile_id then raise exception 'ATENDIDA_POR_OTRO: otra persona atiende esta conversación' using errcode = 'insufficient_privilege'; end if;
  else
    if c.modo <> 'human_active' then raise exception 'ASESORIA_NO_INICIADA: modo %', c.modo using errcode = 'insufficient_privilege'; end if;
    if c.tomada_por is not null or c.seller_profile_id is distinct from new.actor_profile_id then
      raise exception 'ATENDIDA_POR_OTRO: otra persona atiende esta conversación' using errcode = 'insufficient_privilege';
    end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_canal_cambiar(p_canal text, p_cambios jsonb, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_mot text := btrim(coalesce(p_motivo, '')); k text;
        a_modo text; a_ia boolean; a_pausa boolean; n_modo text; n_ia boolean; n_pausa boolean;
begin
  if v_uid is null or not public._cc_es_admin() then raise exception 'NO_AUTORIZADO: solo Dirección' using errcode = 'insufficient_privilege'; end if;
  if p_canal is null or p_canal not in ('whatsapp', 'instagram', 'messenger') then raise exception 'CANAL_INVALIDO: %', coalesce(p_canal, 'null') using errcode = 'check_violation'; end if;
  if p_cambios is null or jsonb_typeof(p_cambios) <> 'object' or p_cambios = '{}'::jsonb then raise exception 'CAMBIO_INVALIDO: se espera un objeto con modo, ia_habilitada o envio_pausado' using errcode = 'check_violation'; end if;
  for k in select jsonb_object_keys(p_cambios) loop
    if k not in ('modo', 'ia_habilitada', 'envio_pausado') then raise exception 'CAMBIO_INVALIDO: propiedad no permitida %', k using errcode = 'check_violation'; end if;
  end loop;
  if p_cambios ? 'modo' and (jsonb_typeof(p_cambios -> 'modo') <> 'string' or p_cambios ->> 'modo' not in ('espejo', 'activo')) then raise exception 'CAMBIO_INVALIDO: modo' using errcode = 'check_violation'; end if;
  if p_cambios ? 'ia_habilitada' and jsonb_typeof(p_cambios -> 'ia_habilitada') <> 'boolean' then raise exception 'CAMBIO_INVALIDO: ia_habilitada' using errcode = 'check_violation'; end if;
  if p_cambios ? 'envio_pausado' and jsonb_typeof(p_cambios -> 'envio_pausado') <> 'boolean' then raise exception 'CAMBIO_INVALIDO: envio_pausado' using errcode = 'check_violation'; end if;

  -- Fila bloqueada: los cambios concurrentes del mismo canal se serializan y cada uno decide sobre el estado vigente.
  if p_canal = 'whatsapp' then select modo, ia_habilitada, envio_pausado into a_modo, a_ia, a_pausa from public.cc_wa_config where id for update;
  else select modo, ia_habilitada, envio_pausado into a_modo, a_ia, a_pausa from public.cc_meta_config where canal = p_canal for update; end if;
  if a_modo is null then raise exception 'CANAL_INVALIDO: sin configuración para %', p_canal using errcode = 'check_violation'; end if;

  n_modo := coalesce(p_cambios ->> 'modo', a_modo);
  n_ia := coalesce((p_cambios ->> 'ia_habilitada')::boolean, a_ia);
  n_pausa := coalesce((p_cambios ->> 'envio_pausado')::boolean, a_pausa);
  if n_modo = 'espejo' and n_ia and p_cambios ? 'ia_habilitada' then raise exception 'IA_REQUIERE_ACTIVO: la IA solo se enciende con el canal en activo' using errcode = 'check_violation'; end if;
  if n_modo = 'espejo' then n_ia := false; end if;   -- volver a espejo apaga la IA en el mismo cambio

  if (n_modo, n_ia, n_pausa) is not distinct from (a_modo, a_ia, a_pausa) then
    return jsonb_build_object('cambiado', false, 'canal', p_canal, 'estado', jsonb_build_object('modo', a_modo, 'ia_habilitada', a_ia, 'envio_pausado', a_pausa));
  end if;
  if length(v_mot) < 5 then raise exception 'MOTIVO_REQUERIDO: explica el cambio (mínimo 5 caracteres)' using errcode = 'check_violation'; end if;
  if length(v_mot) > 500 then raise exception 'MOTIVO_LARGO: máximo 500 caracteres' using errcode = 'check_violation'; end if;
  if ((n_modo = 'activo' and a_modo <> 'activo') or (n_ia and not a_ia)) and not public._cc_canal_activacion_lista() then
    raise exception 'ACTIVACION_BLOQUEADA: activar el canal o encender la IA requiere completar R4-B2 (pausa en cola y exclusividad IA/humano)' using errcode = 'insufficient_privilege';
  end if;

  perform set_config('rc.canal_origen', 'rpc', true);
  perform set_config('rc.canal_motivo', v_mot, true);
  if p_canal = 'whatsapp' then update public.cc_wa_config set modo = n_modo, ia_habilitada = n_ia, envio_pausado = n_pausa where id;   -- WHERE explícito (safeupdate)
  else update public.cc_meta_config set modo = n_modo, ia_habilitada = n_ia, envio_pausado = n_pausa where canal = p_canal; end if;
  perform set_config('rc.canal_origen', '', true);
  perform set_config('rc.canal_motivo', '', true);

  return jsonb_build_object('cambiado', true, 'canal', p_canal,
    'antes', jsonb_build_object('modo', a_modo, 'ia_habilitada', a_ia, 'envio_pausado', a_pausa),
    'despues', jsonb_build_object('modo', n_modo, 'ia_habilitada', n_ia, 'envio_pausado', n_pausa));
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_canal_conversacion_control(p_conv uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.cc_wa_conversacion(p_conv uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare k public.cc_wa_contactos;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  k := public._cc_wa_contacto_de(p_conv);
  if k.wa_id is null then return null; end if;
  return jsonb_build_object('wa_id', k.wa_id, 'modo', (select modo from public.cc_wa_config),
    'ventana_hasta', k.ultimo_entrante_at + interval '24 hours', 'ventana_abierta', k.ultimo_entrante_at > now() - interval '24 hours',
    'fallidos', (select count(*) from public.cc_wa_salida where conversation_id = p_conv and estado in ('fallido', 'fuera_ventana')));
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_canal_conversacion(p_conv uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare w public.cc_wa_contactos; m public.cc_meta_contactos;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  w := public._cc_wa_contacto_de(p_conv);
  if w.wa_id is not null then
    return jsonb_build_object('canal', 'whatsapp', 'id', w.wa_id, 'wa_id', w.wa_id, 'modo', (select modo from public.cc_wa_config),
      'ventana_hasta', w.ultimo_entrante_at + interval '24 hours', 'ventana_abierta', w.ultimo_entrante_at > now() - interval '24 hours',
      'fallidos', (select count(*) from public.cc_wa_salida where conversation_id = p_conv and estado in ('fallido', 'fuera_ventana')));
  end if;
  m := public._cc_meta_contacto_de(p_conv);
  if m.psid is null then return null; end if;
  return jsonb_build_object('canal', m.canal, 'id', m.psid, 'modo', (select modo from public.cc_meta_config where canal = m.canal),
    'ventana_hasta', m.ultimo_entrante_at + interval '24 hours', 'ventana_abierta', m.ultimo_entrante_at > now() - interval '24 hours',
    'fallidos', (select count(*) from public.cc_meta_salida where conversation_id = p_conv and estado in ('fallido', 'fuera_ventana')));
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_canal_estado()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if not (public._cc_es_admin() or public._cc_es_service()) then raise exception 'NO_AUTORIZADO: solo Dirección' using errcode = 'insufficient_privilege'; end if;
  return jsonb_build_object(
    'activacion_disponible', public._cc_canal_activacion_lista(),
    'canales', (select jsonb_agg(x order by x ->> 'canal') from (
        select jsonb_build_object('canal', 'whatsapp', 'modo', w.modo, 'ia_habilitada', w.ia_habilitada, 'envio_pausado', w.envio_pausado, 'updated_at', w.updated_at) x from public.cc_wa_config w
        union all
        select jsonb_build_object('canal', m.canal, 'modo', m.modo, 'ia_habilitada', m.ia_habilitada, 'envio_pausado', m.envio_pausado, 'updated_at', m.updated_at) from public.cc_meta_config m
          where m.canal in ('instagram', 'messenger')) s),
    'historial', coalesce((select jsonb_agg(jsonb_build_object('canal', h.canal, 'antes', h.antes, 'despues', h.despues, 'origen', h.origen,
                                                     'actor', coalesce(p.full_name, p.email), 'motivo', h.motivo, 'at', h.created_at) order by h.id desc)
                           from (select * from public.cc_canal_control_hist order by id desc limit 30) h left join public.profiles p on p.id = h.actor_profile_id), '[]'::jsonb));
end;
$function$;

drop function if exists public.cc_canal_prueba_revocar(uuid, text);
drop function if exists public.cc_canal_prueba_autorizar(uuid, integer, text);
drop function if exists public._cc_wa_config_cierre_prueba();
drop function if exists public._cc_wa_config_guardia();
drop table if exists public.cc_canal_prueba;
drop function if exists public._cc_canal_prueba_al_revocar();
drop function if exists public._cc_canal_prueba_guardia();
drop function if exists public._cc_wa_modo_efectivo(text, boolean);
drop function if exists public._cc_canal_prueba_vigentes();
alter table public.cc_wa_config drop constraint ck_wa_ia_requiere_activo;
alter table public.cc_wa_config add constraint ck_wa_ia_requiere_activo check (not ia_habilitada or modo = 'activo');
alter table public.cc_wa_config drop constraint cc_wa_config_modo_check;
alter table public.cc_wa_config add constraint cc_wa_config_modo_check check (modo in ('espejo', 'activo'));
