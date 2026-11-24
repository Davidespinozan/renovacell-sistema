-- ============================================================================
-- ENVÍOS EXTRA (24 nov 2026, pedido de Ventas, reglas del dueño): un mismo pedido con 2 o más envíos foráneos.
--   · La vendedora, al vender, agrega cada envío extra: domicilio foráneo + qué productos y cuántos van ahí.
--   · Cada envío extra cuesta entrega_config.envio_extra_costo ($600); el principal sigue la regla de siempre.
--   · Almacén genera una guía por paquete: paquete 0 = el principal (todo lo de antes, intacto), 1..n = los extras.
--   · El cliente recibe su aviso con cada guía; el pedido queda "Entregado" cuando llegaron TODOS sus paquetes.
-- shipping_meta.entrega.extras = [{paquete, address, contacto, lineas:[{product_id, nombre, qty}], flete}],
-- shipping_meta.entrega.extras_flete = suma; orders.shipping_cost = flete principal + extras (la factura cuadra igual).
-- ============================================================================

alter table public.entrega_config add column if not exists envio_extra_costo numeric(12,2) not null default 600;
alter table public.shipments add column if not exists paquete smallint not null default 0;
alter table public.shipping_attempts add column if not exists paquete smallint not null default 0;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'ck_shipments_paquete') then
    alter table public.shipments add constraint ck_shipments_paquete check (paquete between 0 and 10);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_shipping_attempts_paquete') then
    alter table public.shipping_attempts add constraint ck_shipping_attempts_paquete check (paquete between 0 and 10);
  end if;
end $$;

-- Una guía viva / un envío vivo / un intento activo POR PAQUETE (antes: por pedido; el paquete 0 se comporta igual).
drop index if exists public.uq_shipments_order_tracking;
create unique index uq_shipments_order_tracking on public.shipments (order_id, paquete) where tracking_number is not null;
drop index if exists public.uq_shipments_un_envio_vivo;
create unique index uq_shipments_un_envio_vivo on public.shipments (order_id, paquete) where status <> all (array['cancelado', 'delivered']);
drop index if exists public.uq_shipping_attempts_active;
create unique index uq_shipping_attempts_active on public.shipping_attempts (order_id, paquete)
  where status = any (array['pending', 'succeeded', 'unknown_requires_reconciliation']);

-- ── Validación y normalización de los envíos extra (solo personal; foráneos; las piezas salen del pedido).
create or replace function public._entrega_extras(p_actor text, p_lines jsonb, p_extras jsonb) returns jsonb
  language plpgsql stable set search_path = public as
$$
declare x jsonb; l jsonb; snap jsonb; v_cp text; v_pid uuid; v_qty int; k int := 0; v_costo numeric;
  v_out jsonb := '[]'::jsonb; v_lineas jsonb; v_pedido jsonb := '{}'::jsonb; v_usado jsonb := '{}'::jsonb; v_resto int;
begin
  if p_extras is null or jsonb_typeof(p_extras) = 'null' or (jsonb_typeof(p_extras) = 'array' and jsonb_array_length(p_extras) = 0) then return '{}'::jsonb; end if;
  if p_actor <> 'staff' then raise exception 'ENVIO_EXTRA_SOLO_PERSONAL: los envíos extra los agrega la vendedora' using errcode = 'check_violation'; end if;
  if jsonb_typeof(p_extras) <> 'array' or jsonb_array_length(p_extras) > 5 then
    raise exception 'ENVIO_EXTRA_INVALIDO: hasta 5 envíos extra por pedido' using errcode = 'check_violation'; end if;
  select envio_extra_costo into v_costo from public.entrega_config where id = 1;
  -- piezas del pedido por producto
  for l in select * from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) loop
    v_pedido := v_pedido || jsonb_build_object(l ->> 'product_id', coalesce((v_pedido ->> (l ->> 'product_id'))::int, 0) + (l ->> 'qty')::int);
  end loop;
  for x in select * from jsonb_array_elements(p_extras) loop
    k := k + 1;
    snap := public._cc_chk_direccion_snapshot(x -> 'address');
    v_cp := snap -> 'address' ->> 'cp';
    if snap is null or v_cp is null or v_cp !~ '^[0-9]{5}$' then
      raise exception 'ENVIO_EXTRA_SIN_DIRECCION: el envío extra % necesita calle y código postal de 5 dígitos', k using errcode = 'check_violation'; end if;
    if public._entrega_es_local(v_cp) then
      raise exception 'ENVIO_EXTRA_LOCAL: el envío extra % es a Culiacán; los envíos extra son solo foráneos (paquetería)', k using errcode = 'check_violation'; end if;
    if jsonb_typeof(x -> 'lineas') <> 'array' or jsonb_array_length(x -> 'lineas') = 0 then
      raise exception 'ENVIO_EXTRA_VACIO: indica qué productos van en el envío extra %', k using errcode = 'check_violation'; end if;
    v_lineas := '[]'::jsonb;
    for l in select * from jsonb_array_elements(x -> 'lineas') loop
      begin v_pid := (l ->> 'product_id')::uuid; v_qty := (l ->> 'qty')::int;
      exception when others then raise exception 'ENVIO_EXTRA_INVALIDO: producto o cantidad inválidos' using errcode = 'check_violation'; end;
      if v_qty is null or v_qty <= 0 then continue; end if;
      if not v_pedido ? v_pid::text then
        raise exception 'ENVIO_EXTRA_INVALIDO: el envío extra % lleva un producto que no está en el pedido', k using errcode = 'check_violation'; end if;
      v_usado := v_usado || jsonb_build_object(v_pid::text, coalesce((v_usado ->> v_pid::text)::int, 0) + v_qty);
      v_lineas := v_lineas || jsonb_build_object('product_id', v_pid, 'qty', v_qty, 'nombre', (select name from public.products where id = v_pid));
    end loop;
    if jsonb_array_length(v_lineas) = 0 then
      raise exception 'ENVIO_EXTRA_VACIO: indica qué productos van en el envío extra %', k using errcode = 'check_violation'; end if;
    v_out := v_out || jsonb_build_object('paquete', k, 'address', snap -> 'address', 'contacto', snap -> 'contacto', 'lineas', v_lineas, 'flete', v_costo);
  end loop;
  -- nadie reparte más piezas de las que lleva el pedido, y el envío principal se queda con algo
  for l in select jsonb_build_object('pid', key, 'n', value) from jsonb_each(v_usado) loop
    if (l ->> 'n')::int > (v_pedido ->> (l ->> 'pid'))::int then
      raise exception 'ENVIO_EXTRA_PIEZAS: repartiste más piezas de % de las que lleva el pedido', (select name from public.products where id = (l ->> 'pid')::uuid) using errcode = 'check_violation'; end if;
  end loop;
  select coalesce(sum(value::text::int), 0) - coalesce((select sum(value::text::int) from jsonb_each(v_usado)), 0) into v_resto from jsonb_each(v_pedido);
  if v_resto <= 0 then
    raise exception 'ENVIO_PRINCIPAL_VACIO: deja al menos un producto en el envío principal' using errcode = 'check_violation'; end if;
  return jsonb_build_object('extras', v_out, 'extras_flete', v_costo * jsonb_array_length(v_out));
end;
$$;
revoke all on function public._entrega_extras(text, jsonb, jsonb) from public, anon, authenticated;

-- ── Venta: los extras viajan en p_entrega.extras y se cobran en la misma transacción que el pedido.
do $$
declare d text := pg_get_functiondef('public.crear_pedido_con_entrega(uuid,text,uuid,jsonb,jsonb,boolean,uuid,jsonb,jsonb)'::regprocedure);
  a1 text := 'v_ent := public._entrega_normalizar(v_actor, (v_res ->> ''total'')::numeric, v_cp, p_entrega, now());';
  b1 text := 'v_ent := public._entrega_normalizar(v_actor, (v_res ->> ''total'')::numeric, v_cp, p_entrega, now());
  v_ent := v_ent || public._entrega_extras(v_actor, p_lines, p_entrega -> ''extras'');   -- ENVÍOS EXTRA';
  a2 text := '''envio'', (v_ent ->> ''flete'')::numeric,';
  b2 text := '''envio'', (v_ent ->> ''flete'')::numeric + coalesce((v_ent ->> ''extras_flete'')::numeric, 0),';
  a3 text := '''total'', (v_res ->> ''total'')::numeric + (v_ent ->> ''flete'')::numeric,';
  b3 text := '''total'', (v_res ->> ''total'')::numeric + (v_ent ->> ''flete'')::numeric + coalesce((v_ent ->> ''extras_flete'')::numeric, 0),';
begin
  if (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1 or (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1
     or (length(d) - length(replace(d, a3, ''))) / length(a3) <> 1 then raise exception 'ENVIOS_EXTRA: crear_pedido_con_entrega cambió'; end if;
  execute replace(replace(replace(d, a1, b1), a2, b2), a3, b3);
end $$;

do $$
declare d text := pg_get_functiondef('public._entrega_aplicar(uuid,jsonb)'::regprocedure);
  a text := 'v_costo numeric := (p_entrega ->> ''flete'')::numeric;';
  b text := 'v_costo numeric := (p_entrega ->> ''flete'')::numeric + coalesce((p_entrega ->> ''extras_flete'')::numeric, 0);   -- ENVÍOS EXTRA';
begin
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'ENVIOS_EXTRA: _entrega_aplicar cambió'; end if;
  execute replace(d, a, b);
end $$;

-- ── Guía: una por paquete. Un paquete extra no cambia el estado del pedido; su aviso al cliente sale aquí.
create or replace function public.finalize_shipment(p_attempt_id uuid, p_shipment jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_order uuid := (p_shipment->>'order_id')::uuid;
  v_paquete smallint := coalesce(nullif(p_shipment->>'paquete', '')::smallint, 0);
  v_existing uuid;
  v_id uuid;
  v_reenvio int;
begin
  if not (coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role','') = 'service_role'
          or public.auth_role() = any (array['admin','warehouse','packing'])) then
    raise exception 'NO_AUTORIZADO';
  end if;
  if v_paquete > 0 and not exists (select 1 from public.orders o where o.id = v_order
       and jsonb_array_length(coalesce(o.shipping_meta -> 'entrega' -> 'extras', '[]'::jsonb)) >= v_paquete) then
    raise exception 'PAQUETE_INEXISTENTE: ese pedido no tiene el envío extra %', v_paquete;
  end if;

  -- Idempotencia dura: una guía (tracking) por paquete del pedido.
  select id into v_existing from public.shipments
   where order_id = v_order and paquete = v_paquete and tracking_number is not null limit 1;
  if v_existing is not null then
    update public.shipping_attempts
       set status = 'succeeded',
           tracking_number = coalesce(tracking_number, p_shipment->>'tracking_number'),
           updated_at = now()
     where id = p_attempt_id;
    return jsonb_build_object('ok', true, 'shipment_id', v_existing, 'reused', true);
  end if;

  insert into public.shipments (
    order_id, paquete, carrier, tracking_number, status, estimated_delivery_at, provider, service_code,
    label_path, package, ship_from, ship_to, provider_meta, provider_cost, currency, quote_ref
  ) values (
    v_order, v_paquete,
    coalesce(p_shipment->>'carrier','DHL'),
    p_shipment->>'tracking_number',
    coalesce(p_shipment->>'status','in_transit'),
    nullif(p_shipment->>'estimated_delivery_at','')::timestamptz,
    p_shipment->>'provider',
    p_shipment->>'service_code',
    nullif(p_shipment->>'label_path',''),
    p_shipment->'package',
    p_shipment->'ship_from',
    p_shipment->'ship_to',
    p_shipment->'provider_meta',
    nullif(p_shipment->>'provider_cost','')::numeric,
    p_shipment->>'currency',
    p_shipment->>'quote_ref'
  ) returning id into v_id;

  update public.shipping_attempts
     set status = 'succeeded',
         tracking_number = p_shipment->>'tracking_number',
         provider_cost = nullif(p_shipment->>'provider_cost','')::numeric,
         currency = p_shipment->>'currency',
         quote_ref = p_shipment->>'quote_ref',
         updated_at = now()
   where id = p_attempt_id;

  -- ENVÍOS EXTRA · el aviso «va en camino» del paquete extra, con SU guía (el del principal lo dispara el pedido).
  if v_paquete > 0 and nullif(p_shipment->>'tracking_number', '') is not null then
    select count(*) into v_reenvio from public.shipments s where s.order_id = v_order and s.paquete = v_paquete and s.status = 'cancelado' and s.provider_meta ? 'anulada';
    perform public._comm_encolar('pedido_enviado:' || v_order || ':p' || v_paquete || case when v_reenvio > 0 then ':r' || v_reenvio else '' end,
      'pedido_enviado', v_order, jsonb_build_object('paqueteria', coalesce(p_shipment->>'carrier', 'DHL'), 'rastreo', p_shipment->>'tracking_number', 'metodo', 'paqueteria', 'paquete', v_paquete));
  end if;

  return jsonb_build_object('ok', true, 'shipment_id', v_id);
end;
$$;

-- ── Anular guía (paquete principal): solo mira el paquete 0.
do $$
declare d text := pg_get_functiondef('public.anular_guia(uuid,uuid,text)'::regprocedure);
  a1 text := 'select * into s from public.shipments where order_id = p_order and tracking_number is not null for update;';
  b1 text := 'select * into s from public.shipments where order_id = p_order and paquete = 0 and tracking_number is not null for update;';
  a2 text := 'where a.order_id = p_order and a.status in (''pending'', ''unknown_requires_reconciliation'')';
  b2 text := 'where a.order_id = p_order and a.paquete = 0 and a.status in (''pending'', ''unknown_requires_reconciliation'')';
  a3 text := 'where order_id = p_order and status = ''succeeded'';';
  b3 text := 'where order_id = p_order and paquete = 0 and status = ''succeeded'';';
begin
  if (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1 or (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1
     or (length(d) - length(replace(d, a3, ''))) / length(a3) <> 1 then raise exception 'ENVIOS_EXTRA: anular_guia cambió'; end if;
  execute replace(replace(replace(d, a1, b1), a2, b2), a3, b3);
end $$;

-- ── Anular la guía de un envío extra (aún en el local): constancia, sin tocar el pedido.
create or replace function public.anular_guia_extra(p_op_id uuid, p_order uuid, p_paquete int, p_motivo text) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_rol text := public.auth_role(); v_uid uuid := auth.uid();
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_req jsonb; v_prev jsonb; v_res jsonb; o record; s public.shipments; v_estado text;
begin
  if v_rol is null or v_rol not in ('admin', 'warehouse') then
    raise exception 'NO_AUTORIZADO: solo Dirección o Almacén anulan una guía';
  end if;
  v_req := jsonb_build_object('order', p_order, 'paquete', p_paquete, 'motivo', v_motivo);
  v_prev := public._w1_op_begin(p_op_id, 'anulacion_guia', v_req);
  if v_prev is not null then return v_prev; end if;
  if v_motivo is null or length(v_motivo) < 3 or length(v_motivo) > 200 then
    raise exception 'MOTIVO_REQUERIDO: indica por qué se anula la guía (3 a 200 caracteres)';
  end if;
  if p_paquete is null or p_paquete < 1 then raise exception 'PAQUETE_INVALIDO: esto es para los envíos extra'; end if;
  select id, external_ref into o from public.orders where id = p_order for update;
  if not found then raise exception 'PEDIDO_INEXISTENTE'; end if;
  select * into s from public.shipments where order_id = p_order and paquete = p_paquete and tracking_number is not null for update;
  if not found then raise exception 'SIN_GUIA: ese envío extra no tiene guía'; end if;
  if s.status in ('delivered', 'cancelado') then raise exception 'ENVIO_CERRADO: ese envío ya está %', s.status; end if;
  if nullif(btrim(coalesce(s.pickup_confirmation, '')), '') is not null then
    raise exception 'RECOLECCION_AGENDADA: cancela primero la recolección agendada con la paquetería';
  end if;
  select t.estado into v_estado from public.shipment_tracking t where t.shipment_id = s.id;
  if v_estado is not null and v_estado <> 'sin_eventos' then
    raise exception 'PAQUETE_EN_PAQUETERIA: la paquetería ya reporta movimiento (%); no se anula la guía, registra una devolución', v_estado;
  end if;
  if exists (select 1 from public.shipping_attempts a where a.order_id = p_order and a.paquete = p_paquete and a.status in ('pending', 'unknown_requires_reconciliation')) then
    raise exception 'GUIA_EN_PROCESO: hay una guía en creación o en estado desconocido para este envío';
  end if;
  update public.shipping_attempts
     set status = 'voided_manual', voided_by = v_uid, voided_at = now(),
         void_reference = left('Anulada en el sistema: ' || v_motivo, 240), updated_at = now()
   where order_id = p_order and paquete = p_paquete and status = 'succeeded';
  update public.shipments
     set status = 'cancelado', tracking_number = null,
         provider_meta = coalesce(provider_meta, '{}'::jsonb) || jsonb_build_object('anulada',
           jsonb_build_object('tracking', s.tracking_number, 'motivo', v_motivo, 'por', v_uid, 'at', now()))
   where id = s.id;
  update public.comm_outbox
     set status = 'fallido', last_error = left('GUIA_ANULADA: la guía ' || s.tracking_number || ' de este aviso se anuló, no reenviar', 300)
   where order_id = p_order and plantilla = 'pedido_enviado' and status = 'pendiente' and payload ->> 'rastreo' = s.tracking_number;
  begin
    perform public.log_audit('Guía anulada (envío extra ' || p_paquete || ')', coalesce(o.external_ref, p_order::text), 'guía ' || s.tracking_number || ' · ' || v_motivo, 'Logística');
  exception when others then null;
  end;
  v_res := jsonb_build_object('status', 'applied', 'order_id', p_order, 'paquete', p_paquete, 'guia_anulada', s.tracking_number);
  return public._w1_op_finish(p_op_id, 'anulacion_guia', v_req, v_res);
end;
$$;
revoke all on function public.anular_guia_extra(uuid, uuid, int, text) from public, anon;
grant execute on function public.anular_guia_extra(uuid, uuid, int, text) to authenticated;

-- ── Reconciliar un intento: por paquete; solo el principal mueve el pedido a "enviado".
do $$
declare d text := pg_get_functiondef('public.reconciliar_guia'::regproc);
  a1 text := 'select 1 from public.shipments s where s.order_id = a.order_id and s.tracking_number is not null';
  b1 text := 'select 1 from public.shipments s where s.order_id = a.order_id and s.paquete = a.paquete and s.tracking_number is not null';
  a2 text := '''order_id'', a.order_id, ''carrier'', ''DHL'', ''tracking_number'', v_tracking,';
  b2 text := '''order_id'', a.order_id, ''paquete'', a.paquete, ''carrier'', ''DHL'', ''tracking_number'', v_tracking,';
  a3 text := 'where id = a.order_id and status = ''packed'';';
  b3 text := 'where id = a.order_id and status = ''packed'' and a.paquete = 0;';
begin
  if (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1 or (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1
     or (length(d) - length(replace(d, a3, ''))) / length(a3) <> 1 then raise exception 'ENVIOS_EXTRA: reconciliar_guia cambió'; end if;
  execute replace(replace(replace(d, a1, b1), a2, b2), a3, b3);
end $$;

-- ── Entregado: el pedido se cierra cuando llegaron TODOS sus paquetes (principal y extras).
do $$
declare d text := pg_get_functiondef('public.confirmar_entrega(uuid,text,text)'::regprocedure);
  a text := 'where id = s.order_id
     and status = ''shipped'';';
  b text := 'where id = s.order_id
     and status = ''shipped''
     -- ENVÍOS EXTRA · ningún otro paquete en camino y todos los extras entregados
     and not exists (select 1 from public.shipments x where x.order_id = s.order_id and x.status not in (''delivered'', ''cancelado''))
     and (select count(distinct x.paquete) from public.shipments x where x.order_id = s.order_id and x.paquete > 0 and x.status = ''delivered'')
         >= jsonb_array_length(coalesce(shipping_meta -> ''entrega'' -> ''extras'', ''[]''::jsonb));';
begin
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'ENVIOS_EXTRA: confirmar_entrega cambió'; end if;
  execute replace(d, a, b);
end $$;

-- ── Guía de un envío extra: también cuando el principal ya salió (pedido enviado); el principal, como siempre, empacado.
do $$
declare d text := pg_get_functiondef('public.shipping_attempts_guard()'::regprocedure);
  a text := 'if v_status is distinct from ''packed'' then';
  b text := 'if v_status is distinct from ''packed'' and not (new.paquete > 0 and v_status = ''shipped'') then';
begin
  if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'ENVIOS_EXTRA: shipping_attempts_guard cambió'; end if;
  execute replace(d, a, b);
end $$;
