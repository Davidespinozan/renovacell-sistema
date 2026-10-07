-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- COMMERCIAL INTENT · CI-1 (migración 128) · AUTORIDAD BACKEND DEL EPISODIO COMERCIAL
--   Conversación = permanente · sesión = temporal (C1) · EPISODIO de atención comercial = por sesión, repetible.
--   · Antes (CC-7): "un ciclo por carrito": tras el primer aviso, el carrito quedaba 'solicitado'/'rechazado'
--     para siempre y ninguna intención comercial posterior volvía a avisar a ventas.
--   · Ahora: una señal FUERTE (agregar producto o subir cantidad; nunca bajar/quitar/vaciar) abre un episodio
--     si no hay uno VIGENTE: atención humana en curso (requested/assigned/active) o un aviso/rechazo ligado a la
--     sesión ABIERTA. Un aviso o rechazo de una sesión ya cerrada no bloquea: se rearma. Vaciar no rearma.
--   · Relación durable: cc_carts.handoff_session_id (sesión del aviso o del rechazo). Sin backfill: las filas
--     existentes quedan en null = sin episodio vigente (ninguna sesión está abierta hoy).
--   · Orden canónico: el aviso de sistema va ANTES que los eventos → todos los eventos del episodio llevan su
--     sesión. Ids de aviso por episodio ('sys:handoff:<carrito>:<seq>', 'sys:rechazo:<carrito>:<seq>').
--   · Sin cambios a la IA (_cc_ia_puede), al ruteo (_cc_rutear), a C2 ni a la Edge. No toca datos.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'cc_carts' and column_name = 'handoff_session_id') then
    raise exception 'CI-1: ya aplicada (cc_carts.handoff_session_id existe)';
  end if;
  if to_regclass('public.cc_conversation_sessions') is null or to_regprocedure('public._cc_sesion_mensaje()') is null
     or to_regprocedure('public._cc_handoff_carrito(uuid)') is null or to_regprocedure('public._cc_cart_mutar(uuid,text,text,uuid,text,uuid,integer,text)') is null then
    raise exception 'CI-1: faltan prerequisitos (C1/C2/CC-7)';
  end if;
end $pre$;

-- ── 1) Relación durable carrito → sesión del episodio ────────────────────────────────────────────────
alter table public.cc_carts add column handoff_session_id uuid references public.cc_conversation_sessions(id) on delete set null;
comment on column public.cc_carts.handoff_session_id is 'CI-1 · Sesión (episodio comercial) a la que pertenece el aviso o rechazo actual del carrito. Null o sesión cerrada = sin episodio vigente.';

-- ── 2) ¿Hay un episodio comercial vigente para este carrito? ─────────────────────────────────────────
create or replace function public._cc_episodio_vivo(p_cart uuid) returns boolean
  language sql stable set search_path = public as
$$
  select coalesce((
    select exists (select 1 from public.cc_conversations c
                    where c.estado = 'abierta' and c.modo in ('human_requested', 'human_assigned', 'human_active')
                      and case when k.profile_id is not null then c.profile_id = k.profile_id else c.visitor_id = k.visitor_id and c.profile_id is null end)
        or (k.handoff_estado in ('solicitado', 'rechazado')
            and exists (select 1 from public.cc_conversation_sessions s where s.id = k.handoff_session_id and s.estado = 'abierta'))
      from public.cc_carts k where k.id = p_cart), false)
$$;
revoke all on function public._cc_episodio_vivo(uuid) from public, anon, authenticated;

-- ── 3) Handoff por carrito: idempotente por EPISODIO; aviso antes de los eventos ─────────────────────
CREATE OR REPLACE FUNCTION public._cc_handoff_carrito(p_cart uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare k record; v_conv uuid; c record; hor jsonb; v_conf boolean; v_en boolean; ru jsonb; v_items int; v_ses uuid;
begin
  if coalesce(current_setting('app.cc_handoff_fallar', true), '') = 'on' then raise exception 'FALLO_INYECTADO: handoff'; end if;   -- solo pruebas
  select * into k from public.cc_carts where id = p_cart for update;
  if not found or k.estado <> 'active' then return jsonb_build_object('estado', 'no_aplica'); end if;
  select count(*) into v_items from public.cc_cart_items where cart_id = p_cart;
  if v_items = 0 then return jsonb_build_object('estado', 'no_aplica'); end if;

  v_conv := (public._cc_conversacion_de(case when k.profile_id is null then k.visitor_id end, k.profile_id) ->> 'conversation_id')::uuid;
  select * into c from public.cc_conversations where id = v_conv for update;
  -- CI-1 · episodio = sesión: un aviso o rechazo de la sesión ABIERTA deduplica; uno de una sesión cerrada no.
  if k.handoff_estado in ('solicitado', 'rechazado') and exists (select 1 from public.cc_conversation_sessions s where s.id = k.handoff_session_id and s.estado = 'abierta') then
    return jsonb_build_object('estado', k.handoff_estado, 'idempotente', true);
  end if;
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
    update public.cc_carts set handoff_session_id = (select s.id from public.cc_conversation_sessions s where s.conversation_id = v_conv and s.estado = 'abierta') where id = p_cart;
    perform public._cc_evento(v_conv, 'human_handoff_requested', 'system', null, null,
            jsonb_build_object('origen', 'carrito', 'cart_id', p_cart, 'ya_en_curso', true, 'fuera_horario', not v_en));
    return jsonb_build_object('estado', 'solicitado', 'conversation_id', v_conv, 'modo', c.modo, 'ya_en_curso', true, 'fuera_horario', not v_en, 'horario_configurado', v_conf);
  end if;

  update public.cc_conversations set handoff_cart_id = p_cart, handoff_origen = 'carrito', handoff_fuera_horario = not v_en where id = v_conv;
  -- CI-1 · el aviso va PRIMERO: abre (o usa) la sesión del episodio, así sus eventos quedan en ella. Su id es
  -- por episodio (carrito + seq): un aviso de un episodio anterior del mismo carrito no lo absorbe.
  perform public._cc_sistema(v_conv, public._cc_texto_handoff(v_conf, v_en), 'sys:handoff:' || p_cart::text || ':' || c.ultimo_seq::text);
  select s.id into v_ses from public.cc_conversation_sessions s where s.conversation_id = v_conv and s.estado = 'abierta';
  update public.cc_carts set handoff_session_id = v_ses where id = p_cart;
  perform public._cc_cambiar_modo(v_conv, 'human_requested', 'human_handoff_requested', 'system', null, null,
          jsonb_build_object('origen', 'carrito', 'cart_id', p_cart, 'fuera_horario', not v_en, 'horario_configurado', v_conf));
  ru := public._cc_rutear(v_conv);
  if not (ru ->> 'asignado')::boolean then
    perform public._cc_evento(v_conv, 'human_handoff_queued', 'system', null, null, jsonb_build_object('motivo', ru ->> 'motivo', 'fuera_horario', not v_en));
  end if;
  select * into c from public.cc_conversations where id = v_conv;
  return jsonb_build_object('estado', 'solicitado', 'conversation_id', v_conv, 'modo', c.modo, 'asignado', (ru ->> 'asignado')::boolean,
                            'motivo', ru ->> 'motivo', 'fuera_horario', not v_en, 'horario_configurado', v_conf);
end;
$function$;

-- ── 4) Mutación canónica del carrito: señal fuerte + episodio vigente ────────────────────────────────
CREATE OR REPLACE FUNCTION public._cc_cart_mutar(p_cart uuid, p_actor_type text, p_visitor_hash text, p_profile uuid, p_accion text, p_product uuid, p_qty integer, p_op text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a record; c record; v_rol text; prev jsonb; payload jsonb; antes int; despues int; n_antes int; n_despues int; ctx jsonb; aud text; prod record; res jsonb; primera boolean := false; fuerte boolean := false; h jsonb; v_err text; v_actor text := p_actor_type;
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
  -- CI-1 · INTENCIÓN COMERCIAL FUERTE = agregar un producto o subir su cantidad (bajar, quitar y vaciar NO).
  -- Abre un EPISODIO comercial solo si no hay uno vigente (atención humana en curso, o un aviso/rechazo de la
  -- sesión ABIERTA). Un aviso o rechazo de una sesión ya cerrada no bloquea: se rearma. Reintento de un
  -- 'pendiente' como antes. Corre en un SAVEPOINT: si el ruteo falla, el carrito NO falla; queda 'pendiente'.
  fuerte := p_accion in ('agregar', 'actualizar') and coalesce(despues, 0) > coalesce(antes, 0);
  if n_despues > 0 and (c.handoff_estado = 'pendiente' or (fuerte and not public._cc_episodio_vivo(p_cart))) then
    begin
      h := public._cc_handoff_carrito(p_cart);
    exception when others then
      get stacked diagnostics v_err = returned_sqlstate;
      update public.cc_carts set handoff_estado = 'pendiente', handoff_error = v_err where id = p_cart;
      perform public._cc_cart_evento(p_cart, 'handoff_failed', 'system', null, null, null, null, null, jsonb_build_object('sqlstate', v_err));
      h := jsonb_build_object('estado', 'pendiente');
    end;
    -- Contrato V2-A: solo un aviso NUEVO viaja al cliente (uno deduplicado no abre el chat).
    if coalesce((h ->> 'idempotente')::boolean, false) then h := null; end if;
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

-- ── 5) Solicitud explícita de asesor: aviso antes de los eventos (sin cambio de reglas) ──────────────
CREATE OR REPLACE FUNCTION public.cc_solicitar_asesor(p_conv uuid, p_actor_type text, p_visitor_hash text, p_profile uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- CI-1 · el aviso va PRIMERO: abre (o usa) la sesión, así human_requested/human_assigned quedan en ella.
  perform public._cc_sistema(p_conv, 'Pediste hablar con un asesor. ' || public._cc_texto_handoff(v_conf, v_en), 'sys:solicitud:' || c.ultimo_seq);
  perform public._cc_cambiar_modo(p_conv, 'human_requested', 'human_requested', p_actor_type, case when p_actor_type <> 'visitor' then p_profile end, v_visitor,
          jsonb_build_object('origen', 'manual', 'fuera_horario', not v_en, 'horario_configurado', v_conf));
  update public.cc_conversations set handoff_origen = 'manual', handoff_cart_id = null, handoff_fuera_horario = not v_en where id = p_conv;
  -- CC-7 · el ruteo es la cartera canónica (la atribución del referido ya NO decide quién atiende).
  ru := public._cc_rutear(p_conv);
  if not (ru ->> 'asignado')::boolean then
    perform public._cc_evento(p_conv, 'human_handoff_queued', 'system', null, null, jsonb_build_object('motivo', ru ->> 'motivo', 'fuera_horario', not v_en));
  end if;
  select * into c from public.cc_conversations where id = p_conv;
  return jsonb_build_object('modo', c.modo, 'asesor', c.seller_profile_id is not null, 'idempotente', false, 'fuera_horario', not v_en);
end;
$function$;

-- ── 6) Rechazo: vale para el episodio (sesión) actual; aviso por episodio ───────────────────────────
CREATE OR REPLACE FUNCTION public.cc_handoff_rechazar(p_conv uuid, p_actor_type text, p_visitor_hash text, p_profile uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- CI-1 · el rechazo vale para el episodio (sesión) ACTUAL: se (re)liga aunque el carrito ya tuviera un rechazo viejo.
  if k.id is not null and (k.handoff_estado is distinct from 'rechazado'
      or k.handoff_session_id is distinct from (select s.id from public.cc_conversation_sessions s where s.conversation_id = p_conv and s.estado = 'abierta')) then
    update public.cc_carts set handoff_estado = 'rechazado', updated_at = now(),
           handoff_session_id = (select s.id from public.cc_conversation_sessions s where s.conversation_id = p_conv and s.estado = 'abierta') where id = k.id;
    perform public._cc_cart_evento(k.id, 'handoff_rejected', p_actor_type, case when v_actor = 'doctor' then p_profile end, v_visitor);
  end if;
  perform public._cc_cambiar_modo(p_conv, 'ai_active', 'human_handoff_rejected', v_actor, case when v_actor = 'doctor' then p_profile end, v_visitor,
          jsonb_build_object('cart_id', k.id, 'origen', c.handoff_origen));
  perform public._cc_sistema(p_conv, 'Entendido: seguimos con el asistente. Si más adelante quieres hablar con un asesor, solo pídelo aquí.',
          'sys:rechazo:' || coalesce(k.id::text || ':', '') || c.ultimo_seq::text);
  return jsonb_build_object('rechazado', true, 'modo', 'ai_active', 'cart_id', k.id);
end;
$function$;
