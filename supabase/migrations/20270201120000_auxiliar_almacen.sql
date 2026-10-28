-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- AUXILIAR DE ALMACÉN (rol 'packing') · pedido del dueño (28 oct 2026): "Blanca es la asistente de Alberto; ella en sí
--   se encarga de empaque y despacho" y del inventario físico. "La guía la imprime Alberto". Recibir mercancía,
--   devoluciones, custodia, reingresos y guías son de Alberto (inventario y control digital).
--   El rol 'packing' (Auxiliar de almacén) conserva: ver inventario, corregir conteo físico (ajustar_lote), surtir,
--   empacar, despachar (envíos con chofer / recoger) y la agenda de entregas.
--   Se le QUITA (solo cambia la lista de roles de cada función; el resto es idéntico):
--   · recibir_lote · recibir_devolucion · confirmar_reingreso · anular_guia
--   · abrir_custodia · entregar_custodia · devolver_de_custodia · registrar_perdida_custodia
--   La generación de guías (Edge shipping) se restringe aparte en la Edge.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if md5(pg_get_functiondef('public.abrir_custodia(uuid,text,text,uuid,uuid,text,text,date)'::regprocedure)) <> '020e8d3926b16202fdd4b193036fdd8c'
     or md5(pg_get_functiondef('public.anular_guia(uuid,uuid,text)'::regprocedure)) <> '35015b5940b8848f001e18ce8d6e1356'
     or md5(pg_get_functiondef('public.confirmar_reingreso(uuid,uuid,jsonb)'::regprocedure)) <> '3c2068f979e776fcb01775e56ebca1be'
     or md5(pg_get_functiondef('public.devolver_de_custodia(uuid,uuid,jsonb,text)'::regprocedure)) <> '33eeb7f08ff35a897b96f3c2b37156f3'
     or md5(pg_get_functiondef('public.entregar_custodia(uuid,uuid,jsonb)'::regprocedure)) <> '7809078dc95d49e5cccb08d85590ada3'
     or md5(pg_get_functiondef('public.recibir_devolucion(uuid,uuid,jsonb,text)'::regprocedure)) <> 'f7667c4c800f89d67084050668f3132b'
     or md5(pg_get_functiondef('public.recibir_lote(uuid,uuid,text,date,integer,uuid,text,numeric,text,text)'::regprocedure)) <> '1fd76e03f8df4f77751022c61e745614'
     or md5(pg_get_functiondef('public.registrar_perdida_custodia(uuid,uuid,text,jsonb,text,text)'::regprocedure)) <> '39ed137cfd26a6d579a3cb047d6c2845' then
    raise exception 'AUXILIAR: alguna función cambió desde que se escribió esta migración';
  end if;
end $pre$;

CREATE OR REPLACE FUNCTION public.abrir_custodia(p_op_id uuid, p_kind text, p_holder_kind text, p_holder_user_id uuid DEFAULT NULL::uuid, p_holder_customer_id uuid DEFAULT NULL::uuid, p_event_name text DEFAULT NULL::text, p_event_venue text DEFAULT NULL::text, p_event_date date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_req jsonb; v_prev jsonb;
begin
  if not (public.auth_role() = any (array['admin','warehouse'])) then
    raise exception 'NO_AUTORIZADO: solo Dirección o Almacén abren una custodia';
  end if;
  v_req := jsonb_build_object('kind', p_kind, 'holder_kind', p_holder_kind, 'user', p_holder_user_id,
             'customer', p_holder_customer_id, 'event', p_event_name, 'venue', p_event_venue, 'date', p_event_date);
  v_prev := public._w2c_op_begin(p_op_id, 'custodia_abierta', v_req);
  if v_prev is not null then return v_prev; end if;

  if p_kind not in ('evento','vendedor') then raise exception 'TIPO_INVALIDO: usa evento o vendedor'; end if;
  if p_holder_kind not in ('staff','doctor','tercero') then raise exception 'TENEDOR_INVALIDO: usa staff, doctor o tercero'; end if;
  if (p_holder_user_id is not null)::int + (p_holder_customer_id is not null)::int <> 1 then
    raise exception 'TENEDOR_REQUERIDO: indica EXACTAMENTE un tenedor (usuario del sistema o cliente del maestro)';
  end if;
  if p_holder_kind = 'staff' and p_holder_user_id is null then
    raise exception 'TENEDOR_INTERNO_REQUIERE_CUENTA: el personal interno se identifica con su usuario';
  end if;
  if p_holder_customer_id is not null
     and not exists (select 1 from public.customers where id = p_holder_customer_id and active) then
    raise exception 'CLIENTE_INEXISTENTE: el tenedor externo debe existir y estar activo en el maestro de clientes';
  end if;
  if p_holder_user_id is not null and not exists (select 1 from public.profiles where id = p_holder_user_id) then
    raise exception 'USUARIO_INEXISTENTE: el tenedor no tiene perfil';
  end if;
  if p_kind = 'evento' and nullif(btrim(p_event_name), '') is null then
    raise exception 'EVENTO_REQUIERE_NOMBRE';
  end if;
  if p_kind = 'vendedor' and p_event_name is not null then
    raise exception 'CONSIGNACION_SIN_EVENTO: una consignación de vendedor no lleva datos de evento';
  end if;
  if exists (select 1 from public.custodies c
              where c.kind = p_kind and c.status = 'abierta'
                and c.holder_user_id is not distinct from p_holder_user_id
                and c.holder_customer_id is not distinct from p_holder_customer_id) then
    raise exception 'CUSTODIA_YA_ABIERTA: ese tenedor ya tiene una custodia abierta de ese tipo';
  end if;

  insert into public.custodies (id, kind, holder_kind, holder_user_id, holder_customer_id,
                                event_name, event_venue, event_date, status, opened_by, op_id)
  values (p_op_id, p_kind, p_holder_kind, p_holder_user_id, p_holder_customer_id,
          nullif(btrim(p_event_name), ''), nullif(btrim(p_event_venue), ''), p_event_date,
          'abierta', auth.uid(), p_op_id);

  return public._w2c_op_finish(p_op_id, 'custodia_abierta', v_req,
    jsonb_build_object('status', 'applied', 'custody_id', p_op_id, 'kind', p_kind));
end;
$function$;

CREATE OR REPLACE FUNCTION public.anular_guia(p_op_id uuid, p_order uuid, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- PAQ-B · Anula la guía de paquetería de un pedido que AÚN NO sale del local y lo deja listo para generar otra.
-- La paquetería no ofrece anular por API: una guía sin usar simplemente no se entrega. Aquí se deja constancia y se
-- libera el pedido. No toca inventario ni dinero (el pedido ya estaba surtido y, en su caso, cobrado).
declare
  v_rol text := public.auth_role(); v_uid uuid := auth.uid();
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_req jsonb; v_prev jsonb; v_res jsonb; o record; s public.shipments; v_estado text;
  v_trusted text := coalesce(current_setting('app.trusted', true), '');
begin
  if v_rol is null or v_rol not in ('admin', 'warehouse') then
    raise exception 'NO_AUTORIZADO: solo Dirección, Almacén o Empaque anulan una guía';
  end if;
  v_req := jsonb_build_object('order', p_order, 'motivo', v_motivo);
  v_prev := public._w1_op_begin(p_op_id, 'anulacion_guia', v_req);
  if v_prev is not null then return v_prev; end if;
  if v_motivo is null or length(v_motivo) < 3 or length(v_motivo) > 200 then
    raise exception 'MOTIVO_REQUERIDO: indica por qué se anula la guía (3 a 200 caracteres)';
  end if;

  select id, status, external_ref into o from public.orders where id = p_order for update;   -- una anulación a la vez por pedido
  if not found then raise exception 'PEDIDO_INEXISTENTE'; end if;
  if o.status <> 'shipped' then
    raise exception 'PEDIDO_NO_ENVIADO: solo se anula la guía de un pedido marcado como enviado (este está %)', o.status;
  end if;
  select * into s from public.shipments where order_id = p_order and tracking_number is not null for update;
  if not found then raise exception 'SIN_GUIA: ese pedido no tiene una guía de paquetería'; end if;
  if s.driver_id is not null then raise exception 'ENVIO_CON_CHOFER: ese envío lo lleva un chofer propio; no es una guía de paquetería'; end if;
  if s.status in ('delivered', 'cancelado') then raise exception 'ENVIO_CERRADO: ese envío ya está %', s.status; end if;
  if nullif(btrim(coalesce(s.pickup_confirmation, '')), '') is not null then
    raise exception 'RECOLECCION_AGENDADA: cancela primero la recolección agendada con la paquetería';
  end if;
  -- El paquete debe seguir en el local: si la paquetería ya reporta cualquier movimiento, lo que procede es una devolución.
  select t.estado into v_estado from public.shipment_tracking t where t.shipment_id = s.id;
  if v_estado is not null and v_estado <> 'sin_eventos' then
    raise exception 'PAQUETE_EN_PAQUETERIA: la paquetería ya reporta movimiento (%); no se anula la guía, registra una devolución', v_estado;
  end if;
  if exists (select 1 from public.shipping_attempts a where a.order_id = p_order and a.status in ('pending', 'unknown_requires_reconciliation')) then
    raise exception 'GUIA_EN_PROCESO: hay una guía en creación o en estado desconocido para este pedido; no se anula hasta resolverla';
  end if;

  update public.shipping_attempts
     set status = 'voided_manual', voided_by = v_uid, voided_at = now(),
         void_reference = left('Anulada en el sistema: ' || v_motivo, 240), updated_at = now()
   where order_id = p_order and status = 'succeeded';

  -- El envío queda como constancia: cancelado, con su número en `provider_meta.anulada` y SIN número activo (así el
  -- pedido admite una guía nueva y nada vuelve a tratar la anulada como vigente).
  update public.shipments
     set status = 'cancelado', tracking_number = null,
         provider_meta = coalesce(provider_meta, '{}'::jsonb) || jsonb_build_object('anulada',
           jsonb_build_object('tracking', s.tracking_number, 'motivo', v_motivo, 'por', v_uid, 'at', now()))
   where id = s.id;

  -- El pedido vuelve a "empacado" (transición que solo hace el servidor) y pierde los datos de la guía anulada.
  perform set_config('app.trusted', 'on', true);
  update public.orders
     set status = 'packed',
         shipping_meta = coalesce(shipping_meta, '{}'::jsonb) - 'carrier' - 'tracking' - 'label_url' - 'method'
   where id = p_order;
  -- El aviso "tu pedido va en camino" con el número anulado, si aún no salió, ya no debe salir.
  update public.comm_outbox
     set status = 'fallido', last_error = left('GUIA_ANULADA: la guía ' || s.tracking_number || ' de este aviso se anuló, no reenviar', 300)
   where order_id = p_order and plantilla = 'pedido_enviado' and status = 'pendiente';
  perform set_config('app.trusted', v_trusted, true);

  begin
    perform public.log_audit('Guía anulada', coalesce(o.external_ref, p_order::text), 'guía ' || s.tracking_number || ' · ' || v_motivo, 'Logística');
  exception when others then null;   -- la bitácora de aplicación nunca bloquea la operación
  end;

  v_res := jsonb_build_object('status', 'applied', 'order_id', p_order, 'guia_anulada', s.tracking_number, 'order_status', 'packed');
  return public._w1_op_finish(p_op_id, 'anulacion_guia', v_req, v_res);
end;
$function$;

CREATE OR REPLACE FUNCTION public.confirmar_reingreso(p_op_id uuid, p_return_id uuid, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_req jsonb; v_prev jsonb; v_res jsonb;
  v_ret record; r record; v_insp text; v_pending int; v_given int; v_match int; v_ok int := 0; v_okq int := 0; v_dir int := 0;
begin
  if not (public.auth_role() = any (array['admin','warehouse'])) then
    raise exception 'NO_AUTORIZADO: sin permiso para confirmar reingresos';
  end if;
  v_req := jsonb_build_object('return', p_return_id, 'lines', p_lines);
  v_prev := public._w1_op_begin(p_op_id, 'reingreso_cancelacion', v_req);
  if v_prev is not null then return v_prev; end if;

  select sr.*, o.external_ref into v_ret from public.stock_returns sr join public.orders o on o.id = sr.order_id
   where sr.id = p_return_id and sr.origin = 'cancelacion' for update of sr;
  if not found then raise exception 'REINGRESO_INEXISTENTE'; end if;
  select count(*) into v_pending from public.stock_return_lines where return_id = p_return_id and inspection is null;
  if v_pending = 0 then raise exception 'REINGRESO_YA_CONFIRMADO'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then raise exception 'RENGLONES_REQUERIDOS'; end if;

  select count(*), count(distinct x.line_id) filter (where x.estado in ('ok','dañado')),
         count(rl.id)
    into v_given, v_match, v_pending
    from jsonb_to_recordset(p_lines) as x(line_id uuid, estado text)
    left join public.stock_return_lines rl on rl.id = x.line_id and rl.return_id = p_return_id and rl.inspection is null;
  if v_given <> v_match or v_given <> v_pending
     or v_given <> (select count(*) from public.stock_return_lines where return_id = p_return_id and inspection is null) then
    raise exception 'REINGRESO_INCOMPLETO: confirma cada renglón pendiente exactamente una vez con estado ok o dañado';
  end if;

  for r in
    select rl.id, rl.lot_id, rl.qty, rl.order_item_id, l.expiry_date, x.estado
      from jsonb_to_recordset(p_lines) as x(line_id uuid, estado text)
      join public.stock_return_lines rl on rl.id = x.line_id
      join public.lots l on l.id = rl.lot_id
     order by rl.lot_id
       for update of rl, l
  loop
    v_insp := case when public.lote_caducado(r.expiry_date) then 'caducado' else r.estado end;
    if v_insp = 'ok' then
      update public.lots set quantity = quantity + r.qty where id = r.lot_id;
      update public.stock_return_lines
         set inspection = 'ok', inspected_by = v_uid, inspected_at = now(),
             disposition = 'vendible', disposed_by = v_uid, disposed_at = now(), disposition_op_id = p_op_id
       where id = r.id;
      insert into public.inventory_movements (lot_id, change, reason, reference, created_by, op_id, order_id, order_item_id, return_line_id)
      values (r.lot_id, r.qty, 'cancelacion', coalesce(v_ret.external_ref, v_ret.order_id::text), v_uid, p_op_id,
              v_ret.order_id, r.order_item_id, r.id);
      v_ok := v_ok + 1; v_okq := v_okq + r.qty;
    else
      update public.stock_return_lines set inspection = v_insp, inspected_by = v_uid, inspected_at = now() where id = r.id;
      v_dir := v_dir + 1;
    end if;
  end loop;

  v_res := jsonb_build_object('status', 'applied', 'return_id', p_return_id, 'reingresados', v_ok,
             'cantidad_reingresada', v_okq, 'pendientes_direccion', v_dir);
  return public._w1_op_finish(p_op_id, 'reingreso_cancelacion', v_req, v_res);
end;
$function$;

CREATE OR REPLACE FUNCTION public.devolver_de_custodia(p_op_id uuid, p_custody uuid, p_lines jsonb, p_motivo text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_req jsonb; v_prev jsonb; v_cus record; v_ln record; v_insp text;
  v_ok int := 0; v_perdido int := 0; v_en_poder int;
begin
  if not (public.auth_role() = any (array['admin','warehouse'])) then
    raise exception 'NO_AUTORIZADO: la devolución la recibe Almacén (o Dirección)';
  end if;
  v_req := jsonb_build_object('custody', p_custody, 'lines', p_lines, 'motivo', p_motivo);
  v_prev := public._w2c_op_begin(p_op_id, 'devolucion', v_req);
  if v_prev is not null then return v_prev; end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'DEVOLUCION_SIN_RENGLONES';
  end if;
  select * into v_cus from public.custodies where id = p_custody for update;
  if not found then raise exception 'CUSTODIA_INEXISTENTE'; end if;
  if v_cus.status <> 'abierta' then raise exception 'CUSTODIA_CERRADA: esa custodia ya se cerró'; end if;

  for v_ln in select x.lot_id, x.qty, coalesce(x.inspection, '') as inspection
                from jsonb_to_recordset(p_lines) as x(lot_id uuid, qty int, inspection text)
  loop
    if v_ln.qty is null or v_ln.qty <= 0 then raise exception 'CANTIDAD_INVALIDA: cada renglón debe ser mayor a cero'; end if;
    v_insp := v_ln.inspection;
    if v_insp = '' then
      raise exception 'INSPECCION_REQUERIDA: indica si el producto llegó bien, dañado o caducado';
    end if;
    if v_insp not in ('ok','dañado','caducado') then
      raise exception 'INSPECCION_INVALIDA: usa ok, dañado o caducado';
    end if;

    -- Un lote CADUCADO no vuelve a estar disponible aunque llegue íntegro
    -- (D-W2-C-9): se reclasifica como caducado y se da de baja.
    if v_insp = 'ok'
       and public.lote_caducado((select expiry_date from public.lots where id = v_ln.lot_id)) then
      v_insp := 'caducado';
    end if;

    if v_insp = 'ok' then
      v_en_poder := public.custody_held_en(p_custody, v_ln.lot_id);
      if v_ln.qty > v_en_poder then
        raise exception 'CUSTODIA_SALDO_INSUFICIENTE: del lote % hay % en poder y se devuelven %',
          v_ln.lot_id, v_en_poder, v_ln.qty;
      end if;
      insert into public.custody_lines (id, custody_id, kind, product_id, lot_id, qty, held_delta,
                                        actor, actor_role, op_id)
      select gen_random_uuid(), p_custody, 'devolucion', l.product_id, v_ln.lot_id, v_ln.qty, -v_ln.qty,
             auth.uid(), coalesce(public.auth_role(), ''), p_op_id
        from public.lots l where l.id = v_ln.lot_id;
      v_ok := v_ok + v_ln.qty;
    else
      perform public._w2c_perdida(p_custody,
        case when v_insp = 'caducado' then 'caducado' else 'merma' end,
        v_ln.lot_id, v_ln.qty,
        coalesce(nullif(btrim(p_motivo), ''), 'Devuelto ' || v_insp), null, p_op_id);
      v_perdido := v_perdido + v_ln.qty;
    end if;
  end loop;

  return public._w2c_op_finish(p_op_id, 'devolucion', v_req,
    jsonb_build_object('status', 'applied', 'custody_id', p_custody,
                       'devuelto_disponible', v_ok, 'dado_de_baja', v_perdido));
end;
$function$;

CREATE OR REPLACE FUNCTION public.entregar_custodia(p_op_id uuid, p_custody uuid, p_lines jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_req jsonb; v_prev jsonb; v_cus record; v_ln record; v_falta record; v_n int := 0; v_u int := 0;
begin
  if not (public.auth_role() = any (array['admin','warehouse'])) then
    raise exception 'NO_AUTORIZADO: solo Almacén o Dirección entregan producto en custodia';
  end if;
  v_req := jsonb_build_object('custody', p_custody, 'lines', p_lines);
  v_prev := public._w2c_op_begin(p_op_id, 'entrega', v_req);
  if v_prev is not null then return v_prev; end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'ENTREGA_SIN_RENGLONES';
  end if;
  select * into v_cus from public.custodies where id = p_custody for update;
  if not found then raise exception 'CUSTODIA_INEXISTENTE'; end if;
  if v_cus.status <> 'abierta' then raise exception 'CUSTODIA_CERRADA: no se entrega a una custodia cerrada'; end if;

  -- a) renglón por renglón: cantidad válida, lote real y VIGENTE (hoy_local, D-W2-C-9).
  for v_ln in select x.lot_id, x.qty, l.id as existe, l.expiry_date, l.lot_code
                from jsonb_to_recordset(p_lines) as x(lot_id uuid, qty int)
                left join public.lots l on l.id = x.lot_id
  loop
    if v_ln.qty is null or v_ln.qty <= 0 then raise exception 'CANTIDAD_INVALIDA: cada renglón debe ser mayor a cero'; end if;
    if v_ln.existe is null then raise exception 'LOTE_INEXISTENTE: %', v_ln.lot_id; end if;
    if public.lote_caducado(v_ln.expiry_date) then
      raise exception 'LOTE_CADUCADO: el lote % caducó el %; no se entrega en custodia', v_ln.lot_code, v_ln.expiry_date;
    end if;
  end loop;

  -- b) cerrojo de lotes en orden determinista (evita deadlock con surtido y POS).
  perform 1 from public.lots
   where id in (select x.lot_id from jsonb_to_recordset(p_lines) as x(lot_id uuid, qty int))
   order by id for update;

  -- c) tope AGREGADO por lote contra la DISPONIBILIDAD: dos renglones del mismo lote
  --    no pueden burlar el tope, y nunca se entrega lo que ya está en otra custodia.
  select f.lot_id, f.pedido, f.disponible into v_falta from (
    select x.lot_id, sum(x.qty)::int as pedido,
           (select l.quantity - public.custody_held(l.id) from public.lots l where l.id = x.lot_id) as disponible
      from jsonb_to_recordset(p_lines) as x(lot_id uuid, qty int)
     group by x.lot_id) f
   where f.pedido > coalesce(f.disponible, 0)
   limit 1;
  if found then
    raise exception 'DISPONIBILIDAD_INSUFICIENTE: del lote % hay % disponibles y la entrega pide %',
      v_falta.lot_id, coalesce(v_falta.disponible, 0), v_falta.pedido;
  end if;

  -- d) el libro. NO se escribe inventory_movements y NO se toca lots.quantity (G-3):
  --    el producto sigue siendo nuestro, solo cambió de manos.
  insert into public.custody_lines (id, custody_id, kind, product_id, lot_id, qty, held_delta,
                                    actor, actor_role, op_id)
  select gen_random_uuid(), p_custody, 'entrega', l.product_id, x.lot_id, x.qty, x.qty,
         auth.uid(), coalesce(public.auth_role(), ''), p_op_id
    from jsonb_to_recordset(p_lines) as x(lot_id uuid, qty int)
    join public.lots l on l.id = x.lot_id;

  select count(*)::int, coalesce(sum(x.qty), 0)::int into v_n, v_u
    from jsonb_to_recordset(p_lines) as x(lot_id uuid, qty int);

  return public._w2c_op_finish(p_op_id, 'entrega', v_req,
    jsonb_build_object('status', 'applied', 'custody_id', p_custody, 'renglones', v_n, 'unidades', v_u));
end;
$function$;

CREATE OR REPLACE FUNCTION public.recibir_devolucion(p_op_id uuid, p_order uuid, p_lines jsonb, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_req jsonb; v_prev jsonb; v_res jsonb;
  v_o record; r record; v_out int; v_prev_ret int; v_item uuid; v_n int := 0; v_q int := 0;
begin
  if not (public.auth_role() = any (array['admin','warehouse'])) then
    raise exception 'NO_AUTORIZADO: sin permiso para recibir devoluciones';
  end if;
  v_req := jsonb_build_object('order', p_order, 'lines', p_lines, 'notes', p_notes);
  v_prev := public._w1_op_begin(p_op_id, 'recepcion_devolucion', v_req);
  if v_prev is not null then return v_prev; end if;

  select id, status into v_o from public.orders where id = p_order for update;
  if not found then raise exception 'PEDIDO_INEXISTENTE: no hay devolución sin pedido previo'; end if;
  if v_o.status = 'cancelled' or exists (select 1 from public.order_cancellations where order_id = p_order) then
    raise exception 'DEVOLUCION_NO_PERMITIDA: el pedido está cancelado';
  end if;
  if v_o.status not in ('shipped','delivered','fulfilled') then
    raise exception 'DEVOLUCION_NO_PERMITIDA: el pedido está % %', v_o.status,
      case when v_o.status = 'packed' then ' (si no ha salido, cancélalo)' else '' end;
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'RENGLONES_REQUERIDOS';
  end if;

  for r in select x.lot_id, x.qty, x.inspection from jsonb_to_recordset(p_lines) as x(lot_id uuid, qty int, inspection text) loop
    if r.qty is null or r.qty <= 0 then raise exception 'CANTIDAD_INVALIDA: cada renglón debe ser mayor a cero'; end if;
    if r.inspection is null or r.inspection not in ('ok','dañado') then
      raise exception 'INSPECCION_REQUERIDA: indica ok o dañado por renglón';
    end if;
    if r.lot_id is null or not exists (select 1 from public.lots where id = r.lot_id) then raise exception 'LOTE_INEXISTENTE'; end if;
  end loop;

  for r in select x.lot_id, sum(x.qty) as q from jsonb_to_recordset(p_lines) as x(lot_id uuid, qty int, inspection text) group by x.lot_id loop
    select coalesce(sum(-change), 0) into v_out from public.inventory_movements
     where order_id = p_order and lot_id = r.lot_id and reason in ('surtido','venta');
    if v_out = 0 then raise exception 'LOTE_NO_SURTIDO_EN_PEDIDO: el lote % no salió en este pedido', r.lot_id; end if;
    select coalesce(sum(qty), 0) into v_prev_ret from public.stock_return_lines where order_id = p_order and lot_id = r.lot_id;
    if r.q + v_prev_ret > v_out then
      raise exception 'DEVOLUCION_EXCEDE_SURTIDO: lote %: surtido %, ya devuelto %, solicitado %', r.lot_id, v_out, v_prev_ret, r.q;
    end if;
  end loop;

  insert into public.stock_returns (id, order_id, origin, notes, created_by)
  values (p_op_id, p_order, 'devolucion', nullif(btrim(p_notes), ''), v_uid);

  for r in
    select x.lot_id, x.qty, x.inspection, x.notes, l.product_id, l.expiry_date
      from jsonb_to_recordset(p_lines) as x(lot_id uuid, qty int, inspection text, notes text)
      join public.lots l on l.id = x.lot_id
  loop
    select case when count(distinct m.order_item_id) = 1 then min(m.order_item_id::text)::uuid end into v_item
      from public.inventory_movements m
     where m.order_id = p_order and m.lot_id = r.lot_id and m.reason in ('surtido','venta');
    insert into public.stock_return_lines (return_id, order_id, order_item_id, product_id, lot_id, qty,
                                           inspection, inspected_by, inspected_at, notes)
    values (p_op_id, p_order, v_item, r.product_id, r.lot_id, r.qty,
            case when public.lote_caducado(r.expiry_date) then 'caducado' else r.inspection end,
            v_uid, now(), nullif(btrim(r.notes), ''));
    v_n := v_n + 1; v_q := v_q + r.qty;
  end loop;

  v_res := jsonb_build_object('status', 'applied', 'return_id', p_op_id, 'order_id', p_order, 'renglones', v_n, 'cantidad', v_q);
  return public._w1_op_finish(p_op_id, 'recepcion_devolucion', v_req, v_res);
end;
$function$;

CREATE OR REPLACE FUNCTION public.recibir_lote(p_op_id uuid, p_product uuid, p_lote text, p_caducidad date, p_cantidad integer, p_replenishment_id uuid DEFAULT NULL::uuid, p_kind text DEFAULT 'orden'::text, p_unit_cost numeric DEFAULT NULL::numeric, p_reason text DEFAULT NULL::text, p_evidence text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role text := public.auth_role();
  v_uid  uuid := auth.uid();
  v_req  jsonb; v_prev jsonb; v_res jsonb;
  v_rep  record;
  v_norm text; v_lot uuid; v_oldq int; v_oldc numeric; v_exp date;
  v_inc  numeric; v_newc numeric; v_created boolean := false;
  v_rec_status text; v_rec_qty int; v_rec_pend int;
begin
  if p_kind is null or p_kind not in ('orden','sin_orden','excedente') then
    raise exception 'TIPO_RECEPCION_INVALIDO: usa orden, sin_orden o excedente';
  end if;
  if p_kind = 'orden' then
    if not (v_role = any (array['admin','warehouse'])) then
      raise exception 'NO_AUTORIZADO: sin permiso para recibir inventario';
    end if;
  elsif v_role <> 'admin' then
    raise exception 'NO_AUTORIZADO: una entrada % requiere autorización de Dirección', p_kind;
  end if;

  v_req := jsonb_build_object('product', p_product, 'lote', p_lote, 'caducidad', p_caducidad,
             'cantidad', p_cantidad, 'replenishment', p_replenishment_id, 'kind', p_kind,
             'unit_cost', p_unit_cost, 'reason', p_reason, 'evidence', p_evidence);
  v_prev := public._w1_op_begin(p_op_id, 'recepcion', v_req);
  if v_prev is not null then return v_prev; end if;

  if p_product is null or not exists (select 1 from public.products where id = p_product) then
    raise exception 'PRODUCTO_INEXISTENTE';
  end if;
  if coalesce(public.lote_code_norm(p_lote), '') = '' then raise exception 'LOTE_REQUERIDO'; end if;
  if p_cantidad is null or p_cantidad <= 0 then raise exception 'CANTIDAD_INVALIDA: la cantidad debe ser mayor a cero'; end if;
  if p_caducidad is null then raise exception 'CADUCIDAD_REQUERIDA: toda recepción requiere fecha de caducidad'; end if;
  if public.lote_caducado(p_caducidad) then
    raise exception 'CADUCADO_NO_RECIBIBLE: el producto caducó el % (hoy %); no entra como stock', p_caducidad, public.hoy_local();
  end if;
  if p_kind <> 'orden' and nullif(btrim(p_reason), '') is null then
    raise exception 'MOTIVO_REQUERIDO: una entrada % requiere motivo', p_kind;
  end if;

  if p_kind in ('orden','excedente') then
    if p_replenishment_id is null then raise exception 'ORDEN_REQUERIDA: indica la orden de compra/producción'; end if;
    select * into v_rep from public.replenishments where id = p_replenishment_id for update;
    if not found then raise exception 'ORDEN_INEXISTENTE'; end if;
    if v_rep.product_id is distinct from p_product then
      raise exception 'ORDEN_PRODUCTO_DISTINTO: la orden es de otro producto';
    end if;
    if p_kind = 'orden' then
      if v_rep.status not in ('pendiente','parcial') then
        raise exception 'ORDEN_CERRADA: la orden está % y no se reabre; genera una nueva', v_rep.status;
      end if;
      if p_cantidad > v_rep.qty - v_rep.received_qty then
        raise exception 'RECEPCION_EXCEDE_PENDIENTE: pendiente de recibir % (pedido %, recibido %). El excedente va como entrada separada con autorización de Dirección.',
          v_rep.qty - v_rep.received_qty, v_rep.qty, v_rep.received_qty;
      end if;
    end if;
  elsif p_replenishment_id is not null then
    raise exception 'SIN_ORDEN_CON_ORDEN: una entrada sin orden no referencia una orden';
  end if;

  -- Costo de ESTA entrada (misma semántica previa): orden → costo de la orden; si no,
  -- costo explícito o costo de referencia; si tampoco hay → NULL (desconocido, no se fabrica).
  if p_kind = 'orden' then
    v_inc := v_rep.unit_cost;
  elsif p_kind = 'excedente' then
    v_inc := coalesce(p_unit_cost, v_rep.unit_cost);
  else
    v_inc := coalesce(p_unit_cost, (select unit_cost from public.product_costs where product_id = p_product));
  end if;

  -- Identidad canónica: producto + código normalizado (UNIQUE). Crear si no existe.
  v_norm := public.lote_code_norm(p_lote);
  insert into public.lots (product_id, lot_code, expiry_date, quantity, unit_cost)
  values (p_product, regexp_replace(btrim(p_lote), '\s+', ' ', 'g'), p_caducidad, 0, v_inc)
  on conflict (product_id, lot_code_norm) do nothing
  returning id into v_lot;
  v_created := v_lot is not null;

  select id, quantity, unit_cost, expiry_date into v_lot, v_oldq, v_oldc, v_exp
    from public.lots where product_id = p_product and lot_code_norm = v_norm for update;
  if v_exp is distinct from p_caducidad then
    raise exception 'LOTE_CADUCIDAD_DISTINTA: el lote % ya existe con caducidad % (recibida %). No se fusiona ni se sustituye.',
      p_lote, v_exp, p_caducidad;
  end if;
  if v_created then v_oldq := 0; v_oldc := null; end if;

  -- Costo del LOTE (preservado): promedio ponderado solo con ambos conocidos; nunca fabrica costo.
  v_newc := case
    when v_inc is null then v_oldc
    when coalesce(v_oldq, 0) <= 0 then v_inc
    when v_oldc is null then null
    else round((v_oldq * v_oldc + p_cantidad * v_inc) / (v_oldq + p_cantidad), 4)
  end;

  update public.lots set quantity = quantity + p_cantidad, unit_cost = v_newc where id = v_lot;

  insert into public.purchase_receipts (id, kind, replenishment_id, product_id, lot_id, qty, unit_cost,
                                        reason, evidence_ref, received_by, authorized_by)
  values (p_op_id, p_kind, p_replenishment_id, p_product, v_lot, p_cantidad, v_inc,
          nullif(btrim(p_reason), ''), nullif(btrim(p_evidence), ''), v_uid,
          case when p_kind <> 'orden' then v_uid end);

  insert into public.inventory_movements (lot_id, change, reason, reference, created_by, unit_cost, op_id, receipt_id)
  values (v_lot, p_cantidad, 'entrada',
          case when p_kind = 'orden' then 'OC ' || p_replenishment_id::text else p_kind || ': ' || btrim(p_reason) end,
          v_uid, v_inc, p_op_id, p_op_id);

  if p_kind = 'orden' then
    perform public._w1_trusted(true);
    update public.replenishments
       set received_qty = received_qty + p_cantidad,
           status = case when received_qty + p_cantidad = qty then 'recibida' else 'parcial' end
     where id = p_replenishment_id
     returning status, received_qty, qty - received_qty into v_rec_status, v_rec_qty, v_rec_pend;
    perform public._w1_trusted(false);
  end if;

  v_res := jsonb_build_object('status', 'applied', 'op_id', p_op_id, 'receipt_id', p_op_id, 'kind', p_kind,
             'lot_id', v_lot, 'lot_created', v_created, 'lot_unit_cost', v_newc,
             'replenishment_id', p_replenishment_id, 'replenishment_status', v_rec_status,
             'received_qty', v_rec_qty, 'pending_qty', v_rec_pend);
  return public._w1_op_finish(p_op_id, 'recepcion', v_req, v_res);
end;
$function$;

CREATE OR REPLACE FUNCTION public.registrar_perdida_custodia(p_op_id uuid, p_custody uuid, p_kind text, p_lines jsonb, p_motivo text, p_evidencia text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_req jsonb; v_prev jsonb; v_cus record; v_ln record; v_u int := 0;
begin
  if not (public.auth_role() = any (array['admin','warehouse'])) then
    raise exception 'NO_AUTORIZADO: solo Almacén o Dirección registran una pérdida de custodia';
  end if;
  v_req := jsonb_build_object('custody', p_custody, 'kind', p_kind, 'lines', p_lines,
             'motivo', p_motivo, 'evidencia', p_evidencia);
  v_prev := public._w2c_op_begin(p_op_id, 'perdida', v_req);
  if v_prev is not null then return v_prev; end if;

  if p_kind not in ('faltante','merma','caducado') then
    raise exception 'TIPO_INVALIDO: usa faltante, merma o caducado';
  end if;
  if nullif(btrim(p_motivo), '') is null then raise exception 'MOTIVO_REQUERIDO: toda pérdida lleva motivo'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'PERDIDA_SIN_RENGLONES';
  end if;
  select * into v_cus from public.custodies where id = p_custody for update;
  if not found then raise exception 'CUSTODIA_INEXISTENTE'; end if;
  if v_cus.status <> 'abierta' then raise exception 'CUSTODIA_CERRADA: esa custodia ya se cerró'; end if;

  for v_ln in select x.lot_id, x.qty from jsonb_to_recordset(p_lines) as x(lot_id uuid, qty int) loop
    perform public._w2c_perdida(p_custody, p_kind, v_ln.lot_id, v_ln.qty, p_motivo, p_evidencia, p_op_id);
    v_u := v_u + v_ln.qty;
  end loop;

  return public._w2c_op_finish(p_op_id, 'perdida', v_req,
    jsonb_build_object('status', 'applied', 'custody_id', p_custody, 'kind', p_kind, 'unidades', v_u,
                       'nota', 'Pérdida de inventario de la empresa. NO genera deuda del tenedor.'));
end;
$function$;
