-- HORARIO DE ENTREGA LOCAL (ENT-H, 189) · rollback: se retira la agenda, los campos horario_* y vuelven las funciones de la 171.
-- Se niega si hay reservas de horario registradas (esa información no se destruye por un rollback), salvo
-- SET app.entrega_horarios_rollback_forzado = 'on' (decisión explícita del dueño; las cadenas de prueba lo usan).
do $pre$ begin
  if coalesce(current_setting('app.entrega_horarios_rollback_forzado', true), '') <> 'on'
     and to_regclass('public.entrega_horarios') is not null and exists (select 1 from public.entrega_horarios) then
    raise exception 'ENT-H down: hay horarios de entrega reservados; no se revierte en automático (SET app.entrega_horarios_rollback_forzado = ''on'' para forzarlo)';
  end if;
end $pre$;
drop trigger if exists orders_entrega_horario_liberar on public.orders;
drop function if exists public._entrega_horarios_liberar_trg();
drop function if exists public.entrega_horario_reprogramar(uuid, text, text, text);
drop function if exists public.entrega_horarios_agenda(date, date);
drop function if exists public.entrega_horarios_disponibles(timestamptz);
drop function if exists public._entrega_horario_validar(text, text, timestamptz, boolean);
drop function if exists public._entrega_horario_ultimo_dia(date);
drop function if exists public._entrega_horario_ocupados(date, time);
drop function if exists public._entrega_horario_slots();
drop table if exists public.entrega_horarios;
alter table public.entrega_config drop constraint if exists ck_entcfg_franjas;
alter table public.entrega_config
  drop column if exists horario_franjas, drop column if exists horario_intervalo_min, drop column if exists horario_cupo,
  drop column if exists horario_margen_min, drop column if exists horario_dias_adelante;
drop function if exists public._entrega_franjas_validas(jsonb);
-- _entrega_normalizar tal como quedó en la 171:
create or replace function public._entrega_normalizar(p_actor text, p_subtotal numeric, p_cp text, p_eleccion jsonb, p_ahora timestamptz default now()) returns jsonb
  language plpgsql stable set search_path = public as
$$
declare ops jsonb; o jsonb; v_id text; v_costo numeric; v_motivo text; cfg public.entrega_config%rowtype;
begin
  if p_eleccion is null or jsonb_typeof(p_eleccion) <> 'object' then raise exception 'ENTREGA_REQUERIDA: el pedido necesita cómo se entrega' using errcode = 'check_violation'; end if;
  v_id := nullif(btrim(coalesce(p_eleccion ->> 'opcion', '')), '');
  ops := public.entrega_opciones(p_actor, p_subtotal, p_cp, p_ahora);
  select x into o from jsonb_array_elements(ops -> 'opciones') x where x ->> 'id' = v_id;
  if o is null then raise exception 'ENTREGA_INVALIDA: opción de entrega desconocida' using errcode = 'check_violation'; end if;
  if not (o ->> 'permitido')::boolean then raise exception 'ENTREGA_NO_PERMITIDA: %', coalesce(o ->> 'motivo', 'esa entrega no aplica') using errcode = 'check_violation'; end if;
  if not (o ->> 'disponible')::boolean then raise exception 'ENTREGA_NO_DISPONIBLE: esa paquetería aún no está activa' using errcode = 'check_violation'; end if;
  v_costo := (o ->> 'flete')::numeric;
  if p_actor = 'staff' and p_eleccion ? 'flete' and jsonb_typeof(p_eleccion -> 'flete') = 'number' then
    if (p_eleccion ->> 'flete')::numeric < 0 or (p_eleccion ->> 'flete')::numeric > 99999 then raise exception 'ENTREGA_FLETE_INVALIDO' using errcode = 'check_violation'; end if;
    if (p_eleccion ->> 'flete')::numeric <> v_costo then
      v_motivo := nullif(btrim(left(coalesce(p_eleccion ->> 'motivo', ''), 200)), '');
      if v_motivo is null or length(v_motivo) < 3 then raise exception 'ENTREGA_AJUSTE_SIN_MOTIVO: para cambiar el flete escribe el motivo' using errcode = 'check_violation'; end if;
      v_costo := round((p_eleccion ->> 'flete')::numeric, 2);
    end if;
  end if;
  select * into cfg from public.entrega_config where id = 1;
  return jsonb_strip_nulls(jsonb_build_object(
    'opcion', o ->> 'id', 'tipo', o ->> 'tipo', 'paqueteria', o -> 'paqueteria', 'texto', o ->> 'texto',
    'flete', v_costo, 'flete_regla', (o ->> 'flete')::numeric, 'ajuste_motivo', v_motivo,
    'local', ops -> 'local', 'cp', ops -> 'cp', 'subtotal', ops -> 'subtotal',
    'salida', o -> 'salida', 'antes_de_corte', o -> 'antes_de_corte', 'llega_desde', o -> 'llega_desde', 'llega_hasta', o -> 'llega_hasta',
    'recoge', case when o ->> 'tipo' = 'recoge' then jsonb_build_object('lugar', cfg.recoge_lugar, 'horario', cfg.recoge_horario) end,
    'actor', p_actor, 'calculado_at', p_ahora));
end;
$$;
-- _entrega_aplicar tal como quedó en la 171:
create or replace function public._entrega_aplicar(p_order uuid, p_entrega jsonb) returns void
  language plpgsql set search_path = public as
$$
declare o record; v_trusted text := coalesce(current_setting('app.trusted', true), ''); v_costo numeric := (p_entrega ->> 'flete')::numeric;
begin
  select id, shipping_cost, shipping_meta into o from public.orders where id = p_order for update;
  if not found then raise exception 'PEDIDO_INEXISTENTE'; end if;
  if o.shipping_meta ? 'entrega' then
    if o.shipping_meta -> 'entrega' ->> 'opcion' = p_entrega ->> 'opcion' and o.shipping_cost = v_costo then return; end if;   -- ya aplicada (reintento)
    raise exception 'ENTREGA_YA_FIJADA: la entrega del pedido ya quedó registrada' using errcode = 'check_violation';
  end if;
  perform set_config('app.trusted', 'on', true);
  update public.orders
     set shipping_cost = v_costo, total = coalesce(total, 0) + v_costo,
         shipping_meta = coalesce(shipping_meta, '{}'::jsonb) || jsonb_build_object('entrega', p_entrega)
   where id = p_order;
  perform set_config('app.trusted', v_trusted, true);
end;
$$;
-- entrega_config_guardar tal como quedó en la 171:
create or replace function public.entrega_config_guardar(p jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare cfg public.entrega_config%rowtype;
begin
  if public.auth_role() <> 'admin' then raise exception 'NO_AUTORIZADO: solo Dirección cambia la regla de entrega' using errcode = 'insufficient_privilege'; end if;
  if p is null or jsonb_typeof(p) <> 'object' or length(p::text) > 4000 then raise exception 'ENTREGA_CONFIG_INVALIDA' using errcode = 'check_violation'; end if;
  select * into cfg from public.entrega_config where id = 1 for update;
  update public.entrega_config set
    corte                = coalesce((p ->> 'corte')::time, cfg.corte),
    foraneo_gratis_desde = coalesce((p ->> 'foraneo_gratis_desde')::numeric, cfg.foraneo_gratis_desde),
    foraneo_costo        = coalesce((p ->> 'foraneo_costo')::numeric, cfg.foraneo_costo),
    local_gratis_desde   = coalesce((p ->> 'local_gratis_desde')::numeric, cfg.local_gratis_desde),
    local_costo          = coalesce((p ->> 'local_costo')::numeric, cfg.local_costo),
    cp_local_desde       = coalesce(p ->> 'cp_local_desde', cfg.cp_local_desde),
    cp_local_hasta       = coalesce(p ->> 'cp_local_hasta', cfg.cp_local_hasta),
    dias_paqueteria      = coalesce((select array_agg(x::smallint) from jsonb_array_elements_text(p -> 'dias_paqueteria') x), cfg.dias_paqueteria),
    dias_chofer          = coalesce((select array_agg(x::smallint) from jsonb_array_elements_text(p -> 'dias_chofer') x), cfg.dias_chofer),
    dias_entrega_foranea = coalesce((select array_agg(x::smallint) from jsonb_array_elements_text(p -> 'dias_entrega_foranea') x), cfg.dias_entrega_foranea),
    dhl_transito_min     = coalesce((p ->> 'dhl_transito_min')::smallint, cfg.dhl_transito_min),
    dhl_transito_max     = coalesce((p ->> 'dhl_transito_max')::smallint, cfg.dhl_transito_max),
    t1_activo            = coalesce((p ->> 't1_activo')::boolean, cfg.t1_activo),
    t1_transito_min      = coalesce((p ->> 't1_transito_min')::smallint, cfg.t1_transito_min),
    t1_transito_max      = coalesce((p ->> 't1_transito_max')::smallint, cfg.t1_transito_max),
    local_mismo_dia      = coalesce((p ->> 'local_mismo_dia')::boolean, cfg.local_mismo_dia),
    recoge_lugar         = coalesce(nullif(btrim(p ->> 'recoge_lugar'), ''), cfg.recoge_lugar),
    recoge_horario       = coalesce(nullif(btrim(p ->> 'recoge_horario'), ''), cfg.recoge_horario),
    updated_at = now(), updated_by = auth.uid()
  where id = 1;
  perform public.log_audit('Regla de entrega actualizada', 'entrega_config', left(p::text, 1000), 'Dirección');
  return public.entrega_config_ver();
end;
$$;
-- cc_checkout_revisar tal como quedó en la 171:
CREATE OR REPLACE FUNCTION public.cc_checkout_revisar(p_cart uuid, p_location_id uuid DEFAULT NULL::uuid, p_direccion jsonb DEFAULT NULL::jsonb, p_entrega jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); c record; prep jsonb; lin jsonb; dir jsonb; problemas jsonb; rv uuid; v_exp timestamptz; v_rol text := public.auth_role(); v_cust uuid;
        v_ops jsonb; v_ent jsonb; v_elec text; v_msg text; v_dir_ok boolean;
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
  -- ENT-0 · opciones de entrega con el importe de productos y el CP del domicilio. La entrega la ELIGE el doctor (el
  -- portal le muestra las opciones y la sugerida); el servidor nunca la decide por él: sin elección no hay revisión lista.
  v_ops := public.entrega_opciones('doctor', coalesce((lin ->> 'total')::numeric, 0), dir -> 'address' ->> 'cp', now());
  v_elec := nullif(btrim(coalesce(p_entrega ->> 'opcion', '')), '');
  if v_elec is null then
    problemas := problemas || '"REQUIERE_ENTREGA"'::jsonb;
  else
    begin
      v_ent := public._entrega_normalizar('doctor', coalesce((lin ->> 'total')::numeric, 0), dir -> 'address' ->> 'cp', jsonb_build_object('opcion', v_elec), now());
    exception when check_violation then
      get stacked diagnostics v_msg = message_text;
      problemas := problemas || to_jsonb(split_part(v_msg, ':', 1));
    end;
  end if;
  v_dir_ok := dir is not null or coalesce(v_ent ->> 'tipo', '') = 'recoge';   -- recoger en sucursal no necesita domicilio
  if not v_dir_ok then problemas := problemas || '"REQUIERE_DIRECCION"'::jsonb; end if;
  -- C360-0 · identidad comercial canónica (perfil → customers.id). Sin cliente vinculado no hay revisión lista.
  v_cust := public._cc_chk_customer(v_uid);
  if v_cust is null then problemas := problemas || '"CLIENTE_NO_VINCULADO"'::jsonb; end if;
  if (prep ->> 'listo')::boolean and (lin ->> 'ok')::boolean and v_dir_ok and v_ent is not null and v_cust is not null then
    v_exp := now() + interval '15 minutes';   -- D-CC6-01
    insert into public.cc_checkout_reviews (cart_id, profile_id, cart_rev, fingerprint, total, n_items, location_id, direccion, entrega, expires_at)
    values (c.id, v_uid, c.rev, lin ->> 'fingerprint', (lin ->> 'total')::numeric, (lin ->> 'n_items')::int, (dir ->> 'location_id')::uuid, dir -> 'address', v_ent, v_exp) returning id into rv;
    perform public._cc_chk_evento(c.id, rv, v_uid, 'review_created', jsonb_build_object('rev', c.rev, 'n_items', lin ->> 'n_items'));
    return jsonb_build_object('listo', true, 'cart_id', c.id, 'cart_rev', c.rev, 'review_id', rv, 'expires_at', v_exp, 'total', (lin ->> 'total')::numeric, 'moneda', 'MXN',
                              'lineas', lin -> 'lineas', 'direccion', dir, 'proyeccion', prep -> 'proyeccion', 'problemas', '[]'::jsonb,
                              'entrega', v_ent, 'entrega_opciones', v_ops, 'envio', (v_ent ->> 'flete')::numeric, 'total_con_envio', (lin ->> 'total')::numeric + (v_ent ->> 'flete')::numeric);
  end if;
  perform public._cc_chk_evento(c.id, null, v_uid, 'review_not_ready', jsonb_build_object('n', jsonb_array_length(problemas)));
  return jsonb_build_object('listo', false, 'cart_id', c.id, 'cart_rev', c.rev, 'problemas', problemas || coalesce(lin -> 'problemas', '[]'::jsonb), 'proyeccion', prep -> 'proyeccion', 'direccion', dir, 'total', (lin ->> 'total')::numeric, 'moneda', 'MXN',
                            'entrega', v_ent, 'entrega_opciones', v_ops);
end;
$function$;
-- cc_checkout_confirmar tal como quedó en la 171:
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
  v_ent := public._entrega_normalizar('doctor', (lin ->> 'total')::numeric, r.direccion ->> 'cp', jsonb_build_object('opcion', coalesce(r.entrega ->> 'opcion', 'recoge')), now());
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
alter function public._entrega_normalizar(text, numeric, text, jsonb, timestamptz) owner to postgres;
alter function public._entrega_aplicar(uuid, jsonb) owner to postgres;
alter function public.entrega_config_guardar(jsonb) owner to postgres;
revoke all on function public._entrega_normalizar(text, numeric, text, jsonb, timestamptz), public._entrega_aplicar(uuid, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.entrega_config_guardar(jsonb) from public, anon;
grant execute on function public.entrega_config_guardar(jsonb) to authenticated;
