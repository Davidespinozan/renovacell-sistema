-- ROLLBACK ENVÍOS EXTRA (20270407850000). OJO: si ya hay pedidos con 2+ guías vivas, los índices por pedido no se pueden recrear: resolver esos envíos antes.
begin;
CREATE OR REPLACE FUNCTION public.crear_pedido_con_entrega(p_order_id uuid, p_folio text, p_doctor_id uuid, p_lines jsonb, p_shipping_meta jsonb, p_invoice_requested boolean, p_customer_id uuid, p_receiver jsonb, p_entrega jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_rol text := public.auth_role(); v_actor text; v_res jsonb; v_ent jsonb; v_cp text; o record; v_tipo text;
begin
  if not ((v_rol = 'doctor' and p_doctor_id = auth.uid() and public.is_verified()) or v_rol = any (array['admin', 'pos'])) then
    raise exception 'No autorizado';
  end if;
  v_actor := case when v_rol = 'doctor' then 'doctor' else 'staff' end;
  if p_entrega is null or jsonb_typeof(p_entrega) <> 'object' then raise exception 'ENTREGA_REQUERIDA: el pedido necesita cómo se entrega' using errcode = 'check_violation'; end if;
  -- La opción se valida con un importe provisional (0) solo para saber si exige domicilio; el costo real se calcula
  -- después con el importe que fija crear_pedido.
  v_tipo := (select x ->> 'tipo' from jsonb_array_elements(public.entrega_opciones(v_actor, 0, null, now()) -> 'opciones') x where x ->> 'id' = p_entrega ->> 'opcion');
  if v_tipo is null then raise exception 'ENTREGA_INVALIDA: opción de entrega desconocida' using errcode = 'check_violation'; end if;
  v_cp := nullif(btrim(coalesce(p_shipping_meta -> 'address' ->> 'cp', '')), '');
  if v_tipo in ('foraneo', 'local') and (public._cc_chk_direccion_snapshot(p_shipping_meta -> 'address') is null or v_cp !~ '^[0-9]{5}$') then
    raise exception 'ENTREGA_SIN_DIRECCION: ese tipo de entrega necesita calle y código postal de 5 dígitos' using errcode = 'check_violation';
  end if;

  v_res := public.crear_pedido_con_receptor(p_order_id, p_folio, p_doctor_id, p_lines, p_shipping_meta, p_invoice_requested, p_customer_id, p_receiver);
  if coalesce((v_res ->> 'idempotent')::boolean, false) then
    select shipping_cost, total, shipping_meta -> 'entrega' as entrega into o from public.orders where id = p_order_id;
    return v_res || jsonb_build_object('total', o.total, 'envio', o.shipping_cost, 'entrega', o.entrega);
  end if;
  v_ent := public._entrega_normalizar(v_actor, (v_res ->> 'total')::numeric, v_cp, p_entrega, now());
  perform public._entrega_aplicar(p_order_id, v_ent);
  return v_res || jsonb_build_object('subtotal', (v_res ->> 'total')::numeric, 'envio', (v_ent ->> 'flete')::numeric,
                                     'total', (v_res ->> 'total')::numeric + (v_ent ->> 'flete')::numeric, 'entrega', v_ent);
end;
$function$

;
CREATE OR REPLACE FUNCTION public._entrega_aplicar(p_order uuid, p_entrega jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare o record; v_trusted text := coalesce(current_setting('app.trusted', true), ''); v_costo numeric := (p_entrega ->> 'flete')::numeric;
        v_f date; v_i time; v_fin time; v_cupo smallint;
begin
  select id, shipping_cost, shipping_meta into o from public.orders where id = p_order for update;
  if not found then raise exception 'PEDIDO_INEXISTENTE'; end if;
  if o.shipping_meta ? 'entrega' then
    if o.shipping_meta -> 'entrega' ->> 'opcion' = p_entrega ->> 'opcion' and o.shipping_cost = v_costo then return; end if;   -- ya aplicada (reintento)
    raise exception 'ENTREGA_YA_FIJADA: la entrega del pedido ya quedó registrada' using errcode = 'check_violation';
  end if;
  -- ENT-H · reserva del horario (entrega local por chofer). Candado por horario: dos pedidos al mismo horario se serializan.
  if p_entrega ? 'horario' then
    v_f := (p_entrega -> 'horario' ->> 'fecha')::date; v_i := (p_entrega -> 'horario' ->> 'inicio')::time; v_fin := (p_entrega -> 'horario' ->> 'fin')::time;
    perform pg_advisory_xact_lock(hashtext('entrega_horario'), hashtext(v_f::text || ' ' || v_i::text));
    select horario_cupo into v_cupo from public.entrega_config where id = 1;
    if public._entrega_horario_ocupados(v_f, v_i) >= v_cupo then
      raise exception 'HORARIO_OCUPADO: ese horario de entrega ya está ocupado; elige otro' using errcode = 'check_violation';
    end if;
    insert into public.entrega_horarios (order_id, fecha, inicio, fin, created_by) values (p_order, v_f, v_i, v_fin, auth.uid());
  end if;
  perform set_config('app.trusted', 'on', true);
  update public.orders
     set shipping_cost = v_costo, total = coalesce(total, 0) + v_costo,
         shipping_meta = coalesce(shipping_meta, '{}'::jsonb) || jsonb_build_object('entrega', p_entrega)
   where id = p_order;
  perform set_config('app.trusted', v_trusted, true);
end;
$function$

;
CREATE OR REPLACE FUNCTION public.finalize_shipment(p_attempt_id uuid, p_shipment jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_order uuid := (p_shipment->>'order_id')::uuid;
  v_existing uuid;
  v_id uuid;
begin
  if not (coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role','') = 'service_role'
          or public.auth_role() = any (array['admin','warehouse','packing'])) then
    raise exception 'NO_AUTORIZADO';
  end if;

  -- Idempotencia dura: una guía (tracking) por pedido.
  select id into v_existing from public.shipments
   where order_id = v_order and tracking_number is not null limit 1;
  if v_existing is not null then
    update public.shipping_attempts
       set status = 'succeeded',
           tracking_number = coalesce(tracking_number, p_shipment->>'tracking_number'),
           updated_at = now()
     where id = p_attempt_id;
    return jsonb_build_object('ok', true, 'shipment_id', v_existing, 'reused', true);
  end if;

  insert into public.shipments (
    order_id, carrier, tracking_number, status, estimated_delivery_at, provider, service_code,
    label_path, package, ship_from, ship_to, provider_meta, provider_cost, currency, quote_ref
  ) values (
    v_order,
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

  return jsonb_build_object('ok', true, 'shipment_id', v_id);
end;
$function$

;
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
$function$

;
CREATE OR REPLACE FUNCTION public.reconciliar_guia(p_op_id uuid, p_attempt uuid, p_resolucion text, p_consulta jsonb, p_motivo text, p_tracking text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- DHL D1 · Resuelve un intento de guía en estado desconocido con hechos del proveedor obtenidos por el SERVIDOR.
-- `p_consulta` la arma la Edge `shipping` (acción reconciliar_guia): { consultado_en, referencia,
--   por_referencia: { realizada, resultado: 'sin_resultados'|'encontradas'|'error', encontradas: [guia…] },
--   por_tracking?:  { realizada, tracking, resultado, encontradas: [guia…] },
--   portal_revisado, acepta_duplicado_tardio }
-- guia = { tracking, referencias: [texto…], producto, destino_cp, peso_total, piezas }.
-- Un 404 del proveedor nunca prueba que la guía no existe: 'sin_guia' es una decisión de Dirección bajo riesgo declarado.
declare
  v_rol text := public.auth_role(); v_uid uuid := auth.uid();
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_tracking text := nullif(btrim(coalesce(p_tracking, '')), '');
  v_req jsonb; v_prev jsonb; v_res jsonb; v_fin jsonb;
  a public.shipping_attempts; o record;
  v_consultado timestamptz; v_ref text;
  v_por_ref jsonb; v_por_tn jsonb; v_hallazgos jsonb; v_guia jsonb; v_cand jsonb; v_distintas int;
  v_request jsonb; v_cp_snapshot text; v_peso numeric; v_piezas int; v_producto text;
  v_env jsonb; v_shipment uuid; v_trusted text := coalesce(current_setting('app.trusted', true), '');
begin
  if v_rol is distinct from 'admin' then
    raise exception 'NO_AUTORIZADO: solo Dirección resuelve un intento de guía en estado desconocido';
  end if;
  -- La consulta NO entra en la huella de la operación: un reintento con el mismo op_id trae una consulta más reciente.
  v_req := jsonb_build_object('attempt', p_attempt, 'resolucion', p_resolucion, 'tracking', v_tracking, 'motivo', v_motivo);
  v_prev := public._w1_op_begin(p_op_id, 'reconciliacion_guia', v_req);
  if v_prev is not null then return v_prev; end if;

  if p_resolucion not in ('sin_guia', 'guia_confirmada') then
    raise exception 'RESOLUCION_INVALIDA: la resolución es sin_guia o guia_confirmada';
  end if;
  if v_motivo is null or length(v_motivo) < 10 or length(v_motivo) > 400 then
    raise exception 'MOTIVO_REQUERIDO: explica la decisión (10 a 400 caracteres)';
  end if;

  select * into a from public.shipping_attempts where id = p_attempt for update;
  if not found then raise exception 'INTENTO_INEXISTENTE'; end if;
  if a.status <> 'unknown_requires_reconciliation' then
    raise exception 'ESTADO_INVALIDO: solo se reconcilia un intento en estado desconocido (este está %)', a.status;
  end if;
  select id, status, external_ref into o from public.orders where id = a.order_id for update;   -- una resolución a la vez por pedido
  if not found then raise exception 'PEDIDO_INEXISTENTE'; end if;
  if o.status <> 'packed' then
    raise exception 'PEDIDO_NO_EMPACADO: el pedido del intento está % y no empacado; revisa antes de reconciliar', o.status;
  end if;
  if exists (select 1 from public.shipments s where s.order_id = a.order_id and s.tracking_number is not null) then
    raise exception 'ESTADO_INCONSISTENTE: el pedido ya tiene una guía registrada; el intento no debería seguir en desconocido';
  end if;

  -- ── La consulta del servidor: realizada, reciente y de ESTE intento ──
  if p_consulta is null or jsonb_typeof(p_consulta) <> 'object' then raise exception 'CONSULTA_INCOMPLETA: falta la consulta al proveedor'; end if;
  begin
    v_consultado := (p_consulta ->> 'consultado_en')::timestamptz;
  exception when others then v_consultado := null;
  end;
  if v_consultado is null then raise exception 'CONSULTA_INCOMPLETA: la consulta no indica cuándo se hizo'; end if;
  if v_consultado < now() - interval '30 minutes' or v_consultado > now() + interval '5 minutes' then
    raise exception 'CONSULTA_CADUCA: la consulta al proveedor debe tener menos de 30 minutos';
  end if;
  v_ref := replace(coalesce(a.external_reference, a.id::text), '-', '');
  if coalesce(p_consulta ->> 'referencia', '') <> v_ref then
    raise exception 'CONSULTA_AJENA: la consulta no corresponde a la referencia de este intento';
  end if;
  v_por_ref := p_consulta -> 'por_referencia';
  if v_por_ref is null or coalesce((v_por_ref ->> 'realizada')::boolean, false) is not true
     or coalesce(v_por_ref ->> 'resultado', '') not in ('sin_resultados', 'encontradas') then
    raise exception 'CONSULTA_INCOMPLETA: la búsqueda por referencia no se completó (%)', coalesce(v_por_ref ->> 'resultado', 'sin resultado');
  end if;
  v_por_tn := p_consulta -> 'por_tracking';
  if v_por_tn is not null and jsonb_typeof(v_por_tn) = 'object'
     and (coalesce((v_por_tn ->> 'realizada')::boolean, false) is not true or coalesce(v_por_tn ->> 'resultado', '') not in ('sin_resultados', 'encontradas')) then
    raise exception 'CONSULTA_INCOMPLETA: la búsqueda por número no se completó (%)', coalesce(v_por_tn ->> 'resultado', 'sin resultado');
  end if;
  -- Todo lo hallado, por referencia y por número.
  v_hallazgos := coalesce(case when jsonb_typeof(v_por_ref -> 'encontradas') = 'array' then v_por_ref -> 'encontradas' end, '[]'::jsonb)
              || coalesce(case when v_por_tn is not null and jsonb_typeof(v_por_tn -> 'encontradas') = 'array' then v_por_tn -> 'encontradas' end, '[]'::jsonb);
  select count(distinct g ->> 'tracking') into v_distintas from jsonb_array_elements(v_hallazgos) g where nullif(g ->> 'tracking', '') is not null;

  if p_resolucion = 'sin_guia' then
    if now() - greatest(a.created_at, a.updated_at) < interval '60 minutes' then
      raise exception 'CIERRE_PREMATURO: espera al menos 60 minutos desde el intento antes de resolver sin guía';
    end if;
    if v_distintas > 0 then
      raise exception 'HALLAZGOS_EXISTEN: el proveedor devolvió % guía(s); no se puede resolver como sin guía', v_distintas;
    end if;
    if coalesce((p_consulta ->> 'portal_revisado')::boolean, false) is not true then
      raise exception 'REVISION_REQUERIDA: confirma que revisaste el portal MyDHL sin encontrar la guía';
    end if;
    if coalesce((p_consulta ->> 'acepta_duplicado_tardio')::boolean, false) is not true then
      raise exception 'RIESGO_NO_ACEPTADO: resolver sin guía exige aceptar que, si DHL la creó, aparecerá después como duplicado';
    end if;
    v_env := p_consulta || jsonb_build_object('resolucion', 'sin_guia', 'motivo', v_motivo, 'op_id', p_op_id, 'advertencia',
               'Un 404 del proveedor no prueba que la guía no exista. Si aparece después, la consulta previa a la siguiente guía la detectará y Dirección deberá tratarla en el portal.');
    update public.shipping_attempts
       set status = 'failed_safe_to_retry',
           error = left('Reconciliado por Dirección como sin guía (riesgo de duplicado tardío aceptado): ' || v_motivo, 300),
           reconciliacion = v_env, reconciled_by = v_uid, reconciled_at = now(), updated_at = now()
     where id = a.id;
    begin
      perform public.log_audit('Intento de guía reconciliado: sin guía', coalesce(o.external_ref, a.order_id::text), 'referencia ' || v_ref || ' · ' || v_motivo, 'Dirección');
    exception when others then null;
    end;
    v_res := jsonb_build_object('status', 'applied', 'resolucion', 'sin_guia', 'order_id', a.order_id, 'attempt_id', a.id, 'order_status', o.status);
    return public._w1_op_finish(p_op_id, 'reconciliacion_guia', v_req, v_res);
  end if;

  -- ── guia_confirmada ──
  if v_tracking is null then raise exception 'TRACKING_REQUERIDO: indica el número de guía hallado'; end if;
  if v_tracking !~ '^[0-9]{10}$' then raise exception 'TRACKING_INVALIDO: una guía de DHL Express tiene 10 dígitos'; end if;
  v_request := a.request;
  if v_request is null or jsonb_typeof(v_request) <> 'object' or v_request -> 'pkg' is null or v_request -> 'receiver' is null then
    raise exception 'SIN_SNAPSHOT: el intento no guardó la petición original; no se puede registrar la guía sin inventar datos';
  end if;
  if v_distintas > 1 then
    raise exception 'AMBIGUO: el proveedor devolvió % guías distintas para este intento; no se registra ninguna', v_distintas;
  end if;
  select g into v_guia from jsonb_array_elements(v_hallazgos) g where g ->> 'tracking' = v_tracking limit 1;
  if v_guia is null then
    raise exception 'COINCIDENCIA_INSUFICIENTE: la guía % no aparece en la consulta del servidor', v_tracking;
  end if;
  if not exists (select 1 from jsonb_array_elements_text(coalesce(case when jsonb_typeof(v_guia -> 'referencias') = 'array' then v_guia -> 'referencias' end, '[]'::jsonb)) r where r = v_ref) then
    raise exception 'COINCIDENCIA_INSUFICIENTE: la guía no lleva la referencia de este intento';
  end if;
  v_producto := coalesce(v_request ->> 'productCode', a.service_code);
  if nullif(v_guia ->> 'producto', '') is null or v_guia ->> 'producto' <> v_producto then
    raise exception 'COINCIDENCIA_INSUFICIENTE: el servicio de la guía (%) no es el del intento (%)', coalesce(v_guia ->> 'producto', '?'), v_producto;
  end if;
  v_cp_snapshot := regexp_replace(coalesce(v_request -> 'receiver' -> 'address' ->> 'cp', ''), '\D', '', 'g');
  if v_cp_snapshot = '' or regexp_replace(coalesce(v_guia ->> 'destino_cp', ''), '\D', '', 'g') <> v_cp_snapshot then
    raise exception 'COINCIDENCIA_INSUFICIENTE: el CP de destino de la guía (%) no es el del pedido (%)', coalesce(v_guia ->> 'destino_cp', '?'), v_cp_snapshot;
  end if;
  begin
    v_peso := (v_request -> 'pkg' ->> 'weightKg')::numeric; v_piezas := (v_request -> 'pkg' ->> 'pieces')::int;
  exception when others then v_peso := null; v_piezas := null;
  end;
  if v_peso is null or v_peso <= 0 or nullif(v_guia ->> 'peso_total', '') is null
     or abs((v_guia ->> 'peso_total')::numeric - v_peso) > v_peso * 0.10 then
    raise exception 'COINCIDENCIA_INSUFICIENTE: el peso de la guía (%) no coincide con el del paquete (%)', coalesce(v_guia ->> 'peso_total', '?'), coalesce(v_peso::text, '?');
  end if;
  if v_piezas is null or nullif(v_guia ->> 'piezas', '') is null or (v_guia ->> 'piezas')::int <> v_piezas then
    raise exception 'COINCIDENCIA_INSUFICIENTE: las piezas de la guía (%) no coinciden con las del paquete (%)', coalesce(v_guia ->> 'piezas', '?'), coalesce(v_piezas::text, '?');
  end if;
  if exists (select 1 from public.shipments s where s.tracking_number = v_tracking) then
    raise exception 'GUIA_YA_REGISTRADA: la guía % ya está registrada en otro envío', v_tracking;
  end if;

  v_env := p_consulta || jsonb_build_object('resolucion', 'guia_confirmada', 'motivo', v_motivo, 'op_id', p_op_id, 'tracking', v_tracking, 'guia', v_guia);
  v_fin := public.finalize_shipment(a.id, jsonb_build_object(
    'order_id', a.order_id, 'carrier', 'DHL', 'tracking_number', v_tracking, 'status', 'in_transit',
    'provider', 'dhl', 'service_code', v_producto, 'label_path', null,
    'package', v_request -> 'pkg', 'ship_from', v_request -> 'shipper', 'ship_to', v_request -> 'receiver',
    'provider_meta', jsonb_build_object('trackingNumber', v_tracking, 'labelFormat', null,
        'reconciliada', jsonb_build_object('op_id', p_op_id, 'por', v_uid, 'at', now(), 'motivo', v_motivo, 'referencia', v_ref))
        || case when a.provider_cost is null then jsonb_build_object('costo_pendiente', true) else '{}'::jsonb end,
    'provider_cost', a.provider_cost, 'currency', a.currency, 'quote_ref', coalesce(a.quote_ref, v_producto)));
  v_shipment := (v_fin ->> 'shipment_id')::uuid;
  update public.shipping_attempts
     set reconciliacion = v_env, reconciled_by = v_uid, reconciled_at = now(), error = null, updated_at = now()
   where id = a.id;
  -- El pedido pasa a enviado como lo haría Empaque al generar la guía; su aviso "va en camino" sale por el camino normal.
  perform set_config('app.trusted', 'on', true);
  update public.orders
     set status = 'shipped',
         shipping_meta = coalesce(shipping_meta, '{}'::jsonb) || jsonb_build_object('method', 'paqueteria', 'carrier', 'DHL', 'tracking', v_tracking)
   where id = a.order_id and status = 'packed';
  perform set_config('app.trusted', v_trusted, true);
  begin
    perform public.log_audit('Intento de guía reconciliado: guía confirmada', coalesce(o.external_ref, a.order_id::text), 'guía ' || v_tracking || ' · referencia ' || v_ref || ' · ' || v_motivo, 'Dirección');
  exception when others then null;
  end;
  v_res := jsonb_build_object('status', 'applied', 'resolucion', 'guia_confirmada', 'order_id', a.order_id, 'attempt_id', a.id, 'tracking', v_tracking,
                              'shipment_id', v_shipment, 'order_status', 'shipped', 'costo_pendiente', a.provider_cost is null);
  return public._w1_op_finish(p_op_id, 'reconciliacion_guia', v_req, v_res);
end;
$function$

;
CREATE OR REPLACE FUNCTION public.confirmar_entrega(p_shipment_id uuid, p_proof_path text DEFAULT NULL::text, p_received_by text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid    uuid := auth.uid();
  v_rol    text;
  v_staff  boolean;
  v_path   text := nullif(btrim(p_proof_path), '');
  s        public.shipments;
begin
  if v_uid is null then
    raise exception 'No tienes permiso para cerrar esta entrega';
  end if;
  v_rol := public.auth_role();          -- lanza CUENTA_SUSPENDIDA si la cuenta está suspendida
  v_staff := v_rol in ('admin', 'warehouse', 'packing');

  -- Candado de fila: dos cierres simultáneos del mismo envío se atienden uno tras otro.
  select * into s from public.shipments where id = p_shipment_id for update;
  if not found then
    raise exception 'El envío no existe';
  end if;

  -- Solo el chofer asignado (con rol de chofer vigente), o Almacén/Empaque/Dirección desde el escritorio.
  if not (v_staff or (v_rol = 'driver' and coalesce(s.driver_id = v_uid, false))) then
    raise exception 'No tienes permiso para cerrar esta entrega';
  end if;

  -- La evidencia es obligatoria: sin quién recibió, no hay entrega comprobable.
  if coalesce(btrim(p_received_by), '') = '' then
    raise exception 'Falta el nombre de quien recibió';
  end if;

  if s.status = 'delivered' then
    return; -- idempotente: reintento del celular sin señal no rompe nada (ni cambia receptor, fecha o evidencia)
  end if;
  if s.status = 'cancelado' then
    raise exception 'ENVIO_CANCELADO: un envío cancelado no se entrega';
  end if;
  -- El chofer entrega lo que ya trae a bordo: en reparto, o con una incidencia abierta.
  if not v_staff and s.status not in ('out_for_delivery', 'incident') then
    raise exception 'ESTADO_INVALIDO: confirma tu carga antes de entregar';
  end if;

  -- Evidencia: debe ser un archivo REAL de proofs/<archivo>, subido por el chofer del envío (o por quien cierra), y no
  -- ser ya la prueba de otro envío. La autoría la escribe Storage (owner / owner_id), no el cliente. Un solo mensaje
  -- para todos los casos: no se revela si un archivo ajeno existe.
  if v_path is not null then
    perform 1 from storage.objects o where o.bucket_id = 'proofs' and o.name = v_path for share;   -- un borrado en curso espera
    if not found
       or (storage.foldername(v_path))[1] is distinct from 'proofs'
       or array_length(storage.foldername(v_path), 1) is distinct from 1
       or exists (select 1 from storage.objects o where o.bucket_id = 'proofs' and o.name = v_path
                   and not ( coalesce(o.owner = v_uid, false) or coalesce(o.owner_id = v_uid::text, false)
                             or (v_staff and s.driver_id is not null
                                 and (coalesce(o.owner = s.driver_id, false) or coalesce(o.owner_id = s.driver_id::text, false))) ))
       or exists (select 1 from public.shipments x where md5(x.proof_image_url) = md5(v_path) and x.proof_image_url = v_path and x.id <> s.id) then
      raise exception 'EVIDENCIA_INVALIDA: la foto no existe, no la subiste tú o ya es la prueba de otra entrega';
    end if;
  end if;

  -- `orders_guard()` no reconoce al rol chofer y SECURITY DEFINER no cambia el JWT que el guard consulta: se abre su
  -- compuerta (ámbito: la transacción) y la del candado de envíos, solo para ESTE envío, y se cierran al terminar.
  perform set_config('app.trusted', 'on', true);
  perform set_config('app.sec_c3b_entrega', s.id::text, true);

  begin
    update public.shipments
       set status = 'delivered',
           delivered_at = now(),
           proof_image_url = coalesce(v_path, proof_image_url),
           received_by = p_received_by, incident = case when incident is null then null else incident || jsonb_build_object('resolved', true, 'resolved_on_delivery', true) end
     where id = s.id;
  exception when unique_violation then
    perform set_config('app.sec_c3b_entrega', '', true);
    perform set_config('app.trusted', 'off', true);
    raise exception 'EVIDENCIA_INVALIDA: la foto no existe, no la subiste tú o ya es la prueba de otra entrega';
  end;

  update public.orders
     set status = 'delivered'
   where id = s.order_id
     and status = 'shipped';   -- solo se entrega lo que salió

  perform set_config('app.sec_c3b_entrega', '', true);
  perform set_config('app.trusted', 'off', true);
end;
$function$

;
CREATE OR REPLACE FUNCTION public.shipping_attempts_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_status text;
begin
  select status into v_status from public.orders where id = new.order_id for share;
  if v_status = 'cancelled' or exists (select 1 from public.order_cancellations where order_id = new.order_id) then
    raise exception 'PEDIDO_CANCELADO: no se crea guía para un pedido cancelado' using errcode = 'check_violation';
  end if;
  if v_status is distinct from 'packed' then
    raise exception 'PEDIDO_NO_EMPACADO: solo se crea guía para un pedido empacado (está %)', coalesce(v_status, 'inexistente')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$function$

;
drop function if exists public.anular_guia_extra(uuid, uuid, int, text);
drop function if exists public._entrega_extras(text, jsonb, jsonb);
drop index if exists public.uq_shipments_order_tracking;
create unique index uq_shipments_order_tracking on public.shipments (order_id) where tracking_number is not null;
drop index if exists public.uq_shipments_un_envio_vivo;
create unique index uq_shipments_un_envio_vivo on public.shipments (order_id) where status <> all (array['cancelado', 'delivered']);
drop index if exists public.uq_shipping_attempts_active;
create unique index uq_shipping_attempts_active on public.shipping_attempts (order_id) where status = any (array['pending', 'succeeded', 'unknown_requires_reconciliation']);
alter table public.shipments drop constraint if exists ck_shipments_paquete, drop column if exists paquete;
alter table public.shipping_attempts drop constraint if exists ck_shipping_attempts_paquete, drop column if exists paquete;
alter table public.entrega_config drop column if exists envio_extra_costo;
delete from supabase_migrations.schema_migrations where version = '20270407850000';
commit;
