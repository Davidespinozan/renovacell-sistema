-- ============================================================================
-- W3-A · F3 — COMANDOS DE LA INTENCIÓN FISCAL (sin proveedor).
--
--  · solicitar_cfdi()             crea/actualiza la intención durable (pendiente)
--  · descartar_solicitud_cfdi()   pendiente → fallido, libera la ranura
--  · _w3_reclamar()               CIMIENTO del reclamo atómico (lo usa W3-B)
--  · _w3_transicion()             único camino de cambio de estado, siempre con bitácora
--  · estado_fiscal_pedido()       proyección de lectura para el operador
--  · conciliar_cfdi()             conciliación LOCAL (la externa es W3-B/D)
--
-- NADA de esto llama a Facturama, timbra, cancela ni lee credenciales. La salida
-- al PAC es W3-B. Aquí se construye el terreno seguro sobre el que pisará.
--
-- El registro de operaciones se INSERTA al final (_w3_op_finish): así la tabla es
-- de verdad append-only y su llave primaria resuelve las carreras —mismo patrón
-- probado en W2 y W2-C.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0) Infraestructura de comando: idempotencia, contexto confiable y bitácora.
-- ---------------------------------------------------------------------------
create function public._w3_op_begin(p_op uuid, p_kind text, p_req jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_prev record;
begin
  if p_op is null then raise exception 'OP_ID_REQUERIDO: toda operación fiscal lleva identificador'; end if;
  select * into v_prev from public.fiscal_operations where op_id = p_op;
  if not found then return null; end if;
  if v_prev.kind <> p_kind or v_prev.request <> p_req then
    raise exception 'OP_ID_REUTILIZADO: ese identificador ya se usó con otros datos';
  end if;
  return coalesce(v_prev.result, '{}'::jsonb) || jsonb_build_object('status', 'already_applied');
end;
$$;

create function public._w3_op_finish(p_op uuid, p_kind text, p_req jsonb, p_result jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$
begin
  insert into public.fiscal_operations (op_id, kind, actor, actor_role, request, result)
  values (p_op, p_kind, auth.uid(), coalesce(public.auth_role(), ''), p_req, p_result);
  return p_result;
end;
$$;

-- Cambio de estado: ATÓMICO, validado y SIEMPRE con su fila en la bitácora.
-- `p_from_expected` convierte esta función en el reclamo atómico del punto 2:
-- la condición viaja DENTRO del UPDATE, así que de dos sesiones concurrentes una
-- actualiza una fila y la otra ninguna. Devuelve null cuando no ganó.
create function public._w3_transicion(
  p_doc uuid, p_to text, p_event text,
  p_from_expected text default null,
  p_reason text default null, p_evidence jsonb default null,
  p_uuid text default null, p_provider_ref text default null, p_provider_env text default null,
  p_serie text default null, p_folio text default null, p_stamped_at timestamptz default null,
  p_error_code text default null, p_error_message text default null,
  p_claim uuid default null, p_reconcile_note text default null, p_op uuid default null
) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_trusted text := coalesce(current_setting('app.trusted', true), '');
  v_from text; v_row public.fiscal_documents;
begin
  select status into v_from from public.fiscal_documents where id = p_doc for update;
  if not found then raise exception 'FISCAL_DOCUMENTO_INEXISTENTE'; end if;
  if p_from_expected is not null and v_from <> p_from_expected then return null; end if;
  if not public._w3_transicion_valida(v_from, p_to) then
    raise exception 'FISCAL_TRANSICION_INVALIDA: % → % no es una transición permitida.', v_from, p_to;
  end if;

  perform set_config('app.trusted', 'on', true);
  perform set_config('renovacell.w3_transicion', 'on', true);
  update public.fiscal_documents d set
    status              = p_to,
    uuid                = coalesce(p_uuid, d.uuid),
    provider_ref        = coalesce(p_provider_ref, d.provider_ref),
    provider_env        = coalesce(p_provider_env, d.provider_env),
    serie               = coalesce(p_serie, d.serie),
    folio               = coalesce(p_folio, d.folio),
    provider_stamped_at = coalesce(p_stamped_at, d.provider_stamped_at),
    error_code          = case when p_to in ('fallido','incierto') then p_error_code else null end,
    error_message       = case when p_to in ('fallido','incierto') then left(coalesce(p_error_message, ''), 500) else null end,
    claim_id            = case when p_to = 'en_proceso' then coalesce(p_claim, d.claim_id) else d.claim_id end,
    claimed_at          = case when p_to = 'en_proceso' then now() else d.claimed_at end,
    claimed_by          = case when p_to = 'en_proceso' then auth.uid() else d.claimed_by end,
    attempts            = case when p_to = 'en_proceso' then d.attempts + 1 else d.attempts end,
    reconciled_at       = case when p_event = 'conciliacion' then now() else d.reconciled_at end,
    reconcile_note      = coalesce(p_reconcile_note, d.reconcile_note)
   where d.id = p_doc and d.status = v_from
  returning * into v_row;
  perform set_config('renovacell.w3_transicion', 'off', true);
  if v_row.id is null then
    perform set_config('app.trusted', v_trusted, true);
    return null;   -- otra sesión movió el documento entre el SELECT y el UPDATE
  end if;

  insert into public.fiscal_document_events (fiscal_document_id, from_status, to_status, event, reason, evidence, actor, actor_role, op_id)
  values (p_doc, v_from, p_to, p_event, p_reason, p_evidence, auth.uid(), coalesce(public.auth_role(), ''), p_op);

  -- La PROYECCIÓN se actualiza en la misma transacción que el estado. Así no existe la
  -- posibilidad de que un comando futuro (W3-B) mueva el estado y olvide proyectarlo: la
  -- única forma de cambiar de estado ya lo hace.
  perform public._w3_proyectar(v_row.order_id);
  perform set_config('app.trusted', v_trusted, true);

  return jsonb_build_object('doc_id', p_doc, 'from', v_from, 'status', p_to, 'uuid', v_row.uuid, 'attempts', v_row.attempts);
end;
$$;
comment on function public._w3_transicion(uuid, text, text, text, text, jsonb, text, text, text, text, text, timestamptz, text, text, uuid, text, uuid) is
  'ÚNICO camino de cambio de estado fiscal. Valida la transición, escribe la bitácora en la misma transacción y, con p_from_expected, funciona como reclamo atómico (devuelve null si no ganó).';

-- RECLAMO ATÓMICO — cimiento de W3-B. Probable en su totalidad sin Facturama.
create function public._w3_reclamar(p_doc uuid, p_claim uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
begin
  if p_claim is null then raise exception 'CLAIM_REQUERIDO: el reclamo lleva su propio identificador'; end if;
  return public._w3_transicion(p_doc => p_doc, p_to => 'en_proceso', p_event => 'claim',
    p_from_expected => 'pendiente', p_reason => 'reclamo de la intención fiscal', p_claim => p_claim);
end;
$$;
comment on function public._w3_reclamar(uuid, uuid) is
  'Reclama una intención `pendiente` para trabajarla. Devuelve null si otra sesión ya la tenía: es imposible que dos workers ganen la misma intención.';

-- ---------------------------------------------------------------------------
-- 1) RECEPTOR CANÓNICO server-side, en orden de autoridad:
--    override explícito → snapshot del pedido → maestro del cliente → perfil
--    legacy. Sin defaults silenciosos: lo que no se resuelve, no se inventa.
-- ---------------------------------------------------------------------------
create function public._w3_norm_legacy(p jsonb, p_email text default null) returns jsonb
  language sql immutable set search_path = public as
$$
  select public._fiscal_clean(jsonb_build_object(
    'rfc',               coalesce(p->>'rfc', ''),
    'razon_social',      coalesce(nullif(p->>'razon_social', ''), p->>'name', ''),
    'regimen',           coalesce(nullif(p->>'regimen', ''), p->>'taxRegime', ''),
    'cp',                coalesce(nullif(p->>'cp', ''), p->>'taxZip', ''),
    'uso_cfdi',          coalesce(nullif(p->>'uso_cfdi', ''), p->>'cfdiUse', ''),
    'email_facturacion', coalesce(nullif(p->>'email_facturacion', ''), nullif(p->>'email', ''), p_email, '')
  ));
$$;

create function public._w3_receptor(p_order uuid, p_override jsonb default null) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
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
$$;

-- ---------------------------------------------------------------------------
-- 2) PROYECCIÓN sobre el pedido. `orders.invoice_meta` deja de ser la verdad:
--    se deriva del documento fiscal (H-3). Se PRESERVA la forma legacy de un
--    comprobante timbrado (status/uuid/facturama_id) para no romper los caminos
--    de cancelación, envío y descarga; el estado autoritativo va en `fiscal`.
-- ---------------------------------------------------------------------------
create function public._w3_proyectar(p_order uuid) returns void
  language plpgsql security definer set search_path = public as
$$
declare
  v_trusted text := coalesce(current_setting('app.trusted', true), '');
  d public.fiscal_documents; v_meta jsonb;
begin
  select * into d from public.fiscal_documents f
   where f.order_id = p_order
   order by (f.status in ('pendiente','en_proceso','timbrado','incierto')) desc, f.created_at desc
   limit 1;
  if not found then return; end if;

  select coalesce(o.invoice_meta, '{}'::jsonb) into v_meta from public.orders o where o.id = p_order;
  v_meta := jsonb_set(v_meta, '{receiver}', d.receiver, true);
  v_meta := jsonb_set(v_meta, '{fiscal}', jsonb_build_object(
              'doc_id', d.id, 'status', d.status, 'uuid', d.uuid,
              'provider_env', d.provider_env, 'attempts', d.attempts,
              'error_code', d.error_code, 'updated_at', d.updated_at), true);
  -- Forma legacy SOLO cuando hay comprobante real. Nunca se escribe 'timbrada'
  -- sin UUID: es la misma regla que la constraint, repetida en la proyección.
  if d.status in ('timbrado','cancelado') and d.uuid is not null then
    v_meta := v_meta || jsonb_build_object('status', 'timbrada', 'uuid', d.uuid,
                'facturama_id', d.provider_ref, 'emitida_at', d.provider_stamped_at, 'simulated', false);
  end if;

  perform set_config('app.trusted', 'on', true);
  update public.orders set invoice_meta = v_meta, invoice_requested = true where id = p_order;
  perform set_config('app.trusted', v_trusted, true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 3) SOLICITAR CFDI — nace la intención durable. Este es el comando que W3-B
--    encontrará ya escrito antes de hablarle al PAC.
-- ---------------------------------------------------------------------------
create function public.solicitar_cfdi(p_op_id uuid, p_order_id uuid, p_receiver jsonb default null)
returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_trusted text := coalesce(current_setting('app.trusted', true), '');
  v_req jsonb; v_prev jsonb; v_role text := public.auth_role();
  v_doctor uuid; v_cust uuid; v_status text; v_total numeric; v_curr text;
  v_recv jsonb; v_fp text; v_live public.fiscal_documents; v_res jsonb;
begin
  if p_order_id is null then raise exception 'PEDIDO_REQUERIDO'; end if;
  v_req := jsonb_build_object('order', p_order_id,
             'receiver', case when p_receiver is null then null else public._fiscal_clean(p_receiver) end);
  v_prev := public._w3_op_begin(p_op_id, 'cfdi_solicitado', v_req);
  if v_prev is not null then return v_prev; end if;

  select o.doctor_id, o.customer_id, o.status, o.total, o.currency
    into v_doctor, v_cust, v_status, v_total, v_curr
    from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'PEDIDO_INEXISTENTE'; end if;

  -- Autorización: Dirección/Facturación/Punto de venta, o el propio dueño del pedido.
  if v_role = any (array['admin','billing','pos']) then null;
  elsif v_doctor = auth.uid()
     or exists (select 1 from public.customers c where c.id = v_cust and c.profile_id = auth.uid()) then null;
  else raise exception 'NO_AUTORIZADO: no puedes solicitar la factura de este pedido';
  end if;

  if v_status = 'cancelled' then
    raise exception 'PEDIDO_CANCELADO: un pedido cancelado no se factura';
  end if;

  v_recv := public._w3_receptor(p_order_id, p_receiver);
  if v_recv is null then
    raise exception 'DATOS_FISCALES_REQUERIDOS: faltan datos fiscales completos del receptor (RFC, razón social, régimen, CP, uso de CFDI y correo). No se factura con datos incompletos.';
  end if;
  v_fp := public._w3_fingerprint(p_order_id, v_recv);

  select * into v_live from public.fiscal_documents f
   where f.order_id = p_order_id and f.kind = 'ingreso'
     and f.status in ('pendiente','en_proceso','timbrado','incierto');

  if found then
    if v_live.status = 'timbrado' then
      v_res := jsonb_build_object('status', 'already_stamped', 'doc_id', v_live.id, 'uuid', v_live.uuid);
      return public._w3_op_finish(p_op_id, 'cfdi_solicitado', v_req, v_res);
    elsif v_live.status = 'en_proceso' then
      raise exception 'CFDI_EN_PROCESO: ya hay un timbrado en curso para este pedido. Espera a que termine.';
    elsif v_live.status = 'incierto' then
      raise exception 'CFDI_INCIERTO: no se sabe si el SAT ya timbró este pedido. Dirección debe conciliar antes de volver a intentar.';
    end if;

    -- pendiente: se puede CORREGIR el contenido mientras no haya salido a ningún PAC.
    if v_live.request_fingerprint = v_fp then
      v_res := jsonb_build_object('status', 'already_requested', 'doc_id', v_live.id, 'fiscal_status', 'pendiente');
    else
      perform set_config('app.trusted', 'on', true);
      update public.fiscal_documents set receiver = v_recv, request_fingerprint = v_fp,
             total = v_total, currency = coalesce(v_curr, 'MXN')
       where id = v_live.id;
      perform set_config('app.trusted', v_trusted, true);
      insert into public.fiscal_document_events (fiscal_document_id, from_status, to_status, event, reason, actor, actor_role, op_id)
      values (v_live.id, 'pendiente', 'pendiente', 'solicitud_actualizada',
              'se corrigió el contenido de la solicitud antes de timbrar', auth.uid(), coalesce(v_role, ''), p_op_id);
      v_res := jsonb_build_object('status', 'updated', 'doc_id', v_live.id, 'fiscal_status', 'pendiente');
    end if;
    perform public._w3_proyectar(p_order_id);
    return public._w3_op_finish(p_op_id, 'cfdi_solicitado', v_req, v_res);
  end if;

  -- Nueva intención. `total` y `currency` se congelan; el DESGLOSE (subtotal/IVA),
  -- la forma y el método de pago quedan nulos a propósito: dependen de decisiones
  -- fiscales abiertas (D-W3-1…4) y se derivan del libro de W2 en W3-C. No se
  -- inventa una tasa de IVA ni una forma de pago para rellenarlos.
  perform set_config('app.trusted', 'on', true);
  insert into public.fiscal_documents (id, order_id, kind, status, request_fingerprint, receiver,
                                       total, currency, actor, actor_role, op_id)
  values (p_op_id, p_order_id, 'ingreso', 'pendiente', v_fp, v_recv,
          v_total, coalesce(v_curr, 'MXN'), auth.uid(), coalesce(v_role, ''), p_op_id);
  perform set_config('app.trusted', v_trusted, true);

  insert into public.fiscal_document_events (fiscal_document_id, from_status, to_status, event, reason, actor, actor_role, op_id)
  values (p_op_id, null, 'pendiente', 'solicitud', 'solicitud de CFDI registrada', auth.uid(), coalesce(v_role, ''), p_op_id);

  perform public._w3_proyectar(p_order_id);
  perform public._fiscal_audit('Solicitud de CFDI registrada', 'order:' || p_order_id, v_recv);

  return public._w3_op_finish(p_op_id, 'cfdi_solicitado', v_req,
    jsonb_build_object('status', 'applied', 'doc_id', p_op_id, 'fiscal_status', 'pendiente'));
end;
$$;
comment on function public.solicitar_cfdi(uuid, uuid, jsonb) is
  'Registra la INTENCIÓN fiscal durable del pedido (estado pendiente) con su receptor congelado. No timbra: el timbrado llega en W3-B. Máximo una intención viva por pedido; `incierto` la bloquea hasta conciliar.';

-- ---------------------------------------------------------------------------
-- 4) DESCARTAR una solicitud que nunca salió. pendiente → fallido: libera la
--    ranura sin fabricar ni borrar evidencia. Un `incierto` NO se descarta así:
--    se concilia contra el PAC (W3-B/D).
-- ---------------------------------------------------------------------------
create function public.descartar_solicitud_cfdi(p_op_id uuid, p_doc_id uuid, p_motivo text)
returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_req jsonb; v_prev jsonb; v_st text; v_ord uuid; v_t jsonb;
begin
  -- Ojo con la forma: `x <> any(...)` es cierto en cuanto x difiera de UN elemento
  -- (y 'admin' difiere de 'billing'). La negación de `= any` es la correcta.
  if not (public.auth_role() = any (array['admin','billing'])) then
    raise exception 'NO_AUTORIZADO: solo Dirección o Facturación descarta una solicitud fiscal';
  end if;
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO: indica por qué se descarta la solicitud';
  end if;
  v_req := jsonb_build_object('doc', p_doc_id, 'motivo', btrim(p_motivo));
  v_prev := public._w3_op_begin(p_op_id, 'cfdi_descartado', v_req);
  if v_prev is not null then return v_prev; end if;

  select status, order_id into v_st, v_ord from public.fiscal_documents where id = p_doc_id;
  if not found then raise exception 'FISCAL_DOCUMENTO_INEXISTENTE'; end if;
  if v_st = 'incierto' then
    raise exception 'CFDI_INCIERTO: no se descarta una intención cuyo efecto en el SAT se desconoce; hay que conciliarla.';
  end if;
  if v_st <> 'pendiente' then
    raise exception 'FISCAL_ESTADO_NO_DESCARTABLE: solo se descarta una solicitud pendiente (estado actual: %).', v_st;
  end if;

  -- Notación con nombre: la transición tiene muchos parámetros opcionales y la posición
  -- es una trampa. Aquí se escribe exactamente lo que se quiere guardar.
  v_t := public._w3_transicion(p_doc => p_doc_id, p_to => 'fallido', p_event => 'descarte',
           p_from_expected => 'pendiente', p_reason => btrim(p_motivo),
           p_error_code => 'descartada', p_error_message => btrim(p_motivo),
           p_reconcile_note => btrim(p_motivo), p_op => p_op_id);
  if v_t is null then raise exception 'CFDI_EN_PROCESO: la solicitud cambió de estado; vuelve a consultarla.'; end if;
  perform public._w3_proyectar(v_ord);

  return public._w3_op_finish(p_op_id, 'cfdi_descartado', v_req,
    jsonb_build_object('status', 'applied', 'doc_id', p_doc_id, 'fiscal_status', 'fallido'));
end;
$$;

-- ---------------------------------------------------------------------------
-- 5) ESTADO FISCAL DEL PEDIDO — lo que el operador tiene derecho a ver, incluida
--    la verdad incómoda: si el estado es `incierto`, NO se ofrece reintento.
-- ---------------------------------------------------------------------------
create function public.estado_fiscal_pedido(p_order uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare d public.fiscal_documents; v_role text := public.auth_role(); v_doctor uuid; v_cust uuid;
begin
  select o.doctor_id, o.customer_id into v_doctor, v_cust from public.orders o where o.id = p_order;
  if not found then raise exception 'PEDIDO_INEXISTENTE'; end if;
  if not (v_role = any (array['admin','billing','pos'])
          or v_doctor = auth.uid()
          or exists (select 1 from public.customers c where c.id = v_cust and c.profile_id = auth.uid())) then
    raise exception 'NO_AUTORIZADO: no puedes consultar el estado fiscal de este pedido';
  end if;

  select * into d from public.fiscal_documents f
   where f.order_id = p_order
   order by (f.status in ('pendiente','en_proceso','timbrado','incierto')) desc, f.created_at desc
   limit 1;
  if not found then
    return jsonb_build_object('status', 'sin_solicitud', 'puede_solicitar', true,
             'puede_reintentar', false, 'requiere_conciliacion', false,
             'timbrado_habilitado', false);
  end if;
  return jsonb_build_object(
    'doc_id', d.id, 'status', d.status, 'uuid', d.uuid, 'provider_env', d.provider_env,
    'attempts', d.attempts, 'error_code', d.error_code, 'error_message', d.error_message,
    'puede_solicitar',        d.status in ('fallido','cancelado'),
    'puede_reintentar',       d.status = 'fallido',
    'requiere_conciliacion',  d.status = 'incierto',
    'timbrado_habilitado',    false,   -- W3-A: el camino al PAC no está activado
    'updated_at', d.updated_at);
end;
$$;
comment on function public.estado_fiscal_pedido(uuid) is
  'Proyección de lectura del estado fiscal. `puede_reintentar` es FALSO en `incierto`: de un estado ambiguo no se reintenta, se concilia. `timbrado_habilitado` es falso en W3-A por diseño.';

-- ---------------------------------------------------------------------------
-- 6) CONCILIACIÓN LOCAL. Detecta lo que se puede detectar SIN hablar con el PAC.
--    La conciliación EXTERNA (consultar Facturama por serie+folio para adoptar o
--    descartar un timbre huérfano) es W3-B/D: aquí no se finge que ya existe —
--    el check C4 la reporta como pendiente en vez de callarla.
-- ---------------------------------------------------------------------------
create function public.conciliar_cfdi()
returns table (check_id text, severidad text, entidad text, entidad_id uuid, detalle text)
  language plpgsql stable security definer set search_path = public as
$$
begin
  if public.auth_role() <> 'admin' then raise exception 'NO_AUTORIZADO: solo Dirección'; end if;
  return query
  -- C1: timbrado sin UUID. Imposible por constraint; se verifica igual.
  select 'C1_timbrado_sin_uuid', 'error', 'fiscal_document', d.id,
         'documento timbrado sin UUID del SAT'
    from public.fiscal_documents d where d.status = 'timbrado' and d.uuid is null
  union all
  -- C2: dos documentos vivos para el mismo pedido. Imposible por índice; se verifica igual.
  select 'C2_dos_documentos_vivos', 'error', 'order', d.order_id,
         count(*)::text || ' documentos vivos para el mismo pedido'
    from public.fiscal_documents d
   where d.status in ('pendiente','en_proceso','timbrado','incierto')
   group by d.order_id, d.kind having count(*) > 1
  union all
  -- C3: reclamo abandonado. No se reintenta: se reclasifica como incierto (W3-B/D).
  select 'C3_claim_abandonado', 'error', 'fiscal_document', d.id,
         'en_proceso desde ' || d.claimed_at::text || ' · requiere reclasificar a incierto, NO reintentar'
    from public.fiscal_documents d
   where d.status = 'en_proceso' and d.claimed_at < now() - interval '15 minutes'
  union all
  -- C4: intención ambigua. Solo se resuelve consultando al PAC (W3-B/D).
  select 'C4_incierto_sin_conciliar', 'error', 'fiscal_document', d.id,
         'no se sabe si el SAT lo timbró · conciliación externa contra el PAC no implementada (W3-B)'
    from public.fiscal_documents d where d.status = 'incierto' and d.reconciled_at is null
  union all
  -- C5: pedido cancelado con comprobante fiscal vigente sin cancelar.
  select 'C5_pedido_cancelado_con_cfdi', 'error', 'order', d.order_id,
         'pedido cancelado con CFDI ' || coalesce(d.uuid, '(sin timbrar)') || ' en estado ' || d.status
    from public.fiscal_documents d join public.orders o on o.id = d.order_id
   where o.status = 'cancelled' and d.status in ('pendiente','en_proceso','timbrado','incierto')
  union all
  -- C6: la proyección del pedido no coincide con el documento fiscal.
  select 'C6_proyeccion_vs_documento', 'error', 'order', d.order_id,
         'invoice_meta.fiscal.status=' || coalesce(o.invoice_meta->'fiscal'->>'status', '(nulo)')
           || ' vs documento=' || d.status
    from public.fiscal_documents d join public.orders o on o.id = d.order_id
   where d.status in ('pendiente','en_proceso','timbrado','incierto','cancelado')
     and coalesce(o.invoice_meta->'fiscal'->>'status', '') is distinct from d.status
  union all
  -- C7: comprobante con UUID sin entorno. Imposible por constraint; se verifica igual.
  select 'C7_uuid_sin_entorno', 'error', 'fiscal_document', d.id,
         'UUID sin entorno declarado: no se puede saber si es real o de sandbox'
    from public.fiscal_documents d where d.uuid is not null and d.provider_env is null
  union all
  -- C8: mismo UUID en dos documentos. Imposible por índice; se verifica igual.
  select 'C8_uuid_duplicado', 'error', 'fiscal_document', (array_agg(d.id order by d.created_at))[1],
         'el mismo UUID aparece en ' || count(*)::text || ' documentos'
    from public.fiscal_documents d where d.uuid is not null group by d.uuid having count(*) > 1
  union all
  -- C9: estado actual sin respaldo en la bitácora (historia incompleta).
  select 'C9_estado_sin_bitacora', 'error', 'fiscal_document', d.id,
         'estado ' || d.status || ' sin transición registrada'
    from public.fiscal_documents d
   where d.status is distinct from (
           select e.to_status from public.fiscal_document_events e
            where e.fiscal_document_id = d.id order by e.created_at desc, e.id desc limit 1)
  union all
  -- C10: comprobante de SANDBOX. Nunca debe contarse como fiscalmente real.
  select 'C10_comprobante_sandbox', 'alerta', 'fiscal_document', d.id,
         'UUID de SANDBOX: no es un comprobante fiscal real'
    from public.fiscal_documents d where d.uuid is not null and d.provider_env = 'sandbox'
  union all
  -- C11: LEGADO. Pedido marcado como timbrado en invoice_meta SIN documento fiscal
  -- que lo respalde: es exactamente el rastro que podía dejar el camino anterior.
  select 'C11_timbre_legacy_sin_documento', 'error', 'order', o.id,
         'invoice_meta declara CFDI ' || coalesce(o.invoice_meta->>'uuid', '(sin uuid)')
           || ' sin documento fiscal · requiere adopción manual'
    from public.orders o
   where coalesce(o.invoice_meta->>'status', '') in ('timbrada','emitida')
     and not exists (select 1 from public.fiscal_documents d where d.order_id = o.id);
end;
$$;
comment on function public.conciliar_cfdi() is
  'Conciliación LOCAL del libro fiscal (C1…C11). La conciliación EXTERNA contra el PAC es W3-B/D; C4 la reporta explícitamente como pendiente en vez de aparentar que ya existe.';

-- ---------------------------------------------------------------------------
-- 7) set_order_fiscal_snapshot — se CONSERVA (el frontend y el POS lo usan) y se
--    endurece: no toca un pedido cuya intención fiscal ya salió de `pendiente`, y
--    mantiene sincronizado el receptor del documento vivo para que la huella no
--    quede desfasada. Sigue sin poder escribir evidencia fiscal.
-- ---------------------------------------------------------------------------
create or replace function public.set_order_fiscal_snapshot(p_order_id uuid, p_receiver jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_role  text := public.auth_role();
  v_err   text;
  v_clean jsonb;
  v_meta  jsonb;
  v_doc   uuid;
  v_cust  uuid;
  v_live  public.fiscal_documents;
begin
  if p_order_id is null then raise exception 'PEDIDO_REQUERIDO'; end if;

  select invoice_meta, doctor_id, customer_id into v_meta, v_doc, v_cust
    from public.orders where id = p_order_id for update;
  if not found then raise exception 'PEDIDO_INEXISTENTE'; end if;

  -- Autorización idéntica al master, pero sobre el pedido.
  if v_role = any (array['admin','billing','pos']) then
    null;
  elsif v_doc = auth.uid()
     or exists (select 1 from public.customers c where c.id = v_cust and c.profile_id = auth.uid()) then
    null;
  else
    raise exception 'NO_AUTORIZADO: no puedes editar los datos fiscales de este pedido';
  end if;

  -- Un CFDI ya timbrado NO puede cambiar de receptor en silencio (refacturación = otra fase).
  if coalesce(v_meta->>'status','') in ('timbrada','emitida') then
    raise exception 'YA_TIMBRADO: el CFDI ya fue emitido; no se puede cambiar el receptor';
  end if;

  -- W3-A: la intención fiscal manda. Si ya salió (o pudo salir) al PAC, el
  -- contenido de la solicitud está congelado.
  select * into v_live from public.fiscal_documents f
   where f.order_id = p_order_id and f.kind = 'ingreso'
     and f.status in ('pendiente','en_proceso','timbrado','incierto');
  if found and v_live.status <> 'pendiente' then
    raise exception 'FISCAL_SOLICITUD_CONGELADA: hay una intención fiscal en estado %; el receptor ya no se modifica aquí.', v_live.status;
  end if;

  v_err := public._fiscal_error(p_receiver);
  if v_err is not null then raise exception 'FISCAL_INVALIDO: %', v_err; end if;
  v_clean := public._fiscal_clean(p_receiver);

  -- Congela el snapshot preservando cualquier otra clave de invoice_meta. Marca la solicitud.
  perform set_config('app.trusted','on', true);
  update public.orders
     set invoice_meta = jsonb_set(coalesce(invoice_meta, '{}'::jsonb), '{receiver}', v_clean, true),
         invoice_requested = true
   where id = p_order_id;

  -- Mantiene coherente la intención viva: mismo receptor, misma huella.
  if v_live.id is not null then
    update public.fiscal_documents
       set receiver = v_clean, request_fingerprint = public._w3_fingerprint(p_order_id, v_clean)
     where id = v_live.id;
    insert into public.fiscal_document_events (fiscal_document_id, from_status, to_status, event, reason, actor, actor_role)
    values (v_live.id, 'pendiente', 'pendiente', 'solicitud_actualizada',
            'receptor actualizado desde el snapshot del pedido', auth.uid(), coalesce(v_role, ''));
  end if;
  perform set_config('app.trusted','off', true);

  perform public._fiscal_audit('Snapshot fiscal congelado', 'order:' || p_order_id, v_clean);
  return jsonb_build_object('ok', true, 'order_id', p_order_id);
end $$;
