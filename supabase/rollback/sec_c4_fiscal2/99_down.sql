-- SEC-C4-FISCAL-2 (146) · down: restaura vender_pos y _w3_receptor EXACTAMENTE como en producción antes de la 146 y
-- elimina las dos funciones auxiliares. No toca tablas, datos, políticas, triggers ni permisos.
-- ⚠️ REABRE LOS HALLAZGOS: vender_pos vuelve a guardar invoice_meta sin validar (claves y estados arbitrarios) y un
-- receptor capturado inválido vuelve a sustituirse en silencio por el perfil del cliente. Los pedidos creados con la
-- 146 conservan su invoice_meta canónico (no se modifica ningún dato).
-- Orden: si SEC-C4-FISCAL-3 (147) está aplicada, bajarla ANTES (supabase/rollback/sec_c4_fiscal3/99_down.sql); este down lo exige.
do $pre$ begin
  -- SEC-C4-FISCAL-3 (147) valida el receptor con las funciones de la 146: si sigue activa, este down la dejaría rota
  -- (todo pedido con factura fallaría). Se baja primero la 147 (o cualquier otra función que las use).
  if exists (select 1 from pg_proc p where p.pronamespace = 'public'::regnamespace
               and p.proname not in ('_fiscal_entrada_error', '_fiscal_entrada_pos', 'vender_pos')
               and (p.proname = 'crear_pedido_con_receptor' or p.prosrc ~ '_fiscal_entrada_(error|pos)')) then
    raise exception 'SEC-C4-FISCAL-2 down: % usa la validación de la 146; revierte primero SEC-C4-FISCAL-3 (147)',
      (select string_agg(p.oid::regprocedure::text, ', ' order by 1) from pg_proc p where p.pronamespace = 'public'::regnamespace
         and p.proname not in ('_fiscal_entrada_error', '_fiscal_entrada_pos', 'vender_pos')
         and (p.proname = 'crear_pedido_con_receptor' or p.prosrc ~ '_fiscal_entrada_(error|pos)'));
  end if;
  if md5(pg_get_functiondef('public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure)) <> '643cda22dcd76283ae8225ebb6afd188'
     or md5(pg_get_functiondef('public._w3_receptor(uuid,jsonb)'::regprocedure)) <> 'bb7b1d1a51edd1cbf4e8427045fb0dcb'
     or md5(pg_get_functiondef('public._fiscal_entrada_error(jsonb)'::regprocedure)) <> 'b651a11fd4cd94040473a1aa503986c0'
     or md5(pg_get_functiondef('public._fiscal_entrada_pos(boolean,jsonb)'::regprocedure)) <> '53d053a6956644148ceffb62526c0ea1' then
    raise exception 'SEC-C4-FISCAL-2 down: las funciones no están en el estado de la 146; no se revierte sobre un estado desconocido';
  end if;
  -- Una sola sobrecarga de cada función (una segunda firma dejaría viva la versión anterior).
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('vender_pos', '_w3_receptor')) <> 2 then
    raise exception 'SEC-C4-FISCAL-2 down: hay sobrecargas inesperadas de vender_pos / _w3_receptor';
  end if;
  -- Forma: dueño, SECURITY DEFINER, search_path fijo, lenguaje, volatilidad y retorno.
  if exists (select 1 from pg_proc p where p.oid in ('public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure, 'public._w3_receptor(uuid,jsonb)'::regprocedure)
             and (p.proowner <> 'postgres'::regrole or not p.prosecdef or p.proconfig is distinct from array['search_path=public']
                  or p.prolang <> (select oid from pg_language where lanname = 'plpgsql')))
     or (select provolatile::text || ':' || prorettype::regtype::text from pg_proc where oid = 'public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure) <> 'v:boolean'
     or (select provolatile::text || ':' || prorettype::regtype::text from pg_proc where oid = 'public._w3_receptor(uuid,jsonb)'::regprocedure) <> 's:jsonb' then
    raise exception 'SEC-C4-FISCAL-2 down: cambió el dueño, SECURITY DEFINER, la volatilidad, el search_path o el retorno';
  end if;
  -- Permisos: vender_pos la ejecutan authenticated y service_role (nunca PUBLIC/anon); _w3_receptor es interna.
  if (select array_agg(a.grantee::regrole::text || ':' || a.privilege_type order by a.grantee::regrole::text)
        from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = 'public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure)
       is distinct from array['authenticated:EXECUTE', 'postgres:EXECUTE', 'service_role:EXECUTE']
     or has_function_privilege('anon', 'public._w3_receptor(uuid,jsonb)', 'execute') or has_function_privilege('authenticated', 'public._w3_receptor(uuid,jsonb)', 'execute')
     or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = 'public._w3_receptor(uuid,jsonb)'::regprocedure and a.grantee = 0) then
    raise exception 'SEC-C4-FISCAL-2 down: los permisos de vender_pos / _w3_receptor no son los auditados';
  end if;
end $pre$;

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

  -- C360-F3 · perfil fiscal PREDETERMINADO canónico del cliente (antes que cualquier legado)
  if v_cust is not null then
    select jsonb_build_object('rfc', f.rfc, 'razon_social', f.razon_social, 'regimen', f.regimen, 'cp', f.cp, 'uso_cfdi', f.uso_cfdi, 'email_facturacion', f.email_facturacion) into v_try
      from public.customer_fiscal_profiles f where f.customer_id = v_cust and f.es_predeterminado and f.activo;
    if v_try is not null and public._fiscal_error(v_try) is null then return public._fiscal_clean(v_try); end if;
  end if;

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

drop function public._fiscal_entrada_pos(boolean, jsonb);
drop function public._fiscal_entrada_error(jsonb);

do $post$ begin
  if md5(pg_get_functiondef('public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure)) <> '3b85cb0590122e4e9056455780fb7231'
     or md5(pg_get_functiondef('public._w3_receptor(uuid,jsonb)'::regprocedure)) <> '79f888d3185d4ba0e4c97802b24115c2' then
    raise exception 'SEC-C4-FISCAL-2 down: las funciones no quedaron como antes de la 146';
  end if;
  if exists (select 1 from pg_proc where pronamespace = 'public'::regnamespace and proname in ('_fiscal_entrada_error', '_fiscal_entrada_pos')) then
    raise exception 'SEC-C4-FISCAL-2 down: quedaron funciones auxiliares';
  end if;
  -- Una sola sobrecarga de cada función (una segunda firma dejaría viva la versión anterior).
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('vender_pos', '_w3_receptor')) <> 2 then
    raise exception 'SEC-C4-FISCAL-2 down: hay sobrecargas inesperadas de vender_pos / _w3_receptor';
  end if;
  -- Forma: dueño, SECURITY DEFINER, search_path fijo, lenguaje, volatilidad y retorno.
  if exists (select 1 from pg_proc p where p.oid in ('public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure, 'public._w3_receptor(uuid,jsonb)'::regprocedure)
             and (p.proowner <> 'postgres'::regrole or not p.prosecdef or p.proconfig is distinct from array['search_path=public']
                  or p.prolang <> (select oid from pg_language where lanname = 'plpgsql')))
     or (select provolatile::text || ':' || prorettype::regtype::text from pg_proc where oid = 'public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure) <> 'v:boolean'
     or (select provolatile::text || ':' || prorettype::regtype::text from pg_proc where oid = 'public._w3_receptor(uuid,jsonb)'::regprocedure) <> 's:jsonb' then
    raise exception 'SEC-C4-FISCAL-2 down: cambió el dueño, SECURITY DEFINER, la volatilidad, el search_path o el retorno';
  end if;
  -- Permisos: vender_pos la ejecutan authenticated y service_role (nunca PUBLIC/anon); _w3_receptor es interna.
  if (select array_agg(a.grantee::regrole::text || ':' || a.privilege_type order by a.grantee::regrole::text)
        from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = 'public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure)
       is distinct from array['authenticated:EXECUTE', 'postgres:EXECUTE', 'service_role:EXECUTE']
     or has_function_privilege('anon', 'public._w3_receptor(uuid,jsonb)', 'execute') or has_function_privilege('authenticated', 'public._w3_receptor(uuid,jsonb)', 'execute')
     or exists (select 1 from pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a where p.oid = 'public._w3_receptor(uuid,jsonb)'::regprocedure and a.grantee = 0) then
    raise exception 'SEC-C4-FISCAL-2 down: los permisos de vender_pos / _w3_receptor no son los auditados';
  end if;
end $post$;
