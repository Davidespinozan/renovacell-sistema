-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- CX-0c (migración 137) · INTEGRIDAD DE LA ATRIBUCIÓN COMERCIAL DEL PEDIDO (Seller Snapshot Integrity)
--   Hallazgos (auditoría CX-0c, confirmados en cluster desechable): el doctor fijaba el vendedor por RPC directa y lo
--   cambiaba en pendiente; Dirección/facturación/almacén/empaque/service_role lo cambiaban en cualquier estado; la caja
--   atribuía la venta a quien quisiera; cambiarlo ocultaba el pedido a su vendedor y lo mostraba a otro POS.
--   Decisiones (Dirección): D1 atribución congelada sin excepción · D2 Ventas → vendedor de cartera (el capturista no es
--   vendedor) · D3 POS: cartera > cajero autenticado; no resoluble → sin vendedor; mostrador → cajero · D4 capturista
--   del servidor y congelado · D5 conservar literal «Checkout canónico (CC-6)». DX-1: sin equivalencia Odoo → no resoluble.
--   Cambios:
--     · _cx0c_atribucion(cuenta, comprador): resolución determinista contra cc_cartera (fuente de verdad, por persona).
--       Interna: sin EXECUTE para la API.
--     · crear_pedido / vender_pos: descartan seller, seller_profile_id, seller_origen y placed_by del navegador y los
--       escriben desde el servidor. Precio, folio, inventario, caja, idempotencia y CX-0b intactos.
--     · cc_checkout_confirmar: marca transaccional app.cc_checkout_pedido = id del pedido que va a crear (y la borra al
--       volver) → solo ese pedido recibe «Checkout canónico (CC-6)». Ninguna función expuesta fija GUCs con nombre
--       dinámico ni esta GUC (verificado en producción); PostgREST solo fija request.*.
--     · orders_guard: seller, seller_profile_id, seller_origen y placed_by inmutables para todos, antes de cualquier atajo.
--     · orders_select_scoped (rama pos): vendedor por seller_profile_id; histórico solo-email por seller (solo si el pedido
--       no trae id canónico); o el cajero que HIZO la venta POS (_cx0c_venta_pos_propia: operación W1 'venta_pos' con
--       op_id = id del pedido y actor = auth.uid(), escrita por vender_pos en la misma transacción; libro append-only).
--       R1: NUNCA por haber registrado un cobro (registrar_cobro lo permite a pos sobre cualquier pedido → F1).
--   No toca datos, cartera, pagos, inventario, CFDI ni pedidos existentes. Sin tablas nuevas.
--   Rollback: supabase/rollback/cx0c/99_down.sql (vuelve a CX-0b; no reabre CX-0b).
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if md5(pg_get_functiondef('public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)'::regprocedure)) <> '0de9f17fbe0a9e1efeb0ebcb6ada55d1'
     or md5(pg_get_functiondef('public.orders_guard()'::regprocedure)) <> '3dcc8ade6c0107d77d2c07b7830f8e6b'
     or md5(pg_get_functiondef('public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure)) <> '0bf3c975bb998fa0685fd36def671f0f'
     or md5(pg_get_functiondef('public.cc_checkout_confirmar(uuid,text,integer,boolean,uuid)'::regprocedure)) <> '9e8af913a8cbe42f26a80ffa6db98823' then
    raise exception 'CX-0c: alguna función no es la versión CX-0b esperada (ya aplicada o drift en producción)';
  end if;
  if (select md5(qual) from pg_policies where schemaname = 'public' and tablename = 'orders' and policyname = 'orders_select_scoped') <> '11eed2578d4cec08ec2fa114ae747a27' then
    raise exception 'CX-0c: orders_select_scoped no es la política esperada';
  end if;
  if to_regprocedure('public._cx0c_atribucion(uuid,uuid)') is not null or to_regprocedure('public._cx0c_venta_pos_propia(uuid)') is not null or to_regprocedure('public._cx0c_cobro_propio(uuid)') is not null then raise exception 'CX-0c: ya aplicada'; end if;
end $pre$;

-- 0) Resolución de cartera (determinista). Persona P = la ligada a la cuenta (customers.profile_id); sin cuenta, el comprador.
--    cartera       : P tiene fila en cc_cartera y el vendedor está activo y es de ventas (pos).
--    no_resoluble  : vendedor de cartera inactivo / no pos; o cuenta sin portal con señal comercial (vendedor Odoo en
--                    texto sin equivalencia aplicada, o comprador con cartera propia); o cuenta ligada sin cartera canónica
--                    pero con vendedor Odoo en texto.
--    sin_asignacion: todo lo demás. Nunca infiere por correo, teléfono, nombre ni datos fiscales.
--    ⇢ B2B-3: P pasa a ser la cuenta (membresía); los estados no cambian.
create or replace function public._cx0c_atribucion(p_customer uuid, p_doctor uuid) returns jsonb
  language plpgsql stable set search_path = public as
$$
declare v_p uuid; v_odoo text; v_seller uuid; v_ok boolean; v_email text;
begin
  if p_customer is not null then
    select c.profile_id, nullif(btrim(c.seller_name), '') into v_p, v_odoo from public.customers c where c.id = p_customer;
    if v_p is null then   -- cuenta sin portal
      if v_odoo is not null or (p_doctor is not null and exists (select 1 from public.cc_cartera k where k.profile_id = p_doctor)) then
        return jsonb_build_object('estado', 'no_resoluble');
      end if;
      return jsonb_build_object('estado', 'sin_asignacion');
    end if;
  else
    v_p := p_doctor;
  end if;
  if v_p is null then return jsonb_build_object('estado', 'sin_asignacion'); end if;
  select k.seller_profile_id into v_seller from public.cc_cartera k where k.profile_id = v_p;
  if v_seller is null then
    return jsonb_build_object('estado', case when v_odoo is not null then 'no_resoluble' else 'sin_asignacion' end);
  end if;
  select coalesce(p.active, false) and p.role_id = 'pos', p.email into v_ok, v_email from public.profiles p where p.id = v_seller;
  if not coalesce(v_ok, false) then return jsonb_build_object('estado', 'no_resoluble'); end if;
  return jsonb_build_object('estado', 'cartera', 'seller_profile_id', v_seller, 'seller', v_email);
end;
$$;
comment on function public._cx0c_atribucion(uuid, uuid) is 'CX-0c · Atribución comercial del pedido desde cc_cartera: cartera | sin_asignacion | no_resoluble. Interna (sin EXECUTE para la API).';
revoke all on function public._cx0c_atribucion(uuid, uuid) from public, anon, authenticated;

-- 1) crear_pedido · CX-0b + atribución y capturista del servidor.
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
comment on function public.crear_pedido(uuid, text, uuid, jsonb, jsonb, boolean, uuid) is 'CX-0b/CX-0c · Pedido canónico (W1). Cuenta, snapshot del cliente, vendedor (cartera) y capturista decididos en el servidor.';
revoke all on function public.crear_pedido(uuid, text, uuid, jsonb, jsonb, boolean, uuid) from public, anon;
grant execute on function public.crear_pedido(uuid, text, uuid, jsonb, jsonb, boolean, uuid) to authenticated;

-- 2) vender_pos · CX-0b + D3 (cartera > cajero autenticado; no resoluble → sin vendedor).
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
    if not (public.auth_role() = 'admin' or v_cus.holder_user_id = v_uid) then
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
  values (p_order_id, p_folio, p_doctor_id, p_customer_id, tot, 'MXN', 'delivered', p_payment_method, 'paid', coalesce(p_invoice_requested, false), p_invoice_meta, v_meta);

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
comment on function public.vender_pos(uuid, text, numeric, text, uuid, jsonb, jsonb, jsonb, boolean, jsonb, uuid, numeric, uuid) is 'CX-0b/CX-0c · Venta de mostrador. Comprador opcional coherente; vendedor = cartera, si no hay asignación el cajero autenticado; no resoluble → sin vendedor.';
revoke all on function public.vender_pos(uuid, text, numeric, text, uuid, jsonb, jsonb, jsonb, boolean, jsonb, uuid, numeric, uuid) from public, anon;
grant execute on function public.vender_pos(uuid, text, numeric, text, uuid, jsonb, jsonb, jsonb, boolean, jsonb, uuid, numeric, uuid) to authenticated;

-- 3) cc_checkout_confirmar · marca de procedencia ligada al pedido (D5).
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
$function$;
comment on function public.cc_checkout_confirmar(uuid, text, integer, boolean, uuid) is 'CC-6/CX-0c · Confirmación del checkout canónico; marca transaccional por pedido para «Checkout canónico (CC-6)».';

-- 4) orders_guard · CX-0b + atribución inmutable.
CREATE OR REPLACE FUNCTION public.orders_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE r text := public.auth_role();
BEGIN
  -- CX-0b · IDENTIDAD COMERCIAL INMUTABLE. Va ANTES de cualquier salida anticipada (app.trusted, service_role,
  -- Dirección): ninguna ruta legítima cambia la cuenta, el comprador ni el snapshot del cliente de un pedido
  -- creado; corregir un error = cancelar y recrear. Comparación NULL-safe y estructural (jsonb).
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id
     OR (NEW.shipping_meta -> 'customer') IS DISTINCT FROM (OLD.shipping_meta -> 'customer') THEN
    RAISE EXCEPTION 'IDENTIDAD_PEDIDO_INMUTABLE: la cuenta, el comprador y los datos del cliente de un pedido no se modifican; cancela y crea uno nuevo'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- CX-0c · ATRIBUCIÓN COMERCIAL INMUTABLE (D1/D4): vendedor, su id, su origen y el capturista se fijan al crear el
  -- pedido y no cambian por ninguna vía (incluye app.trusted, service_role y Dirección). Sin excepción administrativa.
  IF (NEW.shipping_meta -> 'seller') IS DISTINCT FROM (OLD.shipping_meta -> 'seller')
     OR (NEW.shipping_meta -> 'seller_profile_id') IS DISTINCT FROM (OLD.shipping_meta -> 'seller_profile_id')
     OR (NEW.shipping_meta -> 'seller_origen') IS DISTINCT FROM (OLD.shipping_meta -> 'seller_origen')
     OR (NEW.shipping_meta -> 'placed_by') IS DISTINCT FROM (OLD.shipping_meta -> 'placed_by') THEN
    RAISE EXCEPTION 'ATRIBUCION_PEDIDO_INMUTABLE: el vendedor y el capturista de un pedido no se modifican'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF coalesce(current_setting('app.trusted', true), '') = 'on'
     OR coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role','') = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- W3-A · H-3: la evidencia fiscal NO la escribe el cliente. `invoice_meta` es la
  -- PROYECCIÓN de fiscal_documents y `invoice_requested` la marca la solicitud.
  -- Un fallo de red del frontend jamás puede borrar el rastro de un timbre.
  IF NEW.invoice_meta IS DISTINCT FROM OLD.invoice_meta
     OR NEW.invoice_requested IS DISTINCT FROM OLD.invoice_requested THEN
    RAISE EXCEPTION 'FISCAL_SOLO_POR_COMANDO: la factura se solicita y se timbra con los comandos del servidor (solicitar_cfdi), no editando el pedido';
  END IF;

  -- W2 · F-4: los campos financieros SOLO los escriben los comandos del servidor.
  -- Vale para todos los roles, Dirección incluida: el dinero se registra con
  -- evidencia (registrar_cobro / revisar_pago / pagar_reembolso), no a mano.
  IF NEW.payment_status IS DISTINCT FROM OLD.payment_status
     OR NEW.payment_method IS DISTINCT FROM OLD.payment_method
     OR NEW.payment_ref IS DISTINCT FROM OLD.payment_ref
     OR NEW.stripe_payment_id IS DISTINCT FROM OLD.stripe_payment_id THEN
    RAISE EXCEPTION 'PAGO_SOLO_POR_COMANDO: el estado de pago se registra con evidencia (registrar_cobro / revisar_pago / pagar_reembolso), no editando el pedido';
  END IF;

  -- W1: transiciones de inventario solo por comando; sin regresar desde empacado o posterior.
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status IN ('packed','cancelled') THEN
      RAISE EXCEPTION 'TRANSICION_SOLO_POR_COMANDO: % → % solo por comando del servidor (surtir_pedido / cancelar_pedido)', OLD.status, NEW.status;
    END IF;
    IF OLD.status IN ('packed','shipped','delivered','fulfilled')
       AND NEW.status IN ('draft','pending_payment','paid','picking') THEN
      RAISE EXCEPTION 'TRANSICION_REGRESIVA: % → % no permitido', OLD.status, NEW.status;
    END IF;
    IF (NEW.status = 'picking'   AND OLD.status IS DISTINCT FROM 'paid')
       OR (NEW.status = 'shipped'   AND OLD.status IS DISTINCT FROM 'packed')
       OR (NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'shipped')
       OR (NEW.status = 'fulfilled' AND OLD.status IS DISTINCT FROM 'delivered') THEN
      RAISE EXCEPTION 'TRANSICION_INVALIDA: % → %', OLD.status, NEW.status;
    END IF;
  END IF;

  IF r = 'admin' THEN RETURN NEW; END IF;

  IF r = 'doctor' AND OLD.doctor_id = auth.uid() THEN
    -- W2: la declaración de pago vive en payment_claims; el doctor no la fabrica en el JSON.
    IF NEW.shipping_meta -> 'transfer' IS DISTINCT FROM OLD.shipping_meta -> 'transfer' THEN
      RAISE EXCEPTION 'PAGO_SOLO_POR_COMANDO: reporta tu pago con el comando, no editando el pedido';
    END IF;
    IF OLD.status IS NOT NULL AND OLD.status NOT IN ('draft','pending_payment') THEN
      RAISE EXCEPTION 'No autorizado: el pedido ya está en proceso';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status
       AND NEW.status NOT IN ('draft','pending_payment','cancelled') THEN
      RAISE EXCEPTION 'No autorizado: el doctor no puede mover el pedido a ese estado';
    END IF;
    IF NEW.doctor_id IS DISTINCT FROM OLD.doctor_id OR NEW.total IS DISTINCT FROM OLD.total
       OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.invoice_meta IS DISTINCT FROM OLD.invoice_meta THEN
      RAISE EXCEPTION 'No autorizado: no puedes modificar campos financieros del pedido';
    END IF;
    RETURN NEW;
  END IF;

  IF r IN ('warehouse','packing') THEN
    IF NEW.doctor_id IS DISTINCT FROM OLD.doctor_id OR NEW.total IS DISTINCT FROM OLD.total
       OR NEW.invoice_meta IS DISTINCT FROM OLD.invoice_meta THEN
      RAISE EXCEPTION 'No autorizado: almacén/empaque solo actualiza estado y envío';
    END IF;
    RETURN NEW;
  END IF;

  IF r = 'billing' THEN
    IF NEW.doctor_id IS DISTINCT FROM OLD.doctor_id OR NEW.total IS DISTINCT FROM OLD.total THEN
      RAISE EXCEPTION 'No autorizado: facturación no modifica doctor ni total';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'No autorizado';
END; $function$;
comment on function public.orders_guard() is 'CX-0b/CX-0c · Cuenta, comprador, snapshot del cliente, vendedor y capturista inmutables para todos; resto W1/W2/W3-A.';

-- 5) Visibilidad POS: solo cambia la rama pos. La autoría del cajero se evalúa con un auxiliar (mismo patrón que
--    is_order_driver): sin dependencia de la política sobre tablas W1/W2 (sus rollbacks históricos siguen funcionando).
--    Fuente de autoría (R1, verificada): inventory_operations kind='venta_pos' — solo la escribe vender_pos, con
--    op_id = id del pedido que inserta en la MISMA transacción y actor = auth.uid() (_w1_op_finish, no invocable por la
--    API); authenticated no inserta/actualiza/borra ahí y el libro es append-only. Solo responde por el PROPIO llamador.
create or replace function public._cx0c_venta_pos_propia(o_id uuid) returns boolean
  language sql stable security definer set search_path = public as
$$ select auth.uid() is not null and exists (select 1 from public.inventory_operations w
                                             where w.op_id = o_id and w.kind = 'venta_pos' and w.actor = auth.uid()) $$;
comment on function public._cx0c_venta_pos_propia(uuid) is 'CX-0c-R1 · ¿El usuario actual HIZO la venta POS de este pedido? (operación W1 venta_pos; nunca por cobros).';
revoke all on function public._cx0c_venta_pos_propia(uuid) from public, anon;
grant execute on function public._cx0c_venta_pos_propia(uuid) to authenticated;

alter policy orders_select_scoped on public.orders using (
  (public.auth_role() = 'admin'::text)
  or (doctor_id = auth.uid())
  or (public.auth_role() = any (array['warehouse'::text, 'packing'::text, 'billing'::text]))
  or ((public.auth_role() = 'pos'::text) and (
        ((shipping_meta ->> 'seller_profile_id') = (auth.uid())::text)
     or (((shipping_meta ->> 'seller_profile_id') is null) and ((shipping_meta ->> 'seller'::text) = (auth.jwt() ->> 'email'::text)))
     or (public.order_vendor_email(id) = (auth.jwt() ->> 'email'::text))
     or public._cx0c_venta_pos_propia(id)))
  or ((public.auth_role() = 'driver'::text) and public.is_order_driver(id))
);

do $post$ begin
  if has_function_privilege('authenticated', 'public._cx0c_atribucion(uuid,uuid)', 'EXECUTE') or has_function_privilege('anon', 'public._cx0c_atribucion(uuid,uuid)', 'EXECUTE') then
    raise exception 'CX-0c: _cx0c_atribucion quedó expuesta a la API';
  end if;
  if has_function_privilege('anon', 'public._cx0c_venta_pos_propia(uuid)', 'EXECUTE') or to_regprocedure('public._cx0c_cobro_propio(uuid)') is not null then
    raise exception 'CX-0c-R1: auxiliar de autoría expuesto a anon o quedó el auxiliar basado en cobros';
  end if;
  if not has_function_privilege('authenticated', 'public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.cc_checkout_confirmar(uuid,text,integer,boolean,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)', 'EXECUTE') then
    raise exception 'CX-0c: permisos de las funciones comerciales alterados';
  end if;
  if has_table_privilege('authenticated', 'public.orders', 'INSERT') then raise exception 'CX-0c: reapareció INSERT directo (CX-0b)'; end if;
  if pg_get_functiondef('public.orders_guard()'::regprocedure) !~ 'IDENTIDAD_PEDIDO_INMUTABLE' then raise exception 'CX-0c: se perdió la guarda CX-0b'; end if;
  if pg_get_functiondef('public.crear_pedido(uuid,text,uuid,jsonb,jsonb,boolean,uuid)'::regprocedure) !~ 'CUENTA_NO_AUTORIZADA'
     or pg_get_functiondef('public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure) !~ 'PAR_INCONSISTENTE' then
    raise exception 'CX-0c: se perdió una validación CX-0b';
  end if;
  if (select qual from pg_policies where schemaname = 'public' and tablename = 'orders' and policyname = 'orders_select_scoped') !~ '_cx0c_venta_pos_propia' or (select qual from pg_policies where schemaname = 'public' and tablename = 'orders' and policyname = 'orders_select_scoped') ~ '(payment_entries|recorded_by|cobro)' then
    raise exception 'CX-0c: la política POS no quedó aplicada';
  end if;
end $post$;
