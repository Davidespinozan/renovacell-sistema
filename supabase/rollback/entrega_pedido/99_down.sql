-- ENTREGA DEL PEDIDO · rollback de la migración 171: se retira la entrega del pedido y el checkout vuelve a la 119/137.
-- Se niega si algún pedido ya lleva entrega o flete: esa información no se destruye por un rollback, salvo que se ejecute
-- con SET app.entrega_rollback_forzado = 'on' (decisión explícita del dueño; las cadenas de prueba lo usan).
do $pre$ begin
  if coalesce(current_setting('app.entrega_rollback_forzado', true), '') <> 'on'
     and exists (select 1 from public.orders where shipping_cost <> 0 or shipping_meta ? 'entrega') then
    raise exception 'ENTREGA down: hay pedidos con entrega o flete registrados; no se revierte en automático (SET app.entrega_rollback_forzado = ''on'' para forzarlo)';
  end if;
end $pre$;
drop function public.cc_checkout_revisar(uuid, uuid, jsonb, jsonb);
drop function public.crear_pedido_con_entrega(uuid, text, uuid, jsonb, jsonb, boolean, uuid, jsonb, jsonb);
drop function public.entrega_config_guardar(jsonb);
drop function public.entrega_config_ver();
drop function public._entrega_aplicar(uuid, jsonb);
drop function public._entrega_normalizar(text, numeric, text, jsonb, timestamptz);
drop function public.entrega_opciones(text, numeric, text, timestamptz);
drop function public._entrega_opcion(text, text, text, numeric, boolean, text, boolean, jsonb, date, date, text);
drop function public._entrega_es_local(text);
drop function public._entrega_salida(timestamptz, smallint[]);
drop function public._entrega_sumar_dias(date, int, smallint[]);
drop function public._entrega_siguiente_dia(date, smallint[]);
drop function public._entrega_dia_valido(date, smallint[]);
drop function public._entrega_zona();
alter table public.cc_checkout_reviews drop column entrega;
drop trigger orders_shipping_cost_guard on public.orders;
drop function public._orders_shipping_cost_guard();
alter table public.orders drop column shipping_cost;
drop table public.entrega_config;
-- cc_checkout_revisar tal como quedó en la 119 (C360-0):
CREATE OR REPLACE FUNCTION public.cc_checkout_revisar(p_cart uuid, p_location_id uuid DEFAULT NULL::uuid, p_direccion jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); c record; prep jsonb; lin jsonb; dir jsonb; problemas jsonb; rv uuid; v_exp timestamptz; v_rol text := public.auth_role(); v_cust uuid;
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
  -- C360-0 · identidad comercial canónica (perfil → customers.id). Sin cliente vinculado no hay revisión lista.
  v_cust := public._cc_chk_customer(v_uid);
  if v_cust is null then problemas := problemas || '"CLIENTE_NO_VINCULADO"'::jsonb; end if;
  if (prep ->> 'listo')::boolean and (lin ->> 'ok')::boolean and dir is not null and v_cust is not null then
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
$function$

;
revoke all on function public.cc_checkout_revisar(uuid, uuid, jsonb) from public, anon, service_role;
grant execute on function public.cc_checkout_revisar(uuid, uuid, jsonb) to authenticated;
-- cc_checkout_confirmar tal como quedó en la 137 (CX-0c):
CREATE OR REPLACE FUNCTION public.cc_checkout_confirmar(p_review uuid, p_operation text, p_expected_rev integer DEFAULT NULL::integer, p_factura boolean DEFAULT false, p_perfil_fiscal uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); r public.cc_checkout_reviews%rowtype; c record; op record; lin jsonb; v_order uuid; meta jsonb; res jsonb; w1 jsonb; v_fallo text; v_seller jsonb; v_cust uuid; v_fiscal jsonb;
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
  perform public._cc_chk_evento(c.id, r.id, v_uid, 'order_created', jsonb_build_object('order_id', v_order, 'total', (w1 ->> 'total')::numeric));
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
$function$

;
-- _cc_chk_resultado tal como quedó en la 117 (CC-6):
CREATE OR REPLACE FUNCTION public._cc_chk_resultado(p_order uuid, p_cart uuid, p_idem boolean)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  select jsonb_build_object('confirmado', true, 'idempotente', p_idem, 'cart_id', p_cart, 'order_id', o.id, 'folio', o.external_ref, 'status', o.status, 'total', o.total, 'moneda', coalesce(o.currency, 'MXN'),
           'estado_pago', coalesce(m.estado_pago, 'pending'), 'saldo', coalesce(m.saldo, o.total),
           'acciones_pago', jsonb_build_array('transferencia', 'tarjeta'),   -- métodos permitidos hoy (reportar transferencia / Stripe); la verdad de pago sigue en W2
           'created_at', o.created_at)
    from public.orders o left join public.v_order_money m on m.order_id = o.id where o.id = p_order
$function$

;
do $post$ begin
  if md5(pg_get_functiondef('public.cc_checkout_revisar(uuid,uuid,jsonb)'::regprocedure)) <> 'de58088479a7c4a5ee971c240f442802' then raise exception 'ENTREGA down: cc_checkout_revisar no quedó como en la 119'; end if;
  if md5(pg_get_functiondef('public.cc_checkout_confirmar(uuid,text,integer,boolean,uuid)'::regprocedure)) <> '49129e57d5f044e624a6d61621fb3bce' then raise exception 'ENTREGA down: cc_checkout_confirmar no quedó como en la 137'; end if;
  if md5(pg_get_functiondef('public._cc_chk_resultado(uuid,uuid,boolean)'::regprocedure)) <> '10f9f4dfaaaac23e1025ade13ac62f2e' then raise exception 'ENTREGA down: _cc_chk_resultado no quedó como en la 117'; end if;
end $post$;
