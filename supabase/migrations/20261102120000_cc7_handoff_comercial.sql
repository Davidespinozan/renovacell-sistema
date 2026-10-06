-- ============================================================================
-- CC-7 · CANAL PERMANENTE + CARRITO CANÓNICO + HANDOFF COMERCIAL AUTOMÁTICO (migración 119)
--
-- Decisiones del dueño (6 oct 2026):
--   · Horario de atención configurable por Dirección (zona por defecto America/Mazatlan). Sin
--     configurar = "disponibilidad desconocida": nunca se promete un humano inmediato.
--   · Cartera canónica cliente→vendedor (cc_cartera) con historial append-only. Es la ÚNICA
--     autoridad de ruteo de conversaciones y de atribución en el checkout. La atribución de
--     marketing (cc_visitors.seller_profile_id / seller_preferido_id) se conserva aparte.
--   · Vendedor elegible = rol pos activo + capability 'conversaciones'; para clientes NUEVOS además
--     'nuevos_clientes'. Dirección supervisa; no recibe ruteo automático.
--   · Primer artículo de un carrito (mutación canónica _cc_cart_mutar) → UN handoff por carrito,
--     idempotente, en un SAVEPOINT (el carrito nunca falla por el ruteo; queda 'pendiente').
--   · La IA sigue hasta HUMAN_ACTIVE (ahora también en human_assigned). Tras human_ended, el
--     siguiente mensaje del dueño la reanuda sola. Cerrar no es permanente: abrir reabre la última.
--   · El doctor puede rechazar al asesor SOLO para el carrito actual (sin enfriamiento global).
--   · Checkout CC-6 acepta snapshot de dirección y factura (convergencia del Catálogo).
-- Orden de locks: dueño (advisory 'cc_dueno:<perfil>' o FOR KEY SHARE del visitante) → carrito → conversación.
-- Rollback: supabase/rollback/cc7/99_down.sql
-- ============================================================================
do $pre$
begin
  if to_regprocedure('public.cc_checkout_confirmar(uuid,text,integer)') is null then raise exception 'CC7: falta CC-6'; end if;
  if to_regprocedure('public._cc_cart_mutar(uuid,text,text,uuid,text,uuid,integer,text)') is null then raise exception 'CC7: falta CC-5'; end if;
end $pre$;

-- ── 1) Horario de atención ───────────────────────────────────────────────────
create table public.cc_horario_config (
  id smallint primary key default 1 constraint ck_chc_unica check (id = 1),
  zona text not null default 'America/Mazatlan',
  configurado boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);
insert into public.cc_horario_config default values;

create table public.cc_horario_semanal (
  dia smallint primary key constraint ck_chs_dia check (dia between 1 and 7),   -- ISO: 1 = lunes … 7 = domingo
  abierto boolean not null default false,
  abre time, cierra time,
  constraint ck_chs_rango check (not abierto or (abre is not null and cierra is not null and abre < cierra))
);

create table public.cc_horario_excepciones (
  fecha date primary key,
  tipo text not null constraint ck_che_tipo check (tipo in ('cerrado', 'horario')),
  abre time, cierra time,
  motivo text constraint ck_che_motivo check (motivo is null or length(motivo) <= 200),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id),
  constraint ck_che_rango check (tipo = 'cerrado' or (abre is not null and cierra is not null and abre < cierra))
);

create table public.cc_horario_eventos (
  id bigint generated always as identity primary key,
  accion text not null constraint ck_chev_accion check (accion in ('semana_guardada', 'excepcion_guardada', 'excepcion_borrada')),
  detalle jsonb constraint ck_chev_detalle check (detalle is null or length(detalle::text) <= 4000),
  actor_profile_id uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create trigger trg_chev_append_only before update or delete on public.cc_horario_eventos for each row execute function public._cc_append_only();

-- ── 2) Cartera canónica cliente → vendedor ───────────────────────────────────
create table public.cc_cartera (
  profile_id uuid primary key references public.profiles(id),
  seller_profile_id uuid not null references public.profiles(id),
  asignado_at timestamptz not null default now(),
  asignado_por uuid references public.profiles(id),
  motivo text constraint ck_ccart_motivo check (motivo is null or length(motivo) <= 200),
  constraint ck_ccart_distintos check (profile_id <> seller_profile_id)
);
create index idx_ccartera_seller on public.cc_cartera (seller_profile_id);

create table public.cc_cartera_historial (
  id bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id),
  seller_anterior uuid references public.profiles(id),
  seller_nuevo uuid references public.profiles(id),
  actor_profile_id uuid references public.profiles(id),
  motivo text constraint ck_cch_motivo check (motivo is null or length(motivo) <= 200),
  created_at timestamptz not null default now()
);
create index idx_cch_profile on public.cc_cartera_historial (profile_id, created_at desc);
create trigger trg_cch_append_only before update or delete on public.cc_cartera_historial for each row execute function public._cc_append_only();

alter table public.cc_horario_config enable row level security;
alter table public.cc_horario_semanal enable row level security;
alter table public.cc_horario_excepciones enable row level security;
alter table public.cc_horario_eventos enable row level security;
alter table public.cc_cartera enable row level security;
alter table public.cc_cartera_historial enable row level security;
revoke all on public.cc_horario_config, public.cc_horario_semanal, public.cc_horario_excepciones, public.cc_horario_eventos,
  public.cc_cartera, public.cc_cartera_historial from public, anon, authenticated;

-- ── 3) Estado del handoff en carrito y conversación ──────────────────────────
alter table public.cc_carts
  add column handoff_estado text constraint ck_ccart_handoff check (handoff_estado is null or handoff_estado in ('solicitado', 'pendiente', 'rechazado')),
  add column handoff_at timestamptz,
  add column handoff_conversation_id uuid references public.cc_conversations(id),
  add column handoff_error text constraint ck_ccart_handoff_error check (handoff_error is null or handoff_error ~ '^[0-9A-Z]{5}$');

alter table public.cc_conversations
  add column handoff_origen text constraint ck_ccc_handoff_origen check (handoff_origen is null or handoff_origen in ('carrito', 'manual')),
  add column handoff_cart_id uuid references public.cc_carts(id),
  add column handoff_fuera_horario boolean,
  add column ruteo_motivo text constraint ck_ccc_ruteo check (ruteo_motivo is null or ruteo_motivo in ('sin_vendedor', 'vendedor_no_elegible', 'visitante'));

alter table public.cc_conversation_events drop constraint ck_ccce_tipo;
alter table public.cc_conversation_events add constraint ck_ccce_tipo check (tipo in ('conversation_opened', 'visitor_adopted', 'human_offered', 'human_requested', 'human_assigned', 'seller_unassigned',
  'human_started', 'human_ended', 'ai_resumed', 'conversation_closed', 'conversation_reopened',
  'human_handoff_requested', 'human_handoff_queued', 'human_handoff_rejected'));
alter table public.cc_cart_events drop constraint ck_ccev_tipo;
alter table public.cc_cart_events add constraint ck_ccev_tipo check (tipo in ('opened', 'item_added', 'first_item_added', 'item_quantity_changed', 'item_removed', 'emptied', 'merged', 'adopted', 'closed',
  'converted', 'conversation_linked', 'seller_offer_triggered', 'seller_offer_accepted', 'seller_offer_dismissed', 'checkout_prepared',
  'handoff_requested', 'handoff_failed', 'handoff_rejected'));

-- ── 4) Helpers de autoridad ──────────────────────────────────────────────────
create or replace function public._cc7_direccion() returns void
  language plpgsql stable set search_path = public as
$$ begin if not (public._cc_es_admin() or public._cc_es_service()) then raise exception 'NO_AUTORIZADO: solo Dirección' using errcode = 'insufficient_privilege'; end if; end $$;

-- Vendedor elegible para RECIBIR conversaciones (y, con p_nuevos, para recibir clientes nuevos).
create or replace function public._cc_vendedor_elegible(p_profile uuid, p_nuevos boolean default false) returns boolean
  language sql stable set search_path = public as
$$
  select coalesce((select p.active and p.role_id = 'pos'
                          and coalesce(p.meta -> 'capabilities', '[]'::jsonb) ? 'conversaciones'
                          and (not p_nuevos or coalesce(p.meta -> 'capabilities', '[]'::jsonb) ? 'nuevos_clientes')
                     from public.profiles p where p.id = p_profile), false)
$$;

-- La autoridad canónica cliente → vendedor.
create or replace function public._cc_vendedor_de(p_profile uuid) returns uuid
  language sql stable set search_path = public as
$$ select k.seller_profile_id from public.cc_cartera k where k.profile_id = p_profile $$;

-- ── 5) Horario: estado en un instante (servidor = autoridad) ────────────────
create or replace function public._cc_horario_estado(p_ts timestamptz default now()) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare cfg record; loc timestamp; d date; t time; i int; dd date; ab time; ci time; v_exc boolean; v_exc_hoy boolean := false;
        abierto boolean := false; prox timestamptz; ex record; s record;
begin
  select * into cfg from public.cc_horario_config where id = 1;
  if not found or not cfg.configurado then
    return jsonb_build_object('configurado', false, 'abierto', false, 'zona', coalesce(cfg.zona, 'America/Mazatlan'), 'motivo', 'sin_configurar');
  end if;
  loc := p_ts at time zone cfg.zona; d := loc::date; t := loc::time;
  for i in 0..14 loop
    dd := d + i; ab := null; ci := null;
    select * into ex from public.cc_horario_excepciones where fecha = dd;
    v_exc := found;
    if v_exc then
      if ex.tipo = 'horario' then ab := ex.abre; ci := ex.cierra; end if;
    else
      select * into s from public.cc_horario_semanal where dia = extract(isodow from dd)::int;
      if found and s.abierto then ab := s.abre; ci := s.cierra; end if;
    end if;
    if i = 0 then
      v_exc_hoy := v_exc;
      abierto := ab is not null and t >= ab and t < ci;
      if abierto then exit; end if;
      if ab is not null and t < ab then prox := (dd + ab) at time zone cfg.zona; exit; end if;
    elsif ab is not null then
      prox := (dd + ab) at time zone cfg.zona; exit;
    end if;
  end loop;
  return jsonb_build_object('configurado', true, 'abierto', abierto, 'zona', cfg.zona, 'motivo', case when abierto then 'en_horario' else 'fuera_de_horario' end,
                            'excepcion_hoy', v_exc_hoy, 'proxima_apertura', prox, 'hora_local', to_char(loc, 'YYYY-MM-DD HH24:MI'));
end;
$$;

-- ── 6) Conversación canónica del dueño: abierta → reabrir la última → crear ──
create or replace function public._cc_conversacion_de(p_visitor uuid, p_profile uuid) returns jsonb
  language plpgsql set search_path = public as
$$
declare v uuid; v_seller uuid; v_rol text;
begin
  if p_profile is not null then
    select id into v from public.cc_conversations where profile_id = p_profile and estado = 'abierta';
    if v is not null then return jsonb_build_object('conversation_id', v, 'nuevo', false); end if;
    select c.id into v from public.cc_conversations c
     where c.profile_id = p_profile and c.estado = 'cerrada'
       and not exists (select 1 from public.cc_conversation_events e where e.conversation_id = c.id and e.tipo = 'conversation_closed' and e.detalle ->> 'motivo' = 'consolidada')
     order by c.last_message_at desc nulls last, c.created_at desc limit 1 for update;
  else
    select id into v from public.cc_conversations where visitor_id = p_visitor and profile_id is null and estado = 'abierta';
    if v is not null then return jsonb_build_object('conversation_id', v, 'nuevo', false); end if;
    select c.id into v from public.cc_conversations c
     where c.visitor_id = p_visitor and c.profile_id is null and c.estado = 'cerrada'
     order by c.last_message_at desc nulls last, c.created_at desc limit 1 for update;
  end if;
  if v is not null then
    -- Canal permanente: cerrar nunca es definitivo; la conversación vuelve con su historial.
    begin
      update public.cc_conversations set estado = 'abierta', closed_at = null, updated_at = now() where id = v;
      perform public._cc_evento(v, 'conversation_reopened', 'system', null, null, jsonb_build_object('motivo', 'canal_permanente'));
      return jsonb_build_object('conversation_id', v, 'nuevo', false);
    exception when unique_violation then
      v := null;   -- otra sesión abrió una en paralelo: se usa esa
    end;
  end if;
  if p_profile is not null then
    v_rol := public._cc_perfil_activo(p_profile);
    select vi.seller_profile_id into v_seller from public.cc_visitors vi
     where vi.adopted_profile_id = p_profile and vi.seller_profile_id is not null and public._cc_puede_atender(vi.seller_profile_id)
     order by vi.adopted_at desc limit 1;
    insert into public.cc_conversations (profile_id, seller_preferido_id) values (p_profile, v_seller)
      on conflict (profile_id) where estado = 'abierta' and profile_id is not null do nothing returning id into v;
    if v is null then
      select id into v from public.cc_conversations where profile_id = p_profile and estado = 'abierta';
      return jsonb_build_object('conversation_id', v, 'nuevo', false);
    end if;
    perform public._cc_participante(v, case when v_rol = 'admin' then 'admin' else 'doctor' end, null, p_profile, 'dueno');
    perform public._cc_evento(v, 'conversation_opened', 'doctor', p_profile, null);
  else
    select vi.seller_profile_id into v_seller from public.cc_visitors vi where vi.id = p_visitor and vi.seller_profile_id is not null and public._cc_puede_atender(vi.seller_profile_id);
    insert into public.cc_conversations (visitor_id, seller_preferido_id) values (p_visitor, v_seller)
      on conflict (visitor_id) where estado = 'abierta' and visitor_id is not null and profile_id is null do nothing returning id into v;
    if v is null then
      select id into v from public.cc_conversations where visitor_id = p_visitor and profile_id is null and estado = 'abierta';
      return jsonb_build_object('conversation_id', v, 'nuevo', false);
    end if;
    perform public._cc_participante(v, 'visitor', p_visitor, null, 'dueno');
    perform public._cc_evento(v, 'conversation_opened', 'visitor', null, p_visitor);
  end if;
  return jsonb_build_object('conversation_id', v, 'nuevo', true);
end;
$$;

-- ── 7) Ruteo canónico (la conversación debe estar en human_requested) ────────
create or replace function public._cc_rutear(p_conv uuid) returns jsonb
  language plpgsql set search_path = public as
$$
declare c record; s uuid; v_motivo text;
begin
  select * into c from public.cc_conversations where id = p_conv for update;
  if c.modo <> 'human_requested' then
    return jsonb_build_object('asignado', c.seller_profile_id is not null and c.modo in ('human_assigned', 'human_active'), 'sin_cambio', true);
  end if;
  if c.profile_id is null then
    -- Visitante: no hay cartera; solo un asesor que Dirección ya le haya puesto a ESTA conversación.
    if c.seller_profile_id is not null and public._cc_puede_atender(c.seller_profile_id) then s := c.seller_profile_id; else v_motivo := 'visitante'; end if;
  else
    s := public._cc_vendedor_de(c.profile_id);
    if s is null then v_motivo := 'sin_vendedor';
    elsif not public._cc_vendedor_elegible(s, false) then v_motivo := 'vendedor_no_elegible'; s := null;
    end if;
  end if;
  if v_motivo is null then
    if c.seller_profile_id is distinct from s then
      if c.seller_profile_id is not null then
        update public.cc_participants set left_at = now() where conversation_id = p_conv and profile_id = c.seller_profile_id and rol = 'asesor';
        perform public._cc_evento(p_conv, 'seller_unassigned', 'system', null, null, jsonb_build_object('seller', c.seller_profile_id, 'motivo', 'cartera'));
      end if;
      update public.cc_conversations set seller_profile_id = s, updated_at = now() where id = p_conv;
      perform public._cc_participante(p_conv, 'seller', null, s, 'asesor');
    end if;
    update public.cc_conversations set ruteo_motivo = null where id = p_conv;
    perform public._cc_cambiar_modo(p_conv, 'human_assigned', 'human_assigned', 'system', null, null, jsonb_build_object('seller', s, 'origen', case when c.profile_id is null then 'conversacion' else 'cartera' end));
    return jsonb_build_object('asignado', true, 'seller', s);
  end if;
  -- Sin vendedor elegible: NUNCA se reasigna al azar. Se libera un asesor que ya no puede atender y se encola para Dirección.
  if c.seller_profile_id is not null then
    update public.cc_participants set left_at = now() where conversation_id = p_conv and profile_id = c.seller_profile_id and rol = 'asesor';
    perform public._cc_evento(p_conv, 'seller_unassigned', 'system', null, null, jsonb_build_object('seller', c.seller_profile_id, 'motivo', v_motivo));
  end if;
  update public.cc_conversations set seller_profile_id = null, ruteo_motivo = v_motivo, updated_at = now() where id = p_conv;
  return jsonb_build_object('asignado', false, 'motivo', v_motivo);
end;
$$;

-- Textos del aviso al dueño: verdad según el horario (nunca "ya viene" sin evidencia).
create or replace function public._cc_texto_handoff(p_configurado boolean, p_en_horario boolean) returns text
  language sql immutable as
$$
  select case
    when not p_configurado then 'Registramos tu solicitud para que un asesor personal de Renovacell te atienda; te avisaremos aquí en cuanto se una. Mientras tanto, el asistente sigue aquí para ayudarte.'
    when p_en_horario then 'Te conectaremos con un asesor personal de Renovacell. Mientras tanto, el asistente sigue aquí para ayudarte.'
    else 'Nuestro equipo de asesores no está disponible en este momento. Tu conversación quedó lista para que podamos continuar cuando vuelva a estar disponible. Mientras tanto, el asistente sigue aquí para ayudarte.'
  end
$$;

-- ── 8) Handoff por carrito (un ciclo por carrito; idempotente) ───────────────
create or replace function public._cc_handoff_carrito(p_cart uuid) returns jsonb
  language plpgsql set search_path = public as
$$
declare k record; v_conv uuid; c record; hor jsonb; v_conf boolean; v_en boolean; ru jsonb; v_items int;
begin
  if coalesce(current_setting('app.cc_handoff_fallar', true), '') = 'on' then raise exception 'FALLO_INYECTADO: handoff'; end if;   -- solo pruebas
  select * into k from public.cc_carts where id = p_cart for update;
  if not found or k.estado <> 'active' then return jsonb_build_object('estado', 'no_aplica'); end if;
  if k.handoff_estado in ('solicitado', 'rechazado') then return jsonb_build_object('estado', k.handoff_estado, 'idempotente', true); end if;
  select count(*) into v_items from public.cc_cart_items where cart_id = p_cart;
  if v_items = 0 then return jsonb_build_object('estado', 'no_aplica'); end if;

  v_conv := (public._cc_conversacion_de(case when k.profile_id is null then k.visitor_id end, k.profile_id) ->> 'conversation_id')::uuid;
  select * into c from public.cc_conversations where id = v_conv for update;
  hor := public._cc_horario_estado(now());
  v_conf := (hor ->> 'configurado')::boolean;
  v_en := v_conf and coalesce((hor ->> 'abierto')::boolean, false);

  update public.cc_carts set handoff_estado = 'solicitado', handoff_at = now(), handoff_conversation_id = v_conv, handoff_error = null,
         conversation_id = coalesce(conversation_id, v_conv), updated_at = now() where id = p_cart;
  perform public._cc_cart_evento(p_cart, 'handoff_requested', 'system', null, null, null, null, null,
          jsonb_build_object('conversation_id', v_conv, 'fuera_horario', not v_en, 'horario_configurado', v_conf));

  if c.modo in ('human_requested', 'human_assigned', 'human_active') then
    -- Ya hay atención humana en curso o pedida: se liga el carrito, sin mensaje ni solicitud duplicada.
    update public.cc_conversations set handoff_cart_id = p_cart, handoff_origen = coalesce(handoff_origen, 'carrito'), updated_at = now() where id = v_conv;
    perform public._cc_evento(v_conv, 'human_handoff_requested', 'system', null, null,
            jsonb_build_object('origen', 'carrito', 'cart_id', p_cart, 'ya_en_curso', true, 'fuera_horario', not v_en));
    return jsonb_build_object('estado', 'solicitado', 'conversation_id', v_conv, 'modo', c.modo, 'ya_en_curso', true, 'fuera_horario', not v_en, 'horario_configurado', v_conf);
  end if;

  update public.cc_conversations set handoff_cart_id = p_cart, handoff_origen = 'carrito', handoff_fuera_horario = not v_en where id = v_conv;
  perform public._cc_cambiar_modo(v_conv, 'human_requested', 'human_handoff_requested', 'system', null, null,
          jsonb_build_object('origen', 'carrito', 'cart_id', p_cart, 'fuera_horario', not v_en, 'horario_configurado', v_conf));
  ru := public._cc_rutear(v_conv);
  if not (ru ->> 'asignado')::boolean then
    perform public._cc_evento(v_conv, 'human_handoff_queued', 'system', null, null, jsonb_build_object('motivo', ru ->> 'motivo', 'fuera_horario', not v_en));
  end if;
  perform public._cc_sistema(v_conv, public._cc_texto_handoff(v_conf, v_en), 'sys:handoff:' || p_cart::text);
  select * into c from public.cc_conversations where id = v_conv;
  return jsonb_build_object('estado', 'solicitado', 'conversation_id', v_conv, 'modo', c.modo, 'asignado', (ru ->> 'asignado')::boolean,
                            'motivo', ru ->> 'motivo', 'fuera_horario', not v_en, 'horario_configurado', v_conf);
end;
$$;

-- Envoltura segura: un fallo deja el carrito 'pendiente' (observable y recuperable), nunca rompe al llamador.
create or replace function public._cc_handoff_seguro(p_cart uuid) returns jsonb
  language plpgsql set search_path = public as
$$
declare v_err text;
begin
  return public._cc_handoff_carrito(p_cart);
exception when others then
  get stacked diagnostics v_err = returned_sqlstate;
  update public.cc_carts set handoff_estado = 'pendiente', handoff_error = v_err where id = p_cart and estado = 'active';
  perform public._cc_cart_evento(p_cart, 'handoff_failed', 'system', null, null, null, null, null, jsonb_build_object('sqlstate', v_err));
  return jsonb_build_object('estado', 'pendiente');
end;
$$;

-- Tras adoptar un visitante: el handoff del carrito se conserva en la conversación canónica y se rutea por cartera.
create or replace function public._cc_handoff_tras_adopcion(p_profile uuid) returns void
  language plpgsql set search_path = public as
$$
declare pc record; v record; v_abierta uuid;
begin
  select id into v_abierta from public.cc_conversations where profile_id = p_profile and estado = 'abierta';
  select * into pc from public.cc_carts where profile_id = p_profile and estado = 'active' for update;
  if found and exists (select 1 from public.cc_cart_items where cart_id = pc.id) then
    if pc.handoff_estado is null and exists (select 1 from public.cc_carts m where m.merged_into_cart_id = pc.id and m.handoff_estado in ('solicitado', 'pendiente')) then
      perform public._cc_handoff_seguro(pc.id);
    elsif pc.handoff_estado in ('solicitado', 'pendiente') and pc.handoff_conversation_id is distinct from v_abierta then
      update public.cc_carts set handoff_estado = null where id = pc.id;   -- la conversación del visitante se consolidó: se solicita en la canónica
      perform public._cc_handoff_seguro(pc.id);
    end if;
  end if;
  select * into v from public.cc_conversations where profile_id = p_profile and estado = 'abierta' for update;
  if found and v.modo = 'human_requested' and v.seller_profile_id is null then
    begin
      perform public._cc_rutear(v.id);
    exception when others then
      perform public._cc_evento(v.id, 'human_handoff_queued', 'system', null, null, jsonb_build_object('motivo', 'ruteo_fallido'));
    end;
  end if;
end;
$$;

-- Snapshot de dirección enviado por el Catálogo (forma ShippingAddress del portal). Validado; nunca autoridad económica.
create or replace function public._cc_chk_direccion_snapshot(p jsonb) returns jsonb
  language plpgsql immutable as
$$
declare l1 text; cp text;
  f text[] := array['colonia', 'city', 'state', 'refs', 'phone', 'country'];
  a jsonb; k text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return null; end if;
  l1 := btrim(coalesce(p ->> 'line1', ''));
  if length(l1) < 3 or length(l1) > 200 then return null; end if;
  cp := nullif(btrim(coalesce(p ->> 'cp', '')), '');
  if cp is not null and cp !~ '^[0-9]{5}$' then return null; end if;
  a := jsonb_build_object('line1', l1, 'cp', cp);
  foreach k in array f loop
    a := a || jsonb_build_object(k, nullif(btrim(left(coalesce(p ->> k, ''), 200)), ''));
  end loop;
  return jsonb_build_object('location_id', null, 'address', jsonb_strip_nulls(a), 'nombre', null, 'contacto', nullif(btrim(left(coalesce(p ->> 'contacto', ''), 120)), ''));
end;
$$;

-- Atribución del checkout = la misma autoridad que el ruteo (cartera). Sin cartera: ninguno.
create or replace function public._cc_chk_seller(p_profile uuid) returns jsonb
  language plpgsql stable set search_path = public as
$$
declare v_id uuid; v_email text;
begin
  v_id := public._cc_vendedor_de(p_profile);
  if v_id is null then return null; end if;
  select email into v_email from public.profiles where id = v_id;
  return jsonb_build_object('seller_profile_id', v_id, 'seller', v_email, 'seller_origen', 'cartera');
end;
$$;

-- ── 9a) Comandos de conversación (servicio; los llama la Edge chat) ──────────
create or replace function public.cc_abrir_conversacion(p_visitor_hash text, p_profile uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_visitor uuid; r jsonb; c record; v_cart uuid;
begin
  if p_profile is not null then
    if public._cc_perfil_activo(p_profile) is null then raise exception 'CUENTA_SUSPENDIDA'; end if;
    perform pg_advisory_xact_lock(hashtext('cc_dueno:' || p_profile::text));
  else
    v_visitor := public._cc_visitor_por_hash(p_visitor_hash);
    if v_visitor is null then raise exception 'SESION_INVALIDA'; end if;
    perform 1 from public.cc_visitors where id = v_visitor for key share;
  end if;
  r := public._cc_conversacion_de(v_visitor, p_profile);
  -- Recuperación: un handoff que quedó 'pendiente' se reintenta al volver (el carrito nunca falló por él).
  select k.id into v_cart from public.cc_carts k
   where k.estado = 'active' and k.handoff_estado = 'pendiente'
     and (case when p_profile is not null then k.profile_id = p_profile else k.visitor_id = v_visitor and k.profile_id is null end)
     and exists (select 1 from public.cc_cart_items i where i.cart_id = k.id) limit 1;
  if v_cart is not null then perform public._cc_handoff_seguro(v_cart); end if;
  select * into c from public.cc_conversations where id = (r ->> 'conversation_id')::uuid;
  return jsonb_build_object('conversation_id', c.id, 'estado', c.estado, 'modo', c.modo, 'nuevo', (r ->> 'nuevo')::boolean,
                            'asesor', c.seller_profile_id is not null, 'ultimo_seq', c.ultimo_seq);
end;
$$;

create or replace function public.cc_solicitar_asesor(p_conv uuid, p_actor_type text, p_visitor_hash text, p_profile uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_visitor uuid; c record; hor jsonb; v_conf boolean; v_en boolean; ru jsonb;
begin
  if p_actor_type not in ('visitor', 'doctor') then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if p_actor_type = 'visitor' then v_visitor := public._cc_visitor_por_hash(p_visitor_hash); if v_visitor is null then raise exception 'SESION_INVALIDA'; end if; end if;
  perform public._cc_autoridad(p_conv, p_actor_type, v_visitor, p_profile);
  select * into c from public.cc_conversations where id = p_conv for update;
  if c.estado <> 'abierta' then raise exception 'CONVERSACION_CERRADA' using errcode = 'check_violation'; end if;
  if c.modo in ('human_requested', 'human_assigned', 'human_active') then
    return jsonb_build_object('modo', c.modo, 'asesor', c.seller_profile_id is not null, 'idempotente', true);
  end if;
  hor := public._cc_horario_estado(now()); v_conf := (hor ->> 'configurado')::boolean; v_en := v_conf and coalesce((hor ->> 'abierto')::boolean, false);
  perform public._cc_cambiar_modo(p_conv, 'human_requested', 'human_requested', p_actor_type, case when p_actor_type <> 'visitor' then p_profile end, v_visitor,
          jsonb_build_object('origen', 'manual', 'fuera_horario', not v_en, 'horario_configurado', v_conf));
  update public.cc_conversations set handoff_origen = 'manual', handoff_cart_id = null, handoff_fuera_horario = not v_en where id = p_conv;
  -- CC-7 · el ruteo es la cartera canónica (la atribución del referido ya NO decide quién atiende).
  ru := public._cc_rutear(p_conv);
  if not (ru ->> 'asignado')::boolean then
    perform public._cc_evento(p_conv, 'human_handoff_queued', 'system', null, null, jsonb_build_object('motivo', ru ->> 'motivo', 'fuera_horario', not v_en));
  end if;
  perform public._cc_sistema(p_conv, 'Pediste hablar con un asesor. ' || public._cc_texto_handoff(v_conf, v_en), 'sys:solicitud:' || c.ultimo_seq);
  select * into c from public.cc_conversations where id = p_conv;
  return jsonb_build_object('modo', c.modo, 'asesor', c.seller_profile_id is not null, 'idempotente', false, 'fuera_horario', not v_en);
end;
$$;

-- El dueño rechaza al asesor para ESTE carrito/solicitud. No toca la cartera ni impone enfriamiento global.
create or replace function public.cc_handoff_rechazar(p_conv uuid, p_actor_type text, p_visitor_hash text, p_profile uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_actor text := p_actor_type; v_visitor uuid; v_cart uuid; k record; c record;
begin
  if p_actor_type = 'ai' then v_actor := case when p_visitor_hash is not null then 'visitor' else 'doctor' end; end if;
  if v_actor not in ('visitor', 'doctor') then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if v_actor = 'visitor' then
    v_visitor := public._cc_visitor_por_hash(p_visitor_hash); if v_visitor is null then raise exception 'SESION_INVALIDA'; end if;
    perform 1 from public.cc_visitors where id = v_visitor for key share;
  else
    perform pg_advisory_xact_lock(hashtext('cc_dueno:' || p_profile::text));
  end if;
  perform public._cc_autoridad(p_conv, v_actor, v_visitor, p_profile);   -- solo el dueño
  select handoff_cart_id into v_cart from public.cc_conversations where id = p_conv;
  select * into k from public.cc_carts where id = v_cart for update;   -- carrito → conversación (sin carrito: registro en nulos)
  select * into c from public.cc_conversations where id = p_conv for update;
  if c.estado <> 'abierta' then raise exception 'CONVERSACION_CERRADA' using errcode = 'check_violation'; end if;
  if c.modo = 'human_active' then return jsonb_build_object('rechazado', false, 'motivo', 'asesor_activo', 'modo', c.modo); end if;
  if c.modo not in ('human_requested', 'human_assigned') then
    return jsonb_build_object('rechazado', false, 'motivo', 'sin_handoff', 'modo', c.modo, 'idempotente', coalesce(k.handoff_estado = 'rechazado', false));
  end if;
  if k.id is not null and k.handoff_estado is distinct from 'rechazado' then
    update public.cc_carts set handoff_estado = 'rechazado', updated_at = now() where id = k.id;
    perform public._cc_cart_evento(k.id, 'handoff_rejected', p_actor_type, case when v_actor = 'doctor' then p_profile end, v_visitor);
  end if;
  perform public._cc_cambiar_modo(p_conv, 'ai_active', 'human_handoff_rejected', v_actor, case when v_actor = 'doctor' then p_profile end, v_visitor,
          jsonb_build_object('cart_id', k.id, 'origen', c.handoff_origen));
  perform public._cc_sistema(p_conv, 'Entendido: seguimos con el asistente. Si más adelante quieres hablar con un asesor, solo pídelo aquí.',
          'sys:rechazo:' || coalesce(k.id::text, c.ultimo_seq::text));
  return jsonb_build_object('rechazado', true, 'modo', 'ai_active', 'cart_id', k.id);
end;
$$;

-- Lectura para el orquestador de IA (servicio): qué puede decir sobre la atención humana.
create or replace function public.cc_ia_estado_handoff(p_conv uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare c record; hor jsonb; v_rech boolean;
begin
  perform public._cc_solo_servicio();
  select * into c from public.cc_conversations where id = p_conv;
  if not found then return null; end if;
  hor := public._cc_horario_estado(now());
  select k.handoff_estado = 'rechazado' into v_rech from public.cc_carts k
   where k.estado = 'active' and (case when c.profile_id is not null then k.profile_id = c.profile_id else k.visitor_id = c.visitor_id and k.profile_id is null end) limit 1;
  return jsonb_build_object('modo', c.modo, 'origen', c.handoff_origen, 'horario_configurado', (hor ->> 'configurado')::boolean,
                            'en_horario', (hor ->> 'configurado')::boolean and coalesce((hor ->> 'abierto')::boolean, false),
                            'asignado', c.seller_profile_id is not null and c.modo in ('human_assigned', 'human_active'),
                            'rechazado_carrito', coalesce(v_rech, false));
end;
$$;

-- Cola de Asesorías: Dirección ve todo; el vendedor SOLO lo suyo (ya no toma clientes de la cola).
drop function public.cc_cola_asesorias();
create function public.cc_cola_asesorias() returns table (
  conversation_id uuid, modo text, seller_profile_id uuid, asesoria_solicitada_at timestamptz, last_message_at timestamptz,
  es_mia boolean, sin_leer bigint, dueno text, handoff_origen text, fuera_horario boolean, ruteo_motivo text,
  cart_id uuid, n_items int, edad_min int, iniciada boolean
) language sql stable security definer set search_path = public as
$$
  select c.id, c.modo, c.seller_profile_id, c.asesoria_solicitada_at, c.last_message_at,
         c.seller_profile_id = auth.uid() as es_mia,
         greatest(c.ultimo_seq - coalesce((select p.last_read_seq from public.cc_participants p where p.conversation_id = c.id and p.profile_id = auth.uid()), 0), 0) as sin_leer,
         case when c.profile_id is not null then coalesce((select coalesce(pr.meta ->> 'name', pr.full_name) from public.profiles pr where pr.id = c.profile_id), 'Doctor') else 'Visitante' end as dueno,
         c.handoff_origen, c.handoff_fuera_horario, c.ruteo_motivo,
         k.id, (select count(*)::int from public.cc_cart_items i where i.cart_id = k.id),
         case when c.asesoria_solicitada_at is null then null else (extract(epoch from (now() - c.asesoria_solicitada_at)) / 60)::int end,
         c.modo = 'human_active'
    from public.cc_conversations c
    left join lateral (select kk.id from public.cc_carts kk where kk.estado = 'active'
                         and (case when c.profile_id is not null then kk.profile_id = c.profile_id else kk.visitor_id = c.visitor_id and kk.profile_id is null end) limit 1) k on true
   where c.estado = 'abierta' and c.modo in ('human_requested', 'human_assigned', 'human_active', 'human_ended')
     and public._cc_puede_atender(auth.uid())
     and (public.auth_role() = 'admin' or c.seller_profile_id = auth.uid())
   order by case when c.seller_profile_id = auth.uid() then 0 else 1 end, c.asesoria_solicitada_at nulls last
$$;

-- ── 9b) Dirección: horario ───────────────────────────────────────────────────
create or replace function public.cc_horario_ver() returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare cfg record;
begin
  perform public._cc7_direccion();
  select * into cfg from public.cc_horario_config where id = 1;
  return jsonb_build_object('zona', cfg.zona, 'configurado', cfg.configurado, 'actualizado_at', cfg.updated_at,
    'semana', (select jsonb_agg(jsonb_build_object('dia', g.d, 'abierto', coalesce(s.abierto, false), 'abre', to_char(s.abre, 'HH24:MI'), 'cierra', to_char(s.cierra, 'HH24:MI')) order by g.d)
                 from generate_series(1, 7) g(d) left join public.cc_horario_semanal s on s.dia = g.d),
    'excepciones', coalesce((select jsonb_agg(jsonb_build_object('fecha', e.fecha, 'tipo', e.tipo, 'abre', to_char(e.abre, 'HH24:MI'), 'cierra', to_char(e.cierra, 'HH24:MI'), 'motivo', e.motivo) order by e.fecha)
                 from public.cc_horario_excepciones e where e.fecha >= ((now() at time zone cfg.zona)::date - 30)), '[]'::jsonb),
    'estado', public._cc_horario_estado(now()));
end;
$$;

create or replace function public.cc_horario_guardar(p_zona text, p_semana jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare x jsonb; v_dia int; v_ab time; v_ci time; v_abierto boolean; vistos int[] := '{}'; antes jsonb;
begin
  perform public._cc7_direccion();
  if p_zona is null or not exists (select 1 from pg_timezone_names where name = p_zona) then raise exception 'ZONA_INVALIDA' using errcode = 'check_violation'; end if;
  if p_semana is null or jsonb_typeof(p_semana) <> 'array' or jsonb_array_length(p_semana) <> 7 then raise exception 'SEMANA_INVALIDA: se esperan 7 días' using errcode = 'check_violation'; end if;
  select jsonb_build_object('zona', zona, 'configurado', configurado,
         'semana', (select jsonb_agg(jsonb_build_object('dia', dia, 'abierto', abierto, 'abre', abre, 'cierra', cierra) order by dia) from public.cc_horario_semanal))
    into antes from public.cc_horario_config where id = 1 for update;
  delete from public.cc_horario_semanal;
  for x in select * from jsonb_array_elements(p_semana) loop
    begin
      v_dia := (x ->> 'dia')::int; v_abierto := coalesce((x ->> 'abierto')::boolean, false);
      v_ab := case when v_abierto then (x ->> 'abre')::time end; v_ci := case when v_abierto then (x ->> 'cierra')::time end;
    exception when others then raise exception 'HORARIO_INVALIDO' using errcode = 'check_violation';
    end;
    if v_dia is null or v_dia not between 1 and 7 or v_dia = any (vistos) then raise exception 'SEMANA_INVALIDA: días repetidos o fuera de rango' using errcode = 'check_violation'; end if;
    if v_abierto and (v_ab is null or v_ci is null or v_ab >= v_ci) then raise exception 'HORARIO_INVALIDO: la apertura debe ser antes del cierre' using errcode = 'check_violation'; end if;
    vistos := vistos || v_dia;
    insert into public.cc_horario_semanal (dia, abierto, abre, cierra) values (v_dia, v_abierto, v_ab, v_ci);
  end loop;
  update public.cc_horario_config set zona = p_zona, configurado = true, updated_at = now(), updated_by = auth.uid() where id = 1;
  insert into public.cc_horario_eventos (accion, detalle, actor_profile_id) values ('semana_guardada', jsonb_build_object('antes', antes, 'despues', jsonb_build_object('zona', p_zona, 'semana', p_semana)), auth.uid());
  return public.cc_horario_ver();
end;
$$;

create or replace function public.cc_horario_excepcion_guardar(p_fecha date, p_tipo text, p_abre text default null, p_cierra text default null, p_motivo text default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_ab time; v_ci time; antes jsonb;
begin
  perform public._cc7_direccion();
  if p_fecha is null or p_tipo not in ('cerrado', 'horario') then raise exception 'EXCEPCION_INVALIDA' using errcode = 'check_violation'; end if;
  if p_tipo = 'horario' then
    begin v_ab := p_abre::time; v_ci := p_cierra::time; exception when others then raise exception 'HORARIO_INVALIDO' using errcode = 'check_violation'; end;
    if v_ab is null or v_ci is null or v_ab >= v_ci then raise exception 'HORARIO_INVALIDO: la apertura debe ser antes del cierre' using errcode = 'check_violation'; end if;
  end if;
  select to_jsonb(e) into antes from public.cc_horario_excepciones e where fecha = p_fecha;
  insert into public.cc_horario_excepciones (fecha, tipo, abre, cierra, motivo, created_by)
  values (p_fecha, p_tipo, v_ab, v_ci, nullif(btrim(left(coalesce(p_motivo, ''), 200)), ''), auth.uid())
  on conflict (fecha) do update set tipo = excluded.tipo, abre = excluded.abre, cierra = excluded.cierra, motivo = excluded.motivo, created_by = excluded.created_by, created_at = now();
  insert into public.cc_horario_eventos (accion, detalle, actor_profile_id)
  values ('excepcion_guardada', jsonb_build_object('fecha', p_fecha, 'antes', antes, 'tipo', p_tipo, 'abre', v_ab, 'cierra', v_ci), auth.uid());
  return public.cc_horario_ver();
end;
$$;

create or replace function public.cc_horario_excepcion_borrar(p_fecha date) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare antes jsonb;
begin
  perform public._cc7_direccion();
  delete from public.cc_horario_excepciones where fecha = p_fecha returning to_jsonb(cc_horario_excepciones.*) into antes;
  if antes is not null then
    insert into public.cc_horario_eventos (accion, detalle, actor_profile_id) values ('excepcion_borrada', jsonb_build_object('fecha', p_fecha, 'antes', antes), auth.uid());
  end if;
  return public.cc_horario_ver();
end;
$$;

-- ── 9c) Dirección: vendedores, cartera y ruteo ───────────────────────────────
create or replace function public.cc_vendedores() returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
begin
  perform public._cc7_direccion();
  return coalesce((select jsonb_agg(jsonb_build_object(
      'id', p.id, 'nombre', coalesce(p.meta ->> 'name', p.full_name, p.email), 'activo', p.active,
      'conversaciones', coalesce(p.meta -> 'capabilities', '[]'::jsonb) ? 'conversaciones',
      'nuevos_clientes', coalesce(p.meta -> 'capabilities', '[]'::jsonb) ? 'nuevos_clientes',
      'elegible', public._cc_vendedor_elegible(p.id, false), 'elegible_nuevos', public._cc_vendedor_elegible(p.id, true),
      'clientes', (select count(*) from public.cc_cartera k where k.seller_profile_id = p.id)) order by coalesce(p.meta ->> 'name', p.full_name, p.email))
    from public.profiles p where p.role_id = 'pos'), '[]'::jsonb);
end;
$$;

create or replace function public.cc_cartera_listar(p_filtro text default 'todos') returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
begin
  perform public._cc7_direccion();
  return coalesce((select jsonb_agg(x order by x ->> 'nombre') from (
    select jsonb_build_object('profile_id', p.id, 'nombre', coalesce(p.full_name, p.meta ->> 'name', p.email), 'verificado', p.verified, 'activo', p.active,
           'vendedor_id', k.seller_profile_id, 'vendedor_nombre', (select coalesce(s.meta ->> 'name', s.full_name, s.email) from public.profiles s where s.id = k.seller_profile_id),
           'vendedor_elegible', k.seller_profile_id is not null and public._cc_vendedor_elegible(k.seller_profile_id, false),
           'requiere_reasignacion', k.seller_profile_id is not null and not public._cc_vendedor_elegible(k.seller_profile_id, false),
           'asignado_at', k.asignado_at,
           'vendedor_historico', (select cu.seller_name from public.customers cu where cu.profile_id = p.id and cu.seller_name is not null limit 1)) as x
      from public.profiles p left join public.cc_cartera k on k.profile_id = p.id
     where p.role_id = 'doctor'
       and (p_filtro = 'todos'
            or (p_filtro = 'sin_vendedor' and k.profile_id is null)
            or (p_filtro = 'reasignacion' and k.profile_id is not null and not public._cc_vendedor_elegible(k.seller_profile_id, false)))
     limit 500) s), '[]'::jsonb);
end;
$$;

create or replace function public.cc_cartera_asignar(p_cliente uuid, p_vendedor uuid, p_motivo text default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_rol text; v_motivo text := nullif(btrim(left(coalesce(p_motivo, ''), 200)), ''); ant record; c record; conv jsonb;
begin
  perform public._cc7_direccion();
  select role_id into v_rol from public.profiles where id = p_cliente;
  if v_rol is distinct from 'doctor' then raise exception 'CLIENTE_INVALIDO: solo doctores tienen cartera' using errcode = 'check_violation'; end if;
  if p_vendedor is not null and not public._cc_vendedor_elegible(p_vendedor, true) then
    raise exception 'VENDEDOR_NO_ELEGIBLE: activo, de ventas, con "Atender conversaciones" y "Recibir clientes nuevos"' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtext('cc_dueno:' || p_cliente::text));
  select * into ant from public.cc_cartera where profile_id = p_cliente for update;
  if ant.seller_profile_id is not distinct from p_vendedor then
    return jsonb_build_object('cliente', p_cliente, 'vendedor', p_vendedor, 'idempotente', true);
  end if;
  if ant.profile_id is not null and v_motivo is null then raise exception 'MOTIVO_REQUERIDO: reasignar o quitar exige motivo' using errcode = 'check_violation'; end if;
  if p_vendedor is null then
    delete from public.cc_cartera where profile_id = p_cliente;
  else
    insert into public.cc_cartera (profile_id, seller_profile_id, asignado_at, asignado_por, motivo) values (p_cliente, p_vendedor, now(), auth.uid(), v_motivo)
    on conflict (profile_id) do update set seller_profile_id = excluded.seller_profile_id, asignado_at = now(), asignado_por = excluded.asignado_por, motivo = excluded.motivo;
  end if;
  insert into public.cc_cartera_historial (profile_id, seller_anterior, seller_nuevo, actor_profile_id, motivo) values (p_cliente, ant.seller_profile_id, p_vendedor, auth.uid(), v_motivo);

  -- Conversación abierta: se rutea al nuevo dueño de cartera SIN interrumpir una sesión humana en curso.
  select * into c from public.cc_conversations where profile_id = p_cliente and estado = 'abierta' for update;
  if found then
    if c.modo = 'human_requested' then
      conv := public._cc_rutear(c.id);
    elsif c.modo = 'human_assigned' and c.seller_profile_id is distinct from p_vendedor then
      if c.seller_profile_id is not null then
        update public.cc_participants set left_at = now() where conversation_id = c.id and profile_id = c.seller_profile_id and rol = 'asesor';
        perform public._cc_evento(c.id, 'seller_unassigned', 'admin', auth.uid(), null, jsonb_build_object('seller', c.seller_profile_id, 'motivo', 'cartera'));
      end if;
      if p_vendedor is not null then
        update public.cc_conversations set seller_profile_id = p_vendedor, ruteo_motivo = null, updated_at = now() where id = c.id;
        perform public._cc_participante(c.id, 'seller', null, p_vendedor, 'asesor');
        perform public._cc_evento(c.id, 'human_assigned', 'admin', auth.uid(), null, jsonb_build_object('seller', p_vendedor, 'origen', 'cartera', 'motivo', 'reasignada'));
      else
        update public.cc_conversations set seller_profile_id = null, ruteo_motivo = 'sin_vendedor', updated_at = now() where id = c.id;
        perform public._cc_cambiar_modo(c.id, 'human_requested', 'human_requested', 'admin', auth.uid(), null, jsonb_build_object('motivo', 'cartera_retirada'));
      end if;
    end if;
    select * into c from public.cc_conversations where id = c.id;
  end if;
  return jsonb_build_object('cliente', p_cliente, 'vendedor', p_vendedor, 'anterior', ant.seller_profile_id, 'idempotente', false,
                            'conversacion', case when c.id is null then null else jsonb_build_object('id', c.id, 'modo', c.modo, 'asignada', c.seller_profile_id is not null) end);
end;
$$;

create or replace function public.cc_ruteo_resumen() returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
begin
  perform public._cc7_direccion();
  return jsonb_build_object(
    'horario', public._cc_horario_estado(now()),
    'sin_vendedor', (select count(*) from public.profiles p where p.role_id = 'doctor' and p.active and not exists (select 1 from public.cc_cartera k where k.profile_id = p.id)),
    'reasignacion', (select count(*) from public.cc_cartera k where not public._cc_vendedor_elegible(k.seller_profile_id, false)),
    'handoffs_sin_asignar', (select count(*) from public.cc_conversations c where c.estado = 'abierta' and c.modo = 'human_requested' and c.seller_profile_id is null),
    'handoffs_pendientes', (select count(*) from public.cc_carts k where k.estado = 'active' and k.handoff_estado = 'pendiente'),
    'vendedores_elegibles', (select count(*) from public.profiles p where p.role_id = 'pos' and public._cc_vendedor_elegible(p.id, false)));
end;
$$;

create or replace function public.cc_ruteo_pendientes() returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
begin
  perform public._cc7_direccion();
  return jsonb_build_object(
    'resumen', public.cc_ruteo_resumen(),
    'conversaciones', coalesce((select jsonb_agg(x order by (x ->> 'solicitado_at') nulls last) from (
      select jsonb_build_object('conversation_id', c.id, 'dueno', case when c.profile_id is not null then 'doctor' else 'visitante' end,
             'profile_id', c.profile_id, 'nombre', case when c.profile_id is not null then (select coalesce(p.full_name, p.meta ->> 'name') from public.profiles p where p.id = c.profile_id) else 'Visitante' end,
             'modo', c.modo, 'seller_id', c.seller_profile_id, 'seller_nombre', (select coalesce(s.meta ->> 'name', s.full_name) from public.profiles s where s.id = c.seller_profile_id),
             'ruteo_motivo', c.ruteo_motivo, 'origen', c.handoff_origen, 'fuera_horario', c.handoff_fuera_horario, 'solicitado_at', c.asesoria_solicitada_at,
             'edad_min', case when c.asesoria_solicitada_at is null then null else (extract(epoch from (now() - c.asesoria_solicitada_at)) / 60)::int end,
             'iniciada', c.modo = 'human_active', 'cart_id', c.handoff_cart_id,
             'n_items', (select count(*) from public.cc_cart_items i where i.cart_id = c.handoff_cart_id)) as x
        from public.cc_conversations c
       where c.estado = 'abierta' and c.modo in ('human_requested', 'human_assigned', 'human_active')
       limit 300) s), '[]'::jsonb),
    'carritos_pendientes', coalesce((select jsonb_agg(jsonb_build_object('cart_id', k.id, 'profile_id', k.profile_id, 'visitante', k.profile_id is null, 'desde', k.handoff_at, 'error', k.handoff_error,
             'n_items', (select count(*) from public.cc_cart_items i where i.cart_id = k.id)))
        from public.cc_carts k where k.estado = 'active' and k.handoff_estado = 'pendiente'), '[]'::jsonb));
end;
$$;

-- ── 9) Redefiniciones sobre el texto vigente (parches mínimos) ─────────────────────────────
CREATE OR REPLACE FUNCTION public._cc_ia_puede(p_modo text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$ select p_modo in ('ai_active', 'human_offered', 'human_requested', 'human_assigned') $function$;

CREATE OR REPLACE FUNCTION public.cc_enviar_mensaje(p_conv uuid, p_actor_type text, p_visitor_hash text, p_profile uuid, p_client_id text, p_content text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_visitor uuid; c record; v_rol text; v_seq bigint; v_id uuid; v_hash text; e record; v_prof uuid; v_modo text;
begin
  if p_content is null or btrim(p_content) = '' then raise exception 'CONTENIDO_VACIO' using errcode = 'check_violation'; end if;
  if length(p_content) > 4000 then raise exception 'CONTENIDO_LARGO' using errcode = 'check_violation'; end if;
  if p_actor_type not in ('visitor', 'doctor', 'seller', 'admin', 'ai', 'system') then raise exception 'ACTOR_INVALIDO' using errcode = 'check_violation'; end if;
  if p_actor_type in ('ai', 'system') then
    if p_profile is not null or p_visitor_hash is not null then raise exception 'ACTOR_INVALIDO' using errcode = 'check_violation'; end if;
    select * into c from public.cc_conversations where id = p_conv for update;
    if not found then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
    if p_actor_type = 'ai' and not public._cc_ia_puede(c.modo) then
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
  -- CC-7 · canal permanente: si la asesoría terminó y el dueño vuelve a escribir, la IA retoma sola.
  v_modo := c.modo;
  if p_actor_type in ('visitor', 'doctor') and c.modo = 'human_ended' then
    perform public._cc_cambiar_modo(p_conv, 'ai_active', 'ai_resumed', p_actor_type, v_prof, v_visitor, jsonb_build_object('auto', true));
    v_modo := 'ai_active';
  end if;
  return jsonb_build_object('id', v_id, 'seq', v_seq, 'idempotente', false, 'modo', v_modo);
end;
$function$;

CREATE OR REPLACE FUNCTION public._cc_cart_mutar(p_cart uuid, p_actor_type text, p_visitor_hash text, p_profile uuid, p_accion text, p_product uuid, p_qty integer, p_op text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a record; c record; v_rol text; prev jsonb; payload jsonb; antes int; despues int; n_antes int; n_despues int; ctx jsonb; aud text; prod record; res jsonb; primera boolean := false; h jsonb; v_err text; v_actor text := p_actor_type;
begin
  if p_actor_type not in ('visitor', 'doctor', 'ai') then raise exception 'NO_AUTORIZADO: solo el dueño modifica su carrito' using errcode = 'insufficient_privilege'; end if;
  -- `ai` actúa en nombre del dueño: con hash = visitante; con perfil = doctor.
  if p_actor_type = 'ai' then v_actor := case when p_visitor_hash is not null then 'visitor' else 'doctor' end; end if;
  a := public._cc_cart_actor(v_actor, p_visitor_hash, p_profile);
  -- CC-7 · orden de locks único para un DUEÑO con cuenta: dueño (advisory) → carrito → conversación.
  if a.profile is not null then perform pg_advisory_xact_lock(hashtext('cc_dueno:' || a.profile::text)); end if;
  v_rol := public._cc_cart_autoridad(p_cart, v_actor, a.visitor, a.profile);
  if v_rol <> 'dueno' then raise exception 'NO_AUTORIZADO: solo el dueño modifica su carrito' using errcode = 'insufficient_privilege'; end if;
  if a.visitor is not null then perform 1 from public.cc_visitors where id = a.visitor for key share; end if;
  select * into c from public.cc_carts where id = p_cart for update;
  if c.estado <> 'active' then raise exception 'CARRITO_CERRADO: %', c.estado using errcode = 'check_violation'; end if;
  payload := jsonb_build_object('accion', p_accion, 'product_id', p_product, 'qty', p_qty);
  prev := public._cc_cart_operacion(p_cart, p_op, payload);
  if prev is not null then return prev; end if;

  if p_accion in ('agregar', 'actualizar') then
    if p_qty is null or p_qty < 0 or p_qty > 999 then raise exception 'CANTIDAD_INVALIDA' using errcode = 'check_violation'; end if;
    if p_accion = 'agregar' and p_qty = 0 then raise exception 'CANTIDAD_INVALIDA' using errcode = 'check_violation'; end if;
  end if;
  select count(*) into n_antes from public.cc_cart_items where cart_id = p_cart;
  select quantity into antes from public.cc_cart_items where cart_id = p_cart and product_id = p_product;

  if p_accion = 'agregar' or (p_accion = 'actualizar' and p_qty > 0) then
    ctx := public.cc_ia_contexto_actor(a.profile); aud := ctx ->> 'audiencia';
    select p.id, p.active, p.sellable, p.name into prod from public.products p where p.id = p_product;
    if prod.id is null or not prod.active or not public._cc_producto_visible(p_product, aud) then raise exception 'PRODUCTO_NO_DISPONIBLE' using errcode = 'check_violation'; end if;
    if not prod.sellable then raise exception 'PRODUCTO_NO_VENDIBLE' using errcode = 'check_violation'; end if;
    despues := case when p_accion = 'agregar' then least(coalesce(antes, 0) + p_qty, 999) else p_qty end;
    insert into public.cc_cart_items (cart_id, product_id, quantity) values (p_cart, p_product, despues)
      on conflict (cart_id, product_id) do update set quantity = excluded.quantity, updated_at = now();
    if antes is null then
      perform public._cc_cart_evento(p_cart, 'item_added', p_actor_type, a.profile, a.visitor, p_product, 0, despues);
      if n_antes = 0 then primera := true; perform public._cc_cart_evento(p_cart, 'first_item_added', p_actor_type, a.profile, a.visitor, p_product, 0, despues); end if;
    elsif antes <> despues then
      perform public._cc_cart_evento(p_cart, 'item_quantity_changed', p_actor_type, a.profile, a.visitor, p_product, antes, despues);
    end if;
  elsif p_accion in ('quitar', 'actualizar') then    -- actualizar con 0 = quitar (documentado)
    delete from public.cc_cart_items where cart_id = p_cart and product_id = p_product;
    if found then perform public._cc_cart_evento(p_cart, 'item_removed', p_actor_type, a.profile, a.visitor, p_product, antes, 0); end if;
    despues := 0;
  elsif p_accion = 'vaciar' then
    delete from public.cc_cart_items where cart_id = p_cart;
    if n_antes > 0 then perform public._cc_cart_evento(p_cart, 'emptied', p_actor_type, a.profile, a.visitor, null, n_antes, 0); end if;
  else
    raise exception 'ACCION_INVALIDA' using errcode = 'check_violation';
  end if;

  select count(*) into n_despues from public.cc_cart_items where cart_id = p_cart;
  update public.cc_carts set rev = rev + 1, updated_at = now(), last_activity_at = now() where id = p_cart;
  -- CC-7 · HANDOFF AUTOMÁTICO: vacío → primer artículo (o reintento de uno pendiente). Un ciclo por carrito.
  -- Corre en un SAVEPOINT: si el ruteo falla, el carrito NO falla; queda 'pendiente' y observable.
  if n_despues > 0 and (primera or c.handoff_estado = 'pendiente') and coalesce(c.handoff_estado, '') not in ('solicitado', 'rechazado') then
    begin
      h := public._cc_handoff_carrito(p_cart);
    exception when others then
      get stacked diagnostics v_err = returned_sqlstate;
      update public.cc_carts set handoff_estado = 'pendiente', handoff_error = v_err where id = p_cart;
      perform public._cc_cart_evento(p_cart, 'handoff_failed', 'system', null, null, null, null, null, jsonb_build_object('sqlstate', v_err));
      h := jsonb_build_object('estado', 'pendiente');
    end;
  end if;
  res := jsonb_build_object('cart_id', p_cart, 'accion', p_accion, 'product_id', p_product, 'qty_antes', coalesce(antes, 0), 'qty_despues', coalesce(despues, 0), 'n_items', n_despues, 'rev', c.rev + 1, 'idempotente', false,
    -- Elegibilidad de oferta de asesor: la decide el SERVIDOR. Primera vez que el carrito deja de estar vacío
    -- y sin oferta previa (o cooldown vencido tras un rechazo).
    'oferta_elegible', primera and (c.oferta_estado is null or (c.oferta_estado = 'rechazada' and c.oferta_siguiente_at <= now())));
  res := res || jsonb_build_object('handoff', h);
  perform public._cc_cart_registrar_op(p_cart, p_op, payload, res);
  return res;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_carrito_proyeccion(p_cart uuid, p_lector uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare c record; ctx jsonb; aud text; it record; items jsonb := '[]'::jsonb; pr jsonb; disp jsonb; total numeric := 0; completo boolean := true; n int := 0; q int := 0; visible boolean; precio jsonb;
begin
  select * into c from public.cc_carts where id = p_cart;
  if not found then return null; end if;
  ctx := public.cc_ia_contexto_actor(p_lector);
  aud := ctx ->> 'audiencia';
  for it in select i.product_id, i.quantity, p.name, p.odoo_reference, p.image_url, p.active, p.sellable, p.show_landing, p.show_portal
              from public.cc_cart_items i join public.products p on p.id = i.product_id where i.cart_id = p_cart order by i.created_at loop
    n := n + 1; q := q + it.quantity;
    visible := it.active and (case when aud = 'public' then it.show_landing else (it.show_portal or it.show_landing) end);
    if (ctx ->> 'puede_precio')::boolean then
      pr := public.cc_ia_precio(p_lector, it.product_id, it.quantity);
      if (pr ->> 'autorizado')::boolean then
        precio := jsonb_build_object('estado', 'autorizado', 'unitario', (pr ->> 'precio_unitario')::numeric, 'subtotal', (pr ->> 'total')::numeric, 'por_volumen', (pr ->> 'por_volumen')::boolean, 'moneda', 'MXN');
        total := total + (pr ->> 'total')::numeric;
      else
        precio := jsonb_build_object('estado', 'sin_precio', 'motivo', pr ->> 'motivo'); completo := false;
      end if;
    else
      precio := jsonb_build_object('estado', 'requiere_verificacion'); completo := false;
    end if;
    if (ctx ->> 'puede_stock')::boolean then
      disp := public.cc_ia_disponibilidad(p_lector, it.product_id);
    else
      disp := jsonb_build_object('estado', 'requiere_verificacion');
    end if;
    items := items || jsonb_build_object('product_id', it.product_id, 'nombre', it.name, 'presentacion', it.odoo_reference, 'imagen_url', it.image_url, 'cantidad', it.quantity,
                                         'vendible', it.active and it.sellable, 'visible', visible,
                                         'disponibilidad', case when not (it.active and it.sellable) then 'no_vendible' else coalesce(disp ->> 'estado', disp ->> 'motivo', 'desconocida') end,
                                         'precio', precio);
  end loop;
  return jsonb_build_object('cart_id', c.id, 'estado', c.estado, 'rev', c.rev, 'dueno', case when c.profile_id is not null then 'profile' else 'visitor' end,
    'audiencia', aud, 'puede_precio', (ctx ->> 'puede_precio')::boolean, 'conversation_id', c.conversation_id,
    'items', items, 'n_items', n, 'cantidad_total', q,
    'total', case when n = 0 then jsonb_build_object('estado', 'vacio') when not (ctx ->> 'puede_precio')::boolean then jsonb_build_object('estado', 'requiere_verificacion')
                  when completo then jsonb_build_object('estado', 'completo', 'monto', round(total, 2), 'moneda', 'MXN') else jsonb_build_object('estado', 'parcial', 'moneda', 'MXN') end,
    'oferta_asesor', jsonb_build_object('estado', c.oferta_estado, 'siguiente_at', c.oferta_siguiente_at),
    'handoff', jsonb_build_object('estado', c.handoff_estado, 'at', c.handoff_at),
    'last_activity_at', c.last_activity_at);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_leer_conversacion(p_conv uuid, p_actor_type text, p_visitor_hash text, p_profile uuid, p_desde_seq bigint DEFAULT 0, p_limite integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
                            'mensajes', v_msgs,
                            -- CC-7 · estado del handoff (sin datos del vendedor más allá del nombre ya expuesto)
                            'handoff', jsonb_build_object('origen', c.handoff_origen, 'cart_id', c.handoff_cart_id, 'fuera_horario', c.handoff_fuera_horario,
                                                          'asignado', c.seller_profile_id is not null and c.modo in ('human_assigned', 'human_active'),
                                                          'puede_rechazar', v_rol = 'dueno' and c.modo in ('human_requested', 'human_assigned') and c.handoff_origen is not null));
end;
$function$;

drop function public.cc_checkout_revisar(uuid, uuid);
CREATE OR REPLACE FUNCTION public.cc_checkout_revisar(p_cart uuid, p_location_id uuid DEFAULT NULL::uuid, p_direccion jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); c record; prep jsonb; lin jsonb; dir jsonb; problemas jsonb; rv uuid; v_exp timestamptz; v_rol text := public.auth_role();
begin
  if v_uid is null then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if v_rol <> 'doctor' then raise exception 'NO_AUTORIZADO: el checkout es del doctor dueño (el personal usa su flujo de pedidos)' using errcode = 'insufficient_privilege'; end if;
  select * into c from public.cc_carts where id = p_cart;
  if not found or c.profile_id is distinct from v_uid then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  perform set_config('app.cc_interno', 'on', true);   -- autoridad de lectura CC-4 para este comando (dueño ya verificado arriba)
  if c.estado = 'converted' then return jsonb_build_object('listo', false, 'problemas', '["YA_CONVERTIDO"]'::jsonb, 'order_id', c.converted_order_id, 'cart_id', c.id); end if;
  if c.estado <> 'active' then return jsonb_build_object('listo', false, 'problemas', '["CARRITO_CERRADO"]'::jsonb, 'cart_id', c.id); end if;
  -- CC-5: proyección + problemas base (cuenta, verificación, vendible, precio, disponibilidad)
  prep := public.cc_carrito_preparar_checkout(p_cart, 'doctor', null, v_uid);
  problemas := prep -> 'problemas';
  lin := public._cc_chk_lineas(p_cart, v_uid);
  -- CC-7 · el Catálogo puede mandar un SNAPSHOT de dirección (como el flujo legado); se valida aquí.
  dir := case when p_location_id is null and p_direccion is not null then public._cc_chk_direccion_snapshot(p_direccion)
              else public._cc_chk_direccion(v_uid, p_location_id) end;
  if dir is null then problemas := problemas || '"REQUIERE_DIRECCION"'::jsonb; end if;
  if (prep ->> 'listo')::boolean and (lin ->> 'ok')::boolean and dir is not null then
    v_exp := now() + interval '15 minutes';   -- D-CC6-01
    insert into public.cc_checkout_reviews (cart_id, profile_id, cart_rev, fingerprint, total, n_items, location_id, direccion, expires_at)
    values (c.id, v_uid, c.rev, lin ->> 'fingerprint', (lin ->> 'total')::numeric, (lin ->> 'n_items')::int, (dir ->> 'location_id')::uuid, dir -> 'address', v_exp) returning id into rv;
    perform public._cc_chk_evento(c.id, rv, v_uid, 'review_created', jsonb_build_object('rev', c.rev, 'n_items', lin ->> 'n_items'));
    return jsonb_build_object('listo', true, 'cart_id', c.id, 'cart_rev', c.rev, 'review_id', rv, 'expires_at', v_exp, 'total', (lin ->> 'total')::numeric, 'moneda', 'MXN',
                              'lineas', lin -> 'lineas', 'direccion', dir, 'proyeccion', prep -> 'proyeccion', 'problemas', '[]'::jsonb);
  end if;
  perform public._cc_chk_evento(c.id, null, v_uid, 'review_not_ready', jsonb_build_object('n', jsonb_array_length(problemas)));
  return jsonb_build_object('listo', false, 'cart_id', c.id, 'cart_rev', c.rev, 'problemas', problemas || coalesce(lin -> 'problemas', '[]'::jsonb), 'proyeccion', prep -> 'proyeccion', 'direccion', dir, 'total', (lin ->> 'total')::numeric, 'moneda', 'MXN');
end;
$function$;

drop function public.cc_checkout_confirmar(uuid, text, integer);
CREATE OR REPLACE FUNCTION public.cc_checkout_confirmar(p_review uuid, p_operation text, p_expected_rev integer DEFAULT NULL::integer, p_factura boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); r public.cc_checkout_reviews%rowtype; c record; op record; lin jsonb; v_order uuid; meta jsonb; res jsonb; w1 jsonb; v_fallo text; v_seller jsonb;
begin
  if v_uid is null then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if p_operation is null or p_operation !~ '^[A-Za-z0-9:_.-]{1,120}$' then raise exception 'OPERACION_INVALIDA' using errcode = 'check_violation'; end if;
  select * into r from public.cc_checkout_reviews where id = p_review for update;
  if not found or r.profile_id <> v_uid then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;   -- un review_id conocido no da acceso
  select * into c from public.cc_carts where id = r.cart_id for update;
  if c.profile_id is distinct from v_uid then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  perform set_config('app.cc_interno', 'on', true);

  -- Libro de operaciones: misma operación → mismo resultado; mismo id con otra revisión → conflicto.
  select * into op from public.cc_checkout_operations where cart_id = c.id and operation_id = p_operation;
  if found then
    if op.review_id <> r.id then raise exception 'IDEMPOTENCIA_CONFLICTO' using errcode = 'unique_violation'; end if;
    return public._cc_chk_resultado(op.order_id, c.id, true);
  end if;
  -- Ya convertido (por otra operación/revisión): devolver el pedido existente, nunca crear otro.
  if c.estado = 'converted' then return public._cc_chk_resultado(c.converted_order_id, c.id, true) || jsonb_build_object('motivo', 'YA_CONVERTIDO'); end if;
  if c.estado <> 'active' then raise exception 'CARRITO_CERRADO: %', c.estado using errcode = 'check_violation'; end if;
  perform public._cc_chk_evento(c.id, r.id, v_uid, 'confirmation_attempted', jsonb_build_object('rev', c.rev));

  if r.consumed_at is not null then
    perform public._cc_chk_evento(c.id, r.id, v_uid, 'confirmation_rejected_consumed');
    return jsonb_build_object('confirmado', false, 'motivo', 'REVISION_CONSUMIDA', 'cart_id', c.id);
  end if;
  if r.expires_at < now() then
    perform public._cc_chk_evento(c.id, r.id, v_uid, 'confirmation_rejected_expired');
    return jsonb_build_object('confirmado', false, 'motivo', 'REVISION_EXPIRADA', 'cart_id', c.id);
  end if;
  if r.cart_rev <> c.rev or (p_expected_rev is not null and p_expected_rev <> c.rev) then   -- D-CC6-03: cualquier cambio del carrito invalida la revisión
    perform public._cc_chk_evento(c.id, r.id, v_uid, 'confirmation_rejected_changed_cart', jsonb_build_object('rev_revisada', r.cart_rev, 'rev_actual', c.rev));
    return jsonb_build_object('confirmado', false, 'motivo', 'CARRITO_CAMBIO', 'cart_id', c.id, 'cart_rev', c.rev, 'proyeccion', public.cc_carrito_proyeccion(c.id, v_uid));
  end if;

  -- Revalidación TOTAL con la autoridad actual (precio, visibilidad, cantidades, disponibilidad).
  lin := public._cc_chk_lineas(c.id, v_uid);
  if not (lin ->> 'ok')::boolean then
    perform public._cc_chk_evento(c.id, r.id, v_uid, case when lin -> 'problemas' @> '[{"problema":"SIN_DISPONIBILIDAD"}]' or (lin -> 'problemas')::text like '%SIN_DISPONIBILIDAD%' then 'confirmation_rejected_stock' else 'confirmation_rejected_product' end, jsonb_build_object('n', jsonb_array_length(lin -> 'problemas')));
    return jsonb_build_object('confirmado', false, 'motivo', 'NO_LISTO', 'problemas', lin -> 'problemas', 'cart_id', c.id, 'proyeccion', public.cc_carrito_proyeccion(c.id, v_uid));
  end if;
  if lin ->> 'fingerprint' <> r.fingerprint then   -- mismo rev ⇒ mismos productos/cantidades ⇒ cambió el precio (D-CC6-02: no se compra en silencio)
    perform public._cc_chk_evento(c.id, r.id, v_uid, 'confirmation_rejected_price_changed', jsonb_build_object('total_revisado', r.total, 'total_actual', (lin ->> 'total')::numeric));
    return jsonb_build_object('confirmado', false, 'motivo', 'PRECIO_CAMBIO', 'cart_id', c.id, 'total_revisado', r.total, 'total_actual', (lin ->> 'total')::numeric, 'lineas', lin -> 'lineas', 'proyeccion', public.cc_carrito_proyeccion(c.id, v_uid));
  end if;

  -- Inyección de fallos SOLO para pruebas (GUC de sesión; un cliente PostgREST no puede fijarlo).
  v_fallo := current_setting('app.cc_checkout_fallar', true);
  if v_fallo = 'antes_w1' then raise exception 'FALLO_INYECTADO: antes_w1'; end if;

  -- W1: el pedido canónico. Precio e items los pone crear_pedido (precio_de con la lista del doctor); folio del servidor.
  v_order := gen_random_uuid();
  -- Folio: lo genera crear_pedido (servidor, formato legacy S<n>, único). El origen va en metadata, no en el folio.
  -- Vendedor (metadata server-derived; NO es comisión ni autoridad económica): CC-7 · la cartera canónica (cc_cartera) o ninguno.
  v_seller := public._cc_chk_seller(v_uid);
  meta := jsonb_build_object('placed_by', 'Checkout canónico (CC-6)', 'source', 'cc_checkout', 'address', r.direccion, 'location_id', r.location_id, 'cart_id', c.id, 'checkout_review_id', r.id)
          || coalesce(v_seller, '{}'::jsonb);
  w1 := public.crear_pedido(v_order, null, v_uid, (select jsonb_agg(jsonb_build_object('product_id', l ->> 'product_id', 'qty', (l ->> 'qty')::int)) from jsonb_array_elements(lin -> 'lineas') l), meta, coalesce(p_factura, false), null);
  if coalesce((w1 ->> 'order_id')::uuid, v_order) <> v_order then raise exception 'W1_INCONSISTENTE'; end if;
  if v_fallo = 'despues_w1' then raise exception 'FALLO_INYECTADO: despues_w1'; end if;   -- prueba: nada queda a medias
  perform public._cc_chk_evento(c.id, r.id, v_uid, 'order_created', jsonb_build_object('order_id', v_order, 'total', (w1 ->> 'total')::numeric));

  update public.cc_carts set estado = 'converted', converted_order_id = v_order, closed_at = now(), rev = rev + 1, updated_at = now(), last_activity_at = now() where id = c.id;
  perform public._cc_cart_evento(c.id, 'converted', 'doctor', v_uid, null, null, null, null, jsonb_build_object('order_id', v_order));
  update public.cc_checkout_reviews set consumed_at = now(), order_id = v_order where id = r.id;
  perform public._cc_chk_evento(c.id, r.id, v_uid, 'cart_converted', jsonb_build_object('order_id', v_order));
  if v_fallo = 'antes_operacion' then raise exception 'FALLO_INYECTADO: antes_operacion'; end if;
  res := public._cc_chk_resultado(v_order, c.id, false);
  insert into public.cc_checkout_operations (cart_id, operation_id, profile_id, review_id, order_id, resultado) values (c.id, p_operation, v_uid, r.id, v_order, res);
  return res;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_visitante_adoptar(p_hash text, p_profile uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  prof record; v public.cc_visitors%rowtype; n int := 0; r record; convs int := 0; carts int := 0;
begin
  if p_profile is null then raise exception 'CC1_ARGUMENTOS: perfil requerido' using errcode = 'invalid_parameter_value'; end if;
  select id, active, role_id into prof from public.profiles where id = p_profile;
  if not found then raise exception 'PERFIL_INEXISTENTE'; end if;
  if not prof.active then raise exception 'CUENTA_SUSPENDIDA'; end if;
  perform pg_advisory_xact_lock(hashtext('cc_dueno:' || p_profile::text));   -- CC-7 · mismo orden que el carrito del dueño

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
    carts := public._cc_adoptar_carritos(v.id, p_profile);         -- CC-5
    perform public._cc_handoff_tras_adopcion(p_profile);   -- CC-7
    return jsonb_build_object('estado', 'adoptado', 'visitor_id', v.id, 'adoptados', 1, 'conversaciones', convs, 'carritos', carts);
  end if;

  for r in select id from public.cc_visitors where pending_profile_id = p_profile and estado = 'activo' order by created_at for update loop
    update public.cc_visitors
       set estado = 'adoptado', adopted_profile_id = p_profile, adopted_at = now(), last_seen_at = now(),
           token_hash = encode(extensions.digest(id::text || clock_timestamp()::text || random()::text, 'sha256'), 'hex')
     where id = r.id;
    insert into public.cc_visitor_events (visitor_id, tipo, actor_profile_id) values (r.id, 'adoptado', p_profile);
    insert into public.cc_visitor_events (visitor_id, tipo, detalle) values (r.id, 'revocado', '{"motivo":"adopcion"}');
    convs := convs + public._cc_adoptar_conversaciones(r.id, p_profile);   -- CC-2
    carts := carts + public._cc_adoptar_carritos(r.id, p_profile);         -- CC-5
    n := n + 1;
  end loop;
  if n > 0 then perform public._cc_handoff_tras_adopcion(p_profile); end if;   -- CC-7
  return jsonb_build_object('estado', case when n > 0 then 'adoptado' else 'nada' end, 'adoptados', n, 'conversaciones', convs, 'carritos', carts);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_asignar_asesor(p_conv uuid, p_actor_profile uuid, p_seller uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;


-- ── 10) Privilegios ──────────────────────────────────────────────────────────
-- Helpers internos: nadie los ejecuta desde fuera (Supabase da EXECUTE por defecto a anon/authenticated).
revoke all on function public._cc7_direccion(), public._cc_vendedor_elegible(uuid, boolean), public._cc_vendedor_de(uuid), public._cc_horario_estado(timestamptz),
  public._cc_conversacion_de(uuid, uuid), public._cc_rutear(uuid), public._cc_texto_handoff(boolean, boolean), public._cc_handoff_carrito(uuid), public._cc_handoff_seguro(uuid),
  public._cc_handoff_tras_adopcion(uuid), public._cc_chk_direccion_snapshot(jsonb), public._cc_chk_seller(uuid)
  from public, anon, authenticated;
-- Comandos de la Edge (service_role).
revoke all on function public.cc_abrir_conversacion(text, uuid), public.cc_solicitar_asesor(uuid, text, text, uuid), public.cc_handoff_rechazar(uuid, text, text, uuid),
  public.cc_ia_estado_handoff(uuid), public.cc_asignar_asesor(uuid, uuid, uuid), public.cc_enviar_mensaje(uuid, text, text, uuid, text, text),
  public.cc_leer_conversacion(uuid, text, text, uuid, bigint, int), public._cc_cart_mutar(uuid, text, text, uuid, text, uuid, integer, text),
  public.cc_carrito_proyeccion(uuid, uuid), public.cc_visitante_adoptar(text, uuid), public._cc_ia_puede(text)
  from public, anon, authenticated;
grant execute on function public.cc_abrir_conversacion(text, uuid), public.cc_solicitar_asesor(uuid, text, text, uuid), public.cc_handoff_rechazar(uuid, text, text, uuid),
  public.cc_ia_estado_handoff(uuid), public.cc_asignar_asesor(uuid, uuid, uuid), public.cc_enviar_mensaje(uuid, text, text, uuid, text, text),
  public.cc_leer_conversacion(uuid, text, text, uuid, bigint, int), public.cc_visitante_adoptar(text, uuid),
  public._cc_cart_mutar(uuid, text, text, uuid, text, uuid, integer, text), public.cc_carrito_proyeccion(uuid, uuid), public._cc_ia_puede(text)
  to service_role;
-- Lecturas/comandos con sesión (cada uno valida rol adentro).
revoke all on function public.cc_cola_asesorias(), public.cc_horario_ver(), public.cc_horario_guardar(text, jsonb), public.cc_horario_excepcion_guardar(date, text, text, text, text),
  public.cc_horario_excepcion_borrar(date), public.cc_vendedores(), public.cc_cartera_listar(text), public.cc_cartera_asignar(uuid, uuid, text), public.cc_ruteo_resumen(),
  public.cc_ruteo_pendientes(), public.cc_checkout_revisar(uuid, uuid, jsonb), public.cc_checkout_confirmar(uuid, text, integer, boolean)
  from public, anon;
grant execute on function public.cc_cola_asesorias(), public.cc_horario_ver(), public.cc_horario_guardar(text, jsonb), public.cc_horario_excepcion_guardar(date, text, text, text, text),
  public.cc_horario_excepcion_borrar(date), public.cc_vendedores(), public.cc_cartera_listar(text), public.cc_cartera_asignar(uuid, uuid, text), public.cc_ruteo_resumen(),
  public.cc_ruteo_pendientes(), public.cc_checkout_revisar(uuid, uuid, jsonb), public.cc_checkout_confirmar(uuid, text, integer, boolean)
  to authenticated, service_role;

-- ── 11) Verificación final ───────────────────────────────────────────────────
do $post$
declare n int;
begin
  select count(*) into n from pg_proc p join pg_namespace s on s.oid = p.pronamespace
   where s.nspname = 'public' and (p.proname like 'cc\_%' or p.proname like '\_cc%') and has_function_privilege('anon', p.oid, 'EXECUTE')
     and p.proname not in ('cc_audiencia_actual', 'cc_buscar_conocimiento', 'cc_buscar_productos', 'cc_candidatos_recomendacion', 'cc_catalogo_para_ia',
                           'cc_comparar_productos', 'cc_ficha_producto', 'cc_revisar_claims');
  if n <> 0 then raise exception 'CC7: % funciones cc ejecutables por anon', n; end if;
  if has_function_privilege('authenticated', 'public._cc_handoff_carrito(uuid)', 'EXECUTE') or has_function_privilege('authenticated', 'public.cc_handoff_rechazar(uuid,text,text,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.cc_enviar_mensaje(uuid,text,text,uuid,text,text)', 'EXECUTE') then
    raise exception 'CC7: comandos internos ejecutables por clientes';
  end if;
  select count(*) into n from pg_class c join pg_namespace s on s.oid = c.relnamespace
   where s.nspname = 'public' and c.relkind = 'r' and c.relname like 'cc\_%' and not c.relrowsecurity;
  if n <> 0 then raise exception 'CC7: % tablas cc sin RLS', n; end if;
  select count(*) into n from information_schema.role_table_grants where table_schema = 'public' and grantee in ('anon', 'authenticated')
     and table_name in ('cc_horario_config', 'cc_horario_semanal', 'cc_horario_excepciones', 'cc_horario_eventos', 'cc_cartera', 'cc_cartera_historial');
  if n <> 0 then raise exception 'CC7: % privilegios indebidos sobre tablas nuevas', n; end if;
  if not public._cc_ia_puede('human_assigned') or public._cc_ia_puede('human_active') then raise exception 'CC7: regla de IA incorrecta'; end if;
  if (public._cc_horario_estado(now()) ->> 'configurado')::boolean then raise exception 'CC7: el horario no debe venir configurado'; end if;
  if pg_get_functiondef('public._cc_cart_mutar(uuid,text,text,uuid,text,uuid,integer,text)'::regprocedure) not like '%_cc_handoff_carrito%' then raise exception 'CC7: el carrito no dispara el handoff'; end if;
end $post$;
