-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- CANALES DE META (migración 170) · INSTAGRAM Y MESSENGER ENTRAN Y SALEN POR CONVERSACIONES, COMO WHATSAPP
--   Decisión del dueño (15 oct 2026): "¿no vamos a meter Instagram y Facebook?" → sí, igual que WhatsApp: en modo
--   ESPEJO se registran (Leadsales sigue contestando); en ACTIVO la IA contesta primero, avisa a la vendedora y la
--   respuesta sale por el mismo canal. Mismo diseño que la 167/168, en tablas propias (un contacto de Meta es un
--   PSID de página, no un teléfono: nunca se liga solo a una cuenta de doctor).
--   · cc_meta_config        modo por canal (instagram | messenger).
--   · cc_meta_contactos     un contacto por (canal, psid): su visitante interno (token que ningún navegador conoce).
--   · cc_meta_mensajes      un renglón por mensaje de Meta (mid): un reintento nunca duplica.
--   · cc_meta_salida        cola de salida (lo que contestan la IA, la vendedora o Dirección) con ventana de 24 h.
--   · cc_meta_entrante / cc_meta_nombre / cc_meta_salida_reclamar / cc_meta_salida_resolver (servidor).
--   · _cc_canal_a_cola      a la cola humana (como _cc_wa_a_cola) con el origen del canal.
--   · cc_canal_conversacion  (servidor) ¿de qué canal es esta conversación? WhatsApp o Meta, y su ventana.
--   · cc_canales_bandeja    (Dirección) la bandeja de la 169 con los tres canales.
--   · _cc_nombre_dueno      "Nombre (Instagram)" / "Nombre (Facebook)".
--   NO cambia: WhatsApp (167–169), el chat web, la IA ni la verificación.
--   Depende de la 169. Aplicar en UNA transacción. Rollback: supabase/rollback/meta_canales/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.cc_meta_contactos') is not null then raise exception 'META-CANALES: ya aplicada'; end if;
  if to_regclass('public.cc_wa_salida') is null or to_regprocedure('public.cc_wa_bandeja()') is null then raise exception 'META-CANALES: falta la 168/169'; end if;
  if md5(pg_get_functiondef('public._cc_nombre_dueno(uuid)'::regprocedure)) <> '39c39181b7af60d72a4bf0e1f849dae2' then
    raise exception 'META-CANALES: _cc_nombre_dueno no es la versión de la 167';
  end if;
end $pre$;

create table public.cc_meta_config (
  canal      text primary key check (canal in ('instagram', 'messenger')),
  modo       text not null default 'espejo' check (modo in ('espejo', 'activo')),
  updated_at timestamptz not null default now()
);
insert into public.cc_meta_config (canal, modo) values ('instagram', 'espejo'), ('messenger', 'espejo');
comment on table public.cc_meta_config is 'META · modo por canal: espejo (solo registra) | activo (atiende y contesta por el canal).';

create table public.cc_meta_contactos (
  canal              text not null check (canal in ('instagram', 'messenger')),
  psid               text not null check (psid ~ '^[0-9]{5,40}$'),
  nombre             text check (nombre is null or length(nombre) <= 120),
  visitor_id         uuid unique references public.cc_visitors(id) on delete restrict,
  visitor_hash       text unique check (visitor_hash is null or visitor_hash ~ '^[0-9a-f]{64}$'),
  profile_id         uuid references public.profiles(id) on delete set null,
  ultimo_entrante_at timestamptz,
  created_at         timestamptz not null default now(),
  primary key (canal, psid)
);
comment on table public.cc_meta_contactos is 'META · contacto por (canal, PSID de la página): visitante interno. Solo el servidor.';
create table public.cc_meta_mensajes (
  mid             text primary key check (length(mid) between 8 and 200),
  canal           text not null,
  psid            text not null,
  conversation_id uuid references public.cc_conversations(id) on delete restrict,
  message_id      uuid references public.cc_messages(id) on delete restrict,
  direccion       text not null check (direccion in ('in', 'out')),
  created_at      timestamptz not null default now(),
  foreign key (canal, psid) references public.cc_meta_contactos(canal, psid) on delete restrict
);
create index ix_cc_meta_mensajes_conv on public.cc_meta_mensajes (conversation_id, created_at);
create table public.cc_meta_salida (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid not null unique references public.cc_messages(id) on delete restrict,
  conversation_id uuid not null references public.cc_conversations(id) on delete restrict,
  canal           text not null,
  psid            text not null,
  texto           text not null,
  estado          text not null default 'pendiente' check (estado in ('pendiente', 'enviando', 'enviado', 'fallido', 'fuera_ventana')),
  mid             text unique,
  intentos        int not null default 0,
  error           text,
  reclamado_at    timestamptz,
  created_at      timestamptz not null default now(),
  enviado_at      timestamptz,
  check ((estado = 'enviado') = (mid is not null)),
  foreign key (canal, psid) references public.cc_meta_contactos(canal, psid) on delete restrict
);
create index ix_cc_meta_salida_cola on public.cc_meta_salida (estado, created_at) where estado in ('pendiente', 'enviando');
alter table public.cc_meta_config enable row level security;
alter table public.cc_meta_contactos enable row level security;
alter table public.cc_meta_mensajes enable row level security;
alter table public.cc_meta_salida enable row level security;
revoke all on table public.cc_meta_config, public.cc_meta_contactos, public.cc_meta_mensajes, public.cc_meta_salida from public, anon, authenticated;
grant select, insert, update on table public.cc_meta_config, public.cc_meta_contactos, public.cc_meta_mensajes, public.cc_meta_salida to service_role;

-- A la cola humana (su vendedora o Dirección) como el enlace de contacto; solo con 12 h de respiro. Origen = canal.
create function public._cc_canal_a_cola(p_conv uuid, p_origen text) returns void
  language plpgsql security definer set search_path = public as
$$
declare c record; hor jsonb; v_conf boolean; v_en boolean; ru jsonb;
begin
  select * into c from public.cc_conversations where id = p_conv for update;
  if c.estado <> 'abierta' or c.modo not in ('ai_active', 'human_offered')
     or (c.asesoria_solicitada_at is not null and c.asesoria_solicitada_at > now() - interval '12 hours') then return; end if;
  hor := public._cc_horario_estado(now()); v_conf := (hor ->> 'configurado')::boolean; v_en := v_conf and coalesce((hor ->> 'abierto')::boolean, false);
  perform public._cc_sistema(p_conv, public._cc_texto_handoff(v_conf, v_en), 'sys:' || p_origen || ':' || c.ultimo_seq);
  perform public._cc_cambiar_modo(p_conv, 'human_requested', 'human_requested', case when c.profile_id is null then 'visitor' else 'doctor' end,
          c.profile_id, c.visitor_id, jsonb_build_object('origen', p_origen, 'fuera_horario', not v_en, 'horario_configurado', v_conf));
  update public.cc_conversations set handoff_origen = 'manual', handoff_cart_id = null, handoff_fuera_horario = not v_en where id = p_conv;
  ru := public._cc_rutear(p_conv);
  if not (ru ->> 'asignado')::boolean then
    perform public._cc_evento(p_conv, 'human_handoff_queued', 'system', null, null, jsonb_build_object('motivo', ru ->> 'motivo', 'fuera_horario', not v_en, 'origen', p_origen));
  end if;
end;
$$;

create function public._cc_meta_contacto_de(p_conv uuid) returns public.cc_meta_contactos
  language sql stable security definer set search_path = public as
$$
  select m.* from public.cc_conversations c join public.cc_meta_contactos m
      on (c.profile_id is not null and m.profile_id = c.profile_id) or (c.profile_id is null and m.visitor_id = c.visitor_id)
   where c.id = p_conv order by m.ultimo_entrante_at desc nulls last limit 1
$$;

create function public.cc_meta_entrante(p_canal text, p_psid text, p_nombre text, p_mid text, p_texto text, p_encolar boolean default false) returns jsonb
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

-- Meta no manda el nombre con el mensaje: la Edge lo consulta aparte y lo guarda aquí (si lo consigue).
create function public.cc_meta_nombre(p_canal text, p_psid text, p_nombre text) returns void
  language plpgsql security definer set search_path = public as
$$
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  update public.cc_meta_contactos set nombre = nullif(btrim(left(coalesce(p_nombre, ''), 120)), '') where canal = p_canal and psid = p_psid and nombre is null;
end;
$$;

create function public._cc_meta_encolar() returns trigger
  language plpgsql security definer set search_path = public as
$$
declare k public.cc_meta_contactos;
begin
  if new.actor_type not in ('seller', 'admin', 'ai') then return new; end if;
  k := public._cc_meta_contacto_de(new.conversation_id);
  if k.psid is null then return new; end if;
  if (select modo from public.cc_meta_config where canal = k.canal) <> 'activo' then return new; end if;
  insert into public.cc_meta_salida (message_id, conversation_id, canal, psid, texto, estado)
  values (new.id, new.conversation_id, k.canal, k.psid, left(new.content, 4000),
          case when k.ultimo_entrante_at > now() - interval '24 hours' then 'pendiente' else 'fuera_ventana' end)
  on conflict (message_id) do nothing;
  return new;
exception when others then
  raise warning 'META_ENCOLAR_FALLO: % (%)', sqlerrm, new.id;   -- Meta nunca tumba el mensaje del chat
  return new;
end;
$$;
create trigger trg_cc_meta_encolar after insert on public.cc_messages for each row execute function public._cc_meta_encolar();

create function public.cc_meta_salida_reclamar(p_limite int default 20) returns setof public.cc_meta_salida
  language plpgsql security definer set search_path = public as
$$
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  return query
  update public.cc_meta_salida s set estado = 'enviando', reclamado_at = now(), intentos = s.intentos + 1
   where s.id in (select x.id from public.cc_meta_salida x
                   where (x.estado = 'pendiente' or (x.estado = 'enviando' and x.reclamado_at < now() - interval '2 minutes'))
                     and x.intentos < 5
                   order by x.created_at limit greatest(1, least(coalesce(p_limite, 20), 50)) for update skip locked)
  returning s.*;
end;
$$;

create function public.cc_meta_salida_resolver(p_id uuid, p_ok boolean, p_mid text, p_error text) returns void
  language plpgsql security definer set search_path = public as
$$
declare s public.cc_meta_salida;
begin
  if not public._cc_es_service() then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select * into s from public.cc_meta_salida where id = p_id for update;
  if not found or s.estado <> 'enviando' then return; end if;
  if p_ok and nullif(btrim(coalesce(p_mid, '')), '') is not null then
    update public.cc_meta_salida set estado = 'enviado', mid = p_mid, enviado_at = now(), error = null where id = p_id;
    insert into public.cc_meta_mensajes (mid, canal, psid, conversation_id, message_id, direccion) values (p_mid, s.canal, s.psid, s.conversation_id, s.message_id, 'out') on conflict do nothing;
  else
    update public.cc_meta_salida set estado = case when s.intentos >= 5 then 'fallido' else 'pendiente' end, error = left(coalesce(p_error, 'sin detalle'), 300) where id = p_id;
  end if;
end;
$$;

-- Para el chat del personal: ¿de qué canal es esta conversación (WhatsApp o Meta) y hasta cuándo se le puede escribir?
create function public.cc_canal_conversacion(p_conv uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
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
$$;

-- Dirección: los tres canales en una bandeja (la de la 169, ampliada). Solo lectura.
create function public.cc_canales_bandeja() returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
begin
  perform public._cc7_direccion();
  return jsonb_build_object(
    'modos', jsonb_build_object('whatsapp', (select modo from public.cc_wa_config),
                                'instagram', (select modo from public.cc_meta_config where canal = 'instagram'),
                                'messenger', (select modo from public.cc_meta_config where canal = 'messenger')),
    'chats', coalesce((select jsonb_agg(x order by x.ultimo_at desc nulls last) from (
      select k.canal, k.id, k.nombre, k.ultimo_entrante_at, k.ultimo_entrante_at > now() - interval '24 hours' as ventana_abierta,
             k.profile_id is not null as cliente,
             (select coalesce(p.meta ->> 'name', p.full_name) from public.profiles p where p.id = k.profile_id) as cliente_nombre,
             c.id as conversation_id, c.modo, c.estado,
             (select coalesce(s.meta ->> 'name', s.full_name) from public.profiles s where s.id = c.seller_profile_id) as vendedor,
             k.n_mensajes, u.content as ultimo_texto, u.actor_type as ultimo_actor, u.created_at as ultimo_at,
             greatest(0, floor(extract(epoch from (now() - u.created_at)) / 60))::int as hace_min,
             u.actor_type in ('visitor', 'doctor') as sin_responder
        from (select 'whatsapp' as canal, w.wa_id as id, w.nombre, w.ultimo_entrante_at, w.profile_id, w.visitor_id,
                     (select count(*) from public.cc_wa_mensajes wm where wm.wa_id = w.wa_id)::int as n_mensajes from public.cc_wa_contactos w
              union all
              select m.canal, m.psid, m.nombre, m.ultimo_entrante_at, m.profile_id, m.visitor_id,
                     (select count(*) from public.cc_meta_mensajes mm2 where mm2.canal = m.canal and mm2.psid = m.psid)::int from public.cc_meta_contactos m) k
        left join lateral (select c.* from public.cc_conversations c
                            where (k.profile_id is not null and c.profile_id = k.profile_id) or (k.profile_id is null and c.visitor_id = k.visitor_id)
                            order by (c.estado = 'abierta') desc, c.last_message_at desc nulls last limit 1) c on true
        left join lateral (select left(mm.content, 160) as content, mm.actor_type, mm.created_at from public.cc_messages mm
                            where mm.conversation_id = c.id and mm.actor_type <> 'system' order by mm.seq desc limit 1) u on true
       order by u.created_at desc nulls last limit 300) x), '[]'::jsonb));
end;
$$;

CREATE OR REPLACE FUNCTION public._cc_nombre_dueno(p_conv uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select case when c.profile_id is not null then coalesce((select coalesce(p.meta ->> 'name', p.full_name) from public.profiles p where p.id = c.profile_id), 'Doctor') else coalesce((select r.nombre || case when r.posible_customer_id is not null then ' (posible cliente, sin confirmar)' else ' (prerregistro)' end from public.cc_prerregistros r where r.visitor_id = c.visitor_id), (select coalesce(w.nombre, '+' || w.wa_id) || ' (WhatsApp)' from public.cc_wa_contactos w where w.visitor_id = c.visitor_id), (select coalesce(m.nombre, 'Contacto') || case m.canal when 'instagram' then ' (Instagram)' else ' (Facebook)' end from public.cc_meta_contactos m where m.visitor_id = c.visitor_id), 'Visitante') end
     from public.cc_conversations c where c.id = p_conv $function$;

alter function public._cc_canal_a_cola(uuid, text) owner to postgres;
alter function public._cc_meta_contacto_de(uuid) owner to postgres;
alter function public.cc_meta_entrante(text, text, text, text, text, boolean) owner to postgres;
alter function public.cc_meta_nombre(text, text, text) owner to postgres;
alter function public._cc_meta_encolar() owner to postgres;
alter function public.cc_meta_salida_reclamar(int) owner to postgres;
alter function public.cc_meta_salida_resolver(uuid, boolean, text, text) owner to postgres;
alter function public.cc_canal_conversacion(uuid) owner to postgres;
alter function public.cc_canales_bandeja() owner to postgres;
revoke all on function public._cc_canal_a_cola(uuid, text), public._cc_meta_contacto_de(uuid), public.cc_meta_entrante(text, text, text, text, text, boolean), public.cc_meta_nombre(text, text, text),
  public._cc_meta_encolar(), public.cc_meta_salida_reclamar(int), public.cc_meta_salida_resolver(uuid, boolean, text, text), public.cc_canal_conversacion(uuid) from public, anon, authenticated;
grant execute on function public.cc_meta_entrante(text, text, text, text, text, boolean), public.cc_meta_nombre(text, text, text), public.cc_meta_salida_reclamar(int),
  public.cc_meta_salida_resolver(uuid, boolean, text, text), public.cc_canal_conversacion(uuid) to service_role;
revoke all on function public.cc_canales_bandeja() from public, anon;
grant execute on function public.cc_canales_bandeja() to authenticated, service_role;   -- exige Dirección por dentro

do $post$ begin
  if has_function_privilege('authenticated', 'public.cc_meta_entrante(text,text,text,text,text,boolean)', 'execute')
     or has_table_privilege('authenticated', 'public.cc_meta_contactos', 'select') or has_function_privilege('anon', 'public.cc_canales_bandeja()', 'execute')
     or not has_function_privilege('authenticated', 'public.cc_canales_bandeja()', 'execute') then
    raise exception 'META-CANALES: permisos inesperados';
  end if;
  if (select count(*) from public.cc_meta_config) <> 2 then raise exception 'META-CANALES: falta la configuración de los canales'; end if;
end $post$;
