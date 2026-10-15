-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- WHATSAPP EN EL CHAT (migración 167) · WA-1: LOS WHATSAPP ENTRAN A CONVERSACIONES
--   Decisión del dueño (15 oct 2026): conectar el WhatsApp ACTUAL de la empresa al chat canónico (IA primero y avisa a la
--   vendedora). Primero en MODO ESPEJO: los mensajes se registran en Conversaciones mientras Leadsales sigue atendiendo;
--   nadie contesta desde aquí ni se avisa a nadie. El modo lo decide la Edge meta-webhook (WA_MODO).
--   · cc_wa_contactos      NUEVA. Un contacto por número de WhatsApp: su doctor (si su celular coincide con UNA cuenta)
--                          o un visitante interno (con un token aleatorio que ningún navegador conoce).
--   · cc_wa_mensajes       NUEVA. Un renglón por mensaje de WhatsApp (wamid): un reintento de Meta nunca duplica.
--   · cc_wa_entrante       NUEVA (servidor). Registra un WhatsApp entrante en la conversación de su dueño, con la misma
--                          autoridad que el chat (cc_abrir_conversacion / cc_enviar_mensaje). En modo activo además lo
--                          pasa a la cola de su vendedora o de Dirección (igual que el enlace de contacto).
--   · _cc_nombre_dueno     un cambio: un visitante de WhatsApp se ve como "Nombre (WhatsApp)".
--   NO cambia: el chat web, la IA, la verificación ni el código viejo de Messenger/Instagram.
--   Aplicar en UNA transacción. Rollback: supabase/rollback/whatsapp_canal/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.cc_wa_contactos') is not null then raise exception 'WHATSAPP-CANAL: ya aplicada'; end if;
  if md5(pg_get_functiondef('public._cc_nombre_dueno(uuid)'::regprocedure)) <> '1ebaa87f1e9a1072df6d1eb16b3a0c92' then
    raise exception 'WHATSAPP-CANAL: _cc_nombre_dueno no es la versión auditada (150)';
  end if;
  if to_regprocedure('public._tel10(text)') is null then raise exception 'WHATSAPP-CANAL: falta _tel10 (161)'; end if;
end $pre$;

create table public.cc_wa_contactos (
  wa_id              text primary key check (wa_id ~ '^[0-9]{8,15}$'),
  nombre             text check (nombre is null or length(nombre) <= 120),
  visitor_id         uuid unique references public.cc_visitors(id) on delete restrict,
  visitor_hash       text unique check (visitor_hash is null or visitor_hash ~ '^[0-9a-f]{64}$'),
  profile_id         uuid references public.profiles(id) on delete set null,
  ultimo_entrante_at timestamptz,
  created_at         timestamptz not null default now()
);
comment on table public.cc_wa_contactos is 'WHATSAPP · contacto por número: su cuenta de doctor (por celular) o un visitante interno. Solo el servidor.';
create table public.cc_wa_mensajes (
  wamid           text primary key check (length(wamid) between 8 and 200),
  wa_id           text not null references public.cc_wa_contactos(wa_id) on delete restrict,
  conversation_id uuid references public.cc_conversations(id) on delete restrict,
  message_id      uuid references public.cc_messages(id) on delete restrict,
  direccion       text not null check (direccion in ('in', 'out')),
  created_at      timestamptz not null default now()
);
comment on table public.cc_wa_mensajes is 'WHATSAPP · un renglón por mensaje (wamid de Meta): idempotencia ante reintentos. Solo el servidor.';
create index ix_cc_wa_mensajes_conv on public.cc_wa_mensajes (conversation_id, created_at);
alter table public.cc_wa_contactos enable row level security;
alter table public.cc_wa_mensajes enable row level security;
revoke all on table public.cc_wa_contactos, public.cc_wa_mensajes from public, anon, authenticated;
grant select, insert, update on table public.cc_wa_contactos, public.cc_wa_mensajes to service_role;

-- La cuenta de doctor de ese número: UNA sola coincidencia por celular (su perfil o su ficha de cliente); si no, ninguna.
create function public._cc_wa_perfil(p_wa_id text) returns uuid
  language sql stable security definer set search_path = public as
$$
  select case when count(distinct x.id) = 1 then min(x.id::text)::uuid end
    from (select p.id from public.profiles p
           where p.role_id = 'doctor' and p.active is not false
             and public._tel10(coalesce(p.meta -> 'shipping' ->> 'phone', p.meta ->> 'phone')) = public._tel10(p_wa_id)
          union
          select k.profile_id from public.customers k join public.profiles p on p.id = k.profile_id and p.role_id = 'doctor'
           where k.active and k.profile_id is not null and public._tel10(k.phone) = public._tel10(p_wa_id)) x
$$;

-- A la cola humana (su vendedora o Dirección) como el enlace de contacto; solo modo activo y con 12 h de respiro.
create function public._cc_wa_a_cola(p_conv uuid) returns void
  language plpgsql security definer set search_path = public as
$$
declare c record; hor jsonb; v_conf boolean; v_en boolean; ru jsonb;
begin
  select * into c from public.cc_conversations where id = p_conv for update;
  if c.estado <> 'abierta' or c.modo not in ('ai_active', 'human_offered')
     or (c.asesoria_solicitada_at is not null and c.asesoria_solicitada_at > now() - interval '12 hours') then return; end if;
  hor := public._cc_horario_estado(now()); v_conf := (hor ->> 'configurado')::boolean; v_en := v_conf and coalesce((hor ->> 'abierto')::boolean, false);
  perform public._cc_sistema(p_conv, public._cc_texto_handoff(v_conf, v_en), 'sys:wa:' || c.ultimo_seq);
  perform public._cc_cambiar_modo(p_conv, 'human_requested', 'human_requested', case when c.profile_id is null then 'visitor' else 'doctor' end,
          c.profile_id, c.visitor_id, jsonb_build_object('origen', 'whatsapp', 'fuera_horario', not v_en, 'horario_configurado', v_conf));
  update public.cc_conversations set handoff_origen = 'manual', handoff_cart_id = null, handoff_fuera_horario = not v_en where id = p_conv;
  ru := public._cc_rutear(p_conv);
  if not (ru ->> 'asignado')::boolean then
    perform public._cc_evento(p_conv, 'human_handoff_queued', 'system', null, null, jsonb_build_object('motivo', ru ->> 'motivo', 'fuera_horario', not v_en, 'origen', 'whatsapp'));
  end if;
end;
$$;

create function public.cc_wa_entrante(p_wa_id text, p_nombre text, p_wamid text, p_texto text, p_encolar boolean default false) returns jsonb
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

CREATE OR REPLACE FUNCTION public._cc_nombre_dueno(p_conv uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select case when c.profile_id is not null then coalesce((select coalesce(p.meta ->> 'name', p.full_name) from public.profiles p where p.id = c.profile_id), 'Doctor') else coalesce((select r.nombre || case when r.posible_customer_id is not null then ' (posible cliente, sin confirmar)' else ' (prerregistro)' end from public.cc_prerregistros r where r.visitor_id = c.visitor_id), (select coalesce(w.nombre, '+' || w.wa_id) || ' (WhatsApp)' from public.cc_wa_contactos w where w.visitor_id = c.visitor_id), 'Visitante') end
     from public.cc_conversations c where c.id = p_conv $function$;

alter function public._cc_wa_perfil(text) owner to postgres;
alter function public._cc_wa_a_cola(uuid) owner to postgres;
alter function public.cc_wa_entrante(text, text, text, text, boolean) owner to postgres;
revoke all on function public._cc_wa_perfil(text), public._cc_wa_a_cola(uuid), public.cc_wa_entrante(text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.cc_wa_entrante(text, text, text, text, boolean) to service_role;

do $post$ begin
  if has_function_privilege('authenticated', 'public.cc_wa_entrante(text,text,text,text,boolean)', 'execute')
     or has_table_privilege('authenticated', 'public.cc_wa_contactos', 'select') then
    raise exception 'WHATSAPP-CANAL: permisos inesperados';
  end if;
end $post$;
