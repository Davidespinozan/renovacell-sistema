-- ============================================================================
-- CC-4 · ORQUESTADOR COMERCIAL DE IA — lo que la base sostiene por construcción.
--
-- El modelo de lenguaje interpreta, selecciona, ordena y explica. NUNCA es fuente de verdad ni
-- autoridad. Aquí viven las tres cosas que el modelo no puede decidir:
--
--   1) EL TURNO (cc_ai_turns): un turno de IA por mensaje disparador (conv, seq). Reclamarlo es
--      atómico (lock de la conversación), con arrendamiento: dos workers no procesan el mismo
--      disparador; un reintento tras timeout del proveedor re-reclama el mismo turno y persiste
--      el MISMO mensaje (client_id 'ai:<seq>' de CC-2). Orden por conversación = "el disparador
--      más nuevo gana": si ya se reclamó un turno más nuevo, el más viejo se descarta ('superado')
--      al reclamar o al intentar persistir; así nunca se persiste una respuesta fuera de orden y el
--      último mensaje del usuario siempre recibe la suya (la ejecución es inline, sin cola).
--   2) LA PERSISTENCIA (cc_ia_turno_responder): bajo el mismo lock, se re-verifica estado abierta
--      y modo con IA permitida (IA_PUEDE) ANTES de escribir. Si un humano tomó la conversación
--      mientras el proveedor respondía, la respuesta se DESCARTA y el turno queda 'discarded'
--      (sin guardar el texto). El mensaje entra solo por cc_enviar_mensaje(actor=ai).
--   3) LAS HERRAMIENTAS MATERIALES (cc_ia_contexto_actor / precio / disponibilidad / pedido):
--      la autoridad se deriva del PERFIL que resolvió el servidor, nunca de lo que diga el
--      modelo o el cliente. Precio = precio_de() con la lista del doctor. Disponibilidad =
--      v_stock_disponible agregada (sin lotes). Pedido = solo los del dueño.
--
-- Nunca se guarda prompt, transcript ni chain-of-thought: solo identificadores, estados,
-- clasificaciones y métricas. Rollback: supabase/rollback/cc4/99_down.sql.
-- ============================================================================

do $pre$
begin
  if to_regclass('public.cc_conversations') is null or to_regprocedure('public.cc_enviar_mensaje(uuid,text,text,uuid,text,text)') is null then raise exception 'CC4: falta CC-2'; end if;
  if to_regprocedure('public.cc_ficha_producto(uuid,text)') is null then raise exception 'CC4: falta CC-3'; end if;
  if to_regprocedure('public.precio_de(uuid,uuid,int)') is null then raise exception 'CC4: falta precio_de'; end if;
  if to_regclass('public.v_stock_disponible') is null then raise exception 'CC4: falta v_stock_disponible'; end if;
  if to_regclass('public.cc_ai_turns') is not null then raise exception 'CC4: ya aplicada'; end if;
end $pre$;

-- ---------------------------------------------------------------------------
-- 1) LIBRO DE TURNOS Y TRAZA DE HERRAMIENTAS
-- ---------------------------------------------------------------------------
create table public.cc_ai_turns (
  id                 uuid primary key default gen_random_uuid(),
  conversation_id    uuid not null references public.cc_conversations(id) on delete restrict,
  trigger_message_id uuid references public.cc_messages(id) on delete restrict,
  trigger_seq        bigint not null,
  operation_id       text not null,
  status             text not null default 'provider_running',
  provider           text not null,
  model              text not null,
  attempts           int  not null default 1,
  lease_until        timestamptz,
  intent             text,
  tool_rounds        int  not null default 0,
  evidencia          text[] not null default '{}',
  result_message_id  uuid references public.cc_messages(id) on delete set null,
  input_tokens       int,
  output_tokens      int,
  error_class        text,
  created_at         timestamptz not null default now(),
  started_at         timestamptz not null default now(),
  finished_at        timestamptz,
  constraint ck_cat_status check (status in ('provider_running', 'completed', 'failed', 'discarded', 'unknown')),
  constraint ck_cat_op check (operation_id ~ '^ai:[0-9]+$'),
  constraint ck_cat_fin check ((status = 'provider_running') = (finished_at is null)),
  constraint uq_cat_trigger unique (conversation_id, trigger_seq)
);
create index idx_cat_conv on public.cc_ai_turns (conversation_id, trigger_seq);
comment on table public.cc_ai_turns is 'CC-4 · Un turno de IA por mensaje disparador. Sin prompt, sin transcript: estado, proveedor, modelo, evidencia, métricas.';

create table public.cc_ai_tool_calls (
  id          uuid primary key default gen_random_uuid(),
  turn_id     uuid not null references public.cc_ai_turns(id) on delete cascade,
  round       int  not null,
  tool_name   text not null,
  status      text not null,
  product_ids uuid[] not null default '{}',
  detalle     jsonb,
  started_at  timestamptz not null default now(),
  finished_at timestamptz not null default now(),
  constraint ck_catc_status check (status in ('ok', 'rechazada', 'no_autorizada', 'error', 'vacia')),
  constraint ck_catc_detalle check (detalle is null or length(detalle::text) <= 2000)
);
create index idx_catc_turn on public.cc_ai_tool_calls (turn_id, round);

alter table public.cc_ai_turns enable row level security;
alter table public.cc_ai_tool_calls enable row level security;
revoke all on public.cc_ai_turns, public.cc_ai_tool_calls from public, anon, authenticated;
grant select on public.cc_ai_turns, public.cc_ai_tool_calls to authenticated;
create policy cat_select_admin  on public.cc_ai_turns      for select to authenticated using (public.auth_role() = 'admin');
create policy catc_select_admin on public.cc_ai_tool_calls for select to authenticated using (public.auth_role() = 'admin');

-- ---------------------------------------------------------------------------
-- 2) EL TURNO
-- ---------------------------------------------------------------------------
create or replace function public._cc_ia_puede(p_modo text) returns boolean
  language sql immutable as $$ select p_modo in ('ai_active', 'human_offered', 'human_requested') $$;

create or replace function public._cc_solo_servicio() returns void
  language plpgsql stable set search_path = public as
$$ begin if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role' then raise exception 'NO_AUTORIZADO: solo el servidor orquesta la IA' using errcode = 'insufficient_privilege'; end if; end $$;

-- Reclamar el turno del disparador (conv, seq). Devuelve:
--   reclamado      → este worker procesa (turn_id, operation_id, attempts)
--   ya_completado  → ya hay respuesta persistida (result_message_id); no llamar al proveedor
--   en_curso       → otro worker lo tiene y su arrendamiento sigue vivo
--   superado       → ya existe un turno MÁS NUEVO en curso/completado (queda 'discarded', sin texto)
--   silenciado     → conversación cerrada o modo sin IA (queda 'discarded', sin texto)
create or replace function public.cc_ia_turno_reclamar(p_conv uuid, p_trigger_seq bigint, p_provider text, p_model text, p_lease_segs int default 90) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare c record; t public.cc_ai_turns%rowtype; v_msg uuid; v_lease interval := make_interval(secs => least(greatest(coalesce(p_lease_segs, 90), 10), 600)); v_prev record;
begin
  perform public._cc_solo_servicio();
  select * into c from public.cc_conversations where id = p_conv for update;
  if not found then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  select id into v_msg from public.cc_messages where conversation_id = p_conv and seq = p_trigger_seq;
  if v_msg is null then raise exception 'DISPARADOR_INEXISTENTE' using errcode = 'check_violation'; end if;

  select * into t from public.cc_ai_turns where conversation_id = p_conv and trigger_seq = p_trigger_seq for update;
  if found then
    if t.status in ('completed', 'discarded') then
      return jsonb_build_object('estado', case when t.status = 'completed' then 'ya_completado' else 'silenciado' end, 'turn_id', t.id, 'operation_id', t.operation_id, 'result_message_id', t.result_message_id);
    end if;
    if t.status = 'provider_running' and t.lease_until > now() then
      return jsonb_build_object('estado', 'en_curso', 'turn_id', t.id, 'operation_id', t.operation_id, 'lease_until', t.lease_until);
    end if;
    -- failed / unknown / arrendamiento vencido → se re-reclama (mismo operation_id → mismo mensaje)
  end if;

  if c.estado <> 'abierta' or not public._cc_ia_puede(c.modo) then
    if t.id is null then
      insert into public.cc_ai_turns (conversation_id, trigger_message_id, trigger_seq, operation_id, status, provider, model, error_class, finished_at)
      values (p_conv, v_msg, p_trigger_seq, 'ai:' || p_trigger_seq, 'discarded', p_provider, p_model, case when c.estado <> 'abierta' then 'conversacion_cerrada' else 'ia_silenciada' end, now()) returning * into t;
    else
      update public.cc_ai_turns set status = 'discarded', error_class = case when c.estado <> 'abierta' then 'conversacion_cerrada' else 'ia_silenciada' end, finished_at = now(), lease_until = null where id = t.id returning * into t;
    end if;
    return jsonb_build_object('estado', 'silenciado', 'turn_id', t.id, 'operation_id', t.operation_id, 'modo', c.modo);
  end if;

  -- Orden por conversación: si ya hay un turno MÁS NUEVO reclamado o completado, este queda superado.
  select id, trigger_seq into v_prev from public.cc_ai_turns where conversation_id = p_conv and trigger_seq > p_trigger_seq and status in ('provider_running', 'completed') order by trigger_seq desc limit 1;
  if v_prev.id is not null then
    if t.id is null then
      insert into public.cc_ai_turns (conversation_id, trigger_message_id, trigger_seq, operation_id, status, provider, model, error_class, finished_at)
      values (p_conv, v_msg, p_trigger_seq, 'ai:' || p_trigger_seq, 'discarded', p_provider, p_model, 'superado', now()) returning * into t;
    else
      update public.cc_ai_turns set status = 'discarded', error_class = 'superado', finished_at = now(), lease_until = null where id = t.id returning * into t;
    end if;
    return jsonb_build_object('estado', 'superado', 'turn_id', t.id, 'operation_id', t.operation_id, 'superado_por_seq', v_prev.trigger_seq);
  end if;

  if t.id is null then
    insert into public.cc_ai_turns (conversation_id, trigger_message_id, trigger_seq, operation_id, status, provider, model, lease_until)
    values (p_conv, v_msg, p_trigger_seq, 'ai:' || p_trigger_seq, 'provider_running', p_provider, p_model, now() + v_lease) returning * into t;
  else
    update public.cc_ai_turns set status = 'provider_running', attempts = attempts + 1, lease_until = now() + v_lease, started_at = now(), finished_at = null, error_class = null, provider = p_provider, model = p_model
     where id = t.id returning * into t;
  end if;
  return jsonb_build_object('estado', 'reclamado', 'turn_id', t.id, 'operation_id', t.operation_id, 'attempts', t.attempts, 'modo', c.modo);
end;
$$;

-- Traza mínima de una herramienta: nombre, ronda, estado, ids de producto y detalle acotado.
create or replace function public.cc_ia_herramienta_registrar(p_turn uuid, p_round int, p_tool text, p_status text, p_product_ids uuid[] default '{}', p_detalle jsonb default null) returns uuid
  language plpgsql security definer set search_path = public as
$$
declare v_id uuid;
begin
  perform public._cc_solo_servicio();
  insert into public.cc_ai_tool_calls (turn_id, round, tool_name, status, product_ids, detalle)
  values (p_turn, coalesce(p_round, 0), left(p_tool, 60), p_status, coalesce(p_product_ids, '{}'), p_detalle) returning id into v_id;
  update public.cc_ai_turns set tool_rounds = greatest(tool_rounds, coalesce(p_round, 0) + 1) where id = p_turn;
  return v_id;
end;
$$;

-- Persistir la respuesta final. Re-verifica bajo lock: estado abierta + IA permitida. Si no, DESCARTA.
create or replace function public.cc_ia_turno_responder(p_turn uuid, p_content text, p_intent text default null, p_evidencia text[] default '{}', p_tool_rounds int default null, p_input_tokens int default null, p_output_tokens int default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare t public.cc_ai_turns%rowtype; c record; r jsonb; v_motivo text;
begin
  perform public._cc_solo_servicio();
  select * into t from public.cc_ai_turns where id = p_turn for update;
  if not found then raise exception 'TURNO_INEXISTENTE' using errcode = 'check_violation'; end if;
  if t.status = 'completed' then return jsonb_build_object('persistido', true, 'idempotente', true, 'message_id', t.result_message_id); end if;
  if t.status = 'discarded' then return jsonb_build_object('persistido', false, 'motivo', t.error_class, 'idempotente', true); end if;
  select * into c from public.cc_conversations where id = t.conversation_id for update;
  v_motivo := case when c.estado <> 'abierta' then 'conversacion_cerrada'
                   when not public._cc_ia_puede(c.modo) then 'takeover_humano'
                   when exists (select 1 from public.cc_ai_turns n where n.conversation_id = t.conversation_id and n.trigger_seq > t.trigger_seq and n.status in ('provider_running', 'completed')) then 'superado'
                   end;
  if v_motivo is not null then
    update public.cc_ai_turns set status = 'discarded', error_class = v_motivo, finished_at = now(), lease_until = null,
           intent = coalesce(p_intent, intent), evidencia = coalesce(p_evidencia, evidencia), tool_rounds = coalesce(p_tool_rounds, tool_rounds), input_tokens = p_input_tokens, output_tokens = p_output_tokens
     where id = p_turn;
    return jsonb_build_object('persistido', false, 'motivo', v_motivo, 'modo', c.modo);
  end if;
  r := public.cc_enviar_mensaje(t.conversation_id, 'ai', null, null, t.operation_id, left(p_content, 4000));
  update public.cc_ai_turns set status = 'completed', result_message_id = (r ->> 'id')::uuid, finished_at = now(), lease_until = null,
         intent = coalesce(p_intent, intent), evidencia = coalesce(p_evidencia, evidencia), tool_rounds = coalesce(p_tool_rounds, tool_rounds), input_tokens = p_input_tokens, output_tokens = p_output_tokens
   where id = p_turn;
  return jsonb_build_object('persistido', true, 'idempotente', (r ->> 'idempotente')::boolean, 'message_id', r ->> 'id', 'seq', (r ->> 'seq')::bigint);
end;
$$;

-- Marcar fallo (re-reclamable) o estado desconocido (el proveedor pudo haber respondido; también re-reclamable: el mensaje es idempotente).
create or replace function public.cc_ia_turno_fallar(p_turn uuid, p_error_class text, p_desconocido boolean default false, p_intent text default null, p_tool_rounds int default null, p_input_tokens int default null, p_output_tokens int default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare t public.cc_ai_turns%rowtype;
begin
  perform public._cc_solo_servicio();
  select * into t from public.cc_ai_turns where id = p_turn for update;
  if not found then raise exception 'TURNO_INEXISTENTE' using errcode = 'check_violation'; end if;
  if t.status in ('completed', 'discarded') then return jsonb_build_object('estado', t.status, 'idempotente', true); end if;
  update public.cc_ai_turns set status = case when p_desconocido then 'unknown' else 'failed' end, error_class = left(coalesce(p_error_class, 'error'), 60), finished_at = now(), lease_until = null,
         intent = coalesce(p_intent, intent), tool_rounds = coalesce(p_tool_rounds, tool_rounds), input_tokens = coalesce(p_input_tokens, input_tokens), output_tokens = coalesce(p_output_tokens, output_tokens)
   where id = p_turn;
  return jsonb_build_object('estado', case when p_desconocido then 'unknown' else 'failed' end);
end;
$$;

-- Aviso controlado de no disponibilidad: UNA vez por conversación (client_id fijo), nunca repetido por reintentos.
create or replace function public.cc_ia_aviso_no_disponible(p_conv uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
begin
  perform public._cc_solo_servicio();
  return public.cc_enviar_mensaje(p_conv, 'system', null, null, 'sys:ia_no_disponible', 'No pude consultar al asistente en este momento. Si quieres, puedo pedirte un asesor de Renovacell.');
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) HERRAMIENTAS MATERIALES (autoridad derivada del perfil resuelto por el servidor)
-- ---------------------------------------------------------------------------
-- Contexto del actor: la ÚNICA fuente de audiencia y permisos para el orquestador.
create or replace function public.cc_ia_contexto_actor(p_profile uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare p record;
begin
  perform public._cc_solo_servicio();
  if p_profile is null then
    return jsonb_build_object('actor', 'visitor', 'audiencia', 'public', 'puede_precio', false, 'puede_stock', false, 'puede_pedidos', false, 'verificado', false, 'rol', '');
  end if;
  select role_id, active, verified, price_list_id into p from public.profiles where id = p_profile;
  if not found or not coalesce(p.active, false) then
    return jsonb_build_object('actor', 'suspendido', 'audiencia', 'public', 'puede_precio', false, 'puede_stock', false, 'puede_pedidos', false, 'verificado', false, 'rol', coalesce(p.role_id, ''));
  end if;
  return jsonb_build_object(
    'actor', case when p.role_id = 'doctor' then 'doctor' when p.role_id = 'admin' then 'admin' else 'staff' end,
    'audiencia', case when p.role_id = 'admin' then 'staff' when p.role_id = 'doctor' then case when p.verified then 'verified' else 'public' end else 'verified' end,
    'puede_precio', coalesce(p.role_id, '') <> '' and (p.role_id <> 'doctor' or coalesce(p.verified, false)),   -- = puede_ver_precio() para ese perfil
    'puede_stock',  coalesce(p.role_id, '') <> '' and (p.role_id <> 'doctor' or coalesce(p.verified, false)),
    'puede_pedidos', p.role_id = 'doctor',
    'verificado', coalesce(p.verified, false), 'rol', coalesce(p.role_id, ''));
end;
$$;

create or replace function public._cc_ia_producto_vendible(p_product uuid, p_aud text) returns record
  language sql stable set search_path = public as
$$ select p.id, p.name, p.sellable from public.products p where p.id = p_product and p.active and (case when p_aud = 'public' then p.show_landing else (p.show_portal or p.show_landing) end) $$;

-- PRECIO: solo con autoridad (puede_precio); lista del perfil; precio_de con cantidad; escalas por volumen.
create or replace function public.cc_ia_precio(p_profile uuid, p_product uuid, p_qty int default 1) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare ctx jsonb; v_list uuid; v_qty int := least(greatest(coalesce(p_qty, 1), 1), 999); v_unit numeric; v_base numeric; prod record;
begin
  ctx := public.cc_ia_contexto_actor(p_profile);
  if not (ctx ->> 'puede_precio')::boolean then
    return jsonb_build_object('autorizado', false, 'motivo', 'PRICE_REQUIRES_VERIFICATION');
  end if;
  select p.id, p.name, p.sellable into prod from public.products p where p.id = p_product and p.active and (p.show_portal or p.show_landing);
  if prod.id is null then return jsonb_build_object('autorizado', false, 'motivo', 'PRODUCTO_NO_DISPONIBLE'); end if;
  if not prod.sellable then return jsonb_build_object('autorizado', false, 'motivo', 'PRODUCTO_NO_VENDIBLE', 'nombre', prod.name); end if;
  select price_list_id into v_list from public.profiles where id = p_profile;
  v_unit := public.precio_de(p_product, v_list, v_qty);
  v_base := public.precio_de(p_product, v_list, 1);
  if v_unit is null then return jsonb_build_object('autorizado', false, 'motivo', 'SIN_PRECIO', 'nombre', prod.name); end if;
  return jsonb_build_object('autorizado', true, 'product_id', prod.id, 'nombre', prod.name, 'cantidad', v_qty, 'precio_unitario', v_unit, 'total', round(v_unit * v_qty, 2), 'moneda', 'MXN',
    'por_volumen', v_unit < v_base,
    'lista', (select l.name from public.price_lists l where l.id = v_list),
    'escalas', (select coalesce(jsonb_agg(jsonb_build_object('desde', pv.min_quantity, 'precio', pv.price) order by pv.min_quantity), '[]'::jsonb) from public.product_volume_prices pv where pv.product_id = p_product and pv.active));
end;
$$;

-- DISPONIBILIDAD: agregada y comercial (sin lotes). Solo con autoridad (misma frontera que precio/stock).
create or replace function public.cc_ia_disponibilidad(p_profile uuid, p_product uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare ctx jsonb; prod record; v_disp int;
begin
  ctx := public.cc_ia_contexto_actor(p_profile);
  if not (ctx ->> 'puede_stock')::boolean then return jsonb_build_object('autorizado', false, 'motivo', 'AVAILABILITY_REQUIRES_VERIFICATION'); end if;
  select p.id, p.name, p.sellable into prod from public.products p where p.id = p_product and p.active and (p.show_portal or p.show_landing);
  if prod.id is null then return jsonb_build_object('autorizado', false, 'motivo', 'PRODUCTO_NO_DISPONIBLE'); end if;
  select coalesce(sum(s.disponible), 0)::int into v_disp from public.v_stock_disponible s where s.product_id = p_product and not s.caducado;
  return jsonb_build_object('autorizado', true, 'product_id', prod.id, 'nombre', prod.name, 'estado', case when not prod.sellable then 'no_vendible' when v_disp > 0 then 'disponible' else 'no_disponible' end);
end;
$$;

-- ESTADO DE PEDIDO: solo los pedidos del PERFIL (doctor dueño). Sin datos de otros, sin internals financieros.
create or replace function public.cc_ia_estado_pedido(p_profile uuid, p_folio text default null) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare ctx jsonb;
begin
  ctx := public.cc_ia_contexto_actor(p_profile);
  if not (ctx ->> 'puede_pedidos')::boolean then return jsonb_build_object('autorizado', false, 'motivo', 'ORDERS_REQUIRE_LOGIN'); end if;
  return jsonb_build_object('autorizado', true, 'pedidos', (
    select coalesce(jsonb_agg(jsonb_build_object('folio', o.external_ref, 'estado', o.status, 'pago', o.payment_status, 'total', o.total, 'moneda', coalesce(o.currency, 'MXN'), 'fecha', o.created_at,
                     'articulos', (select count(*) from public.order_items i where i.order_id = o.id),
                     'envio', (select jsonb_build_object('paqueteria', s.carrier, 'guia', s.tracking_number, 'estado', s.status, 'entrega_estimada', s.estimated_delivery_at) from public.shipments s where s.order_id = o.id order by s.created_at desc limit 1))
                     order by o.created_at desc), '[]'::jsonb)
      from (select * from public.orders o where o.doctor_id = p_profile and (p_folio is null or lower(o.external_ref) = lower(btrim(p_folio))) order by o.created_at desc limit 5) o));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) PRIVILEGIOS: todo solo service_role (el orquestador corre en el servidor).
-- ---------------------------------------------------------------------------
revoke all on function public.cc_ia_turno_reclamar(uuid, bigint, text, text, int), public.cc_ia_herramienta_registrar(uuid, int, text, text, uuid[], jsonb),
  public.cc_ia_turno_responder(uuid, text, text, text[], int, int, int), public.cc_ia_turno_fallar(uuid, text, boolean, text, int, int, int), public.cc_ia_aviso_no_disponible(uuid),
  public.cc_ia_contexto_actor(uuid), public.cc_ia_precio(uuid, uuid, int), public.cc_ia_disponibilidad(uuid, uuid), public.cc_ia_estado_pedido(uuid, text),
  public._cc_ia_puede(text), public._cc_solo_servicio(), public._cc_ia_producto_vendible(uuid, text) from public, anon, authenticated;
grant execute on function public.cc_ia_turno_reclamar(uuid, bigint, text, text, int), public.cc_ia_herramienta_registrar(uuid, int, text, text, uuid[], jsonb),
  public.cc_ia_turno_responder(uuid, text, text, text[], int, int, int), public.cc_ia_turno_fallar(uuid, text, boolean, text, int, int, int), public.cc_ia_aviso_no_disponible(uuid),
  public.cc_ia_contexto_actor(uuid), public.cc_ia_precio(uuid, uuid, int), public.cc_ia_disponibilidad(uuid, uuid), public.cc_ia_estado_pedido(uuid, text) to service_role;

do $post$
begin
  if has_function_privilege('authenticated', 'public.cc_ia_precio(uuid,uuid,int)', 'EXECUTE') or has_function_privilege('anon', 'public.cc_ia_turno_responder(uuid,text,text,text[],int,int,int)', 'EXECUTE') then raise exception 'CC4: clientes con acceso a herramientas de IA'; end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name in ('cc_ai_turns', 'cc_ai_tool_calls') and grantee in ('anon')) then raise exception 'CC4: anon con grants en el libro de turnos'; end if;
  if exists (select 1 from information_schema.role_table_grants where table_schema = 'public' and table_name in ('cc_ai_turns', 'cc_ai_tool_calls') and grantee = 'authenticated' and privilege_type <> 'SELECT') then raise exception 'CC4: authenticated escribe el libro de turnos'; end if;
  if not public._cc_ia_puede('ai_active') or public._cc_ia_puede('human_active') or public._cc_ia_puede('human_assigned') then raise exception 'CC4: regla IA_PUEDE mal espejada'; end if;
end $post$;
