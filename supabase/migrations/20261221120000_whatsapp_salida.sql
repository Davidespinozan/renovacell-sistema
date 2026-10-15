-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- WHATSAPP DE IDA Y VUELTA (migración 168) · WA-2: LO QUE SE CONTESTA EN CONVERSACIONES LLEGA POR WHATSAPP
--   Objetivo del dueño (15 oct 2026): Renovacell reemplaza a Leadsales. Lo que contestan la IA, la vendedora o Dirección
--   en una conversación de WhatsApp sale por WhatsApp; las palomitas azules reflejan cuando el cliente lo lee.
--   · cc_wa_config          NUEVA. Un renglón: modo del canal ('espejo' = solo registrar; 'activo' = atender y
--                           contestar). Se cambia con UNA instrucción el día del cambio (sin desplegar nada).
--   · cc_wa_salida          NUEVA. Cola de salida: un renglón por mensaje a entregar por WhatsApp (estado, wamid,
--                           intentos, error). Fuera de la ventana de 24 h de Meta queda 'fuera_ventana' (no se manda).
--   · _cc_wa_encolar (trigger en cc_messages)  NUEVA. Mensaje del personal o de la IA en una conversación cuyo dueño
--                           tiene WhatsApp → a la cola (solo en modo activo). Los avisos del sistema no salen.
--   · cc_wa_salida_reclamar / cc_wa_salida_resolver  NUEVAS (servidor). Tomar y asentar envíos (sin dobles).
--   · cc_wa_estado          NUEVA (servidor). Acuse de Meta: 'read' → palomitas azules (cursor de lectura del dueño).
--   · cc_wa_conversacion    NUEVA (servidor). ¿Es de WhatsApp? ¿la ventana de 24 h está abierta? (para la pantalla).
--   · _whatsapp_despachar + tarea cada minuto: reintento de lo que no salió al instante (pg_net → meta-send).
--   · cc_wa_entrante        un cambio: el modo lo dice cc_wa_config (ya no la Edge) y devuelve lo que la IA necesita.
--   NO cambia: el chat web, la IA, la verificación ni los correos.
--   Aplicar en UNA transacción. Rollback: supabase/rollback/whatsapp_salida/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.cc_wa_salida') is not null then raise exception 'WHATSAPP-SALIDA: ya aplicada'; end if;
  if to_regprocedure('public.cc_wa_entrante(text,text,text,text,boolean)') is null then raise exception 'WHATSAPP-SALIDA: falta la 167'; end if;
end $pre$;

create table public.cc_wa_config (
  id         boolean primary key default true check (id),
  modo       text not null default 'espejo' check (modo in ('espejo', 'activo')),
  updated_at timestamptz not null default now()
);
insert into public.cc_wa_config (id, modo) values (true, 'espejo');
comment on table public.cc_wa_config is 'WHATSAPP · modo del canal: espejo (solo registra) | activo (atiende y contesta por WhatsApp).';

create table public.cc_wa_salida (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid not null unique references public.cc_messages(id) on delete restrict,
  conversation_id uuid not null references public.cc_conversations(id) on delete restrict,
  wa_id           text not null references public.cc_wa_contactos(wa_id) on delete restrict,
  texto           text not null,
  estado          text not null default 'pendiente' check (estado in ('pendiente', 'enviando', 'enviado', 'fallido', 'fuera_ventana')),
  wamid           text unique,
  intentos        int not null default 0,
  error           text,
  reclamado_at    timestamptz,
  created_at      timestamptz not null default now(),
  enviado_at      timestamptz,
  check ((estado = 'enviado') = (wamid is not null))
);
create index ix_cc_wa_salida_cola on public.cc_wa_salida (estado, created_at) where estado in ('pendiente', 'enviando');
comment on table public.cc_wa_salida is 'WHATSAPP · cola de salida: lo que el personal o la IA contestan, a entregar por WhatsApp. Solo el servidor.';
alter table public.cc_wa_config enable row level security;
alter table public.cc_wa_salida enable row level security;
revoke all on table public.cc_wa_config, public.cc_wa_salida from public, anon, authenticated;
grant select, insert, update on table public.cc_wa_config, public.cc_wa_salida to service_role;

-- El contacto de WhatsApp del dueño de una conversación (por su cuenta o por su visitante interno).
create function public._cc_wa_contacto_de(p_conv uuid) returns public.cc_wa_contactos
  language sql stable security definer set search_path = public as
$$
  select w.* from public.cc_conversations c join public.cc_wa_contactos w
      on (c.profile_id is not null and w.profile_id = c.profile_id) or (c.profile_id is null and w.visitor_id = c.visitor_id)
   where c.id = p_conv order by w.ultimo_entrante_at desc nulls last limit 1
$$;

create function public._cc_wa_encolar() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare k public.cc_wa_contactos;
begin
  if new.actor_type not in ('seller', 'admin', 'ai') then return new; end if;
  if (select modo from public.cc_wa_config) <> 'activo' then return new; end if;
  k := public._cc_wa_contacto_de(new.conversation_id);
  if k.wa_id is null then return new; end if;
  insert into public.cc_wa_salida (message_id, conversation_id, wa_id, texto, estado)
  values (new.id, new.conversation_id, k.wa_id, left(new.content, 4000),
          case when k.ultimo_entrante_at > now() - interval '24 hours' then 'pendiente' else 'fuera_ventana' end)
  on conflict (message_id) do nothing;
  return new;
exception when others then
  raise warning 'WA_ENCOLAR_FALLO: % (%)', sqlerrm, new.id;   -- WhatsApp nunca tumba el mensaje del chat
  return new;
end;
$$;
create trigger trg_cc_wa_encolar after insert on public.cc_messages for each row execute function public._cc_wa_encolar();

create function public.cc_wa_salida_reclamar(p_limite int default 20) returns setof public.cc_wa_salida
  language plpgsql security definer set search_path = public as
$$
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  return query
  update public.cc_wa_salida s set estado = 'enviando', reclamado_at = now(), intentos = s.intentos + 1
   where s.id in (select x.id from public.cc_wa_salida x
                   where (x.estado = 'pendiente' or (x.estado = 'enviando' and x.reclamado_at < now() - interval '2 minutes'))
                     and x.intentos < 5
                   order by x.created_at limit greatest(1, least(coalesce(p_limite, 20), 50)) for update skip locked)
  returning s.*;
end;
$$;

create function public.cc_wa_salida_resolver(p_id uuid, p_ok boolean, p_wamid text, p_error text) returns void
  language plpgsql security definer set search_path = public as
$$
declare s public.cc_wa_salida;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into s from public.cc_wa_salida where id = p_id for update;
  if not found or s.estado <> 'enviando' then return; end if;
  if p_ok and nullif(btrim(coalesce(p_wamid, '')), '') is not null then
    update public.cc_wa_salida set estado = 'enviado', wamid = p_wamid, enviado_at = now(), error = null where id = p_id;
    insert into public.cc_wa_mensajes (wamid, wa_id, conversation_id, message_id, direccion) values (p_wamid, s.wa_id, s.conversation_id, s.message_id, 'out') on conflict do nothing;
  else
    update public.cc_wa_salida set estado = case when s.intentos >= 5 then 'fallido' else 'pendiente' end, error = left(coalesce(p_error, 'sin detalle'), 300) where id = p_id;
  end if;
end;
$$;

-- Acuse de Meta. 'read' de un mensaje nuestro → el dueño lo leyó (palomitas azules). 'failed' → queda el error.
create function public.cc_wa_estado(p_wamid text, p_estado text, p_error text default null) returns void
  language plpgsql security definer set search_path = public as
$$
declare s public.cc_wa_salida; m record; c record;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into s from public.cc_wa_salida where wamid = p_wamid;
  if not found then return; end if;
  if p_estado = 'failed' then
    update public.cc_wa_salida set error = left(coalesce(p_error, 'Meta no lo entregó'), 300) where id = s.id;
  elsif p_estado = 'read' then
    select seq into m from public.cc_messages where id = s.message_id;
    select profile_id, visitor_id into c from public.cc_conversations where id = s.conversation_id;
    update public.cc_participants set last_read_seq = greatest(last_read_seq, m.seq), last_read_at = now()
     where conversation_id = s.conversation_id and rol = 'dueno';
  end if;
end;
$$;

-- Para la pantalla: ¿es una conversación de WhatsApp y hasta cuándo se le puede escribir?
create function public.cc_wa_conversacion(p_conv uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare k public.cc_wa_contactos;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  k := public._cc_wa_contacto_de(p_conv);
  if k.wa_id is null then return null; end if;
  return jsonb_build_object('wa_id', k.wa_id, 'modo', (select modo from public.cc_wa_config),
    'ventana_hasta', k.ultimo_entrante_at + interval '24 hours', 'ventana_abierta', k.ultimo_entrante_at > now() - interval '24 hours',
    'fallidos', (select count(*) from public.cc_wa_salida where conversation_id = p_conv and estado in ('fallido', 'fuera_ventana')));
end;
$$;

-- cc_wa_entrante: el modo sale de cc_wa_config; devuelve visitor_hash para que la IA conteste como en el chat.
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

-- Respaldo cada minuto: lo que no salió al instante (Meta lenta, error de red) se reintenta.
create function public._whatsapp_despachar() returns text
  language plpgsql security definer set search_path = public as
$$
declare v_url text; v_secreto text;
begin
  if not exists (select 1 from public.cc_wa_salida where estado = 'pendiente' or (estado = 'enviando' and reclamado_at < now() - interval '2 minutes')) then
    return 'sin_pendientes';
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'project_url';
  select decrypted_secret into v_secreto from vault.decrypted_secrets where name = 'comm_cron_secret';
  if v_url is null or v_secreto is null then return 'sin_configurar'; end if;
  perform net.http_post(url := rtrim(v_url, '/') || '/functions/v1/meta-send',
                        headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secreto),
                        body := '{"action":"despachar"}'::jsonb, timeout_milliseconds := 30000);
  return 'despachado';
end;
$$;

alter function public._cc_wa_contacto_de(uuid) owner to postgres;
alter function public._cc_wa_encolar() owner to postgres;
alter function public.cc_wa_salida_reclamar(int) owner to postgres;
alter function public.cc_wa_salida_resolver(uuid, boolean, text, text) owner to postgres;
alter function public.cc_wa_estado(text, text, text) owner to postgres;
alter function public.cc_wa_conversacion(uuid) owner to postgres;
alter function public._whatsapp_despachar() owner to postgres;
revoke all on function public._cc_wa_contacto_de(uuid), public._cc_wa_encolar(), public.cc_wa_salida_reclamar(int), public.cc_wa_salida_resolver(uuid, boolean, text, text),
  public.cc_wa_estado(text, text, text), public.cc_wa_conversacion(uuid), public._whatsapp_despachar() from public, anon, authenticated;
grant execute on function public.cc_wa_salida_reclamar(int), public.cc_wa_salida_resolver(uuid, boolean, text, text), public.cc_wa_estado(text, text, text), public.cc_wa_conversacion(uuid) to service_role;
revoke all on function public.cc_wa_entrante(text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.cc_wa_entrante(text, text, text, text, boolean) to service_role;

select cron.schedule('renovacell-whatsapp', '* * * * *', 'select public._whatsapp_despachar()');

do $post$ begin
  if (select modo from public.cc_wa_config) <> 'espejo' then raise exception 'WHATSAPP-SALIDA: debe nacer en espejo'; end if;
  if has_function_privilege('authenticated', 'public.cc_wa_salida_reclamar(integer)', 'execute') or has_table_privilege('authenticated', 'public.cc_wa_salida', 'select') then
    raise exception 'WHATSAPP-SALIDA: permisos inesperados';
  end if;
end $post$;
