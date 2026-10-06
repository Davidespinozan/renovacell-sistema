-- ============================================================================
-- CC-2 · CONVERSACIÓN CANÓNICA · IA ↔ HUMANO.
--
-- UNA conversación que sobrevive a la identidad: visitante anónimo → IA → prospecto →
-- registro → adopción (CC-1) → doctor autenticado → asesor humano → fin → IA de nuevo.
-- La identidad cambia; `cc_conversations.id` no.
--
-- Invariantes que la base sostiene (C1–C25 del diseño):
--   · Conocer un id no da acceso: todo pasa por comandos (service_role) que exigen prueba de
--     posesión (hash del token de visitante) o identidad del JWT (perfil derivado en la Edge).
--   · actor_type/actor_id los fija el comando; el cliente nunca los elige. Mensajes e eventos
--     son append-only; una corrección futura será un evento explícito, nunca UPDATE.
--   · IA solo habla en ai_active / human_offered / human_requested; en human_assigned,
--     human_active y human_ended la base la rechaza (IA_SILENCIADA).
--   · Un vendedor solo escribe en su conversación asignada y activa; solo se autoasigna desde la
--     cola (human_requested sin asesor) y solo si puede atender (rol pos + capability
--     `conversaciones`, o Dirección). Suspendido = sin autoridad (profiles.active).
--   · Idempotencia por (conversación, actor, client_message_id): mismo payload → mismo mensaje;
--     payload distinto → IDEMPOTENCIA_CONFLICTO.
--   · Adopción CC-1: la conversación del visitante conserva su id, el perfil se incorpora como
--     dueño; los mensajes históricos del visitante no cambian de actor.
--   · Nada aquí toca verified, precio, stock, pedidos, dinero ni fiscal.
--
-- Rollback: supabase/rollback/cc2/99_down.sql.
-- ============================================================================

do $pre$
begin
  if to_regclass('public.cc_visitors') is null or to_regprocedure('public.cc_visitante_adoptar(text,uuid)') is null then
    raise exception 'CC2: CC-1 no está aplicada (cc_visitors / cc_visitante_adoptar)';
  end if;
  if to_regprocedure('public.rate_limit_hit(text,text,int,int,int)') is null then raise exception 'CC2: falta CC-0B'; end if;
  if to_regclass('public.cc_conversations') is not null then raise exception 'CC2: cc_conversations ya existe'; end if;
  if to_regprocedure('public.has_cap(text)') is null or to_regprocedure('public._cc_append_only()') is null then raise exception 'CC2: faltan helpers'; end if;
end $pre$;

-- ---------------------------------------------------------------------------
-- 1) TABLAS
-- ---------------------------------------------------------------------------
create table public.cc_conversations (
  id                     uuid primary key default gen_random_uuid(),
  estado                 text not null default 'abierta',
  modo                   text not null default 'ai_active',
  visitor_id             uuid references public.cc_visitors(id) on delete restrict,
  profile_id             uuid references public.profiles(id) on delete set null,
  seller_profile_id      uuid references public.profiles(id) on delete set null,
  seller_preferido_id    uuid references public.profiles(id) on delete set null,
  ultimo_seq             bigint not null default 0,
  asesoria_solicitada_at timestamptz,
  asesoria_asignada_at   timestamptz,
  asesoria_iniciada_at   timestamptz,
  asesoria_terminada_at  timestamptz,
  created_at             timestamptz not null default now(),
  last_message_at        timestamptz,
  closed_at              timestamptz,
  updated_at             timestamptz not null default now(),
  constraint ck_ccc_estado check (estado in ('abierta', 'cerrada')),
  constraint ck_ccc_modo   check (modo in ('ai_active', 'human_offered', 'human_requested', 'human_assigned', 'human_active', 'human_ended')),
  constraint ck_ccc_dueno  check (visitor_id is not null or profile_id is not null),
  constraint ck_ccc_cerrada check ((estado = 'cerrada') = (closed_at is not null))
);
-- Una conversación ABIERTA por visitante (mientras no tenga dueño autenticado) y una por perfil.
create unique index uq_ccc_visitor_abierta on public.cc_conversations (visitor_id) where estado = 'abierta' and visitor_id is not null and profile_id is null;
create unique index uq_ccc_profile_abierta on public.cc_conversations (profile_id) where estado = 'abierta' and profile_id is not null;
create index idx_ccc_seller on public.cc_conversations (seller_profile_id) where seller_profile_id is not null;
create index idx_ccc_cola on public.cc_conversations (modo, asesoria_solicitada_at) where estado = 'abierta' and modo in ('human_requested', 'human_assigned', 'human_active');
comment on table public.cc_conversations is 'CC-2 · Conversación canónica (una por visitante anónimo o por perfil mientras esté abierta). El id nunca cambia.';

create table public.cc_participants (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.cc_conversations(id) on delete cascade,
  actor_type      text not null,
  visitor_id      uuid references public.cc_visitors(id) on delete restrict,
  profile_id      uuid references public.profiles(id) on delete cascade,
  rol             text not null,
  joined_at       timestamptz not null default now(),
  left_at         timestamptz,
  last_read_seq   bigint not null default 0,
  last_read_at    timestamptz,
  constraint ck_ccp_actor check (actor_type in ('visitor', 'doctor', 'seller', 'admin')),
  constraint ck_ccp_rol   check (rol in ('dueno', 'asesor', 'supervisor')),
  constraint ck_ccp_identidad check (
    (actor_type = 'visitor' and visitor_id is not null and profile_id is null)
    or (actor_type <> 'visitor' and profile_id is not null and visitor_id is null))
);
create unique index uq_ccp_identidad on public.cc_participants (conversation_id, coalesce(profile_id::text, visitor_id::text));
comment on table public.cc_participants is 'CC-2 · Quién participa y hasta dónde ha leído (last_read_seq). El visitante adoptado se conserva como procedencia.';

create table public.cc_messages (
  id                uuid primary key default gen_random_uuid(),
  conversation_id   uuid not null references public.cc_conversations(id) on delete restrict,
  seq               bigint not null,
  actor_type        text not null,
  actor_visitor_id  uuid references public.cc_visitors(id) on delete restrict,
  actor_profile_id  uuid references public.profiles(id) on delete restrict,
  client_message_id text,
  content           text not null,
  content_type      text not null default 'text/plain',
  content_hash      text not null,
  created_at        timestamptz not null default now(),
  constraint uq_ccm_seq check (seq > 0),
  constraint ck_ccm_actor check (actor_type in ('visitor', 'doctor', 'seller', 'admin', 'ai', 'system')),
  constraint ck_ccm_identidad check (
    case actor_type
      when 'visitor' then actor_visitor_id is not null and actor_profile_id is null
      when 'ai'      then actor_visitor_id is null and actor_profile_id is null
      when 'system'  then actor_visitor_id is null and actor_profile_id is null
      else                actor_profile_id is not null and actor_visitor_id is null
    end),
  constraint ck_ccm_contenido check (length(content) between 1 and 4000 and btrim(content) <> ''),
  constraint ck_ccm_tipo check (content_type in ('text/plain')),
  constraint ck_ccm_client_id check (client_message_id is null or length(client_message_id) between 1 and 80),
  unique (conversation_id, seq)
);
create unique index uq_ccm_idempotencia on public.cc_messages
  (conversation_id, actor_type, coalesce(actor_profile_id::text, actor_visitor_id::text, ''), client_message_id) where client_message_id is not null;
comment on table public.cc_messages is 'CC-2 · Mensajes append-only con procedencia de actor fijada por el servidor. Texto plano; el escape es del render.';

create table public.cc_conversation_events (
  id               bigint generated always as identity primary key,
  conversation_id  uuid not null references public.cc_conversations(id) on delete restrict,
  tipo             text not null,
  actor_type       text,
  actor_profile_id uuid,
  actor_visitor_id uuid,
  detalle          jsonb,
  created_at       timestamptz not null default now(),
  constraint ck_ccce_tipo check (tipo in ('conversation_opened', 'visitor_adopted', 'human_offered', 'human_requested', 'human_assigned',
                                          'seller_unassigned', 'human_started', 'human_ended', 'ai_resumed', 'conversation_closed', 'conversation_reopened'))
);
create index idx_ccce_conv on public.cc_conversation_events (conversation_id, created_at);
comment on table public.cc_conversation_events is 'CC-2 · Bitácora append-only del ciclo de vida/handoff (ids y modo; nunca contenido).';

-- Append-only: mensajes y eventos no se editan ni se borran (ni por cascada: las FK son restrict).
create trigger trg_ccm_append_only before update or delete on public.cc_messages for each row execute function public._cc_append_only();
create trigger trg_ccce_append_only before update or delete on public.cc_conversation_events for each row execute function public._cc_append_only();

-- ---------------------------------------------------------------------------
-- 2) RLS. Clientes autenticados pueden LEER lo suyo (dueño, asesor asignado, Dirección); nadie
--    escribe directo; anon nada; los eventos solo Dirección. Los comandos son la autoridad.
-- ---------------------------------------------------------------------------
alter table public.cc_conversations enable row level security;
alter table public.cc_participants enable row level security;
alter table public.cc_messages enable row level security;
alter table public.cc_conversation_events enable row level security;
revoke all on public.cc_conversations, public.cc_participants, public.cc_messages, public.cc_conversation_events from public, anon, authenticated;
grant select on public.cc_conversations, public.cc_participants, public.cc_messages, public.cc_conversation_events to authenticated;

create policy ccc_select_propias on public.cc_conversations for select to authenticated
  using (profile_id = auth.uid() or seller_profile_id = auth.uid() or public.auth_role() = 'admin');
create policy ccp_select_propias on public.cc_participants for select to authenticated
  using (exists (select 1 from public.cc_conversations c where c.id = conversation_id and (c.profile_id = auth.uid() or c.seller_profile_id = auth.uid() or public.auth_role() = 'admin')));
create policy ccm_select_propias on public.cc_messages for select to authenticated
  using (exists (select 1 from public.cc_conversations c where c.id = conversation_id and (c.profile_id = auth.uid() or c.seller_profile_id = auth.uid() or public.auth_role() = 'admin')));
create policy ccce_select_admin on public.cc_conversation_events for select to authenticated using (public.auth_role() = 'admin');

-- ---------------------------------------------------------------------------
-- 3) HELPERS (privados)
-- ---------------------------------------------------------------------------
-- ¿Puede atender conversaciones? Dirección siempre; vendedor (pos) solo con la capability.
create or replace function public._cc_puede_atender(p_profile uuid) returns boolean
  language sql stable set search_path = public as
$$
  select coalesce((select p.active and (p.role_id = 'admin' or (p.role_id = 'pos' and (p.meta -> 'capabilities') ? 'conversaciones'))
                     from public.profiles p where p.id = p_profile), false)
$$;

create or replace function public._cc_perfil_activo(p_profile uuid) returns text
  language sql stable set search_path = public as
$$ select p.role_id from public.profiles p where p.id = p_profile and p.active $$;

create or replace function public._cc_visitor_por_hash(p_hash text) returns uuid
  language sql stable set search_path = public as
$$ select v.id from public.cc_visitors v where p_hash ~ '^[0-9a-f]{64}$' and v.token_hash = p_hash and v.estado = 'activo' $$;

create or replace function public._cc_evento(p_conv uuid, p_tipo text, p_actor_type text, p_profile uuid, p_visitor uuid, p_detalle jsonb default null) returns void
  language sql set search_path = public as
$$ insert into public.cc_conversation_events (conversation_id, tipo, actor_type, actor_profile_id, actor_visitor_id, detalle) values (p_conv, p_tipo, p_actor_type, p_profile, p_visitor, p_detalle) $$;

-- Mensaje de SISTEMA (no falsificable: solo lo escriben los comandos), idempotente por client_id.
create or replace function public._cc_sistema(p_conv uuid, p_texto text, p_client_id text) returns void
  language plpgsql set search_path = public as
$$
declare v_seq bigint;
begin
  if exists (select 1 from public.cc_messages where conversation_id = p_conv and actor_type = 'system' and client_message_id = p_client_id) then return; end if;
  update public.cc_conversations set ultimo_seq = ultimo_seq + 1, last_message_at = now(), updated_at = now() where id = p_conv returning ultimo_seq into v_seq;
  insert into public.cc_messages (conversation_id, seq, actor_type, client_message_id, content, content_hash)
  values (p_conv, v_seq, 'system', p_client_id, p_texto, md5(p_texto));
end;
$$;

-- Transiciones válidas del handoff. `ai_resumed` es un EVENTO que vuelve a ai_active.
create or replace function public._cc_transicion_valida(p_de text, p_a text) returns boolean
  language sql immutable as
$$
  select (p_de, p_a) in (
    ('ai_active', 'human_offered'), ('ai_active', 'human_requested'), ('ai_active', 'human_assigned'),
    ('human_offered', 'human_requested'), ('human_offered', 'ai_active'), ('human_offered', 'human_assigned'),
    ('human_requested', 'human_assigned'), ('human_requested', 'ai_active'),
    ('human_assigned', 'human_active'), ('human_assigned', 'human_requested'), ('human_assigned', 'ai_active'),
    ('human_active', 'human_ended'), ('human_active', 'human_assigned'),
    ('human_ended', 'ai_active'), ('human_ended', 'human_requested'), ('human_ended', 'human_assigned'))
$$;

create or replace function public._cc_cambiar_modo(p_conv uuid, p_a text, p_tipo_evento text, p_actor_type text, p_profile uuid, p_visitor uuid, p_detalle jsonb default null) returns void
  language plpgsql set search_path = public as
$$
declare v_de text;
begin
  select modo into v_de from public.cc_conversations where id = p_conv for update;
  if v_de = p_a then return; end if;   -- idempotente
  if not public._cc_transicion_valida(v_de, p_a) then
    raise exception 'TRANSICION_INVALIDA: % → %', v_de, p_a using errcode = 'check_violation';
  end if;
  update public.cc_conversations set modo = p_a, updated_at = now(),
    asesoria_solicitada_at = case when p_a = 'human_requested' then now() else asesoria_solicitada_at end,
    asesoria_asignada_at   = case when p_a = 'human_assigned' then now() else asesoria_asignada_at end,
    asesoria_iniciada_at   = case when p_a = 'human_active' then now() else asesoria_iniciada_at end,
    asesoria_terminada_at  = case when p_a = 'human_ended' then now() else asesoria_terminada_at end
  where id = p_conv;
  perform public._cc_evento(p_conv, p_tipo_evento, p_actor_type, p_profile, p_visitor, coalesce(p_detalle, '{}'::jsonb) || jsonb_build_object('de', v_de, 'a', p_a));
end;
$$;

-- Autoridad de un actor sobre una conversación. Devuelve el rol efectivo o lanza NO_AUTORIZADO.
--   visitor: la conversación es suya y aún no tiene dueño autenticado.
--   doctor : la conversación es de su perfil.
--   seller : es el asesor asignado y puede atender.
--   admin  : Dirección activa.
create or replace function public._cc_autoridad(p_conv uuid, p_actor_type text, p_visitor uuid, p_profile uuid) returns text
  language plpgsql stable set search_path = public as
$$
declare c record; v_rol text;
begin
  select * into c from public.cc_conversations where id = p_conv;
  if not found then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;   -- no se revela existencia
  if p_actor_type = 'visitor' then
    if p_visitor is not null and c.visitor_id = p_visitor and c.profile_id is null then return 'dueno'; end if;
  elsif p_actor_type = 'doctor' then
    v_rol := public._cc_perfil_activo(p_profile);
    if v_rol is null then raise exception 'CUENTA_SUSPENDIDA'; end if;
    if c.profile_id = p_profile then return 'dueno'; end if;
  elsif p_actor_type = 'seller' then
    if public._cc_perfil_activo(p_profile) is null then raise exception 'CUENTA_SUSPENDIDA'; end if;
    if c.seller_profile_id = p_profile and public._cc_puede_atender(p_profile) then return 'asesor'; end if;
  elsif p_actor_type = 'admin' then
    if public._cc_perfil_activo(p_profile) is null then raise exception 'CUENTA_SUSPENDIDA'; end if;
    if public._cc_perfil_activo(p_profile) = 'admin' then return 'supervisor'; end if;
  end if;
  raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege';
end;
$$;

create or replace function public._cc_participante(p_conv uuid, p_actor_type text, p_visitor uuid, p_profile uuid, p_rol text) returns void
  language sql set search_path = public as
$$
  insert into public.cc_participants (conversation_id, actor_type, visitor_id, profile_id, rol)
  values (p_conv, p_actor_type, case when p_actor_type = 'visitor' then p_visitor end, case when p_actor_type <> 'visitor' then p_profile end, p_rol)
  on conflict (conversation_id, coalesce(profile_id::text, visitor_id::text)) do update set left_at = null
$$;

-- ---------------------------------------------------------------------------
-- 4) COMANDOS (SECURITY DEFINER, solo service_role: la Edge `chat` deriva la identidad)
-- ---------------------------------------------------------------------------
-- Abrir/reanudar la conversación ABIERTA del actor (visitante por hash, perfil por JWT).
create or replace function public.cc_abrir_conversacion(p_visitor_hash text, p_profile uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_visitor uuid; c record; v_nuevo boolean := false; v_rol text; v_seller uuid;
begin
  if p_profile is not null then
    v_rol := public._cc_perfil_activo(p_profile);
    if v_rol is null then raise exception 'CUENTA_SUSPENDIDA'; end if;
    select * into c from public.cc_conversations where profile_id = p_profile and estado = 'abierta';
    if not found then
      -- Vendedor preferido heredado de la atribución de sus visitantes adoptados (si puede atender).
      select v.seller_profile_id into v_seller from public.cc_visitors v
       where v.adopted_profile_id = p_profile and v.seller_profile_id is not null and public._cc_puede_atender(v.seller_profile_id)
       order by v.adopted_at desc limit 1;
      insert into public.cc_conversations (profile_id, seller_preferido_id) values (p_profile, v_seller)
      on conflict (profile_id) where estado = 'abierta' and profile_id is not null do nothing;
      select * into c from public.cc_conversations where profile_id = p_profile and estado = 'abierta';
      v_nuevo := c.ultimo_seq = 0 and c.last_message_at is null and (select count(*) from public.cc_conversation_events e where e.conversation_id = c.id) = 0;
      if v_nuevo then
        perform public._cc_participante(c.id, case when v_rol = 'doctor' then 'doctor' when v_rol = 'admin' then 'admin' else 'doctor' end, null, p_profile, 'dueno');
        perform public._cc_evento(c.id, 'conversation_opened', 'doctor', p_profile, null);
      end if;
    end if;
  else
    v_visitor := public._cc_visitor_por_hash(p_visitor_hash);
    if v_visitor is null then raise exception 'SESION_INVALIDA'; end if;
    select * into c from public.cc_conversations where visitor_id = v_visitor and profile_id is null and estado = 'abierta';
    if not found then
      select v.seller_profile_id into v_seller from public.cc_visitors v where v.id = v_visitor and v.seller_profile_id is not null and public._cc_puede_atender(v.seller_profile_id);
      insert into public.cc_conversations (visitor_id, seller_preferido_id) values (v_visitor, v_seller)
      on conflict (visitor_id) where estado = 'abierta' and visitor_id is not null and profile_id is null do nothing;
      select * into c from public.cc_conversations where visitor_id = v_visitor and profile_id is null and estado = 'abierta';
      v_nuevo := (select count(*) from public.cc_conversation_events e where e.conversation_id = c.id) = 0;
      if v_nuevo then
        perform public._cc_participante(c.id, 'visitor', v_visitor, null, 'dueno');
        perform public._cc_evento(c.id, 'conversation_opened', 'visitor', null, v_visitor);
      end if;
    end if;
  end if;
  return jsonb_build_object('conversation_id', c.id, 'estado', c.estado, 'modo', c.modo, 'nuevo', v_nuevo,
                            'asesor', c.seller_profile_id is not null, 'ultimo_seq', c.ultimo_seq);
end;
$$;

-- Leer: conversación + mensajes desde un seq (paginado). Sin ids de visitante ni hashes.
create or replace function public.cc_leer_conversacion(p_conv uuid, p_actor_type text, p_visitor_hash text, p_profile uuid, p_desde_seq bigint default 0, p_limite int default 100) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_visitor uuid; v_rol text; c record; v_msgs jsonb; v_asesor text;
begin
  if p_actor_type = 'visitor' then v_visitor := public._cc_visitor_por_hash(p_visitor_hash); if v_visitor is null then raise exception 'SESION_INVALIDA'; end if; end if;
  v_rol := public._cc_autoridad(p_conv, p_actor_type, v_visitor, p_profile);
  select * into c from public.cc_conversations where id = p_conv;
  select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'seq', m.seq, 'actor', m.actor_type, 'content', m.content, 'created_at', m.created_at,
                                               'propio', (m.actor_visitor_id is not null and m.actor_visitor_id = v_visitor) or (m.actor_profile_id is not null and m.actor_profile_id = p_profile))
                  order by m.seq), '[]'::jsonb)
    into v_msgs
    from (select * from public.cc_messages m where m.conversation_id = p_conv and m.seq > coalesce(p_desde_seq, 0) order by m.seq limit least(greatest(coalesce(p_limite, 100), 1), 200)) m;
  select coalesce(p.full_name, p.meta ->> 'name') into v_asesor from public.profiles p where p.id = c.seller_profile_id;
  return jsonb_build_object('conversation_id', c.id, 'estado', c.estado, 'modo', c.modo, 'rol', v_rol, 'ultimo_seq', c.ultimo_seq,
                            'asesor_nombre', v_asesor, 'asesor_soy_yo', c.seller_profile_id is not null and c.seller_profile_id = p_profile,
                            'mensajes', v_msgs);
end;
$$;

-- Enviar. El actor lo fija el servidor (la Edge pasa el tipo que derivó del JWT o del token).
create or replace function public.cc_enviar_mensaje(p_conv uuid, p_actor_type text, p_visitor_hash text, p_profile uuid, p_client_id text, p_content text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_visitor uuid; c record; v_rol text; v_seq bigint; v_id uuid; v_hash text; e record; v_prof uuid;
begin
  if p_content is null or btrim(p_content) = '' then raise exception 'CONTENIDO_VACIO' using errcode = 'check_violation'; end if;
  if length(p_content) > 4000 then raise exception 'CONTENIDO_LARGO' using errcode = 'check_violation'; end if;
  if p_actor_type not in ('visitor', 'doctor', 'seller', 'admin', 'ai', 'system') then raise exception 'ACTOR_INVALIDO' using errcode = 'check_violation'; end if;
  if p_actor_type in ('ai', 'system') then
    if p_profile is not null or p_visitor_hash is not null then raise exception 'ACTOR_INVALIDO' using errcode = 'check_violation'; end if;
    select * into c from public.cc_conversations where id = p_conv for update;
    if not found then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
    if p_actor_type = 'ai' and c.modo not in ('ai_active', 'human_offered', 'human_requested') then
      raise exception 'IA_SILENCIADA: modo %', c.modo using errcode = 'insufficient_privilege';
    end if;
  else
    if p_actor_type = 'visitor' then
      v_visitor := public._cc_visitor_por_hash(p_visitor_hash); if v_visitor is null then raise exception 'SESION_INVALIDA'; end if;
      -- Orden de locks = el de la adopción (visitante → conversación): sin ciclos. Si una adopción
      -- está en curso, esperamos a que termine y la autoridad se re-evalúa ya adoptado.
      perform 1 from public.cc_visitors where id = v_visitor for key share;
    end if;
    v_rol := public._cc_autoridad(p_conv, p_actor_type, v_visitor, p_profile);
    select * into c from public.cc_conversations where id = p_conv for update;
    v_rol := public._cc_autoridad(p_conv, p_actor_type, v_visitor, p_profile);   -- re-verificación bajo lock
    if p_actor_type = 'seller' and c.modo <> 'human_active' then raise exception 'ASESORIA_NO_INICIADA: modo %', c.modo using errcode = 'insufficient_privilege'; end if;
    v_prof := case when p_actor_type <> 'visitor' then p_profile end;
  end if;
  if c.estado <> 'abierta' then raise exception 'CONVERSACION_CERRADA' using errcode = 'check_violation'; end if;

  v_hash := md5(p_content);
  if p_client_id is not null then
    select * into e from public.cc_messages m where m.conversation_id = p_conv and m.actor_type = p_actor_type
       and coalesce(m.actor_profile_id::text, m.actor_visitor_id::text, '') = coalesce(v_prof::text, v_visitor::text, '') and m.client_message_id = p_client_id;
    if found then
      if e.content_hash <> v_hash then raise exception 'IDEMPOTENCIA_CONFLICTO' using errcode = 'unique_violation'; end if;
      return jsonb_build_object('id', e.id, 'seq', e.seq, 'idempotente', true, 'modo', c.modo);
    end if;
  end if;
  update public.cc_conversations set ultimo_seq = ultimo_seq + 1, last_message_at = now(), updated_at = now() where id = p_conv returning ultimo_seq into v_seq;
  insert into public.cc_messages (conversation_id, seq, actor_type, actor_visitor_id, actor_profile_id, client_message_id, content, content_hash)
  values (p_conv, v_seq, p_actor_type, v_visitor, v_prof, p_client_id, p_content, v_hash) returning id into v_id;
  -- Quien escribe ya leyó hasta aquí.
  if p_actor_type in ('visitor', 'doctor', 'seller', 'admin') then
    perform public._cc_participante(p_conv, p_actor_type, v_visitor, v_prof, case when p_actor_type = 'seller' then 'asesor' when p_actor_type = 'admin' then 'supervisor' else 'dueno' end);
    update public.cc_participants set last_read_seq = greatest(last_read_seq, v_seq), last_read_at = now()
     where conversation_id = p_conv and coalesce(profile_id::text, visitor_id::text) = coalesce(v_prof::text, v_visitor::text);
  end if;
  return jsonb_build_object('id', v_id, 'seq', v_seq, 'idempotente', false, 'modo', c.modo);
end;
$$;

create or replace function public.cc_marcar_leido(p_conv uuid, p_actor_type text, p_visitor_hash text, p_profile uuid, p_seq bigint) returns void
  language plpgsql security definer set search_path = public as
$$
declare v_visitor uuid;
begin
  if p_actor_type = 'visitor' then v_visitor := public._cc_visitor_por_hash(p_visitor_hash); if v_visitor is null then raise exception 'SESION_INVALIDA'; end if; end if;
  perform public._cc_autoridad(p_conv, p_actor_type, v_visitor, p_profile);
  perform public._cc_participante(p_conv, p_actor_type, v_visitor, case when p_actor_type <> 'visitor' then p_profile end,
                                  case when p_actor_type = 'seller' then 'asesor' when p_actor_type = 'admin' then 'supervisor' else 'dueno' end);
  update public.cc_participants set last_read_seq = greatest(last_read_seq, least(coalesce(p_seq, 0), (select ultimo_seq from public.cc_conversations where id = p_conv))), last_read_at = now()
   where conversation_id = p_conv and coalesce(profile_id::text, visitor_id::text) = coalesce(case when p_actor_type <> 'visitor' then p_profile end::text, v_visitor::text);
end;
$$;

-- Solicitar asesor (dueño). Preferido atendible → se asigna; si no → cola. Idempotente.
create or replace function public.cc_solicitar_asesor(p_conv uuid, p_actor_type text, p_visitor_hash text, p_profile uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_visitor uuid; c record; v_rol text;
begin
  if p_actor_type not in ('visitor', 'doctor') then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if p_actor_type = 'visitor' then v_visitor := public._cc_visitor_por_hash(p_visitor_hash); if v_visitor is null then raise exception 'SESION_INVALIDA'; end if; end if;
  v_rol := public._cc_autoridad(p_conv, p_actor_type, v_visitor, p_profile);
  select * into c from public.cc_conversations where id = p_conv for update;
  if c.estado <> 'abierta' then raise exception 'CONVERSACION_CERRADA' using errcode = 'check_violation'; end if;
  if c.modo in ('human_requested', 'human_assigned', 'human_active') then
    return jsonb_build_object('modo', c.modo, 'asesor', c.seller_profile_id is not null, 'idempotente', true);
  end if;
  perform public._cc_cambiar_modo(p_conv, 'human_requested', 'human_requested', p_actor_type, case when p_actor_type <> 'visitor' then p_profile end, v_visitor);
  perform public._cc_sistema(p_conv, 'Pediste hablar con un asesor de Renovacell. Mientras tanto, el asistente puede seguir ayudándote.', 'sys:solicitud:' || c.ultimo_seq);
  if c.seller_preferido_id is not null and public._cc_puede_atender(c.seller_preferido_id) then
    update public.cc_conversations set seller_profile_id = c.seller_preferido_id where id = p_conv;
    perform public._cc_cambiar_modo(p_conv, 'human_assigned', 'human_assigned', 'system', null, null, jsonb_build_object('seller', c.seller_preferido_id, 'origen', 'preferido'));
    perform public._cc_participante(p_conv, 'seller', null, c.seller_preferido_id, 'asesor');
  end if;
  select * into c from public.cc_conversations where id = p_conv;
  return jsonb_build_object('modo', c.modo, 'asesor', c.seller_profile_id is not null, 'idempotente', false);
end;
$$;

-- Asignar asesor. Dirección: cualquiera que pueda atender (o null → cola). Vendedor: solo se
-- toma a sí mismo una conversación de la cola (human_requested, sin asesor).
create or replace function public.cc_asignar_asesor(p_conv uuid, p_actor_profile uuid, p_seller uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare c record; v_rol text;
begin
  v_rol := public._cc_perfil_activo(p_actor_profile);
  if v_rol is null then raise exception 'CUENTA_SUSPENDIDA'; end if;
  select * into c from public.cc_conversations where id = p_conv for update;
  if not found then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if c.estado <> 'abierta' then raise exception 'CONVERSACION_CERRADA' using errcode = 'check_violation'; end if;
  if p_seller is not null and not public._cc_puede_atender(p_seller) then raise exception 'ASESOR_INVALIDO: no puede atender conversaciones' using errcode = 'check_violation'; end if;
  if v_rol = 'admin' then
    null; -- Dirección asigna/reasigna/libera
  elsif public._cc_puede_atender(p_actor_profile) and p_seller = p_actor_profile and c.modo = 'human_requested' and c.seller_profile_id is null then
    null; -- autoasignación desde la cola
  elsif public._cc_puede_atender(p_actor_profile) and p_seller = p_actor_profile and c.seller_profile_id = p_actor_profile then
    return jsonb_build_object('modo', c.modo, 'seller', c.seller_profile_id, 'idempotente', true);
  elsif public._cc_puede_atender(p_actor_profile) and c.seller_profile_id is not null and c.seller_profile_id <> p_actor_profile then
    raise exception 'YA_ASIGNADA' using errcode = 'unique_violation';
  else
    raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege';
  end if;
  if c.seller_profile_id is not distinct from p_seller then
    return jsonb_build_object('modo', c.modo, 'seller', c.seller_profile_id, 'idempotente', true);
  end if;
  if p_seller is null then
    update public.cc_conversations set seller_profile_id = null, updated_at = now() where id = p_conv;
    update public.cc_participants set left_at = now() where conversation_id = p_conv and profile_id = c.seller_profile_id and rol = 'asesor';
    perform public._cc_evento(p_conv, 'seller_unassigned', 'admin', p_actor_profile, null, jsonb_build_object('seller', c.seller_profile_id));
    if c.modo in ('human_assigned', 'human_active') then
      perform public._cc_cambiar_modo(p_conv, 'human_requested', 'human_requested', 'admin', p_actor_profile, null, jsonb_build_object('motivo', 'liberada'));
      perform public._cc_sistema(p_conv, 'Tu conversación volvió a la cola de asesores.', 'sys:cola:' || c.ultimo_seq);
    end if;
  else
    if c.seller_profile_id is not null then
      update public.cc_participants set left_at = now() where conversation_id = p_conv and profile_id = c.seller_profile_id and rol = 'asesor';
      perform public._cc_evento(p_conv, 'seller_unassigned', case when v_rol = 'admin' then 'admin' else 'seller' end, p_actor_profile, null, jsonb_build_object('seller', c.seller_profile_id, 'motivo', 'reasignada'));
    end if;
    update public.cc_conversations set seller_profile_id = p_seller, updated_at = now() where id = p_conv;
    perform public._cc_participante(p_conv, 'seller', null, p_seller, 'asesor');
    if c.modo <> 'human_assigned' then
      perform public._cc_cambiar_modo(p_conv, 'human_assigned', 'human_assigned', case when v_rol = 'admin' then 'admin' else 'seller' end, p_actor_profile, null, jsonb_build_object('seller', p_seller));
    else
      perform public._cc_evento(p_conv, 'human_assigned', case when v_rol = 'admin' then 'admin' else 'seller' end, p_actor_profile, null, jsonb_build_object('seller', p_seller, 'motivo', 'reasignada'));
    end if;
  end if;
  select * into c from public.cc_conversations where id = p_conv;
  return jsonb_build_object('modo', c.modo, 'seller', c.seller_profile_id, 'idempotente', false);
end;
$$;

-- El asesor asignado inicia: human_assigned → human_active (la IA calla desde aquí).
create or replace function public.cc_iniciar_asesoria(p_conv uuid, p_profile uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare c record; v_nombre text;
begin
  perform public._cc_autoridad(p_conv, 'seller', null, p_profile);
  select * into c from public.cc_conversations where id = p_conv for update;
  if c.estado <> 'abierta' then raise exception 'CONVERSACION_CERRADA' using errcode = 'check_violation'; end if;
  if c.modo = 'human_active' then return jsonb_build_object('modo', c.modo, 'idempotente', true); end if;
  perform public._cc_cambiar_modo(p_conv, 'human_active', 'human_started', 'seller', p_profile, null);
  select coalesce(p.meta ->> 'name', p.full_name, 'Un asesor') into v_nombre from public.profiles p where p.id = p_profile;
  perform public._cc_sistema(p_conv, v_nombre || ' se unió a la conversación.', 'sys:inicio:' || c.ultimo_seq);
  return jsonb_build_object('modo', 'human_active', 'idempotente', false);
end;
$$;

-- Terminar la asesoría (asesor asignado o Dirección): → human_ended.
create or replace function public.cc_terminar_asesoria(p_conv uuid, p_profile uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare c record; v_rol text;
begin
  v_rol := public._cc_perfil_activo(p_profile);
  if v_rol is null then raise exception 'CUENTA_SUSPENDIDA'; end if;
  select * into c from public.cc_conversations where id = p_conv for update;
  if not found then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if not (v_rol = 'admin' or (c.seller_profile_id = p_profile and public._cc_puede_atender(p_profile))) then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if c.modo = 'human_ended' then return jsonb_build_object('modo', c.modo, 'idempotente', true); end if;
  perform public._cc_cambiar_modo(p_conv, 'human_ended', 'human_ended', case when v_rol = 'admin' then 'admin' else 'seller' end, p_profile, null);
  perform public._cc_sistema(p_conv, 'La asesoría terminó. Puedes seguir con el asistente cuando quieras.', 'sys:fin:' || c.ultimo_seq);
  return jsonb_build_object('modo', 'human_ended', 'idempotente', false);
end;
$$;

-- Reanudar IA (dueño, asesor asignado o Dirección): evento ai_resumed → ai_active.
create or replace function public.cc_reanudar_ia(p_conv uuid, p_actor_type text, p_visitor_hash text, p_profile uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_visitor uuid; c record;
begin
  if p_actor_type = 'visitor' then v_visitor := public._cc_visitor_por_hash(p_visitor_hash); if v_visitor is null then raise exception 'SESION_INVALIDA'; end if; end if;
  perform public._cc_autoridad(p_conv, p_actor_type, v_visitor, p_profile);
  select * into c from public.cc_conversations where id = p_conv for update;
  if c.estado <> 'abierta' then raise exception 'CONVERSACION_CERRADA' using errcode = 'check_violation'; end if;
  if c.modo = 'ai_active' then return jsonb_build_object('modo', c.modo, 'idempotente', true); end if;
  if c.modo = 'human_active' and p_actor_type in ('visitor', 'doctor') then raise exception 'TRANSICION_INVALIDA: human_active → ai_active (termina la asesoría primero)' using errcode = 'check_violation'; end if;
  perform public._cc_cambiar_modo(p_conv, 'ai_active', 'ai_resumed', p_actor_type, case when p_actor_type <> 'visitor' then p_profile end, v_visitor);
  perform public._cc_sistema(p_conv, 'El asistente retomó la conversación.', 'sys:ia:' || c.ultimo_seq);
  return jsonb_build_object('modo', 'ai_active', 'idempotente', false);
end;
$$;

create or replace function public.cc_cerrar_conversacion(p_conv uuid, p_actor_type text, p_visitor_hash text, p_profile uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_visitor uuid; c record;
begin
  if p_actor_type = 'visitor' then v_visitor := public._cc_visitor_por_hash(p_visitor_hash); if v_visitor is null then raise exception 'SESION_INVALIDA'; end if; end if;
  perform public._cc_autoridad(p_conv, p_actor_type, v_visitor, p_profile);
  select * into c from public.cc_conversations where id = p_conv for update;
  if c.estado = 'cerrada' then return jsonb_build_object('estado', 'cerrada', 'idempotente', true); end if;
  update public.cc_conversations set estado = 'cerrada', closed_at = now(), updated_at = now() where id = p_conv;
  perform public._cc_evento(p_conv, 'conversation_closed', p_actor_type, case when p_actor_type <> 'visitor' then p_profile end, v_visitor);
  return jsonb_build_object('estado', 'cerrada', 'idempotente', false);
end;
$$;

create or replace function public.cc_reabrir_conversacion(p_conv uuid, p_actor_type text, p_visitor_hash text, p_profile uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_visitor uuid; c record;
begin
  if p_actor_type not in ('visitor', 'doctor', 'admin') then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if p_actor_type = 'visitor' then v_visitor := public._cc_visitor_por_hash(p_visitor_hash); if v_visitor is null then raise exception 'SESION_INVALIDA'; end if; end if;
  perform public._cc_autoridad(p_conv, p_actor_type, v_visitor, p_profile);
  select * into c from public.cc_conversations where id = p_conv for update;
  if c.estado = 'abierta' then return jsonb_build_object('estado', 'abierta', 'idempotente', true); end if;
  begin
    update public.cc_conversations set estado = 'abierta', closed_at = null, updated_at = now() where id = p_conv;
  exception when unique_violation then
    raise exception 'YA_HAY_ABIERTA: ya existe una conversación abierta para este dueño' using errcode = 'unique_violation';
  end;
  perform public._cc_evento(p_conv, 'conversation_reopened', p_actor_type, case when p_actor_type <> 'visitor' then p_profile end, v_visitor);
  return jsonb_build_object('estado', 'abierta', 'idempotente', false);
end;
$$;

-- Cola de asesorías (RPC para autenticados que pueden atender). Dirección ve todo lo humano.
create or replace function public.cc_cola_asesorias() returns table (
  conversation_id uuid, modo text, seller_profile_id uuid, asesoria_solicitada_at timestamptz, last_message_at timestamptz,
  es_mia boolean, sin_leer bigint, dueno text
) language sql stable security definer set search_path = public as
$$
  select c.id, c.modo, c.seller_profile_id, c.asesoria_solicitada_at, c.last_message_at,
         c.seller_profile_id = auth.uid() as es_mia,
         greatest(c.ultimo_seq - coalesce((select p.last_read_seq from public.cc_participants p where p.conversation_id = c.id and p.profile_id = auth.uid()), 0), 0) as sin_leer,
         case when c.profile_id is not null then coalesce((select coalesce(pr.meta ->> 'name', pr.full_name) from public.profiles pr where pr.id = c.profile_id), 'Doctor') else 'Visitante' end as dueno
    from public.cc_conversations c
   where c.estado = 'abierta' and c.modo in ('human_requested', 'human_assigned', 'human_active', 'human_ended')
     and public._cc_puede_atender(auth.uid())
     and (public.auth_role() = 'admin' or c.seller_profile_id = auth.uid() or (c.modo = 'human_requested' and c.seller_profile_id is null))
   order by case when c.seller_profile_id = auth.uid() then 0 else 1 end, c.asesoria_solicitada_at nulls last
$$;

-- ---------------------------------------------------------------------------
-- 5) ADOPCIÓN (CC-1) · la conversación del visitante conserva su id y gana dueño autenticado.
--    Si el perfil ya tiene una conversación abierta, la del visitante se liga al perfil y se
--    cierra como "consolidada" (nada se pierde; una sola abierta por perfil).
-- ---------------------------------------------------------------------------
create or replace function public._cc_adoptar_conversaciones(p_visitor uuid, p_profile uuid) returns int
  language plpgsql set search_path = public as
$$
declare r record; v_abierta uuid; n int := 0;
begin
  select id into v_abierta from public.cc_conversations where profile_id = p_profile and estado = 'abierta';
  for r in select * from public.cc_conversations where visitor_id = p_visitor and profile_id is null order by created_at for update loop
    if r.estado = 'abierta' and v_abierta is not null and v_abierta <> r.id then
      update public.cc_conversations set profile_id = p_profile, estado = 'cerrada', closed_at = now(), updated_at = now() where id = r.id;
      perform public._cc_evento(r.id, 'conversation_closed', 'system', null, null, jsonb_build_object('motivo', 'consolidada', 'en', v_abierta));
    else
      update public.cc_conversations set profile_id = p_profile, updated_at = now() where id = r.id;
      if r.estado = 'abierta' then v_abierta := r.id; end if;
    end if;
    perform public._cc_participante(r.id, 'doctor', null, p_profile, 'dueno');
    perform public._cc_evento(r.id, 'visitor_adopted', 'doctor', p_profile, p_visitor);
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- cc_visitante_adoptar (CC-1) + el gancho de conversación, ATÓMICO en la misma transacción.
create or replace function public.cc_visitante_adoptar(p_hash text, p_profile uuid) returns jsonb
language plpgsql security definer set search_path = public as
$$
declare
  prof record; v public.cc_visitors%rowtype; n int := 0; r record; convs int := 0;
begin
  if p_profile is null then raise exception 'CC1_ARGUMENTOS: perfil requerido' using errcode = 'invalid_parameter_value'; end if;
  select id, active, role_id into prof from public.profiles where id = p_profile;
  if not found then raise exception 'PERFIL_INEXISTENTE'; end if;
  if not prof.active then raise exception 'CUENTA_SUSPENDIDA'; end if;

  if p_hash is not null then
    if p_hash !~ '^[0-9a-f]{64}$' then raise exception 'SESION_INVALIDA'; end if;
    select * into v from public.cc_visitors where token_hash = p_hash and estado in ('activo', 'adoptado') for update;
    if not found then raise exception 'SESION_INVALIDA'; end if;
    if v.estado = 'adoptado' then
      if v.adopted_profile_id = p_profile then
        return jsonb_build_object('estado', 'ya_adoptado', 'visitor_id', v.id, 'adoptados', 0);
      end if;
      insert into public.cc_visitor_events (visitor_id, tipo, detalle, actor_profile_id) values (v.id, 'conflicto', '{"motivo":"adoptado_por_otro"}', p_profile);
      return jsonb_build_object('estado', 'ajeno', 'adoptados', 0);
    end if;
    if v.pending_profile_id is not null and v.pending_profile_id <> p_profile then
      insert into public.cc_visitor_events (visitor_id, tipo, detalle, actor_profile_id) values (v.id, 'conflicto', '{"motivo":"registrado_por_otro"}', p_profile);
      return jsonb_build_object('estado', 'ajeno', 'adoptados', 0);
    end if;
    update public.cc_visitors
       set estado = 'adoptado', adopted_profile_id = p_profile, adopted_at = now(), last_seen_at = now(),
           token_hash = encode(extensions.digest(id::text || clock_timestamp()::text || random()::text, 'sha256'), 'hex')
     where id = v.id;
    insert into public.cc_visitor_events (visitor_id, tipo, actor_profile_id) values (v.id, 'adoptado', p_profile);
    insert into public.cc_visitor_events (visitor_id, tipo, detalle) values (v.id, 'revocado', '{"motivo":"adopcion"}');
    convs := public._cc_adoptar_conversaciones(v.id, p_profile);   -- CC-2
    return jsonb_build_object('estado', 'adoptado', 'visitor_id', v.id, 'adoptados', 1, 'conversaciones', convs);
  end if;

  for r in select id from public.cc_visitors where pending_profile_id = p_profile and estado = 'activo' order by created_at for update loop
    update public.cc_visitors
       set estado = 'adoptado', adopted_profile_id = p_profile, adopted_at = now(), last_seen_at = now(),
           token_hash = encode(extensions.digest(id::text || clock_timestamp()::text || random()::text, 'sha256'), 'hex')
     where id = r.id;
    insert into public.cc_visitor_events (visitor_id, tipo, actor_profile_id) values (r.id, 'adoptado', p_profile);
    insert into public.cc_visitor_events (visitor_id, tipo, detalle) values (r.id, 'revocado', '{"motivo":"adopcion"}');
    convs := convs + public._cc_adoptar_conversaciones(r.id, p_profile);   -- CC-2
    n := n + 1;
  end loop;
  return jsonb_build_object('estado', case when n > 0 then 'adoptado' else 'nada' end, 'adoptados', n, 'conversaciones', convs);
end;
$$;

-- La purga de visitantes (CC-1) nunca toca uno con conversación o mensajes (FK restrict + exclusión).
create or replace function public.cc_visitantes_purgar(p_dias int default 90) returns int
language plpgsql security definer set search_path = public as
$$
declare n int;
begin
  if p_dias is null or p_dias < 30 then raise exception 'CC1_ARGUMENTOS: la retención mínima es 30 días' using errcode = 'invalid_parameter_value'; end if;
  perform set_config('app.cc_purga', 'on', true);
  delete from public.cc_visitors v
   where v.estado = 'activo' and v.adopted_profile_id is null and v.pending_profile_id is null
     and v.last_seen_at < now() - make_interval(days => p_dias)
     and not exists (select 1 from public.prospects p where p.visitor_id = v.id)
     and not exists (select 1 from public.cc_conversations c where c.visitor_id = v.id)
     and not exists (select 1 from public.cc_messages m where m.actor_visitor_id = v.id);
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6) PRIVILEGIOS
-- ---------------------------------------------------------------------------
revoke all on function public.cc_abrir_conversacion(text, uuid), public.cc_leer_conversacion(uuid, text, text, uuid, bigint, int),
  public.cc_enviar_mensaje(uuid, text, text, uuid, text, text), public.cc_marcar_leido(uuid, text, text, uuid, bigint),
  public.cc_solicitar_asesor(uuid, text, text, uuid), public.cc_asignar_asesor(uuid, uuid, uuid), public.cc_iniciar_asesoria(uuid, uuid),
  public.cc_terminar_asesoria(uuid, uuid), public.cc_reanudar_ia(uuid, text, text, uuid), public.cc_cerrar_conversacion(uuid, text, text, uuid),
  public.cc_reabrir_conversacion(uuid, text, text, uuid), public._cc_adoptar_conversaciones(uuid, uuid), public.cc_visitante_adoptar(text, uuid), public.cc_visitantes_purgar(int)
  from public, anon, authenticated;
grant execute on function public.cc_abrir_conversacion(text, uuid), public.cc_leer_conversacion(uuid, text, text, uuid, bigint, int),
  public.cc_enviar_mensaje(uuid, text, text, uuid, text, text), public.cc_marcar_leido(uuid, text, text, uuid, bigint),
  public.cc_solicitar_asesor(uuid, text, text, uuid), public.cc_asignar_asesor(uuid, uuid, uuid), public.cc_iniciar_asesoria(uuid, uuid),
  public.cc_terminar_asesoria(uuid, uuid), public.cc_reanudar_ia(uuid, text, text, uuid), public.cc_cerrar_conversacion(uuid, text, text, uuid),
  public.cc_reabrir_conversacion(uuid, text, text, uuid), public.cc_visitante_adoptar(text, uuid), public.cc_visitantes_purgar(int)
  to service_role;
revoke all on function public.cc_cola_asesorias() from public, anon;
grant execute on function public.cc_cola_asesorias() to authenticated, service_role;
revoke all on function public._cc_puede_atender(uuid), public._cc_perfil_activo(uuid), public._cc_visitor_por_hash(text), public._cc_evento(uuid, text, text, uuid, uuid, jsonb),
  public._cc_sistema(uuid, text, text), public._cc_transicion_valida(text, text), public._cc_cambiar_modo(uuid, text, text, text, uuid, uuid, jsonb),
  public._cc_autoridad(uuid, text, uuid, uuid), public._cc_participante(uuid, text, uuid, uuid, text) from public, anon;

-- ---------------------------------------------------------------------------
-- 7) Verificación final
-- ---------------------------------------------------------------------------
do $post$
declare n int;
begin
  select count(*) into n from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated')
     and table_name in ('cc_conversations', 'cc_participants', 'cc_messages', 'cc_conversation_events') and (grantee = 'anon' or privilege_type <> 'SELECT');
  if n <> 0 then raise exception 'CC2: % privilegios indebidos sobre tablas cc_*', n; end if;
  if has_function_privilege('authenticated', 'public.cc_enviar_mensaje(uuid,text,text,uuid,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.cc_abrir_conversacion(text,uuid)', 'EXECUTE') then
    raise exception 'CC2: comandos ejecutables por clientes';
  end if;
  if not public._cc_transicion_valida('human_active', 'human_ended') or public._cc_transicion_valida('human_active', 'ai_active') then
    raise exception 'CC2: la máquina de estados no cumple su contrato';
  end if;
  if pg_get_functiondef('public.cc_visitante_adoptar(text,uuid)'::regprocedure) not like '%_cc_adoptar_conversaciones%' then
    raise exception 'CC2: la adopción no quedó integrada';
  end if;
end $post$;
