-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- R4-C5-A2 · MODO PRUEBA POR CONTACTO (solo WhatsApp). Permite probar IA-first con contactos AUTORIZADOS uno por uno, con
-- vencimiento corto, mientras el resto de WhatsApp sigue en espejo y la compuerta de 'activo' sigue CERRADA.
--   · cc_canal_prueba: permisos temporales (contacto = wa_id existente; vence ≤ 24 h; quién y por qué; revocación auditable;
--     nunca se borran). RLS sin políticas (denegado por defecto); solo RPC de Dirección o postgres.
--   · _cc_wa_modo_efectivo(wa_id): 'activo' si el canal está en 'activo', o en 'prueba' y el contacto tiene permiso vigente;
--     si no, 'espejo'. Se consulta al recibir, al decidir la IA, al encolar, al reclamar, en el ÚLTIMO chequeo antes del POST y
--     al permitir escritura humana / toma.
--   · Guardia en cc_wa_config (también contra UPDATE directo): 'activo' solo con la compuerta abierta; 'prueba' solo con
--     permisos vigentes. Salir de 'prueba' revoca los permisos vigentes (quedan en el historial) y retiene lo pendiente.
--   · Revocar o vencer un permiso: deja de ser elegible al instante (todas las consultas comparan con now()); lo pendiente
--     de ese contacto se retiene (al revocar: en la misma transacción; al vencer: en el siguiente reclamo). Un POST que ya
--     pasó el último chequeo NO se puede cancelar (límite documentado).
--   No cambia Instagram/Messenger, R4-B1, chat, cart ni el frontend. Instalarla NO cambia el estado operativo.
--   Rollback: supabase/rollback/canal_prueba_contacto/99_down.sql
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public.cc_canal_panel(text)') is null then raise exception 'R4-C5: falta B2 completo (0118–0122)'; end if;
  if to_regclass('public.cc_canal_prueba') is not null then raise exception 'R4-C5: ya aplicada'; end if;
  if (select modo from public.cc_wa_config where id) <> 'espejo' then raise exception 'R4-C5: WhatsApp debe estar en espejo para instalar'; end if;
  if md5(pg_get_functiondef('public.cc_wa_entrante(text,text,text,text,boolean)'::regprocedure)) <> '8c928393e68010e7d8cbacb9791454a4' then raise exception 'R4-C5: cc_wa_entrante no tiene la definición esperada (B2 en producción)'; end if;
  if md5(pg_get_functiondef('public._cc_wa_a_cola(uuid)'::regprocedure)) <> '8d868414c740481aabc55821c690b772' then raise exception 'R4-C5: _cc_wa_a_cola no tiene la definición esperada (B2 en producción)'; end if;
  if md5(pg_get_functiondef('public._cc_ia_permitida_en(uuid,boolean)'::regprocedure)) <> '003f28d9f266d6b2735f19b3a8f21765' then raise exception 'R4-C5: _cc_ia_permitida_en no tiene la definición esperada (B2 en producción)'; end if;
  if md5(pg_get_functiondef('public._cc_wa_encolar()'::regprocedure)) <> '2cd24a83ff723f1f189069a806d0fca0' then raise exception 'R4-C5: _cc_wa_encolar no tiene la definición esperada (B2 en producción)'; end if;
  if md5(pg_get_functiondef('public.cc_wa_salida_reclamar(integer)'::regprocedure)) <> '719a854eb9b295545454d117de64095e' then raise exception 'R4-C5: cc_wa_salida_reclamar no tiene la definición esperada (B2 en producción)'; end if;
  if md5(pg_get_functiondef('public.cc_wa_salida_puede_enviar(uuid)'::regprocedure)) <> 'c0f149bd4d90c48f10524e85e82c87cb' then raise exception 'R4-C5: cc_wa_salida_puede_enviar no tiene la definición esperada (B2 en producción)'; end if;
  if md5(pg_get_functiondef('public._cc_canal_retener_pendientes()'::regprocedure)) <> 'ac283d37ec2c16f7b925b1d968859e3f' then raise exception 'R4-C5: _cc_canal_retener_pendientes no tiene la definición esperada (B2 en producción)'; end if;
  if md5(pg_get_functiondef('public._cc_exclusividad_canal()'::regprocedure)) <> '7a4e2ade962460a1f60ff237f999f9d2' then raise exception 'R4-C5: _cc_exclusividad_canal no tiene la definición esperada (B2 en producción)'; end if;
  if md5(pg_get_functiondef('public.cc_canal_cambiar(text,jsonb,text)'::regprocedure)) <> '857b64fca39b84ab85035e2e89024638' then raise exception 'R4-C5: cc_canal_cambiar no tiene la definición esperada (B2 en producción)'; end if;
  if md5(pg_get_functiondef('public.cc_canal_conversacion_control(uuid)'::regprocedure)) <> '84a3896db408c4e646230b0a7da88b35' then raise exception 'R4-C5: cc_canal_conversacion_control no tiene la definición esperada (B2 en producción)'; end if;
  if md5(pg_get_functiondef('public.cc_wa_conversacion(uuid)'::regprocedure)) <> '583c26a4a92714fe7866acb3ebe5e31e' then raise exception 'R4-C5: cc_wa_conversacion no tiene la definición esperada (B2 en producción)'; end if;
  if md5(pg_get_functiondef('public.cc_canal_conversacion(uuid)'::regprocedure)) <> 'ff84b79a20ec68db6729c72ec94646af' then raise exception 'R4-C5: cc_canal_conversacion no tiene la definición esperada (B2 en producción)'; end if;
  if md5(pg_get_functiondef('public.cc_canal_estado()'::regprocedure)) <> '71ae43068250b0e0932a0e43fe451a76' then raise exception 'R4-C5: cc_canal_estado no tiene la definición esperada (B2 en producción)'; end if;
end $pre$;

-- ── Permisos temporales de prueba ────────────────────────────────────────────────────────────────────
create table public.cc_canal_prueba (
  id bigserial primary key,
  canal text not null default 'whatsapp' check (canal = 'whatsapp'),
  contacto text not null check (contacto ~ '^[0-9]{8,15}$'),                 -- wa_id de WhatsApp (existe en cc_wa_contactos: lo exige la guardia); nunca un PSID de Meta
  autorizado_por uuid not null references public.profiles(id),
  motivo text not null check (length(btrim(motivo)) between 5 and 500),
  creado_at timestamptz not null default now(),
  vence_at timestamptz not null,
  revocado_at timestamptz, revocado_por uuid references public.profiles(id), revocado_motivo text check (revocado_motivo is null or length(revocado_motivo) <= 500),
  constraint ck_ccp_vence check (vence_at > creado_at and vence_at <= creado_at + interval '24 hours'),
  constraint ck_ccp_revocacion check ((revocado_at is null) = (revocado_motivo is null)));
comment on table public.cc_canal_prueba is 'R4-C5 · contactos autorizados para el modo prueba de WhatsApp. Nunca se borran; la revocación queda registrada.';
create unique index uq_ccp_vigente on public.cc_canal_prueba (canal, contacto) where revocado_at is null;
alter table public.cc_canal_prueba enable row level security;
revoke all on table public.cc_canal_prueba from public, anon, authenticated;
revoke all on sequence public.cc_canal_prueba_id_seq from public, anon, authenticated;

-- Inmutabilidad: al crear, el reloj y la revocación los fija el servidor; después solo se puede revocar (una vez); nunca borrar.
create function public._cc_canal_prueba_guardia() returns trigger
  language plpgsql set search_path = public as
$$
begin
  if tg_op = 'DELETE' then raise exception 'PRUEBA_INMUTABLE: los permisos de prueba no se borran (se revocan)' using errcode = 'insufficient_privilege'; end if;
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.cc_wa_contactos where wa_id = new.contacto) then
      raise exception 'PRUEBA_CONTACTO_INEXISTENTE: el número no es un contacto de WhatsApp' using errcode = 'foreign_key_violation';
    end if;
    new.creado_at := now(); new.revocado_at := null; new.revocado_por := null; new.revocado_motivo := null;
    if new.vence_at <= now() + interval '1 minute' or new.vence_at > now() + interval '24 hours' then
      raise exception 'PRUEBA_VENCIMIENTO_INVALIDO: entre 1 minuto y 24 horas' using errcode = 'check_violation';
    end if;
    return new;
  end if;
  if old.revocado_at is not null then raise exception 'PRUEBA_INMUTABLE: ya revocado' using errcode = 'insufficient_privilege'; end if;
  if (new.id, new.canal, new.contacto, new.autorizado_por, new.motivo, new.creado_at, new.vence_at) is distinct from
     (old.id, old.canal, old.contacto, old.autorizado_por, old.motivo, old.creado_at, old.vence_at) or new.revocado_at is null then
    raise exception 'PRUEBA_INMUTABLE: solo se puede revocar' using errcode = 'insufficient_privilege';
  end if;
  new.revocado_at := now();
  return new;
end;
$$;
create trigger trg_ccp_guardia before insert or update or delete on public.cc_canal_prueba for each row execute function public._cc_canal_prueba_guardia();

-- Al revocar: lo pendiente de ESE contacto se retiene en la misma transacción (no sale ni saldrá después).
create function public._cc_canal_prueba_al_revocar() returns trigger
  language plpgsql security definer set search_path = public as
$$
begin
  update public.cc_wa_salida set estado = 'retenido', retenido_at = now(),
         resultado = coalesce(resultado, '{}'::jsonb) || jsonb_build_object('retenido_por', 'permiso_revocado')
   where estado = 'pendiente' and wa_id = new.contacto;
  return null;
end;
$$;
create trigger trg_ccp_al_revocar after update on public.cc_canal_prueba for each row
  when (old.revocado_at is null and new.revocado_at is not null) execute function public._cc_canal_prueba_al_revocar();

create function public._cc_canal_prueba_vigentes() returns integer
  language sql stable security definer set search_path = public as
$$ select count(*)::int from public.cc_canal_prueba where canal = 'whatsapp' and revocado_at is null and vence_at > now() $$;

-- ── Función central ─────────────────────────────────────────────────────────────────────────────────
create function public._cc_wa_modo_efectivo(p_wa_id text, p_bloquear boolean default false) returns text
  language plpgsql security definer set search_path = public as
$$
declare v_modo text; v_ok boolean;
begin
  if p_bloquear then select modo into v_modo from public.cc_wa_config where id for share;
  else select modo into v_modo from public.cc_wa_config where id; end if;
  if v_modo = 'activo' then return 'activo'; end if;
  if v_modo is distinct from 'prueba' or p_wa_id is null then return 'espejo'; end if;
  if p_bloquear then
    perform 1 from public.cc_canal_prueba where canal = 'whatsapp' and contacto = p_wa_id and revocado_at is null and vence_at > now() for share;
    v_ok := found;   -- candado compartido: una revocación en curso espera a esta verificación (y viceversa)
  else
    v_ok := exists (select 1 from public.cc_canal_prueba where canal = 'whatsapp' and contacto = p_wa_id and revocado_at is null and vence_at > now());
  end if;
  return case when v_ok then 'activo' else 'espejo' end;
end;
$$;

-- ── Modo 'prueba' en la configuración de WhatsApp (Meta no cambia) ───────────────────────────────────
alter table public.cc_wa_config drop constraint cc_wa_config_modo_check;
alter table public.cc_wa_config add constraint cc_wa_config_modo_check check (modo in ('espejo', 'activo', 'prueba'));
alter table public.cc_wa_config drop constraint ck_wa_ia_requiere_activo;
alter table public.cc_wa_config add constraint ck_wa_ia_requiere_activo check (not ia_habilitada or modo in ('activo', 'prueba'));

-- Guardia (antes de normalizar): también un UPDATE directo por SQL respeta la compuerta y la regla de permisos.
create function public._cc_wa_config_guardia() returns trigger
  language plpgsql security definer set search_path = public as
$$
begin
  if new.modo = 'activo' and old.modo is distinct from 'activo' and not public._cc_canal_activacion_lista() then
    raise exception 'ACTIVACION_BLOQUEADA: la compuerta de activación sigue cerrada' using errcode = 'insufficient_privilege';
  end if;
  if new.modo = 'prueba' and old.modo is distinct from 'prueba' and public._cc_canal_prueba_vigentes() = 0 then
    raise exception 'PRUEBA_SIN_PERMISOS: autoriza primero un contacto de prueba' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
create trigger trg_cc_wa_config_guardia before update on public.cc_wa_config for each row execute function public._cc_wa_config_guardia();

-- Salir de 'prueba' (a espejo) revoca los permisos vigentes; quedan en el historial (no se borran).
create function public._cc_wa_config_cierre_prueba() returns trigger
  language plpgsql security definer set search_path = public as
$$
begin
  update public.cc_canal_prueba set revocado_at = now(), revocado_motivo = 'cierre del modo prueba (canal a ' || new.modo || ')'
   where canal = 'whatsapp' and revocado_at is null;
  return null;
end;
$$;
create trigger trg_cc_wa_config_cierre_prueba after update on public.cc_wa_config for each row
  when (old.modo = 'prueba' and new.modo is distinct from 'prueba') execute function public._cc_wa_config_cierre_prueba();

-- ── RPC de Dirección (por conversación: el número nunca viaja ni se muestra completo) ───────────────
create function public.cc_canal_prueba_autorizar(p_conv uuid, p_minutos integer, p_motivo text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_uid uuid := auth.uid(); v_mot text := btrim(coalesce(p_motivo, '')); k public.cc_wa_contactos; v_id bigint; v_vence timestamptz;
begin
  if v_uid is null or not public._cc_es_admin() then raise exception 'NO_AUTORIZADO: solo Dirección' using errcode = 'insufficient_privilege'; end if;
  if p_minutos is null or p_minutos not between 5 and 240 then raise exception 'PRUEBA_MINUTOS: de 5 a 240' using errcode = 'check_violation'; end if;
  if length(v_mot) < 5 or length(v_mot) > 500 then raise exception 'MOTIVO_REQUERIDO: de 5 a 500 caracteres' using errcode = 'check_violation'; end if;
  k := public._cc_wa_contacto_de(p_conv);
  if k.wa_id is null then raise exception 'PRUEBA_NO_WHATSAPP: la conversación no es de WhatsApp' using errcode = 'check_violation'; end if;
  -- un permiso vencido sin revocar se cierra (con su motivo) antes de dar otro
  update public.cc_canal_prueba set revocado_at = now(), revocado_por = v_uid, revocado_motivo = 'vencido'
   where canal = 'whatsapp' and contacto = k.wa_id and revocado_at is null and vence_at <= now();
  if exists (select 1 from public.cc_canal_prueba where canal = 'whatsapp' and contacto = k.wa_id and revocado_at is null) then
    raise exception 'PRUEBA_YA_AUTORIZADA: ese contacto ya tiene un permiso vigente' using errcode = 'unique_violation';
  end if;
  insert into public.cc_canal_prueba (canal, contacto, autorizado_por, motivo, vence_at)
  values ('whatsapp', k.wa_id, v_uid, v_mot, now() + make_interval(mins => p_minutos)) returning id, vence_at into v_id, v_vence;
  return jsonb_build_object('id', v_id, 'contacto', '…' || right(k.wa_id, 4), 'vence_at', v_vence);
end;
$$;

create function public.cc_canal_prueba_revocar(p_conv uuid, p_motivo text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_uid uuid := auth.uid(); v_mot text := btrim(coalesce(p_motivo, '')); k public.cc_wa_contactos; n int;
begin
  if v_uid is null or not public._cc_es_admin() then raise exception 'NO_AUTORIZADO: solo Dirección' using errcode = 'insufficient_privilege'; end if;
  if length(v_mot) < 5 or length(v_mot) > 500 then raise exception 'MOTIVO_REQUERIDO: de 5 a 500 caracteres' using errcode = 'check_violation'; end if;
  k := public._cc_wa_contacto_de(p_conv);
  if k.wa_id is null then raise exception 'PRUEBA_NO_WHATSAPP: la conversación no es de WhatsApp' using errcode = 'check_violation'; end if;
  update public.cc_canal_prueba set revocado_at = now(), revocado_por = v_uid, revocado_motivo = v_mot
   where canal = 'whatsapp' and contacto = k.wa_id and revocado_at is null;
  get diagnostics n = row_count;
  return jsonb_build_object('revocados', n, 'contacto', '…' || right(k.wa_id, 4), 'vigentes_restantes', public._cc_canal_prueba_vigentes());
end;
$$;

-- ── Funciones B2 ajustadas (cambios de 1–3 líneas; el resto, idéntico a producción) ────────────────
CREATE OR REPLACE FUNCTION public.cc_wa_entrante(p_wa_id text, p_nombre text, p_wamid text, p_texto text, p_encolar boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare k public.cc_wa_contactos; v_prof uuid; v_hash text; v_conv uuid; r jsonb; v_actor text; v_nombre text := nullif(btrim(left(coalesce(p_nombre, ''), 120)), '');
        v_activo boolean := public._cc_wa_modo_efectivo(p_wa_id) = 'activo';   -- R4-C5 · modo efectivo por contacto ('prueba': solo contactos con permiso vigente)
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
  if public._cc_ia_permitida_en(p_conv) then return; end if;   -- R4-C5 · por conversación (= contacto); en 'activo' equivale a la regla anterior   -- IA primero: el mensaje no pide asesor; atiende la IA
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
  if v_canal = 'whatsapp' then
    -- R4-C5 · IA encendida en el canal y el contacto atendido ('activo', o 'prueba' con permiso vigente)
    if p_bloquear then perform 1 from public.cc_wa_config where id for share; end if;
    return coalesce((select ia_habilitada from public.cc_wa_config where id), false)
       and public._cc_wa_modo_efectivo((public._cc_wa_contacto_de(p_conv)).wa_id, p_bloquear) = 'activo';
  end if;
  if p_bloquear then perform 1 from public.cc_meta_config where canal = v_canal for share; end if;
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
  if v_modo is distinct from 'activo' and v_modo is distinct from 'prueba' then return new; end if;
  k := public._cc_wa_contacto_de(new.conversation_id);
  if k.wa_id is null then return new; end if;
  -- R4-C5 · en 'prueba' solo se encola para un contacto con permiso vigente; el resto sigue en espejo
  if v_modo = 'prueba' and public._cc_wa_modo_efectivo(k.wa_id, true) <> 'activo' then return new; end if;
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
declare v_ok boolean; v_modo text; v_pausa boolean;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  update public.cc_wa_salida set estado = 'incierto', incierto_at = now(),
         resultado = coalesce(resultado, '{}'::jsonb) || jsonb_build_object('clase', 'incierto', 'detalle', 'sin resolución 5 min después de reclamarse')
   where estado = 'enviando' and reclamado_at < now() - interval '5 minutes';
  select modo, envio_pausado into v_modo, v_pausa from public.cc_wa_config where id for share;
  if v_modo = 'prueba' then
    -- R4-C5 · lo pendiente de un contacto sin permiso vigente (vencido o revocado) se RETIENE: no sale ahora ni después
    update public.cc_wa_salida set estado = 'retenido', retenido_at = now(),
           resultado = coalesce(resultado, '{}'::jsonb) || jsonb_build_object('retenido_por', 'sin_permiso_prueba')
     where estado = 'pendiente' and public._cc_wa_modo_efectivo(wa_id) <> 'activo';
  end if;
  v_ok := coalesce(v_modo in ('activo', 'prueba') and not v_pausa, false);
  if not v_ok then return; end if;
  return query
  update public.cc_wa_salida s set estado = 'enviando', reclamado_at = now(), intentos = s.intentos + 1
   where s.id in (select x.id from public.cc_wa_salida x
                   where x.estado = 'pendiente' and x.intentos < 5
                     and (v_modo = 'activo' or public._cc_wa_modo_efectivo(x.wa_id, true) = 'activo')   -- R4-C5 · fila por fila
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
declare v_modo text; v_pausa boolean; v_wa text;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  -- R4-C5 · ÚLTIMO chequeo antes del POST: canal habilitado, sin pausa y ESTE contacto atendido. Los candados compartidos
  -- (configuración y permiso) ordenan esta verificación contra una pausa o una revocación en curso.
  select modo, envio_pausado into v_modo, v_pausa from public.cc_wa_config where id for share;
  if not coalesce(v_modo in ('activo', 'prueba') and not v_pausa, false) then return false; end if;
  select wa_id into v_wa from public.cc_wa_salida where id = p_id and estado = 'enviando' and reclamado_at > now() - interval '5 minutes';
  if v_wa is null then return false; end if;
  return public._cc_wa_modo_efectivo(v_wa, true) = 'activo';
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
  elsif (new.modo is distinct from old.modo and old.modo in ('activo', 'prueba')) then v_motivo := 'canal_no_activo';   -- R4-C5 · también al salir de 'prueba'
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
  if v_canal = 'whatsapp' and v_modo_canal = 'prueba' then   -- R4-C5 · modo efectivo por contacto: fuera de la lista sigue en espejo
    v_modo_canal := public._cc_wa_modo_efectivo((public._cc_wa_contacto_de(new.conversation_id)).wa_id, true);
  end if;
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
  if p_cambios ? 'modo' and (jsonb_typeof(p_cambios -> 'modo') <> 'string' or p_cambios ->> 'modo' not in ('espejo', 'activo', 'prueba')) then raise exception 'CAMBIO_INVALIDO: modo' using errcode = 'check_violation'; end if;
  if p_cambios ->> 'modo' = 'prueba' and p_canal <> 'whatsapp' then raise exception 'PRUEBA_SOLO_WHATSAPP: el modo prueba solo existe para WhatsApp' using errcode = 'check_violation'; end if;
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
  -- R4-C5 · 'activo' (y la IA en 'activo') siguen tras la compuerta; 'prueba' exige permisos vigentes y admite la IA
  if n_modo = 'prueba' and a_modo is distinct from 'prueba' and public._cc_canal_prueba_vigentes() = 0 then
    raise exception 'PRUEBA_SIN_PERMISOS: autoriza primero un contacto de prueba' using errcode = 'check_violation';
  end if;
  if ((n_modo = 'activo' and a_modo <> 'activo') or (n_ia and not a_ia and n_modo = 'activo')) and not public._cc_canal_activacion_lista() then
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
  if v_canal = 'whatsapp' and v_modo_canal = 'prueba' then v_modo_canal := public._cc_wa_modo_efectivo((public._cc_wa_contacto_de(p_conv)).wa_id); end if;   -- R4-C5 · modo efectivo por contacto

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
  return jsonb_build_object('wa_id', k.wa_id, 'modo', public._cc_wa_modo_efectivo(k.wa_id),   -- R4-C5 · modo efectivo por contacto
   
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
    return jsonb_build_object('canal', 'whatsapp', 'id', w.wa_id, 'wa_id', w.wa_id, 'modo', public._cc_wa_modo_efectivo(w.wa_id),   -- R4-C5 · modo efectivo por contacto
     
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
    -- R4-C5 · estado REAL del modo prueba: cuántos contactos vigentes (número enmascarado y vencimiento) y si opera
    'prueba', jsonb_build_object(
      'modo_whatsapp', (select modo from public.cc_wa_config where id),
      'vigentes', public._cc_canal_prueba_vigentes(),
      'operativa', (select modo = 'prueba' from public.cc_wa_config where id) and public._cc_canal_prueba_vigentes() > 0,
      'permisos', coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'contacto', '…' || right(p.contacto, 4), 'vence_at', p.vence_at,
                                                               'autorizado_por', public._cc_nombre_personal(p.autorizado_por)) order by p.vence_at)
                            from public.cc_canal_prueba p where p.revocado_at is null and p.vence_at > now()), '[]'::jsonb)),
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

-- ── Dueños y permisos ───────────────────────────────────────────────────────────────────────────────
alter function public._cc_canal_prueba_guardia() owner to postgres;
alter function public._cc_canal_prueba_al_revocar() owner to postgres;
alter function public._cc_canal_prueba_vigentes() owner to postgres;
alter function public._cc_wa_modo_efectivo(text, boolean) owner to postgres;
alter function public._cc_wa_config_guardia() owner to postgres;
alter function public._cc_wa_config_cierre_prueba() owner to postgres;
alter function public.cc_canal_prueba_autorizar(uuid, integer, text) owner to postgres;
alter function public.cc_canal_prueba_revocar(uuid, text) owner to postgres;
revoke all on function public._cc_canal_prueba_guardia(), public._cc_canal_prueba_al_revocar(), public._cc_canal_prueba_vigentes(),
  public._cc_wa_modo_efectivo(text, boolean), public._cc_wa_config_guardia(), public._cc_wa_config_cierre_prueba() from public, anon, authenticated;
revoke all on function public.cc_canal_prueba_autorizar(uuid, integer, text), public.cc_canal_prueba_revocar(uuid, text) from public, anon;
grant execute on function public.cc_canal_prueba_autorizar(uuid, integer, text), public.cc_canal_prueba_revocar(uuid, text) to authenticated;   -- exigen Dirección por dentro

do $post$ begin
  if public._cc_canal_activacion_lista() then raise exception 'R4-C5: la compuerta de activación debe seguir cerrada'; end if;
  if (select modo from public.cc_wa_config where id) <> 'espejo' or (select ia_habilitada from public.cc_wa_config where id) then raise exception 'R4-C5: instalar no debe cambiar el estado operativo'; end if;
  if exists (select 1 from public.cc_canal_prueba) then raise exception 'R4-C5: la tabla de permisos debe nacer vacía'; end if;
  if (select count(*) from pg_trigger where not tgisinternal and tgname in ('trg_ccp_guardia', 'trg_ccp_al_revocar', 'trg_cc_wa_config_guardia', 'trg_cc_wa_config_cierre_prueba')) <> 4 then
    raise exception 'R4-C5: faltan triggers';
  end if;
  if has_function_privilege('anon', 'public.cc_canal_prueba_autorizar(uuid,integer,text)', 'execute') or has_function_privilege('authenticated', 'public._cc_wa_modo_efectivo(text,boolean)', 'execute')
     or has_table_privilege('authenticated', 'public.cc_canal_prueba', 'select') or has_table_privilege('anon', 'public.cc_canal_prueba', 'select') then
    raise exception 'R4-C5: permisos de más';
  end if;
  if (select modo from public.cc_meta_config where canal = 'instagram') <> 'espejo' or (select modo from public.cc_meta_config where canal = 'messenger') <> 'espejo' then
    raise exception 'R4-C5: Instagram y Messenger deben seguir en espejo';
  end if;
end $post$;
