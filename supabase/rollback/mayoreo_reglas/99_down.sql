-- MAYOREO-REGLAS (20270222) · down: precio_de/3, crear_pedido, vender_pos, cc_cotizacion_crear, cc_ia_precio, _cc_chk_lineas y
-- cc_carrito_proyeccion vuelven a su definición exacta anterior (precio renglón por renglón); fuera precio_de/4, el cálculo
-- del pedido y el nivel de cada escalón.
CREATE OR REPLACE FUNCTION public.precio_de(p_product uuid, p_list uuid, p_qty integer)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_claim_rol text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '');
  v_rol_sesion text := coalesce(current_setting('role', true), '');
  v_base numeric; v_vol numeric; v_promo numeric;
begin
  if not (v_claim_rol = 'service_role' or (v_claim_rol = '' and v_rol_sesion not in ('authenticated', 'anon'))) then
    if public.auth_role() = any (array['admin', 'billing', 'pos', 'warehouse', 'packing', 'comm']) then
      null;
    elsif public.puede_ver_precio()
          and (p_list is null or p_list = (select p.price_list_id from public.profiles p where p.id = auth.uid())) then
      null;
    else
      raise exception 'PRECIO_NO_AUTORIZADO: no tienes acceso a este precio' using errcode = 'insufficient_privilege';
    end if;
  end if;

  select coalesce(
           (select pp.price from public.product_prices pp where pp.product_id = p_product and pp.list_id = p_list),
           (select pr.price from public.products pr where pr.id = p_product))
    into v_base;
  select pv.price into v_vol from public.product_volume_prices pv
   where pv.product_id = p_product and pv.active and pv.min_quantity <= p_qty
   order by pv.min_quantity desc limit 1;
  -- PROMO-1 · la promoción vigente entra como un candidato más: nunca se cobra más que el precio normal del cliente.
  v_promo := public._promo_precio(p_product, p_list, p_qty);
  return (select min(x) from unnest(array[v_base, v_vol, v_promo]) x);
end;
$function$;

CREATE OR REPLACE FUNCTION public.crear_pedido(p_order_id uuid, p_folio text, p_doctor_id uuid, p_lines jsonb, p_shipping_meta jsonb DEFAULT NULL::jsonb, p_invoice_requested boolean DEFAULT false, p_customer_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  ln jsonb; pid uuid; q int; up numeric; tot numeric := 0;
  list uuid; act boolean; out_items jsonb := '[]'::jsonb;
  v_cname text; v_cphone text; v_meta jsonb; v_folio text; v_intento int;
  v_cust uuid; v_cust_profile uuid;
  v_attr jsonb; v_placed text;
begin
  if p_doctor_id is null and p_customer_id is null then
    raise exception 'FALTA_IDENTIDAD: el pedido requiere doctor_id o customer_id';
  end if;
  if not (
    (public.auth_role() = 'doctor' and p_doctor_id = auth.uid() and public.is_verified())
    or public.auth_role() = any (array['admin','pos'])
  ) then
    raise exception 'No autorizado';
  end if;
  -- CX-0b · CUENTA COMERCIAL del pedido, decidida en el servidor.
  --   Doctor (portal): SU cuenta, derivada de la identidad autenticada (_cc_chk_customer: customers.profile_id = auth.uid()
  --   y activa). p_customer_id solo se acepta si ES esa cuenta; cualquier otra (ajena, inexistente o inactiva) → el MISMO
  --   error genérico (no se puede sondear si una cuenta existe ni de quién es).
  --   ⇢ B2B-3 sustituye SOLO esta derivación por: cuenta seleccionada + membresía activa + permiso de compra.
  --   Personal (admin/pos): cualquier cuenta activa (facultad existente); si además hay comprador, la pareja debe ser
  --   coherente: la cuenta ligada a ese comprador, o una cuenta sin portal cuando el comprador no tiene cuenta ligada.
  if public.auth_role() = 'doctor' then
    v_cust := public._cc_chk_customer(auth.uid());
    if p_customer_id is not null and p_customer_id is distinct from v_cust then
      raise exception 'CUENTA_NO_AUTORIZADA: el pedido solo puede crearse para tu propia cuenta' using errcode = 'insufficient_privilege';
    end if;
    if v_cust is not null then
      select full_name, phone into v_cname, v_cphone from public.customers where id = v_cust;
    end if;
  else
    v_cust := p_customer_id;
    if v_cust is not null then
      select full_name, phone, profile_id into v_cname, v_cphone, v_cust_profile from public.customers where id = v_cust and active = true;
      if not found then raise exception 'CUSTOMER_INEXISTENTE: customer inexistente o inactivo'; end if;
      if p_doctor_id is not null
         and v_cust_profile is distinct from p_doctor_id
         and (v_cust_profile is not null or exists (select 1 from public.customers c where c.profile_id = p_doctor_id)) then
        raise exception 'PAR_INCONSISTENTE: el comprador y la cuenta comercial no corresponden';
      end if;
    end if;
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'El pedido no tiene renglones';
  end if;
  if exists (select 1 from public.orders where id = p_order_id) then
    return (select jsonb_build_object('order_id', o.id, 'total', o.total, 'folio', o.external_ref, 'idempotent', true)
            from public.orders o where o.id = p_order_id);
  end if;

  if p_doctor_id is not null then
    select price_list_id into list from public.profiles where id = p_doctor_id;
  end if;

  for ln in select * from jsonb_array_elements(p_lines) loop
    pid := nullif(ln ->> 'product_id','')::uuid;
    q   := (ln ->> 'qty')::int;
    if pid is null then raise exception 'Producto inválido'; end if;
    if q is null or q <= 0 then raise exception 'Cantidad inválida (debe ser > 0)'; end if;
    select active into act from public.products where id = pid;
    if not found then raise exception 'Producto % no existe', pid; end if;
    if act is not true then raise exception 'Producto % no está activo', pid; end if;
    up := public.precio_de(pid, list, q);   -- ← precio autorizado con CANTIDAD (volumen)
    if up is null then raise exception 'Producto % sin precio válido', pid; end if;
    tot := tot + up * q;
    out_items := out_items || jsonb_build_array(jsonb_build_object('product_id', pid, 'qty', q, 'unit_price', up));
  end loop;

  -- CX-0b · el snapshot del cliente lo escribe SOLO el servidor (el que venga del navegador se descarta).
  -- CX-0c · lo mismo la ATRIBUCIÓN: seller / seller_profile_id / seller_origen / placed_by del navegador se descartan.
  v_meta := p_shipping_meta - 'customer' - 'seller' - 'seller_profile_id' - 'seller_origen' - 'placed_by';
  if v_cust is not null then
    v_meta := jsonb_set(coalesce(v_meta, '{}'::jsonb), '{customer}', jsonb_build_object('id', v_cust, 'name', v_cname, 'phone', v_cphone), true);
  end if;
  -- CX-0c · D2: vendedor = cartera (el capturista NO es vendedor). Sin asignación válida o no resoluble → sin vendedor.
  v_attr := public._cx0c_atribucion(v_cust, p_doctor_id);
  v_meta := coalesce(v_meta, '{}'::jsonb) || case when v_attr ->> 'estado' = 'cartera'
      then jsonb_build_object('seller', v_attr ->> 'seller', 'seller_profile_id', v_attr ->> 'seller_profile_id', 'seller_origen', 'cartera')
      else jsonb_build_object('seller_origen', case when v_attr ->> 'estado' = 'no_resoluble' then 'no_resoluble' else 'sin_vendedor' end) end;
  -- CX-0c · D4/D5: capturista del SERVIDOR. «Checkout canónico (CC-6)» solo si el checkout canónico marcó ESTE pedido
  -- (app.cc_checkout_pedido = p_order_id, fijado por cc_checkout_confirmar justo antes y borrado justo después).
  if public.auth_role() = 'doctor' then
    v_placed := case when current_setting('app.cc_checkout_pedido', true) = p_order_id::text
                     then 'Checkout canónico (CC-6)' else 'Pedido directo del portal' end;
  elsif public.auth_role() = 'admin' then
    v_placed := 'Administración';
  else
    select coalesce(nullif(btrim(full_name), ''), 'Ventas') || ' (Ventas)' into v_placed from public.profiles where id = auth.uid();
  end if;
  v_meta := v_meta || jsonb_build_object('placed_by', coalesce(v_placed, 'Ventas'));

  -- FOLIO: el del cliente solo si viene y no existe; si no, el del servidor (único, no reciclable).
  -- Ante una colisión CONCURRENTE (dos clientes con el mismo folio, o la secuencia alcanzando un folio
  -- histórico), el índice único lo detecta y se reintenta con folio del servidor: nunca un duplicado,
  -- nunca un pedido perdido.
  v_folio := nullif(btrim(coalesce(p_folio, '')), '');
  if v_folio is null or exists (select 1 from public.orders where external_ref = v_folio) then v_folio := public.siguiente_folio(); end if;
  for v_intento in 1..5 loop
    begin
      insert into public.orders (id, external_ref, doctor_id, customer_id, total, currency, status, payment_method, payment_status, invoice_requested, shipping_meta)
      values (p_order_id, v_folio, p_doctor_id, v_cust, tot, 'MXN', 'pending_payment', 'contra_pedido', 'pending', coalesce(p_invoice_requested, false), v_meta);
      exit;
    exception when unique_violation then
      if v_intento = 5 then raise; end if;
      v_folio := public.siguiente_folio();
    end;
  end loop;

  insert into public.order_items (order_id, product_id, qty, unit_price)
  select p_order_id, (i->>'product_id')::uuid, (i->>'qty')::int, (i->>'unit_price')::numeric
  from jsonb_array_elements(out_items) i;

  return jsonb_build_object('order_id', p_order_id, 'folio', v_folio, 'total', tot, 'items', out_items);
end;
$function$;

CREATE OR REPLACE FUNCTION public.vender_pos(p_order_id uuid, p_folio text, p_total numeric, p_payment_method text, p_doctor_id uuid, p_shipping_meta jsonb, p_lines jsonb, p_allocations jsonb, p_invoice_requested boolean DEFAULT false, p_invoice_meta jsonb DEFAULT NULL::jsonb, p_customer_id uuid DEFAULT NULL::uuid, p_efectivo_recibido numeric DEFAULT NULL::numeric, p_custody_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_req jsonb; v_prev jsonb;
  a record; ln record; v_nlines int; qty int; pid uuid; up numeric; tot numeric := 0;
  v_items uuid[] := '{}'; v_item uuid; v_bad int;
  v_cname text; v_cphone text; v_meta jsonb; v_metodo text;
  v_cus record; v_falta record;
  v_cust_profile uuid;
  v_attr jsonb; v_cajero_email text;
  v_inv jsonb;
begin
  if not (public.auth_role() = any (array['admin','pos'])) then
    raise exception 'No autorizado';
  end if;
  v_req := jsonb_build_object('folio', p_folio, 'total', p_total, 'payment_method', p_payment_method,
             'doctor', p_doctor_id, 'shipping_meta', p_shipping_meta, 'lines', p_lines, 'allocations', p_allocations,
             'invoice_requested', p_invoice_requested, 'invoice_meta', p_invoice_meta, 'customer', p_customer_id,
             'custody', p_custody_id);
  v_prev := public._w1_op_begin(p_order_id, 'venta_pos', v_req);
  if v_prev is not null then return true; end if;  -- ya aplicada: éxito idempotente

  -- SEC-C4-FISCAL-2 · el receptor fiscal lo valida y lo normaliza el SERVIDOR, aquí: después de la idempotencia y ANTES
  -- de cualquier escritura (pedido, inventario, custodia, cobro). Se persiste solo {receiver:{6 campos}}; cualquier otra
  -- clave (status, uuid, fechas de timbrado…) se rechaza. Sin factura solicitada, lo recibido se ignora (v_inv NULL).
  -- La huella de idempotencia (v_req) sigue calculándose sobre la ENTRADA recibida: los reintentos no cambian.
  v_inv := public._fiscal_entrada_pos(p_invoice_requested, p_invoice_meta);

  if p_customer_id is not null then
    select full_name, phone, profile_id into v_cname, v_cphone, v_cust_profile from public.customers where id = p_customer_id and active = true;
    if not found then raise exception 'CUSTOMER_INEXISTENTE: customer inexistente o inactivo'; end if;
  end if;
  -- CX-0b · comprador opcional (NULL = mostrador / cuenta histórica sin portal). Si viene, debe ser un comprador real
  -- (perfil doctor) y la pareja con la cuenta debe ser coherente: la cuenta ligada a ese comprador, o una cuenta sin
  -- portal cuando el comprador no tiene cuenta ligada. Misma regla que crear_pedido (personal).
  --   ⇢ B2B-3: la coherencia pasa a ser membresía activa del comprador en la cuenta con permiso de compra.
  if p_doctor_id is not null then
    if not exists (select 1 from public.profiles where id = p_doctor_id and role_id = 'doctor') then
      raise exception 'COMPRADOR_INVALIDO: el comprador indicado no es válido';
    end if;
    if p_customer_id is not null
       and v_cust_profile is distinct from p_doctor_id
       and (v_cust_profile is not null or exists (select 1 from public.customers c where c.profile_id = p_doctor_id)) then
      raise exception 'PAR_INCONSISTENTE: el comprador y la cuenta comercial no corresponden';
    end if;
  end if;
  if exists (select 1 from public.orders where id = p_order_id) then
    raise exception 'PEDIDO_EXISTENTE: el id % ya pertenece a otro pedido', p_order_id;
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'VENTA_SIN_RENGLONES';
  end if;
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'ASIGNACIONES_REQUERIDAS';
  end if;
  v_nlines := jsonb_array_length(p_lines);
  v_metodo := case when p_payment_method in ('efectivo','tarjeta','transferencia','stripe') then p_payment_method else 'otro' end;

  for ln in select value as j, ordinality as n from jsonb_array_elements(p_lines) with ordinality loop
    pid := nullif(ln.j ->> 'product_id', '')::uuid; qty := (ln.j ->> 'qty')::int;
    if pid is null then raise exception 'Producto inválido'; end if;
    if qty is null or qty <= 0 then raise exception 'Cantidad inválida'; end if;
    up := public.precio_de(pid, null, qty);
    if up is null then raise exception 'Producto % sin precio válido', pid; end if;
    tot := tot + up * qty;
  end loop;

  for a in
    select x.line_index, x.lot_id, x.qty, l.product_id as lot_product, l.expiry_date,
           nullif(p_lines -> x.line_index ->> 'product_id', '')::uuid as line_product
      from jsonb_to_recordset(p_allocations) as x(line_index int, lot_id uuid, qty int)
      left join public.lots l on l.id = x.lot_id
  loop
    if a.line_index is null or a.line_index < 0 or a.line_index >= v_nlines then
      raise exception 'ASIGNACION_INVALIDA: renglón % inexistente', a.line_index;
    end if;
    if a.qty is null or a.qty <= 0 then raise exception 'CANTIDAD_INVALIDA: cada asignación debe ser mayor a cero'; end if;
    if a.lot_product is null then raise exception 'LOTE_INEXISTENTE: %', a.lot_id; end if;
    if a.lot_product <> a.line_product then raise exception 'LOTE_DE_OTRO_PRODUCTO: el lote % no es del producto del renglón', a.lot_id; end if;
    if public.lote_caducado(a.expiry_date) then raise exception 'LOTE_CADUCADO: el lote % caducó el %', a.lot_id, a.expiry_date; end if;
  end loop;
  select count(*) into v_bad
    from generate_series(0, v_nlines - 1) g(i)
    left join (select x.line_index, sum(x.qty) s from jsonb_to_recordset(p_allocations) as x(line_index int, lot_id uuid, qty int)
                group by 1) s on s.line_index = g.i
   where coalesce(s.s, 0) <> (p_lines -> g.i ->> 'qty')::int;
  if v_bad > 0 then raise exception 'ASIGNACION_INCOMPLETA: % renglón(es) no cuadran con la cantidad vendida', v_bad; end if;

  -- W2-C · VENTA DESDE CUSTODIA. Todo lo anterior (precio del servidor, lote vigente,
  -- asignaciones completas) ya se validó igual que en mostrador; aquí solo se añade lo
  -- propio de la custodia. El cerrojo de la custodia serializa dos ventas simultáneas
  -- del mismo saldo.
  if p_custody_id is not null then
    select * into v_cus from public.custodies where id = p_custody_id for update;
    if not found then raise exception 'CUSTODIA_INEXISTENTE'; end if;
    if v_cus.status <> 'abierta' then raise exception 'CUSTODIA_CERRADA: esa custodia ya se cerró'; end if;
    -- SEC-C2b · comparación NULL-safe: con titular "tercero" (holder_user_id NULL) la igualdad daba NULL y CUALQUIER pos
    -- vendía de esa custodia. Vende Dirección o el titular-usuario; correo, teléfono, cartera, Odoo o customers.profile_id NO autorizan.
    if not (public.auth_role() = 'admin' or coalesce(v_cus.holder_user_id = v_uid, false)) then
      raise exception 'NO_AUTORIZADO: solo el tenedor de la custodia (o Dirección) vende de ella';
    end if;
    -- Cada lote asignado tiene que estar EN PODER de esa custodia, y alcanzar.
    -- Se agrega por lote: una venta puede partir un renglón en dos lotes y dos
    -- renglones pueden tocar el mismo lote.
    select x.lot_id, sum(x.qty)::int as pedido, public.custody_held_en(p_custody_id, x.lot_id) as en_poder
      into v_falta
      from jsonb_to_recordset(p_allocations) as x(line_index int, lot_id uuid, qty int)
     group by x.lot_id
    having sum(x.qty) > public.custody_held_en(p_custody_id, x.lot_id)
     limit 1;
    if found then
      raise exception 'CUSTODIA_SALDO_INSUFICIENTE: del lote % tienes % y la venta pide %',
        v_falta.lot_id, v_falta.en_poder, v_falta.pedido;
    end if;
  end if;

  if p_efectivo_recibido is not null and v_metodo = 'efectivo' and p_efectivo_recibido < tot then
    raise exception 'EFECTIVO_INSUFICIENTE: recibido % para un total de %', p_efectivo_recibido, tot;
  end if;

  -- CX-0b · el snapshot del cliente lo escribe SOLO el servidor (el que venga del navegador se descarta).
  -- CX-0c · la atribución también: el seller que mande la caja se ignora; placed_by no aplica en mostrador.
  v_meta := p_shipping_meta - 'customer' - 'seller' - 'seller_profile_id' - 'seller_origen' - 'placed_by';
  -- CX-0c · D3: 1) vendedor de cartera válido; 2) sin asignación → cajero AUTENTICADO; 3) no resoluble → sin vendedor
  -- (nunca se usa al cajero para encubrir una relación comercial incierta). Mostrador sin cuenta ni comprador → cajero.
  if p_customer_id is null and p_doctor_id is null then
    v_attr := jsonb_build_object('estado', 'sin_asignacion');
  else
    v_attr := public._cx0c_atribucion(p_customer_id, p_doctor_id);
  end if;
  select email into v_cajero_email from public.profiles where id = v_uid;
  v_meta := coalesce(v_meta, '{}'::jsonb) || case v_attr ->> 'estado'
      when 'cartera' then jsonb_build_object('seller', v_attr ->> 'seller', 'seller_profile_id', v_attr ->> 'seller_profile_id', 'seller_origen', 'cartera')
      when 'sin_asignacion' then jsonb_build_object('seller', v_cajero_email, 'seller_profile_id', v_uid, 'seller_origen', 'pos_cajero')
      else jsonb_build_object('seller_origen', 'no_resoluble') end;
  if p_customer_id is not null then
    v_meta := jsonb_set(coalesce(v_meta, '{}'::jsonb), '{customer}', jsonb_build_object('id', p_customer_id, 'name', v_cname, 'phone', v_cphone), true);
  end if;

  -- El POS cobra al momento: payment_status='paid' queda respaldado por el asiento de abajo.
  insert into public.orders (id, external_ref, doctor_id, customer_id, total, currency, status, payment_method, payment_status, invoice_requested, invoice_meta, shipping_meta)
  values (p_order_id, p_folio, p_doctor_id, p_customer_id, tot, 'MXN', 'delivered', p_payment_method, 'paid', coalesce(p_invoice_requested, false), v_inv, v_meta);

  for ln in select value as j, ordinality as n from jsonb_array_elements(p_lines) with ordinality loop
    pid := (ln.j ->> 'product_id')::uuid; qty := (ln.j ->> 'qty')::int;
    insert into public.order_items (order_id, product_id, lot_id, qty, unit_price)
    values (p_order_id, pid,
            (select (e.j ->> 'lot_id')::uuid from jsonb_array_elements(p_allocations) with ordinality as e(j, k)
              where (e.j ->> 'line_index')::int = ln.n - 1 order by e.k limit 1),
            qty, public.precio_de(pid, null, qty))
    returning id into v_item;
    v_items := v_items || v_item;
  end loop;

  perform 1 from public.lots
   where id in (select x.lot_id from jsonb_to_recordset(p_allocations) as x(line_index int, lot_id uuid, qty int))
   order by id for update;

  -- W2-C: el libro de custodia se escribe ANTES del descuento. Así `custody_held` ya
  -- refleja que esas unidades dejaron de estar en poder del tenedor y el descuento de
  -- abajo usa EXACTAMENTE la misma condición que una venta de mostrador: una sola
  -- semántica de disponibilidad, sin excepciones ni banderas.
  if p_custody_id is not null then
    insert into public.custody_lines (id, custody_id, kind, product_id, lot_id, qty, held_delta,
                                      unit_price, order_id, order_item_id, actor, actor_role, op_id)
    select gen_random_uuid(), p_custody_id, 'venta', l.product_id, x.lot_id, x.qty, -x.qty,
           public.precio_de(l.product_id, null, (p_lines -> x.line_index ->> 'qty')::int),
           p_order_id, v_items[x.line_index + 1], v_uid, coalesce(public.auth_role(), ''), p_order_id
      from jsonb_to_recordset(p_allocations) as x(line_index int, lot_id uuid, qty int)
      join public.lots l on l.id = x.lot_id;
  end if;

  for a in select x.line_index, x.lot_id, x.qty from jsonb_to_recordset(p_allocations) as x(line_index int, lot_id uuid, qty int) loop
    -- W2-C · W2-X1: se descuenta contra la DISPONIBILIDAD (propio − en custodia).
    update public.lots set quantity = quantity - a.qty
     where id = a.lot_id and quantity - a.qty >= public.custody_held(a.lot_id);
    if not found then
      if exists (select 1 from public.lots l where l.id = a.lot_id and l.quantity >= a.qty) then
        raise exception 'CUSTODIA_EN_PODER: el lote % tiene % unidades en custodia; disponibles %',
          a.lot_id, public.custody_held(a.lot_id),
          (select l.quantity - public.custody_held(l.id) from public.lots l where l.id = a.lot_id);
      end if;
      raise exception 'Inventario insuficiente en el lote %', a.lot_id;
    end if;
    insert into public.inventory_movements (lot_id, change, reason, reference, created_by, op_id, order_id, order_item_id)
    values (a.lot_id, -a.qty, 'venta', p_folio, v_uid, p_order_id, p_order_id, v_items[a.line_index + 1]);
  end loop;

  -- W2 · F-1: el cobro de mostrador nace como ASIENTO en el libro, en esta misma
  -- transacción. El efectivo recibido queda como evidencia para el corte de caja.
  perform public._w2_asiento(gen_random_uuid(), p_order_id, 'in', v_metodo, tot, public.hoy_local(),
    null, null, null, null,
    case when v_metodo = 'efectivo' and p_efectivo_recibido is not null
         then format('recibido=%s;cambio=%s', p_efectivo_recibido, p_efectivo_recibido - tot) end);

  perform public._w1_op_finish(p_order_id, 'venta_pos', v_req,
    jsonb_build_object('status', 'applied', 'order_id', p_order_id, 'total', tot));
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_cotizacion_crear(p_customer uuid, p_lineas jsonb, p_notas text DEFAULT NULL::text, p_conversation uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare cu record; v_list uuid; l jsonb; pr record; q int; up numeric; v_lineas jsonb := '[]'::jsonb; v_sub numeric := 0; v_id uuid; r public.cotizaciones;
begin
  perform public._cot_exige(p_customer);
  select id, profile_id, active into cu from public.customers where id = p_customer;
  if not cu.active then raise exception 'CLIENTE_INACTIVO' using errcode = 'check_violation'; end if;
  if p_conversation is not null and not (public._cc_puede_ver_conv(p_conversation)
       and exists (select 1 from public.cc_conversations c where c.id = p_conversation and (c.customer_id = p_customer or (c.profile_id is not null and c.profile_id = cu.profile_id)))) then
    raise exception 'CONVERSACION_AJENA: la conversación no es de este cliente' using errcode = 'check_violation';
  end if;
  if jsonb_typeof(p_lineas) <> 'array' or jsonb_array_length(p_lineas) = 0 or jsonb_array_length(p_lineas) > 60 then raise exception 'LINEAS_INVALIDAS' using errcode = 'check_violation'; end if;
  v_list := (select p.price_list_id from public.profiles p where p.id = cu.profile_id);
  for l in select * from jsonb_array_elements(p_lineas) loop
    q := (l ->> 'qty')::int;
    if q is null or q < 1 or q > 999 then raise exception 'LINEAS_INVALIDAS: cantidad' using errcode = 'check_violation'; end if;
    select id, name, sku, price, active, sellable into pr from public.products where id = (l ->> 'product_id')::uuid;
    if not found or not coalesce(pr.active, false) or pr.sellable is false or pr.price is null then raise exception 'PRODUCTO_NO_DISPONIBLE: %', coalesce(pr.name, l ->> 'product_id') using errcode = 'check_violation'; end if;
    up := public.precio_de(pr.id, v_list, q);
    v_lineas := v_lineas || jsonb_build_array(jsonb_build_object('product_id', pr.id, 'nombre', pr.name, 'sku', pr.sku, 'qty', q, 'unit_price', up, 'precio_lista', pr.price, 'subtotal', round(up * q, 2)));
    v_sub := v_sub + round(up * q, 2);
  end loop;
  insert into public.cotizaciones (customer_id, conversation_id, seller_profile_id, vigente_hasta, lineas, subtotal, total, notas, created_by)
  values (p_customer, p_conversation, coalesce(public._cc_vendedor_de_cliente(p_customer), case when public.auth_role() = 'pos' then auth.uid() end),
          now() + interval '7 days', v_lineas, v_sub, v_sub, nullif(btrim(coalesce(p_notas, '')), ''), auth.uid())
  returning * into r;
  return to_jsonb(r);
end;
$function$;

CREATE OR REPLACE FUNCTION public.cc_ia_precio(p_profile uuid, p_product uuid, p_qty integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare ctx jsonb; v_list uuid; v_qty int := least(greatest(coalesce(p_qty, 1), 1), 999); v_unit numeric; v_base numeric; prod record; v_normal numeric; v_promo jsonb; v_promo_unit numeric;
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
  select coalesce((select pp.price from public.product_prices pp where pp.product_id = p_product and pp.list_id = v_list), (select pr.price from public.products pr where pr.id = p_product)) into v_normal;
  v_promo := public._promo_info(p_product, v_list);
  v_promo_unit := public._promo_precio(p_product, v_list, v_qty);
  return jsonb_build_object('autorizado', true, 'product_id', prod.id, 'nombre', prod.name, 'cantidad', v_qty, 'precio_unitario', v_unit, 'total', round(v_unit * v_qty, 2), 'moneda', 'MXN',
    'por_volumen', v_unit < v_base,
    'lista', (select l.name from public.price_lists l where l.id = v_list),
    'escalas', (select coalesce(jsonb_agg(jsonb_build_object('desde', pv.min_quantity, 'precio', pv.price) order by pv.min_quantity), '[]'::jsonb) from public.product_volume_prices pv where pv.product_id = p_product and pv.active),
    'precio_normal', v_normal,
    'en_promocion', v_promo is not null and v_promo_unit is not null and v_unit = v_promo_unit and v_unit < coalesce(v_normal, v_unit + 1),
    'promocion', v_promo);
end;
$function$;

CREATE OR REPLACE FUNCTION public._cc_chk_lineas(p_cart uuid, p_profile uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare it record; pr jsonb; disp jsonb; lineas jsonb := '[]'::jsonb; problemas jsonb := '[]'::jsonb; total numeric := 0; huella text := ''; n int := 0;
begin
  for it in select i.product_id, i.quantity, p.name, p.active, p.sellable, p.show_portal, p.show_landing
              from public.cc_cart_items i join public.products p on p.id = i.product_id where i.cart_id = p_cart order by i.product_id loop
    n := n + 1;
    if not it.active or not it.sellable or not (it.show_portal or it.show_landing) then problemas := problemas || jsonb_build_object('product_id', it.product_id, 'problema', 'NO_VENDIBLE'); continue; end if;
    if it.quantity < 1 or it.quantity > 999 then problemas := problemas || jsonb_build_object('product_id', it.product_id, 'problema', 'CANTIDAD_INVALIDA'); continue; end if;
    pr := public.cc_ia_precio(p_profile, it.product_id, it.quantity);
    if not coalesce((pr ->> 'autorizado')::boolean, false) then problemas := problemas || jsonb_build_object('product_id', it.product_id, 'problema', coalesce(pr ->> 'motivo', 'SIN_PRECIO')); continue; end if;
    disp := public.cc_ia_disponibilidad(p_profile, it.product_id);
    if coalesce(disp ->> 'estado', '') <> 'disponible' then problemas := problemas || jsonb_build_object('product_id', it.product_id, 'problema', 'SIN_DISPONIBILIDAD'); end if;   -- D-CC6-04: bloquea todo
    lineas := lineas || jsonb_build_object('product_id', it.product_id, 'qty', it.quantity, 'nombre', it.name, 'precio_unitario', (pr ->> 'precio_unitario')::numeric, 'subtotal', (pr ->> 'total')::numeric);
    total := total + (pr ->> 'total')::numeric;
    huella := huella || it.product_id::text || ':' || it.quantity || ':' || (pr ->> 'precio_unitario') || ';';
  end loop;
  if n = 0 then problemas := problemas || '"CARRITO_VACIO"'::jsonb; end if;
  return jsonb_build_object('ok', jsonb_array_length(problemas) = 0, 'lineas', lineas, 'total', round(total, 2), 'fingerprint', md5(huella), 'problemas', problemas, 'n_items', n);
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

drop function if exists public._cc_precio_vol(uuid, uuid, integer, integer);
drop function if exists public.precio_de(uuid, uuid, integer, integer);
drop function if exists public._qty_volumen_carrito(uuid);
drop function if exists public._qty_volumen(jsonb);
alter table public.product_volume_prices drop constraint if exists ck_pvp_nivel;
alter table public.product_volume_prices drop column if exists nivel;
