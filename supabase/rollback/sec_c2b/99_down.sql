-- SEC-C2b (142) · down: restaura estado_custodia y vender_pos EXACTAMENTE como en producción antes de la 142.
-- No toca tablas, datos, políticas, vistas ni permisos. La migración 141 (SEC-C2) no se revierte aquí.
-- ⚠️ REABRE EL P1: con una custodia de titular "tercero" (holder_user_id NULL), cualquier autenticado vuelve a leer su
-- estado completo y cualquier pos vuelve a vender desde ella. No revertir si existen custodias de terceros.
do $pre$ begin
  if md5(pg_get_functiondef('public.estado_custodia(uuid)'::regprocedure)) <> '79e390a5879eb28c1ef28c2645a0169b'
     or md5(pg_get_functiondef('public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure)) <> '3b85cb0590122e4e9056455780fb7231' then
    raise exception 'SEC-C2b down: las funciones no están en el estado SEC-C2b esperado; no se revierte sobre un estado desconocido';
  end if;
  -- Una sola sobrecarga de cada función (una segunda firma dejaría viva la versión vulnerable).
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('estado_custodia', 'vender_pos')) <> 2 then
    raise exception 'SEC-C2b down: hay sobrecargas inesperadas de estado_custodia / vender_pos';
  end if;
  -- Forma: dueño, SECURITY DEFINER, volatilidad, search_path fijo y retorno.
  if exists (select 1 from pg_proc p where p.oid in ('public.estado_custodia(uuid)'::regprocedure, 'public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure)
             and (p.proowner <> 'postgres'::regrole or not p.prosecdef or p.proconfig is distinct from array['search_path=public']
                  or p.prolang <> (select oid from pg_language where lanname = 'plpgsql')))
     or (select provolatile::text || ':' || prorettype::regtype::text from pg_proc where oid = 'public.estado_custodia(uuid)'::regprocedure) <> 's:jsonb'
     or (select provolatile::text || ':' || prorettype::regtype::text from pg_proc where oid = 'public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure) <> 'v:boolean' then
    raise exception 'SEC-C2b down: cambió el dueño, SECURITY DEFINER, la volatilidad, el search_path o el retorno';
  end if;
  -- ACL exacta: postgres, authenticated y service_role con EXECUTE; PUBLIC y anon sin él.
  if exists (select 1 from pg_proc p where p.oid in ('public.estado_custodia(uuid)'::regprocedure, 'public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure)
             and (select array_agg(a.grantee::regrole::text || ':' || a.privilege_type order by a.grantee::regrole::text)
                    from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a)
                 is distinct from array['authenticated:EXECUTE', 'postgres:EXECUTE', 'service_role:EXECUTE']) then
    raise exception 'SEC-C2b down: los permisos de estado_custodia / vender_pos no son los auditados';
  end if;
end $pre$;

CREATE OR REPLACE FUNCTION public.estado_custodia(p_custody uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_c record; v_l record;
begin
  select * into v_c from public.custodies where id = p_custody;
  if not found then raise exception 'CUSTODIA_INEXISTENTE'; end if;
  if not (public.auth_role() = any (array['admin','billing','warehouse','packing'])
          or v_c.holder_user_id = auth.uid()) then
    raise exception 'NO_AUTORIZADO';
  end if;
  select * into v_l from public.v_custody_liquidacion where custody_id = p_custody;
  return to_jsonb(v_l) || jsonb_build_object(
    'kind', v_c.kind, 'status', v_c.status, 'holder_kind', v_c.holder_kind,
    'event_name', v_c.event_name, 'opened_at', v_c.opened_at, 'closed_at', v_c.closed_at,
    'saldos', coalesce((select jsonb_agg(jsonb_build_object('product_id', s.product_id, 'lot_id', s.lot_id,
                                'entregado', s.entregado, 'vendido', s.vendido, 'devuelto', s.devuelto,
                                'perdido', s.perdido, 'en_poder', s.en_poder))
                          from public.v_custody_stock s where s.custody_id = p_custody and s.en_poder <> 0), '[]'::jsonb),
    'movimientos', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'kind', l.kind, 'lot_id', l.lot_id,
                                'qty', l.qty, 'motivo', l.motivo, 'order_id', l.order_id, 'created_at', l.created_at)
                              order by l.created_at)
                              from public.custody_lines l where l.custody_id = p_custody), '[]'::jsonb));
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

do $post$ begin
  if md5(pg_get_functiondef('public.estado_custodia(uuid)'::regprocedure)) <> '6f9172476ed18bbec738e7b545c49f5d'
     or md5(pg_get_functiondef('public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure)) <> '9ae71e2fbe55825514202b99d4bec03b' then
    raise exception 'SEC-C2b down: la restauración no es idéntica a producción';
  end if;
  -- Una sola sobrecarga de cada función (una segunda firma dejaría viva la versión vulnerable).
  if (select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('estado_custodia', 'vender_pos')) <> 2 then
    raise exception 'SEC-C2b down: hay sobrecargas inesperadas de estado_custodia / vender_pos';
  end if;
  -- Forma: dueño, SECURITY DEFINER, volatilidad, search_path fijo y retorno.
  if exists (select 1 from pg_proc p where p.oid in ('public.estado_custodia(uuid)'::regprocedure, 'public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure)
             and (p.proowner <> 'postgres'::regrole or not p.prosecdef or p.proconfig is distinct from array['search_path=public']
                  or p.prolang <> (select oid from pg_language where lanname = 'plpgsql')))
     or (select provolatile::text || ':' || prorettype::regtype::text from pg_proc where oid = 'public.estado_custodia(uuid)'::regprocedure) <> 's:jsonb'
     or (select provolatile::text || ':' || prorettype::regtype::text from pg_proc where oid = 'public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure) <> 'v:boolean' then
    raise exception 'SEC-C2b down: cambió el dueño, SECURITY DEFINER, la volatilidad, el search_path o el retorno';
  end if;
  -- ACL exacta: postgres, authenticated y service_role con EXECUTE; PUBLIC y anon sin él.
  if exists (select 1 from pg_proc p where p.oid in ('public.estado_custodia(uuid)'::regprocedure, 'public.vender_pos(uuid,text,numeric,text,uuid,jsonb,jsonb,jsonb,boolean,jsonb,uuid,numeric,uuid)'::regprocedure)
             and (select array_agg(a.grantee::regrole::text || ':' || a.privilege_type order by a.grantee::regrole::text)
                    from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a)
                 is distinct from array['authenticated:EXECUTE', 'postgres:EXECUTE', 'service_role:EXECUTE']) then
    raise exception 'SEC-C2b down: los permisos de estado_custodia / vender_pos no son los auditados';
  end if;
end $post$;
