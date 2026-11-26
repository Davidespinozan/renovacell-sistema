-- ============================================================================
-- REFERENCIA DE PAGO OPCIONAL Y REPETIBLE (26 nov 2026, dueño/Toño: «eso de la referencia no nos está funcionando,
-- solo nos retrasa»). Decisión del dueño: opcional y se puede repetir; el control queda en la revisión de Dirección.
--   · Transferencia: la referencia deja de ser obligatoria (crear pedido con cobro, cobrar pedido, punto de venta).
--   · La misma referencia puede estar en varios cobros (una transferencia que paga dos pedidos). SOLO tarjeta/Stripe
--     sigue siendo única: es el id del pago del procesador y protege contra contar dos veces (Stripe y CyberSource
--     dependen de ese índice para no duplicar).
--   · Dirección ve «Referencia repetida» en Ventas (pantalla), para revisar que no sea el mismo dinero dos veces.
-- Rollback: supabase/rollback/referencia_opcional/99_down.sql
-- ============================================================================
do $pre$ begin
  if exists (select external_ref from public.payment_entries where external_ref is not null and method in ('tarjeta', 'stripe') group by 1 having count(*) > 1) then
    raise exception 'REF-OPCIONAL: hay referencias de tarjeta repetidas; no se puede crear el índice parcial'; end if;
end $pre$;

drop index public.uq_entry_external_ref;
create unique index uq_entry_external_ref on public.payment_entries (external_ref) where external_ref is not null and method in ('tarjeta', 'stripe');
create index ix_entry_external_ref on public.payment_entries (external_ref) where external_ref is not null;

CREATE OR REPLACE FUNCTION public._venta_aplicar_cobro(p_order uuid, p_cobro jsonb, p_op_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o record; m record; v_forma text; v_monto numeric; v_ref text; v_vence date; v_motivo text; v_tipo text;
  v_res jsonb; v_metodo_pedido text; v_rec numeric; v_evid text;
begin
  if p_cobro is null or jsonb_typeof(p_cobro) <> 'object' or nullif(p_cobro ->> 'forma', '') is null then
    raise exception 'FORMA_PAGO_REQUERIDA: elige cómo paga el cliente' using errcode = 'check_violation';
  end if;
  if not public._venta_puede_cobrar(p_order) then
    raise exception 'NO_AUTORIZADO: no puedes cobrar este pedido' using errcode = 'insufficient_privilege';
  end if;
  v_forma := p_cobro ->> 'forma';
  select * into o from public.orders where id = p_order;
  if not found then raise exception 'PEDIDO_INEXISTENTE'; end if;
  if o.status = 'cancelled' then raise exception 'PEDIDO_CANCELADO: ese pedido está cancelado'; end if;
  select * into m from public.v_order_money where order_id = p_order;
  v_ref := nullif(btrim(left(coalesce(p_cobro ->> 'referencia', ''), 200)), '');
  v_motivo := nullif(btrim(left(coalesce(p_cobro ->> 'motivo', ''), 300)), '');

  if v_forma in ('efectivo', 'tarjeta', 'transferencia') then
    if coalesce(m.saldo, 0) <= 0 then raise exception 'YA_PAGADO: ese pedido ya está pagado'; end if;
    v_monto := coalesce(nullif(p_cobro ->> 'monto', '')::numeric, m.saldo);
    if v_monto <= 0 then raise exception 'MONTO_INVALIDO: el monto debe ser mayor a cero'; end if;
    -- REF-OPCIONAL (26 nov 2026, dueño): la referencia de la transferencia ya no es obligatoria.
    v_rec := nullif(p_cobro ->> 'recibido', '')::numeric;
    if v_forma = 'efectivo' and v_rec is not null then
      if v_rec < v_monto then raise exception 'EFECTIVO_INSUFICIENTE: recibido % para un cobro de %', v_rec, v_monto; end if;
      v_evid := format('recibido=%s;cambio=%s', v_rec, v_rec - v_monto);
    end if;
    v_res := public.registrar_cobro(p_op_id, p_order, v_forma, round(v_monto, 2), null, v_ref, null, v_evid);
    v_metodo_pedido := v_forma;
  elsif v_forma = 'credito' then
    v_vence := nullif(p_cobro ->> 'vence', '')::date;
    if v_vence is null then raise exception 'VENCIMIENTO_REQUERIDO: indica la fecha límite de pago'; end if;
    v_res := public.autorizar_credito(p_op_id, p_order, v_vence, coalesce(v_motivo, 'Crédito'));
    v_metodo_pedido := 'credito';
  elsif v_forma = 'al_recibir' then
    v_tipo := o.shipping_meta -> 'entrega' ->> 'tipo';
    if v_tipo is null or v_tipo not in ('local', 'recoge') then
      raise exception 'AL_RECIBIR_SOLO_LOCAL: pagar al recibir es para entrega con chofer o para recoger en sucursal; la paquetería no cobra'; end if;
    v_vence := greatest(public.hoy_local(), coalesce(nullif(o.shipping_meta -> 'entrega' ->> 'llega_hasta', '')::date, public.hoy_local()));
    v_res := public.autorizar_credito(p_op_id, p_order, v_vence,
               case when v_tipo = 'local' then 'Paga al recibir (cobra el chofer)' else 'Paga al recoger en sucursal' end);
    v_metodo_pedido := 'contra_entrega';
    -- AL-RECIBIR · cómo va a pagar al recibir (lo ve el chofer): efectivo, terminal o transferencia.
    if coalesce(p_cobro ->> 'con', '') in ('efectivo', 'tarjeta', 'transferencia') then
      perform set_config('app.trusted', 'on', true);
      update public.orders set shipping_meta = coalesce(shipping_meta, '{}'::jsonb) || jsonb_build_object('cobro_al_recibir', p_cobro ->> 'con') where id = p_order;
      perform set_config('app.trusted', '', true);
    end if;
  elsif v_forma = 'link' then
    v_res := jsonb_build_object('status', 'pendiente', 'forma', 'link');
    v_metodo_pedido := 'link_tarjeta';
  else
    raise exception 'FORMA_PAGO_INVALIDA: %', v_forma using errcode = 'check_violation';
  end if;

  -- La forma elegida queda en el pedido (el estado de pago lo recalcula el libro, no esto).
  perform set_config('app.trusted', 'on', true);
  update public.orders set payment_method = v_metodo_pedido where id = p_order and payment_method is distinct from v_metodo_pedido;
  perform set_config('app.trusted', '', true);
  return coalesce(v_res, '{}'::jsonb) || jsonb_build_object('forma', v_forma, 'payment_method', v_metodo_pedido,
           'liberado', public.pedido_liberado_para_surtir(p_order));
end;
$function$;

CREATE OR REPLACE FUNCTION public.vender_pos(p_order_id uuid, p_folio text, p_total numeric, p_payment_method text, p_doctor_id uuid, p_shipping_meta jsonb, p_lines jsonb, p_allocations jsonb, p_invoice_requested boolean DEFAULT false, p_invoice_meta jsonb DEFAULT NULL::jsonb, p_customer_id uuid DEFAULT NULL::uuid, p_efectivo_recibido numeric DEFAULT NULL::numeric, p_custody_id uuid DEFAULT NULL::uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_vq jsonb;   -- MAYOREO-REGLAS · cantidad que cuenta para el volumen (pedido completo)
  v_uid uuid := auth.uid();
  v_req jsonb; v_prev jsonb;
  a record; ln record; v_nlines int; qty int; pid uuid; up numeric; tot numeric := 0;
  v_items uuid[] := '{}'; v_item uuid; v_bad int;
  v_cname text; v_cphone text; v_meta jsonb; v_metodo text;
  v_cus record; v_falta record;
  v_cust_profile uuid;
  v_attr jsonb; v_cajero_email text;
  v_inv jsonb;
  v_cred_vence date; v_cred_motivo text; v_cobro_ref text;   -- COBRO-U
begin
  if not (public.auth_role() = any (array['admin','pos']) or (p_custody_id is not null and public._evento_es_miembro(p_custody_id, auth.uid()))) then
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
  v_vq := public._qty_volumen(p_lines);
  v_metodo := case when p_payment_method in ('efectivo','tarjeta','transferencia','stripe','credito') then p_payment_method else 'otro' end;
  -- COBRO-U · transferencia con su referencia; crédito con fecha límite (el producto sale y queda por cobrar).
  v_cobro_ref := nullif(btrim(left(coalesce(p_shipping_meta -> 'cobro' ->> 'referencia', ''), 200)), '');
  -- REF-OPCIONAL (26 nov 2026, dueño): la referencia de la transferencia ya no es obligatoria.
  if v_metodo = 'credito' then
    v_cred_vence := nullif(p_shipping_meta -> 'cobro' ->> 'vence', '')::date;
    if v_cred_vence is null then raise exception 'VENCIMIENTO_REQUERIDO: indica la fecha límite de pago'; end if;
    if v_cred_vence < public.hoy_local() then raise exception 'VENCIMIENTO_PASADO: la fecha límite no puede ser anterior a hoy'; end if;
    if v_cred_vence > public.hoy_local() + 180 then raise exception 'VENCIMIENTO_LEJANO: el crédito es de máximo 180 días'; end if;
    v_cred_motivo := coalesce(nullif(btrim(left(coalesce(p_shipping_meta -> 'cobro' ->> 'motivo', ''), 300)), ''), 'Crédito en mostrador');
  end if;

  for ln in select value as j, ordinality as n from jsonb_array_elements(p_lines) with ordinality loop
    pid := nullif(ln.j ->> 'product_id', '')::uuid; qty := (ln.j ->> 'qty')::int;
    if pid is null then raise exception 'Producto inválido'; end if;
    if qty is null or qty <= 0 then raise exception 'Cantidad inválida'; end if;
    up := public.precio_de(pid, null, qty, coalesce((v_vq ->> pid::text)::int, qty));
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
    if not (public.auth_role() = 'admin' or coalesce(v_cus.holder_user_id = v_uid, false) or public._evento_es_miembro(v_cus.id, v_uid)) then
      raise exception 'NO_AUTORIZADO: solo el equipo del evento (o Dirección) vende de esa custodia';
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
  v_meta := v_meta - 'cobro';   -- COBRO-U · los datos del cobro van al libro, no al pedido
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
  values (p_order_id, p_folio, p_doctor_id, p_customer_id, tot, 'MXN', 'delivered', p_payment_method, case when v_metodo = 'credito' then 'pending' else 'paid' end, coalesce(p_invoice_requested, false), v_inv, v_meta);

  for ln in select value as j, ordinality as n from jsonb_array_elements(p_lines) with ordinality loop
    pid := (ln.j ->> 'product_id')::uuid; qty := (ln.j ->> 'qty')::int;
    insert into public.order_items (order_id, product_id, lot_id, qty, unit_price)
    values (p_order_id, pid,
            (select (e.j ->> 'lot_id')::uuid from jsonb_array_elements(p_allocations) with ordinality as e(j, k)
              where (e.j ->> 'line_index')::int = ln.n - 1 order by e.k limit 1),
            qty, public.precio_de(pid, null, qty, coalesce((v_vq ->> pid::text)::int, qty)))
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
           public.precio_de(l.product_id, null, (p_lines -> x.line_index ->> 'qty')::int, coalesce((v_vq ->> l.product_id::text)::int, (p_lines -> x.line_index ->> 'qty')::int)),
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
  if v_metodo = 'credito' then
    -- COBRO-U · venta a crédito: sin asiento; el crédito queda en el libro de créditos y Dirección recibe aviso.
    insert into public.credit_grants (id, order_id, due_date, reason, granted_by)
    values (md5(p_order_id::text || ':credito')::uuid, p_order_id, v_cred_vence, v_cred_motivo, v_uid);
    begin
      perform public._cc_notificar('credito_vendedor', null, null, array['admin'],
        format('Crédito en mostrador por %s · venta %s · %s · paga a más tardar el %s',
               coalesce((select nullif(btrim(full_name), '') from public.profiles where id = v_uid), 'un vendedor'),
               coalesce(p_folio, 'sin folio'), to_char(tot, 'FM$999,999,990.00'), to_char(v_cred_vence, 'DD/MM/YYYY')),
        'av_fin', 'credito:' || p_order_id::text);
    exception when others then raise warning 'aviso de crédito no emitido: %', sqlerrm;
    end;
  else
  perform public._w2_asiento(gen_random_uuid(), p_order_id, 'in', v_metodo, tot, public.hoy_local(),
    null, null, v_cobro_ref, null,
    case when v_metodo = 'efectivo' and p_efectivo_recibido is not null
         then format('recibido=%s;cambio=%s', p_efectivo_recibido, p_efectivo_recibido - tot) end);
  end if;

  perform public._w1_op_finish(p_order_id, 'venta_pos', v_req,
    jsonb_build_object('status', 'applied', 'order_id', p_order_id, 'total', tot));
  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_cobro(p_op_id uuid, p_order uuid, p_method text, p_amount numeric, p_value_date date DEFAULT NULL::date, p_reference text DEFAULT NULL::text, p_bank_account_id uuid DEFAULT NULL::uuid, p_evidence text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_req jsonb; v_prev jsonb; v_o record; v_entry uuid; v_estado text; v_m record; v_srv boolean;
begin
  -- service_role = webhook del proveedor (Stripe): su notificación firmada ES la evidencia.
  v_srv := coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role';
  -- COBRO-U (23 nov 2026, dueño): Ventas también cobra, solo sus ventas (_venta_puede_cobrar).
  if not (v_srv or public._venta_puede_cobrar(p_order)) then
    raise exception 'NO_AUTORIZADO: no tienes permiso para registrar cobros';
  end if;
  v_req := jsonb_build_object('order', p_order, 'method', p_method, 'amount', p_amount,
             'value_date', p_value_date, 'reference', p_reference, 'bank', p_bank_account_id, 'evidence', p_evidence);
  v_prev := public._w2_op_begin(p_op_id, 'cobro', v_req);
  if v_prev is not null then return v_prev; end if;

  select * into v_o from public.orders where id = p_order for update;
  if not found then raise exception 'PEDIDO_INEXISTENTE'; end if;
  -- COBRO-U · el vendedor no cobra sobre cancelados ni de más (Dirección sí: F-9, el dinero que llegó se registra).
  if public.auth_role() = 'pos' then
    if v_o.status = 'cancelled' then raise exception 'PEDIDO_CANCELADO: ese pedido está cancelado; avisa a Dirección'; end if;
    if p_amount > coalesce((select m.saldo from public.v_order_money m where m.order_id = p_order), 0) + 0.009 then
      raise exception 'MONTO_MAYOR: el monto es mayor a lo que debe el pedido'; end if;
  end if;
  if p_method is null or p_method not in ('transferencia','efectivo','tarjeta','stripe','otro') then
    raise exception 'METODO_INVALIDO';
  end if;
  if p_bank_account_id is not null and not exists (
       select 1 from public.company_bank_accounts where id = p_bank_account_id and active) then
    raise exception 'CUENTA_INVALIDA: la cuenta bancaria no existe o está inactiva';
  end if;

  -- REF-OPCIONAL (26 nov 2026, dueño): solo el cobro con TARJETA no repite referencia (es el id del pago en la terminal
  -- o Stripe y así nunca se cuenta dos veces). Transferencia/efectivo/otro pueden repetirla (una transferencia que paga
  -- dos pedidos) y Dirección ve el aviso «referencia repetida» en Ventas. Los webhooks (service_role) siguen con el índice.
  if p_method in ('tarjeta', 'stripe') and not v_srv then
    perform public._w2_referencia_libre(p_reference);
  end if;

  -- F-9: el dinero que llegó SE REGISTRA SIEMPRE, incluso sobre un pedido cancelado.
  -- El conflicto no se niega: queda como excepción en la conciliación (D5).
  v_entry := public._w2_asiento(p_op_id, p_order, 'in', p_method, p_amount,
               coalesce(p_value_date, public.hoy_local()), null, null, p_reference, p_bank_account_id, p_evidence);
  v_estado := public._w2_recalc_payment_status(p_order);
  select * into v_m from public.v_order_money where order_id = p_order;

  return public._w2_op_finish(p_op_id, 'cobro', v_req,
    jsonb_build_object('status', 'applied', 'entry_id', v_entry, 'order_id', p_order,
                       'payment_status', v_estado, 'cobrado_neto', v_m.cobrado_neto, 'saldo', v_m.saldo,
                       'sobrepago', v_m.sobrepago, 'sobre_pedido_cancelado', (v_o.status = 'cancelled')));
end;
$function$;
