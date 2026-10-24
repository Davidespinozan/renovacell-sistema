-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- DHL D1 (migración 190) · RECUPERACIÓN SEGURA DE INTENTOS DE GUÍA EN ESTADO DESCONOCIDO
--   Hasta hoy un intento `unknown_requires_reconciliation` no tenía salida: el índice único impide otra guía, anular_guia
--   y anular_guia_manual lo rechazan y cancelar_pedido lo respeta. El pedido quedaba bloqueado hasta un SQL manual.
--   Qué agrega (aditivo, no redefine ningún comando ni candado existente):
--   · shipping_attempts.request          snapshot de la petición (origen, destinatario, paquete, servicio, folio) tomado al
--                                        reclamar el intento: lo que permite registrar una guía hallada sin inventar datos.
--   · shipping_attempts.reconciliacion   la consulta al proveedor y la decisión de Dirección (evidencia completa).
--   · shipping_attempts.reconciled_by/at quién y cuándo resolvió.
--   · inventory_operations.kind          nuevo tipo 'reconciliacion_guia' (registro idempotente por op_id, como anular_guia).
--   · reconciliar_guia(op, intento, resolución, consulta, motivo, tracking)   NUEVA. Solo Dirección. Dos salidas:
--       'sin_guia'         → el intento pasa a failed_safe_to_retry (libera el pedido para otra guía). Un 404 de DHL NO
--                            prueba inexistencia: exige ≥ 60 min, consulta por referencia del SERVIDOR sin resultados, sin
--                            ningún hallazgo, revisión del portal, motivo y aceptación expresa del riesgo de duplicado tardío.
--       'guia_confirmada'  → solo si la consulta del servidor halló EXACTAMENTE una guía con la referencia del intento y
--                            coincide en servicio, CP de destino, peso (±10 %) y piezas con el snapshot, y nadie más la tiene
--                            registrada. Entonces finalize_shipment (intento succeeded + envío) y el pedido pasa a enviado
--                            por el camino normal (su aviso sale como siempre). Costo: el del intento si existe; nunca inventado.
--       Cualquier otra combinación deja el intento bloqueado con un error explícito.
--   NO cambia: finalize_shipment, anular_guia, anular_guia_manual, cancelar_pedido, orders_guard, shipments_guard, RLS.
--   Depende de la 149 (PAQ-B). Aplicar en UNA transacción. Rollback: supabase/rollback/dhl_d1_reconciliacion/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'shipping_attempts' and column_name = 'request') then
    raise exception 'DHL D1: ya aplicada';
  end if;
  if to_regprocedure('public.anular_guia(uuid,uuid,text)') is null then raise exception 'DHL D1: falta PAQ-B (149): aplícala antes'; end if;
  if md5(pg_get_functiondef('public.finalize_shipment(uuid,jsonb)'::regprocedure)) <> 'a1cf5c01877e87f41ee0e9635b478e34'
     or md5(pg_get_functiondef('public.anular_guia(uuid,uuid,text)'::regprocedure)) <> '35015b5940b8848f001e18ce8d6e1356' then
    raise exception 'DHL D1: finalize_shipment / anular_guia no son las versiones auditadas';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.inventory_operations'::regclass and contype = 'c'
                   and pg_get_constraintdef(oid) like '%anulacion_guia%' and pg_get_constraintdef(oid) like '%alta_compra%') then
    raise exception 'DHL D1: la restricción de tipos de operación no es la esperada (122)';
  end if;
  if to_regprocedure('public._w1_op_begin(uuid,text,jsonb)') is null or to_regprocedure('public._w1_op_finish(uuid,text,jsonb,jsonb)') is null
     or to_regprocedure('public.log_audit(text,text,text,text)') is null then
    raise exception 'DHL D1: faltan los auxiliares de operación o bitácora';
  end if;
end $pre$;

-- ── 1) Evidencia en el intento ───────────────────────────────────────────────────────────────────────
alter table public.shipping_attempts
  add column request        jsonb,          -- snapshot de la petición al reclamar (shipper, receiver, pkg, productCode, orderRef)
  add column reconciliacion jsonb,          -- consulta al proveedor + decisión de Dirección
  add column reconciled_by  uuid,
  add column reconciled_at  timestamptz;

alter table public.shipping_attempts
  add constraint ck_shipping_attempts_reconciliacion
    check ((reconciliacion is null) = (reconciled_at is null) and (reconciled_by is null) = (reconciled_at is null));

comment on column public.shipping_attempts.request is 'DHL D1 · snapshot de la petición de guía al reclamar el intento (origen, destinatario, paquete, servicio, folio). Permite reconciliar sin inventar datos.';
comment on column public.shipping_attempts.reconciliacion is 'DHL D1 · consulta al proveedor (por referencia y, en su caso, por número) y decisión de Dirección sobre un intento desconocido.';

-- ── 2) Tipo de operación 'reconciliacion_guia' (registro idempotente por op_id) ─────────────────────
do $k$
declare v_name text;
begin
  select conname into v_name from pg_constraint
   where conrelid = 'public.inventory_operations'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%recepcion%carga_inicial%';
  if v_name is not null then execute format('alter table public.inventory_operations drop constraint %I', v_name); end if;
  alter table public.inventory_operations add constraint inventory_operations_kind_check check (kind in (
                 'recepcion','carga_inicial','cierre_compra','ajuste','surtido','venta_pos',
                 'cancelacion','reingreso_cancelacion','recepcion_devolucion',
                 'disposicion_devolucion','anulacion_guia',
                 'alta_compra',
                 'reconciliacion_guia'));
end $k$;

-- ── 3) Comando ──────────────────────────────────────────────────────────────────────────────────────
create function public.reconciliar_guia(p_op_id uuid, p_attempt uuid, p_resolucion text, p_consulta jsonb, p_motivo text, p_tracking text default null) returns jsonb
  language plpgsql security definer set search_path = public as
$$
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
$$;

alter function public.reconciliar_guia(uuid, uuid, text, jsonb, text, text) owner to postgres;
comment on function public.reconciliar_guia(uuid, uuid, text, jsonb, text, text) is 'DHL D1 · Dirección resuelve un intento de guía en estado desconocido con la consulta del servidor al proveedor: sin_guia (libera el pedido, riesgo aceptado) o guia_confirmada (registra la guía hallada si coincide con el intento). Idempotente por op_id.';
revoke all on function public.reconciliar_guia(uuid, uuid, text, jsonb, text, text) from public, anon, authenticated, service_role;
grant execute on function public.reconciliar_guia(uuid, uuid, text, jsonb, text, text) to authenticated;   -- la Edge la llama con la identidad de Dirección, nunca como servicio

do $post$ begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'shipping_attempts' and column_name = 'reconciliacion')
     or to_regprocedure('public.reconciliar_guia(uuid,uuid,text,jsonb,text,text)') is null then
    raise exception 'DHL D1: no quedó aplicada';
  end if;
  if has_function_privilege('anon', 'public.reconciliar_guia(uuid,uuid,text,jsonb,text,text)', 'execute')
     or has_function_privilege('service_role', 'public.reconciliar_guia(uuid,uuid,text,jsonb,text,text)', 'execute')
     or not has_function_privilege('authenticated', 'public.reconciliar_guia(uuid,uuid,text,jsonb,text,text)', 'execute')
     or (select not prosecdef or proconfig is distinct from array['search_path=public'] or proowner <> 'postgres'::regrole from pg_proc where oid = 'public.reconciliar_guia(uuid,uuid,text,jsonb,text,text)'::regprocedure) then
    raise exception 'DHL D1: forma o permisos de reconciliar_guia inesperados';
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.inventory_operations'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%reconciliacion_guia%') then
    raise exception 'DHL D1: el tipo de operación no quedó registrado';
  end if;
  if md5(pg_get_functiondef('public.finalize_shipment(uuid,jsonb)'::regprocedure)) <> 'a1cf5c01877e87f41ee0e9635b478e34'
     or md5(pg_get_functiondef('public.anular_guia(uuid,uuid,text)'::regprocedure)) <> '35015b5940b8848f001e18ce8d6e1356' then
    raise exception 'DHL D1: los comandos existentes cambiaron';
  end if;
end $post$;
