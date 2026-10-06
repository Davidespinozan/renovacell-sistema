-- ============================================================================
-- ROLLBACK C360-F3 (migración 121): restaura EXACTAMENTE las funciones redefinidas (texto de 120), la firma de 4
-- argumentos del checkout y las escrituras directas a doctor_locations; retira tablas/columnas/comandos nuevos.
-- customers.phone y customers.meta.fiscal conservan su último valor (eran el espejo): nada se pierde.
-- ============================================================================
drop trigger if exists trg_customers_phone_c360 on public.customers;
drop function if exists public.cliente_360(uuid), public.cliente_perfiles_fiscales(uuid), public.cliente_fiscal_archivar(uuid), public.cliente_fiscal_predeterminar(uuid),
  public.cliente_fiscal_guardar(uuid, uuid, jsonb, boolean), public.cliente_ubicacion_adoptar_alta(uuid), public.cliente_ubicacion_archivar(uuid), public.cliente_ubicacion_predeterminar(uuid),
  public.cliente_ubicacion_guardar(uuid, uuid, jsonb, boolean), public.cliente_nota_agregar(uuid, text), public.cliente_contacto_guardar(uuid, jsonb), public.cliente_telefono_archivar(uuid),
  public.cliente_telefono_principal(uuid), public.cliente_telefono_guardar(uuid, uuid, text, text, boolean);
drop function if exists public.cc_checkout_confirmar(uuid, text, integer, boolean, uuid);
CREATE OR REPLACE FUNCTION public.upsert_customer_fiscal(p_customer_id uuid, p_fiscal jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role  text := public.auth_role();
  v_err   text;
  v_clean jsonb;
  v_meta  jsonb;
begin
  if p_customer_id is null then raise exception 'CLIENTE_REQUERIDO'; end if;

  -- Autorización: staff de cobro/venta (cualquiera) o el DOCTOR dueño de ESE customer.
  -- El customer_id del doctor NO se confía: se verifica profile_id = auth.uid() en la BD.
  if v_role = any (array['admin','billing','pos']) then
    null;
  elsif exists (select 1 from public.customers where id = p_customer_id and profile_id = auth.uid()) then
    null;
  else
    raise exception 'NO_AUTORIZADO: no puedes editar los datos fiscales de este cliente';
  end if;

  v_err := public._fiscal_error(p_fiscal);
  if v_err is not null then raise exception 'FISCAL_INVALIDO: %', v_err; end if;
  v_clean := public._fiscal_clean(p_fiscal);

  select meta into v_meta from public.customers where id = p_customer_id for update;
  if not found then raise exception 'CLIENTE_INEXISTENTE'; end if;

  -- SOLO toca meta.fiscal. No altera full_name/seller/active/profile_id ni otras claves de meta.
  update public.customers
     set meta = jsonb_set(coalesce(meta, '{}'::jsonb), '{fiscal}', v_clean, true),
         updated_at = now()
   where id = p_customer_id;

  perform public._fiscal_audit('Perfil fiscal actualizado', 'customer:' || p_customer_id, v_clean);
  return jsonb_build_object('ok', true, 'customer_id', p_customer_id);
end $function$;
CREATE OR REPLACE FUNCTION public.upsert_customer_contact(p_customer_id uuid, p_patch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text := public.auth_role();
  v_meta jsonb;
begin
  if p_customer_id is null then raise exception 'CLIENTE_REQUERIDO'; end if;
  if v_role = any (array['admin','billing','pos']) then
    null;
  elsif exists (select 1 from public.customers where id = p_customer_id and profile_id = auth.uid()) then
    null;
  else
    raise exception 'NO_AUTORIZADO';
  end if;

  select meta into v_meta from public.customers where id = p_customer_id for update;
  if not found then raise exception 'CLIENTE_INEXISTENTE'; end if;

  update public.customers set
    full_name  = coalesce(nullif(btrim(p_patch->>'full_name'),''), full_name),
    email      = coalesce(nullif(btrim(p_patch->>'email'),''), email),
    phone      = coalesce(nullif(btrim(p_patch->>'phone'),''), phone),
    city       = coalesce(nullif(btrim(p_patch->>'city'),''), city),
    -- seller_name solo si lo manda staff (el doctor no reasigna su vendedor)
    seller_name = case when v_role = any (array['admin','billing','pos'])
                       then coalesce(nullif(btrim(p_patch->>'seller_name'),''), seller_name)
                       else seller_name end,
    meta = coalesce(meta,'{}'::jsonb)
           || jsonb_strip_nulls(jsonb_build_object(
                'organization', coalesce(nullif(btrim(p_patch->>'organization'),''), meta->>'organization'),
                'notes',        coalesce(nullif(btrim(p_patch->>'notes'),''), meta->>'notes')))
    , updated_at = now()
  where id = p_customer_id;

  return jsonb_build_object('ok', true, 'customer_id', p_customer_id);
end;
$function$;
CREATE OR REPLACE FUNCTION public._w3_receptor(p_order uuid, p_override jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_meta jsonb; v_doc uuid; v_cust uuid; v_try jsonb; v_email text;
begin
  select o.invoice_meta, o.doctor_id, o.customer_id into v_meta, v_doc, v_cust
    from public.orders o where o.id = p_order;
  if not found then raise exception 'PEDIDO_INEXISTENTE'; end if;

  if p_override is not null then
    v_try := public._fiscal_clean(p_override);
    if public._fiscal_error(v_try) is null then return v_try; end if;
    return null;  -- un receptor explícito INVÁLIDO no se sustituye en silencio
  end if;

  v_try := public._fiscal_clean(coalesce(v_meta->'receiver', '{}'::jsonb));
  if public._fiscal_error(v_try) is null then return v_try; end if;

  if v_cust is not null then
    select public._w3_norm_legacy(coalesce(c.meta->'fiscal', '{}'::jsonb)) into v_try
      from public.customers c where c.id = v_cust;
    if public._fiscal_error(v_try) is null then return v_try; end if;
  end if;

  if v_doc is not null then
    select public._w3_norm_legacy(coalesce(p.meta->'fiscal', '{}'::jsonb), p.email) into v_try
      from public.profiles p where p.id = v_doc;
    if public._fiscal_error(v_try) is null then return v_try; end if;
  end if;

  return null;
end;
$function$;
CREATE OR REPLACE FUNCTION public.cc_checkout_confirmar(p_review uuid, p_operation text, p_expected_rev integer DEFAULT NULL::integer, p_factura boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); r public.cc_checkout_reviews%rowtype; c record; op record; lin jsonb; v_order uuid; meta jsonb; res jsonb; w1 jsonb; v_fallo text; v_seller jsonb; v_cust uuid;
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
  v_order := gen_random_uuid();
  -- Folio: lo genera crear_pedido (servidor, formato legacy S<n>, único). El origen va en metadata, no en el folio.
  -- Vendedor (metadata server-derived; NO es comisión ni autoridad económica): CC-7 · la cartera canónica (cc_cartera) o ninguno.
  v_seller := public._cc_chk_seller(v_uid);
  meta := jsonb_build_object('placed_by', 'Checkout canónico (CC-6)', 'source', 'cc_checkout', 'address', r.direccion, 'location_id', r.location_id, 'cart_id', c.id, 'checkout_review_id', r.id)
          || coalesce(v_seller, '{}'::jsonb);
  w1 := public.crear_pedido(v_order, null, v_uid, (select jsonb_agg(jsonb_build_object('product_id', l ->> 'product_id', 'qty', (l ->> 'qty')::int)) from jsonb_array_elements(lin -> 'lineas') l), meta, coalesce(p_factura, false), v_cust);
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

revoke all on function public.cc_checkout_confirmar(uuid, text, integer, boolean) from public, anon;
grant execute on function public.cc_checkout_confirmar(uuid, text, integer, boolean) to authenticated, service_role;
drop table if exists public.customer_events, public.customer_notes, public.customer_fiscal_profiles, public.customer_phones;
drop function if exists public._c360_fiscal_predeterminar(uuid, uuid), public._c360_espejo_fiscal(uuid), public._c360_ubic_validar(jsonb), public._c360_ubic_predeterminar(uuid, uuid),
  public._c360_cliente_de_ubicacion(uuid), public._c360_tel_desde_customer(), public._c360_espejo_tel(uuid), public._c360_tel_norm(text), public._c360_evento(uuid, text, jsonb, text),
  public._c360_exige(uuid, text[]), public._c360_cliente(uuid), public._c360_actor(uuid);
alter table public.doctor_locations drop column if exists tipo, drop column if exists municipio;
grant insert, update, delete on public.doctor_locations to authenticated;
