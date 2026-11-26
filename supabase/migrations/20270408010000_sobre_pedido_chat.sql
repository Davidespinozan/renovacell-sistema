-- ============================================================================
-- SOBRE PEDIDO EN EL CHAT (26 nov 2026, dueño: «cotización y carrito del chat extenderlo»).
--   · cc_ia_disponibilidad: un producto marcado sin existencia responde estado 'sobre_pedido' (con nota para la IA).
--   · _cc_chk_lineas (revisión del checkout): 'sobre_pedido' no bloquea y no se topa la cantidad a la existencia.
--   · cc_checkout_confirmar: el pedido creado desde el carrito marca lo que espera mercancía (sin factura hasta surtir).
--   · La cotización no validaba existencia; al pasarla a pedido usa Levantar pedido (ya cubierto).
-- Rollback: supabase/rollback/sobre_pedido_chat/99_down.sql
-- ============================================================================
CREATE OR REPLACE FUNCTION public.cc_ia_disponibilidad(p_profile uuid, p_product uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ctx jsonb; prod record; v_disp int;
begin
  ctx := public.cc_ia_contexto_actor(p_profile);
  if not (ctx ->> 'puede_stock')::boolean then return jsonb_build_object('autorizado', false, 'motivo', 'AVAILABILITY_REQUIRES_VERIFICATION'); end if;
  select p.id, p.name, p.sellable, p.sobre_pedido into prod from public.products p where p.id = p_product and p.active and (p.show_portal or p.show_landing);
  if prod.id is null then return jsonb_build_object('autorizado', false, 'motivo', 'PRODUCTO_NO_DISPONIBLE'); end if;
  select coalesce(sum(s.disponible), 0)::int into v_disp from public.v_stock_disponible s where s.product_id = p_product and not s.caducado;
  -- SOBRE PEDIDO (26 nov 2026, dueño): sin existencia pero marcado → se puede vender; llega y se envía después.
  return jsonb_build_object('autorizado', true, 'product_id', prod.id, 'nombre', prod.name,
    'estado', case when not prod.sellable then 'no_vendible' when v_disp > 0 then 'disponible' when prod.sobre_pedido then 'sobre_pedido' else 'no_disponible' end)
    || case when prod.sellable and v_disp <= 0 and prod.sobre_pedido
            then jsonb_build_object('nota', 'Sin existencia en este momento; se puede vender sobre pedido: se envía cuando llegue la mercancía y se factura al surtirse.')
            else '{}'::jsonb end;
end;
$function$;

CREATE OR REPLACE FUNCTION public._cc_chk_lineas(p_cart uuid, p_profile uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare v_vq jsonb := public._qty_volumen_carrito(p_cart); it record; pr jsonb; disp jsonb; lineas jsonb := '[]'::jsonb; problemas jsonb := '[]'::jsonb; total numeric := 0; huella text := ''; n int := 0;
begin
  for it in select i.product_id, i.quantity, p.name, p.active, p.sellable, p.show_portal, p.show_landing
              from public.cc_cart_items i join public.products p on p.id = i.product_id where i.cart_id = p_cart order by i.product_id loop
    n := n + 1;
    if not it.active or not it.sellable or not (it.show_portal or it.show_landing) then problemas := problemas || jsonb_build_object('product_id', it.product_id, 'problema', 'NO_VENDIBLE'); continue; end if;
    if it.quantity < 1 or it.quantity > 999 then problemas := problemas || jsonb_build_object('product_id', it.product_id, 'problema', 'CANTIDAD_INVALIDA'); continue; end if;
    pr := public._cc_precio_vol(p_profile, it.product_id, it.quantity, (v_vq ->> it.product_id::text)::int);
    if not coalesce((pr ->> 'autorizado')::boolean, false) then problemas := problemas || jsonb_build_object('product_id', it.product_id, 'problema', coalesce(pr ->> 'motivo', 'SIN_PRECIO')); continue; end if;
    disp := public.cc_ia_disponibilidad(p_profile, it.product_id);
    -- SOBRE PEDIDO (26 nov 2026): un producto marcado pasa aunque no alcance la existencia.
    if coalesce(disp ->> 'estado', '') not in ('disponible', 'sobre_pedido') then problemas := problemas || jsonb_build_object('product_id', it.product_id, 'problema', 'SIN_DISPONIBILIDAD'); elsif not coalesce((select p.sobre_pedido from public.products p where p.id = it.product_id), false) and it.quantity > (select coalesce(sum(s.disponible), 0) from public.v_stock_disponible s where s.product_id = it.product_id and not s.caducado) then problemas := problemas || jsonb_build_object('product_id', it.product_id, 'problema', 'SIN_DISPONIBILIDAD', 'disponible', (select coalesce(sum(s.disponible), 0) from public.v_stock_disponible s where s.product_id = it.product_id and not s.caducado)); end if;   -- D-CC6-04: bloquea todo
    lineas := lineas || jsonb_build_object('product_id', it.product_id, 'qty', it.quantity, 'nombre', it.name, 'precio_unitario', (pr ->> 'precio_unitario')::numeric, 'subtotal', (pr ->> 'total')::numeric);
    total := total + (pr ->> 'total')::numeric;
    huella := huella || it.product_id::text || ':' || it.quantity || ':' || (pr ->> 'precio_unitario') || ';';
  end loop;
  if n = 0 then problemas := problemas || '"CARRITO_VACIO"'::jsonb; end if;
  return jsonb_build_object('ok', jsonb_array_length(problemas) = 0, 'lineas', lineas, 'total', round(total, 2), 'fingerprint', md5(huella), 'problemas', problemas, 'n_items', n);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_checkout_confirmar(p_review uuid, p_operation text, p_expected_rev integer DEFAULT NULL::integer, p_factura boolean DEFAULT false, p_perfil_fiscal uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); r public.cc_checkout_reviews%rowtype; c record; op record; lin jsonb; v_order uuid; meta jsonb; res jsonb; w1 jsonb; v_fallo text; v_seller jsonb; v_cust uuid; v_fiscal jsonb; v_ent jsonb;
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
  -- C360-0 · identidad comercial CANÓNICA del pedido: perfil autenticado → customers.id (uq_customers_profile).
  -- Nunca del cliente, del correo ni de seller_name. Sin cliente vinculado y activo: FALLA CERRADO, sin pedido.
  v_cust := public._cc_chk_customer(v_uid);
  if v_cust is null then
    raise exception 'CLIENTE_NO_VINCULADO: tu cuenta no está ligada a un expediente de cliente activo' using errcode = 'check_violation';
  end if;
  -- C360-F3 · receptor fiscal: el perfil ELEGIDO (debe ser de este cliente y estar activo) o el predeterminado.
  -- Se valida ANTES del pedido; se congela en el pedido como snapshot (W3 sigue desde ese receptor).
  if coalesce(p_factura, false) then
    if p_perfil_fiscal is not null then
      select jsonb_build_object('rfc', f.rfc, 'razon_social', f.razon_social, 'regimen', f.regimen, 'cp', f.cp, 'uso_cfdi', f.uso_cfdi, 'email_facturacion', f.email_facturacion) into v_fiscal
        from public.customer_fiscal_profiles f where f.id = p_perfil_fiscal and f.customer_id = v_cust and f.activo;
      if v_fiscal is null then raise exception 'PERFIL_FISCAL_INVALIDO: ese perfil fiscal no es tuyo o está archivado' using errcode = 'check_violation'; end if;
    else
      select jsonb_build_object('rfc', f.rfc, 'razon_social', f.razon_social, 'regimen', f.regimen, 'cp', f.cp, 'uso_cfdi', f.uso_cfdi, 'email_facturacion', f.email_facturacion) into v_fiscal
        from public.customer_fiscal_profiles f where f.customer_id = v_cust and f.es_predeterminado and f.activo;
    end if;
  end if;
  -- ENT-0 · la entrega revisada se vuelve a calcular con la hora de AHORA (el corte pudo pasar); la opción es la revisada.
  -- Revisiones anteriores a la 171 (sin entrega): recoger en sucursal, sin cargo.
  v_ent := public._entrega_normalizar('doctor', (lin ->> 'total')::numeric, r.direccion ->> 'cp', jsonb_build_object('opcion', coalesce(r.entrega ->> 'opcion', 'recoge'), 'horario', r.entrega -> 'horario', 'servicio', r.entrega -> 'servicio'), now());   -- ENT-H · el horario revisado se vuelve a validar (cupo) al confirmar
  v_order := gen_random_uuid();
  -- Folio: lo genera crear_pedido (servidor, formato legacy S<n>, único). El origen va en metadata, no en el folio.
  -- Vendedor (metadata server-derived; NO es comisión ni autoridad económica): CC-7 · la cartera canónica (cc_cartera) o ninguno.
  v_seller := public._cc_chk_seller(v_uid);
  meta := jsonb_build_object('placed_by', 'Checkout canónico (CC-6)', 'source', 'cc_checkout', 'address', r.direccion, 'location_id', r.location_id, 'cart_id', c.id, 'checkout_review_id', r.id)
          || coalesce(v_seller, '{}'::jsonb);
  -- CX-0c · D5: marca de procedencia LIGADA A ESTE PEDIDO (transaccional). crear_pedido solo pone «Checkout canónico
  -- (CC-6)» si coincide con su p_order_id; se borra al volver. La atribución (seller*) y placed_by los decide crear_pedido.
  perform set_config('app.cc_checkout_pedido', v_order::text, true);
  w1 := public.crear_pedido(v_order, null, v_uid, (select jsonb_agg(jsonb_build_object('product_id', l ->> 'product_id', 'qty', (l ->> 'qty')::int)) from jsonb_array_elements(lin -> 'lineas') l), meta, coalesce(p_factura, false), v_cust);
  perform set_config('app.cc_checkout_pedido', '', true);
  if coalesce((w1 ->> 'order_id')::uuid, v_order) <> v_order then raise exception 'W1_INCONSISTENTE'; end if;
  if v_fallo = 'despues_w1' then raise exception 'FALLO_INYECTADO: despues_w1'; end if;   -- prueba: nada queda a medias
  perform public._entrega_aplicar(v_order, v_ent);   -- ENT-0 · flete y promesa en el pedido, misma transacción
  perform public._sobre_pedido_marcar(v_order);   -- SOBRE PEDIDO (26 nov 2026): lo que no hay queda «esperando mercancía»
  perform public._cc_chk_evento(c.id, r.id, v_uid, 'order_created', jsonb_build_object('order_id', v_order, 'total', (w1 ->> 'total')::numeric + (v_ent ->> 'flete')::numeric));
  if v_fiscal is not null then perform public.set_order_fiscal_snapshot(v_order, v_fiscal); end if;   -- C360-F3 · receptor congelado

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
