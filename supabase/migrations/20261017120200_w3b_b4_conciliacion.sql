-- ============================================================================
-- W3-B · B4 — RESULTADO DEL PROVEEDOR Y RECUPERACIÓN DE HUÉRFANO.
--
-- La regla que ordena todo este archivo es ASIMÉTRICA, y es deliberada:
--
--   ENCONTRADO     → se puede adoptar automáticamente (evidencia positiva).
--   NO ENCONTRADO  → no demuestra NADA. La consulta del proveedor es paginada y
--                    no garantiza visibilidad inmediata; concluir "no existe" a
--                    partir de un vacío reabriría el P0 que W3-A cerró, esta vez
--                    por la puerta de atrás.
--
-- Por eso la conclusión negativa (no existe comprobante) exige CUATRO cosas
-- verificadas EN LA BASE, no prometidas por el frontend:
--   · antigüedad suficiente del intento
--   · al menos dos sondeos vacíos SEPARADOS en el tiempo
--   · ninguna evidencia positiva en ningún sondeo
--   · autorización explícita de Dirección
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) SONDEO — evidencia append-only de que se buscó, cuándo y con qué resultado.
-- ---------------------------------------------------------------------------
create function public.registrar_sondeo_cfdi(
  p_op_id uuid, p_doc_id uuid, p_probe_kind text, p_outcome text,
  p_candidates integer default 0, p_uuid text default null,
  p_sat_status text default null, p_detail text default null
) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_req jsonb; v_prev jsonb; v_env text; v_st text;
begin
  if not (public.auth_role() = any (array['admin','billing'])
          or coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role','') = 'service_role') then
    raise exception 'NO_AUTORIZADO: solo Dirección o Facturación concilia';
  end if;
  v_req := jsonb_build_object('doc', p_doc_id, 'kind', p_probe_kind, 'outcome', p_outcome,
             'candidates', p_candidates, 'uuid', p_uuid);
  v_prev := public._w3_op_begin(p_op_id, 'cfdi_conciliado', v_req);
  if v_prev is not null then return v_prev; end if;

  select status, provider_env into v_st, v_env from public.fiscal_documents where id = p_doc_id;
  if not found then raise exception 'FISCAL_DOCUMENTO_INEXISTENTE'; end if;

  insert into public.fiscal_reconciliations (fiscal_document_id, probe_kind, outcome, candidates,
         uuid_found, sat_status, provider_env, detail, actor, actor_role, op_id)
  values (p_doc_id, p_probe_kind, p_outcome, coalesce(p_candidates, 0),
          nullif(btrim(coalesce(p_uuid, '')), ''), p_sat_status, v_env,
          left(coalesce(p_detail, ''), 500), auth.uid(), coalesce(public.auth_role(), ''), p_op_id);

  return public._w3_op_finish(p_op_id, 'cfdi_conciliado', v_req,
    jsonb_build_object('status', 'applied', 'doc_id', p_doc_id, 'outcome', p_outcome));
end;
$$;
comment on function public.registrar_sondeo_cfdi(uuid, uuid, text, text, integer, text, text, text) is
  'Registra un sondeo contra el proveedor o el SAT. No cambia el estado fiscal: solo acumula evidencia. Es lo que hace demostrable, desde la base, que hubo dos consultas vacías separadas en el tiempo.';

-- ---------------------------------------------------------------------------
-- 2) RESULTADO DEL PROVEEDOR — lo escribe el adaptador, y solo el dueño del
--    reclamo. Un worker con un claim viejo no puede pisar el resultado.
-- ---------------------------------------------------------------------------
create function public.registrar_resultado_cfdi(
  p_op_id uuid, p_doc_id uuid, p_claim_id uuid, p_resultado text,
  p_uuid text default null, p_provider_ref text default null,
  p_stamped_at timestamptz default null,
  p_error_code text default null, p_error_message text default null
) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_req jsonb; v_prev jsonb; d public.fiscal_documents; v_t jsonb; v_kind text;
begin
  if not (public.auth_role() = any (array['admin','billing'])
          or coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role','') = 'service_role') then
    raise exception 'NO_AUTORIZADO';
  end if;
  if p_resultado not in ('timbrado','fallido','incierto') then
    raise exception 'RESULTADO_INVALIDO: usa timbrado, fallido o incierto';
  end if;
  v_kind := case p_resultado when 'timbrado' then 'cfdi_timbrado'
                             when 'fallido'  then 'cfdi_fallido'
                             else 'cfdi_incierto' end;
  v_req := jsonb_build_object('doc', p_doc_id, 'claim', p_claim_id, 'resultado', p_resultado,
             'uuid', p_uuid, 'ref', p_provider_ref, 'code', p_error_code);
  v_prev := public._w3_op_begin(p_op_id, v_kind, v_req);
  if v_prev is not null then return v_prev; end if;

  select * into d from public.fiscal_documents where id = p_doc_id for update;
  if not found then raise exception 'FISCAL_DOCUMENTO_INEXISTENTE'; end if;
  if d.status <> 'en_proceso' then
    raise exception 'FISCAL_SIN_RECLAMO_ACTIVO: el resultado solo se registra sobre una intención en proceso (estado actual: %)', d.status;
  end if;
  if d.claim_id is distinct from p_claim_id then
    raise exception 'FISCAL_RECLAMO_AJENO: este intento no es el dueño del reclamo vigente';
  end if;
  if p_resultado = 'timbrado' and nullif(btrim(coalesce(p_uuid, '')), '') is null then
    raise exception 'FISCAL_TIMBRE_SIN_UUID: no se marca timbrado sin folio fiscal del SAT';
  end if;
  if p_resultado <> 'timbrado' and nullif(btrim(coalesce(p_error_code, '')), '') is null then
    raise exception 'FISCAL_MOTIVO_REQUERIDO: un fallo o una ambigüedad llevan su clasificación';
  end if;

  v_t := public._w3_transicion(p_doc => p_doc_id, p_to => p_resultado,
           p_event => case p_resultado when 'timbrado' then 'timbre'
                                       when 'fallido' then 'fallo' else 'incierto' end,
           p_from_expected => 'en_proceso',
           p_reason => case p_resultado when 'timbrado' then 'comprobante timbrado por el PAC'
                                        when 'fallido'  then 'el PAC rechazó el comprobante sin producir efecto'
                                        else 'resultado desconocido: pudo haber efecto en el PAC' end,
           p_uuid => p_uuid, p_provider_ref => p_provider_ref,
           p_stamped_at => p_stamped_at,
           p_error_code => p_error_code, p_error_message => p_error_message, p_op => p_op_id);
  if v_t is null then raise exception 'FISCAL_SIN_RECLAMO_ACTIVO: la intención cambió de estado'; end if;

  return public._w3_op_finish(p_op_id, v_kind, v_req,
    jsonb_build_object('status', 'applied', 'doc_id', p_doc_id, 'fiscal_status', p_resultado, 'uuid', p_uuid));
end;
$$;
comment on function public.registrar_resultado_cfdi(uuid, uuid, uuid, text, text, text, timestamptz, text, text) is
  'Asienta el resultado de la llamada al PAC. Exige ser dueño del reclamo vigente y, para timbrado, un UUID real. Un fallo de persistencia posterior deja la intención en `incierto`, nunca en `fallido`.';

-- ---------------------------------------------------------------------------
-- 3) ADOPCIÓN de evidencia positiva. Desde `incierto` (huérfano recuperado) o
--    desde `en_proceso` (la respuesta llegó por consulta, no por la llamada).
--    La identidad debe coincidir: no se adopta un comprobante de otro.
-- ---------------------------------------------------------------------------
create function public.adoptar_cfdi(
  p_op_id uuid, p_doc_id uuid, p_uuid text, p_provider_ref text default null,
  p_stamped_at timestamptz default null, p_sat_status text default null,
  p_evidencia text default null
) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_req jsonb; v_prev jsonb; d public.fiscal_documents; v_t jsonb;
begin
  if not (public.auth_role() = any (array['admin','billing'])
          or coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role','') = 'service_role') then
    raise exception 'NO_AUTORIZADO';
  end if;
  if nullif(btrim(coalesce(p_uuid, '')), '') is null then
    raise exception 'FISCAL_TIMBRE_SIN_UUID: adoptar exige el folio fiscal encontrado';
  end if;
  if p_sat_status is not null and p_sat_status not in ('Vigente','Cancelado','No encontrado') then
    raise exception 'SAT_STATUS_INVALIDO: usa Vigente, Cancelado o No encontrado';
  end if;
  if p_sat_status = 'No encontrado' then
    raise exception 'SAT_NO_ENCONTRADO: el SAT no reconoce ese folio fiscal; no se adopta';
  end if;
  v_req := jsonb_build_object('doc', p_doc_id, 'uuid', p_uuid, 'ref', p_provider_ref, 'sat', p_sat_status);
  v_prev := public._w3_op_begin(p_op_id, 'cfdi_conciliado', v_req);
  if v_prev is not null then return v_prev; end if;

  select * into d from public.fiscal_documents where id = p_doc_id for update;
  if not found then raise exception 'FISCAL_DOCUMENTO_INEXISTENTE'; end if;
  if d.status not in ('incierto','en_proceso') then
    raise exception 'FISCAL_ESTADO_NO_ADOPTABLE: solo se adopta sobre una intención en proceso o incierta (estado actual: %)', d.status;
  end if;

  v_t := public._w3_transicion(p_doc => p_doc_id, p_to => 'timbrado', p_event => 'conciliacion',
           p_from_expected => d.status,
           p_reason => 'comprobante encontrado en el proveedor y adoptado',
           p_evidence => jsonb_build_object('sat_status', p_sat_status,
                           'evidencia', left(coalesce(p_evidencia, ''), 300)),
           p_uuid => p_uuid, p_provider_ref => p_provider_ref, p_stamped_at => p_stamped_at,
           p_reconcile_note => 'adoptado por conciliación: ' || coalesce(p_sat_status, 'sin verificación SAT'),
           p_op => p_op_id);
  if v_t is null then raise exception 'FISCAL_ESTADO_NO_ADOPTABLE: la intención cambió de estado'; end if;

  return public._w3_op_finish(p_op_id, 'cfdi_conciliado', v_req,
    jsonb_build_object('status', 'applied', 'doc_id', p_doc_id, 'fiscal_status', 'timbrado', 'uuid', p_uuid));
end;
$$;

-- ---------------------------------------------------------------------------
-- 4) ¿Se puede concluir que NO existe comprobante? Las cuatro condiciones,
--    evaluadas contra la evidencia persistida. Función de LECTURA: cualquiera
--    autorizado puede consultarla sin provocar efectos.
-- ---------------------------------------------------------------------------
create function public.evidencia_inexistencia_cfdi(p_doc_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare
  d public.fiscal_documents;
  v_vacios int; v_primero timestamptz; v_ultimo timestamptz;
  v_positivos int; v_edad_ok boolean; v_sep_ok boolean;
begin
  select * into d from public.fiscal_documents where id = p_doc_id;
  if not found then raise exception 'FISCAL_DOCUMENTO_INEXISTENTE'; end if;

  select count(*), min(created_at), max(created_at) into v_vacios, v_primero, v_ultimo
    from public.fiscal_reconciliations r
   where r.fiscal_document_id = p_doc_id
     and r.probe_kind in ('lookup_serie_folio','lookup_order_number')
     and r.outcome = 'vacio';

  select count(*) into v_positivos
    from public.fiscal_reconciliations r
   where r.fiscal_document_id = p_doc_id
     and (r.outcome in ('encontrado','multiple') or r.uuid_found is not null);

  v_edad_ok := d.claimed_at is not null and d.claimed_at < now() - public._w3_edad_minima_sondeo();
  v_sep_ok  := v_vacios >= 2 and v_ultimo - v_primero >= public._w3_separacion_sondeos();

  return jsonb_build_object(
    'doc_id', p_doc_id, 'status', d.status,
    'sondeos_vacios', v_vacios,
    'primer_sondeo', v_primero, 'ultimo_sondeo', v_ultimo,
    'evidencia_positiva', v_positivos,
    'edad_suficiente', v_edad_ok,
    'dos_sondeos_separados', v_sep_ok,
    'sin_evidencia_positiva', v_positivos = 0,
    'separacion_minima', public._w3_separacion_sondeos(),
    'edad_minima', public._w3_edad_minima_sondeo(),
    -- Las cuatro condiciones automáticas. La cuarta (autorización de Dirección)
    -- no es computable: es el acto humano de invocar el comando.
    'listo_para_resolucion_negativa',
      d.status = 'incierto' and v_edad_ok and v_sep_ok and v_positivos = 0);
end;
$$;
comment on function public.evidencia_inexistencia_cfdi(uuid) is
  'Reúne la evidencia de que no existe comprobante, sin concluir nada. La conclusión destructiva la toma Dirección invocando resolver_cfdi_inexistente, y este dictamen es su precondición verificable.';

-- ---------------------------------------------------------------------------
-- 5) RESOLUCIÓN NEGATIVA — el único camino de `incierto` a `fallido`.
--    Solo Dirección. Las condiciones se vuelven a verificar aquí: el dictamen
--    de lectura informa, pero no autoriza.
-- ---------------------------------------------------------------------------
create function public.resolver_cfdi_inexistente(p_op_id uuid, p_doc_id uuid, p_motivo text)
returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_req jsonb; v_prev jsonb; v_ev jsonb; v_t jsonb; v_ord uuid;
begin
  -- Dirección y NADIE más: es la única transición que vuelve a permitir facturar.
  if public.auth_role() <> 'admin' then
    raise exception 'NO_AUTORIZADO: solo Dirección puede declarar que no existe comprobante';
  end if;
  if nullif(btrim(coalesce(p_motivo, '')), '') is null then
    raise exception 'MOTIVO_REQUERIDO: explica en qué te basas para concluir que no se timbró';
  end if;
  v_req := jsonb_build_object('doc', p_doc_id, 'motivo', btrim(p_motivo));
  v_prev := public._w3_op_begin(p_op_id, 'cfdi_conciliado', v_req);
  if v_prev is not null then return v_prev; end if;

  select order_id into v_ord from public.fiscal_documents where id = p_doc_id for update;
  if not found then raise exception 'FISCAL_DOCUMENTO_INEXISTENTE'; end if;

  v_ev := public.evidencia_inexistencia_cfdi(p_doc_id);
  if (v_ev->>'status') <> 'incierto' then
    raise exception 'FISCAL_ESTADO_NO_RESOLUBLE: esta vía es solo para una intención incierta (estado actual: %)', v_ev->>'status';
  end if;
  if not (v_ev->>'sin_evidencia_positiva')::boolean then
    raise exception 'FISCAL_EVIDENCIA_POSITIVA: algún sondeo encontró comprobante; no se puede declarar que no existe';
  end if;
  if not (v_ev->>'edad_suficiente')::boolean then
    raise exception 'FISCAL_INTENTO_RECIENTE: el intento es demasiado reciente; espera antes de concluir que no se timbró';
  end if;
  if not (v_ev->>'dos_sondeos_separados')::boolean then
    raise exception 'FISCAL_EVIDENCIA_INSUFICIENTE: hacen falta al menos dos consultas vacías separadas en el tiempo (hay %)', v_ev->>'sondeos_vacios';
  end if;

  v_t := public._w3_transicion(p_doc => p_doc_id, p_to => 'fallido', p_event => 'conciliacion',
           p_from_expected => 'incierto',
           p_reason => 'Dirección concluye que no existe comprobante: ' || btrim(p_motivo),
           p_evidence => v_ev,
           p_error_code => 'inexistente_confirmado', p_error_message => btrim(p_motivo),
           p_reconcile_note => 'resolución negativa autorizada por Dirección', p_op => p_op_id);
  if v_t is null then raise exception 'FISCAL_ESTADO_NO_RESOLUBLE: la intención cambió de estado'; end if;
  perform public._w3_proyectar(v_ord);

  return public._w3_op_finish(p_op_id, 'cfdi_conciliado', v_req, jsonb_build_object(
    'status', 'applied', 'doc_id', p_doc_id, 'fiscal_status', 'fallido', 'evidencia', v_ev));
end;
$$;
comment on function public.resolver_cfdi_inexistente(uuid, uuid, text) is
  'ÚNICO camino de incierto a fallido. Exige Dirección, motivo, antigüedad suficiente, dos sondeos vacíos separados en el tiempo y cero evidencia positiva. Libera la ranura del pedido, así que es la transición más delicada del sistema.';
