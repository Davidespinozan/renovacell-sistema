-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- CHAT V2-D1 (migración 130) · SALUDO COMERCIAL PROACTIVO Y PERSISTENTE
--   · Cada episodio comercial NUEVO abierto por el carrito (CI-1) inserta, en la misma transacción y después del
--     ruteo, UN saludo de la persona "Asistente Renovacell" con contexto canónico: primer nombre del doctor,
--     nombre del producto que disparó la señal y, solo si la asignación quedó confirmada, el de su asesora.
--   · Plantilla determinista (sin proveedor de IA, sin cc_ai_turns): sin precios, disponibilidad, beneficios,
--     indicaciones, descuentos, horarios ni tiempos. La IA conversa después, cuando el doctor escribe, y ve el
--     saludo en su contexto (cc_ia_contexto lo incluye como mensaje del asistente).
--   · Procedencia inequívoca: actor 'ai' (persona) + client_message_id 'tpl:saludo:<carrito>:<seq>'; la IA real
--     usa siempre 'ai:<seq>'. CHECK ck_ccm_procedencia_ia lo garantiza en el esquema; _cc_procedencia_mensaje
--     clasifica para métricas ('ia_plantilla' vs 'ia_generada').
--   · Sin saludo en: episodio deduplicado, 'ya en curso', solicitud explícita desde el chat, rechazo. Sin saludos
--     retroactivos: la migración no inserta mensajes. Sin cambios de Edge ni de permisos.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regprocedure('public._cc_handoff_carrito(uuid,uuid)') is not null then raise exception 'V2-D1: ya aplicada'; end if;
  if to_regprocedure('public._cc_episodio_vivo(uuid)') is null then raise exception 'V2-D1: requiere CI-1 (128)'; end if;
  if exists (select 1 from public.cc_messages where actor_type = 'ai' and (client_message_id is null or (client_message_id not like 'ai:%' and client_message_id not like 'tpl:%'))) then
    raise exception 'V2-D1: hay mensajes de IA sin procedencia ai:/tpl: — revisar antes de aplicar';
  end if;
end $pre$;

-- ── 1) Procedencia de los mensajes del asistente ─────────────────────────────────────────────────────
alter table public.cc_messages add constraint ck_ccm_procedencia_ia
  check (actor_type <> 'ai' or coalesce(client_message_id, '') like 'ai:%' or coalesce(client_message_id, '') like 'tpl:%');   -- NULL no pasa
create or replace function public._cc_procedencia_mensaje(p_actor text, p_client_id text) returns text
  language sql immutable as
$$ select case when p_actor = 'ai' and coalesce(p_client_id, '') like 'tpl:%' then 'ia_plantilla'
                 when p_actor = 'ai' then 'ia_generada' else p_actor end $$;
comment on function public._cc_procedencia_mensaje(text, text) is 'V2-D1 · Clasifica la procedencia de un mensaje para métricas: ia_plantilla (saludo determinista) vs ia_generada (proveedor).';

-- ── 2) Primer nombre presentable (sin rol "· Ventas", sin títulos, sin cuentas técnicas) ─────────────
create or replace function public._cc_primer_nombre(p_raw text) returns text
  language sql immutable as
$$ select case when x = '' or x ~ '[@0-9_]' then null else upper(left(x, 1)) || lower(substr(x, 2)) end   -- sin initcap: no depende del locale
       from (select split_part(regexp_replace(btrim(split_part(coalesce(p_raw, ''), '·', 1)), '^(dr|dra|doctor|doctora|lic|ing)\.?\s+', '', 'i'), ' ', 1) as x) s $$;

-- ── 3) Plantilla del saludo (segura; variantes si falta nombre, producto o asesora) ──────────────────
create or replace function public._cc_texto_saludo(p_nombre text, p_producto text, p_asignada boolean, p_asesora text) returns text
  language sql immutable as
$$ select '¡Hola' || coalesce(', ' || nullif(btrim(p_nombre), ''), '') || '! 👋 '
     || case when nullif(btrim(p_producto), '') is not null
             then 'Veo que te interesa ' || btrim(p_producto) || '. ¿Te gustaría conocer sus características o necesitas alguna recomendación? '
             else 'Veo que estás armando tu pedido. ¿Te gustaría conocer las características de algún producto o necesitas alguna recomendación? ' end
     || case when p_asignada and nullif(btrim(p_asesora), '') is not null then btrim(p_asesora) || ', tu asesora, ya tiene tu solicitud. '
             when p_asignada then 'Tu asesora ya tiene tu solicitud. '
             else 'Ya registré tu solicitud con nuestro equipo comercial. ' end
     || 'Mientras tanto, estoy aquí para ayudarte.' $$;

-- ── 4) Inserción del saludo: idempotente por episodio (id 'tpl:saludo:<carrito>:<seq>') ─────────────
create or replace function public._cc_saludo_comercial(p_conv uuid, p_cart uuid, p_product uuid, p_asignada boolean, p_seq bigint) returns void
  language plpgsql set search_path = public as
$$
declare cv record; v_nombre text; v_prod text; v_asesora text; v_texto text; v_cid text; v_seq bigint;
begin
  v_cid := 'tpl:saludo:' || p_cart::text || ':' || p_seq::text;
  if exists (select 1 from public.cc_messages where conversation_id = p_conv and actor_type = 'ai' and client_message_id = v_cid) then return; end if;
  select * into cv from public.cc_conversations where id = p_conv;
  if cv.profile_id is not null then
    v_nombre := public._cc_primer_nombre((select coalesce(p.meta ->> 'name', p.full_name) from public.profiles p where p.id = cv.profile_id));
  end if;
  if p_product is not null then
    select nullif(btrim(pr.name), '') into v_prod from public.products pr where pr.id = p_product and pr.active;
  end if;
  if p_asignada and cv.seller_profile_id is not null then
    v_asesora := public._cc_primer_nombre((select coalesce(p.meta ->> 'name', p.full_name) from public.profiles p where p.id = cv.seller_profile_id));
  end if;
  v_texto := public._cc_texto_saludo(v_nombre, v_prod, p_asignada and cv.seller_profile_id is not null, v_asesora);
  update public.cc_conversations set ultimo_seq = ultimo_seq + 1, last_message_at = now(), updated_at = now() where id = p_conv returning ultimo_seq into v_seq;
  insert into public.cc_messages (conversation_id, seq, actor_type, client_message_id, content, content_hash)
  values (p_conv, v_seq, 'ai', v_cid, v_texto, md5(v_texto));
end;
$$;

-- ── 5) Handoff por carrito con contexto de producto (la firma de 1 argumento queda como envoltura) ───
CREATE OR REPLACE FUNCTION public._cc_handoff_carrito(p_cart uuid, p_product uuid)
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
  -- V2-D1 · SALUDO PROACTIVO: plantilla determinista de la persona Asistente (procedencia 'tpl:'), UNO por episodio,
  -- en esta misma transacción y DESPUÉS del ruteo (nombra a la asesora solo si la asignación quedó confirmada).
  perform public._cc_saludo_comercial(v_conv, p_cart, p_product, coalesce((ru ->> 'asignado')::boolean, false), c.ultimo_seq);
  select * into c from public.cc_conversations where id = v_conv;
  return jsonb_build_object('estado', 'solicitado', 'conversation_id', v_conv, 'modo', c.modo, 'asignado', (ru ->> 'asignado')::boolean,
                            'motivo', ru ->> 'motivo', 'fuera_horario', not v_en, 'horario_configurado', v_conf);
end;
$function$;

create or replace function public._cc_handoff_carrito(p_cart uuid) returns jsonb
  language sql set search_path = public as
$$ select public._cc_handoff_carrito(p_cart, null::uuid) $$;   -- abrir (reintento de 'pendiente') y adopción: saludo genérico

revoke all on function public._cc_handoff_carrito(uuid, uuid), public._cc_saludo_comercial(uuid, uuid, uuid, boolean, bigint),
  public._cc_texto_saludo(text, text, boolean, text), public._cc_primer_nombre(text), public._cc_procedencia_mensaje(text, text) from public, anon, authenticated;

-- ── 6) Mutación del carrito: pasa el producto de la señal fuerte ─────────────────────────────────────
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
      h := public._cc_handoff_carrito(p_cart, p_product);   -- V2-D1 · el producto de la señal fuerte da contexto al saludo
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
