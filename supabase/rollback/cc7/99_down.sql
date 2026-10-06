-- ============================================================================
-- ROLLBACK CC-7 (migración 119). Restaura el texto EXACTO de las funciones redefinidas (CC-2/CC-5/CC-6
-- vigentes antes de 119), sus firmas y privilegios, y retira tablas/columnas/funciones nuevas.
-- La bitácora append-only (eventos con tipos nuevos) se conserva: los CHECK se restauran NOT VALID.
-- ============================================================================
drop function if exists public.cc_horario_ver(), public.cc_horario_guardar(text, jsonb), public.cc_horario_excepcion_guardar(date, text, text, text, text),
  public.cc_horario_excepcion_borrar(date), public.cc_vendedores(), public.cc_cartera_listar(text), public.cc_cartera_asignar(uuid, uuid, text),
  public.cc_ruteo_resumen(), public.cc_ruteo_pendientes(), public.cc_handoff_rechazar(uuid, text, text, uuid), public.cc_ia_estado_handoff(uuid),
  public._cc_handoff_tras_adopcion(uuid), public._cc_handoff_seguro(uuid), public._cc_handoff_carrito(uuid), public._cc_texto_handoff(boolean, boolean),
  public._cc_rutear(uuid), public._cc_conversacion_de(uuid, uuid), public._cc_horario_estado(timestamptz), public._cc_chk_direccion_snapshot(jsonb),
  public._cc_vendedor_de(uuid), public._cc_vendedor_elegible(uuid, boolean), public._cc7_direccion();
drop function if exists public.cc_cola_asesorias();
drop function if exists public.cc_checkout_revisar(uuid, uuid, jsonb);
drop function if exists public.cc_checkout_confirmar(uuid, text, integer, boolean);

CREATE OR REPLACE FUNCTION public._cc_ia_puede(p_modo text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
AS $function$ select p_modo in ('ai_active', 'human_offered', 'human_requested') $function$;

CREATE OR REPLACE FUNCTION public.cc_enviar_mensaje(p_conv uuid, p_actor_type text, p_visitor_hash text, p_profile uuid, p_client_id text, p_content text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public._cc_cart_mutar(p_cart uuid, p_actor_type text, p_visitor_hash text, p_profile uuid, p_accion text, p_product uuid, p_qty integer, p_op text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare a record; c record; v_rol text; prev jsonb; payload jsonb; antes int; despues int; n_antes int; n_despues int; ctx jsonb; aud text; prod record; res jsonb; primera boolean := false; v_actor text := p_actor_type;
begin
  if p_actor_type not in ('visitor', 'doctor', 'ai') then raise exception 'NO_AUTORIZADO: solo el dueño modifica su carrito' using errcode = 'insufficient_privilege'; end if;
  -- `ai` actúa en nombre del dueño: con hash = visitante; con perfil = doctor.
  if p_actor_type = 'ai' then v_actor := case when p_visitor_hash is not null then 'visitor' else 'doctor' end; end if;
  a := public._cc_cart_actor(v_actor, p_visitor_hash, p_profile);
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
  res := jsonb_build_object('cart_id', p_cart, 'accion', p_accion, 'product_id', p_product, 'qty_antes', coalesce(antes, 0), 'qty_despues', coalesce(despues, 0), 'n_items', n_despues, 'rev', c.rev + 1, 'idempotente', false,
    -- Elegibilidad de oferta de asesor: la decide el SERVIDOR. Primera vez que el carrito deja de estar vacío
    -- y sin oferta previa (o cooldown vencido tras un rechazo).
    'oferta_elegible', primera and (c.oferta_estado is null or (c.oferta_estado = 'rechazada' and c.oferta_siguiente_at <= now())));
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
                            'mensajes', v_msgs);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_checkout_revisar(p_cart uuid, p_location_id uuid DEFAULT NULL::uuid)
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
  dir := public._cc_chk_direccion(v_uid, p_location_id);
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

CREATE OR REPLACE FUNCTION public.cc_checkout_confirmar(p_review uuid, p_operation text, p_expected_rev integer DEFAULT NULL::integer)
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
  -- Vendedor (D-15, metadata server-derived; NO es comisión ni autoridad económica): asesor asignado por CC-2 > dueño de cartera del perfil > ninguno.
  v_seller := public._cc_chk_seller(v_uid);
  meta := jsonb_build_object('placed_by', 'Checkout canónico (CC-6)', 'source', 'cc_checkout', 'address', r.direccion, 'location_id', r.location_id, 'cart_id', c.id, 'checkout_review_id', r.id)
          || coalesce(v_seller, '{}'::jsonb);
  w1 := public.crear_pedido(v_order, null, v_uid, (select jsonb_agg(jsonb_build_object('product_id', l ->> 'product_id', 'qty', (l ->> 'qty')::int)) from jsonb_array_elements(lin -> 'lineas') l), meta, false, null);
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

CREATE OR REPLACE FUNCTION public._cc_chk_seller(p_profile uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare v_id uuid; v_origen text; v_email text;
begin
  select cv.seller_profile_id into v_id from public.cc_conversations cv where cv.profile_id = p_profile and cv.estado = 'abierta' and cv.modo in ('human_assigned', 'human_active') and cv.seller_profile_id is not null order by cv.asesoria_asignada_at desc nulls last limit 1;
  if v_id is not null then v_origen := 'asesor_asignado';
  else
    select nullif(p.meta ->> 'seller_profile_id', '')::uuid into v_id from public.profiles p where p.id = p_profile;
    if v_id is null then select s.id into v_id from public.profiles p join public.profiles s on lower(s.email) = lower(p.meta ->> 'owner') where p.id = p_profile and p.meta ->> 'owner' is not null limit 1; end if;
    if v_id is not null then v_origen := 'dueno_cartera'; end if;
  end if;
  if v_id is null then return null; end if;
  select email into v_email from public.profiles where id = v_id;
  return jsonb_build_object('seller_profile_id', v_id, 'seller', v_email, 'seller_origen', v_origen);
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
  return jsonb_build_object('estado', case when n > 0 then 'adoptado' else 'nada' end, 'adoptados', n, 'conversaciones', convs, 'carritos', carts);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_abrir_conversacion(p_visitor_hash text, p_profile uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.cc_solicitar_asesor(p_conv uuid, p_actor_type text, p_visitor_hash text, p_profile uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.cc_cola_asesorias()
 RETURNS TABLE(conversation_id uuid, modo text, seller_profile_id uuid, asesoria_solicitada_at timestamp with time zone, last_message_at timestamp with time zone, es_mia boolean, sin_leer bigint, dueno text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select c.id, c.modo, c.seller_profile_id, c.asesoria_solicitada_at, c.last_message_at,
         c.seller_profile_id = auth.uid() as es_mia,
         greatest(c.ultimo_seq - coalesce((select p.last_read_seq from public.cc_participants p where p.conversation_id = c.id and p.profile_id = auth.uid()), 0), 0) as sin_leer,
         case when c.profile_id is not null then coalesce((select coalesce(pr.meta ->> 'name', pr.full_name) from public.profiles pr where pr.id = c.profile_id), 'Doctor') else 'Visitante' end as dueno
    from public.cc_conversations c
   where c.estado = 'abierta' and c.modo in ('human_requested', 'human_assigned', 'human_active', 'human_ended')
     and public._cc_puede_atender(auth.uid())
     and (public.auth_role() = 'admin' or c.seller_profile_id = auth.uid() or (c.modo = 'human_requested' and c.seller_profile_id is null))
   order by case when c.seller_profile_id = auth.uid() then 0 else 1 end, c.asesoria_solicitada_at nulls last
$function$;


alter table public.cc_carts drop column if exists handoff_estado, drop column if exists handoff_at, drop column if exists handoff_conversation_id, drop column if exists handoff_error;
alter table public.cc_conversations drop column if exists handoff_origen, drop column if exists handoff_cart_id, drop column if exists handoff_fuera_horario, drop column if exists ruteo_motivo;
alter table public.cc_conversation_events drop constraint ck_ccce_tipo;
alter table public.cc_conversation_events add constraint ck_ccce_tipo check (tipo in ('conversation_opened', 'visitor_adopted', 'human_offered', 'human_requested', 'human_assigned', 'seller_unassigned',
  'human_started', 'human_ended', 'ai_resumed', 'conversation_closed', 'conversation_reopened')) not valid;
alter table public.cc_cart_events drop constraint ck_ccev_tipo;
alter table public.cc_cart_events add constraint ck_ccev_tipo check (tipo in ('opened', 'item_added', 'first_item_added', 'item_quantity_changed', 'item_removed', 'emptied', 'merged', 'adopted', 'closed',
  'converted', 'conversation_linked', 'seller_offer_triggered', 'seller_offer_accepted', 'seller_offer_dismissed', 'checkout_prepared')) not valid;
drop table if exists public.cc_cartera_historial, public.cc_cartera, public.cc_horario_eventos, public.cc_horario_excepciones, public.cc_horario_semanal, public.cc_horario_config;

revoke all on function public.cc_cola_asesorias(), public.cc_checkout_revisar(uuid, uuid), public.cc_checkout_confirmar(uuid, text, integer) from public, anon;
grant execute on function public.cc_cola_asesorias(), public.cc_checkout_revisar(uuid, uuid), public.cc_checkout_confirmar(uuid, text, integer) to authenticated, service_role;
revoke all on function public._cc_chk_seller(uuid) from public, anon, authenticated;
