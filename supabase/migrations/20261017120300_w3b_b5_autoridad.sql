-- ============================================================================
-- W3-B · B5 — ESTADOS DE OPERADOR, CONCILIACIÓN AMPLIADA Y CIERRE DE AUTORIDAD.
--
-- El estado `incierto` tiene que comunicar tres cosas sin ambigüedad:
--   · no se sabe si el CFDI existe,
--   · volver a emitir está PROHIBIDO,
--   · hace falta conciliar.
-- Y la UI no debe recibir nunca permiso de reintentar desde ahí.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) ESTADO FISCAL DEL PEDIDO — ampliado con la identidad y la ventana de
--    reenvío. Reemplaza la versión de W3-A conservando su contrato.
-- ---------------------------------------------------------------------------
create or replace function public.estado_fiscal_pedido(p_order uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare
  d public.fiscal_documents; v_role text := public.auth_role();
  v_doctor uuid; v_cust uuid; v_multiple int := 0; v_vence timestamptz;
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
             'requiere_revision_manual', false, 'timbrado_habilitado', false);
  end if;

  select count(*) into v_multiple from public.fiscal_reconciliations r
   where r.fiscal_document_id = d.id and r.outcome = 'multiple';
  v_vence := public._w3_replay_vence(d.provider_date_sent);

  return jsonb_build_object(
    'doc_id', d.id, 'status', d.status, 'uuid', d.uuid,
    'serie', d.serie, 'folio', d.folio,
    'provider_env', d.provider_env, 'attempts', d.attempts,
    'error_code', d.error_code, 'error_message', d.error_message,
    'puede_solicitar',        d.status in ('fallido','cancelado'),
    'puede_reintentar',       d.status = 'fallido',
    'requiere_conciliacion',  d.status = 'incierto',
    'requiere_revision_manual', v_multiple > 0 and d.status = 'incierto',
    -- Reenvío: SOLO dentro de la ventana segura, y nunca como "reintento".
    'replay_vence_en',        v_vence,
    'replay_permitido',       d.status in ('en_proceso','incierto')
                              and v_vence is not null and v_vence > now(),
    -- D-W3-4 sigue abierta: W3-B no habilita la emisión real.
    'timbrado_habilitado',    false,
    'updated_at', d.updated_at);
end;
$$;
comment on function public.estado_fiscal_pedido(uuid) is
  'Proyección de lectura del estado fiscal. `puede_reintentar` es FALSO en `incierto`: de un estado ambiguo no se reintenta, se concilia. `replay_permitido` describe el reenvío IDEMPOTENTE dentro de la ventana segura, que no es lo mismo que reintentar. `timbrado_habilitado` sigue en falso: D-W3-4 abierta.';

-- ---------------------------------------------------------------------------
-- 2) CONCILIACIÓN AMPLIADA. Se conservan C1…C11 de W3-A y se añaden los checks
--    que nacen de la identidad ante el proveedor.
-- ---------------------------------------------------------------------------
create or replace function public.conciliar_cfdi()
returns table (check_id text, severidad text, entidad text, entidad_id uuid, detalle text)
  language plpgsql stable security definer set search_path = public as
$$
begin
  if public.auth_role() <> 'admin' then raise exception 'NO_AUTORIZADO: solo Dirección'; end if;
  return query
  select 'C1_timbrado_sin_uuid', 'error', 'fiscal_document', d.id,
         'documento timbrado sin UUID del SAT'
    from public.fiscal_documents d where d.status = 'timbrado' and d.uuid is null
  union all
  select 'C2_dos_documentos_vivos', 'error', 'order', d.order_id,
         count(*)::text || ' documentos vivos para el mismo pedido'
    from public.fiscal_documents d
   where d.status in ('pendiente','en_proceso','timbrado','incierto')
   group by d.order_id, d.kind having count(*) > 1
  union all
  select 'C3_claim_abandonado', 'error', 'fiscal_document', d.id,
         'en_proceso desde ' || d.claimed_at::text || ' · requiere reclasificar a incierto, NO reintentar'
    from public.fiscal_documents d
   where d.status = 'en_proceso' and d.claimed_at < now() - interval '15 minutes'
  union all
  select 'C4_incierto_sin_conciliar', 'error', 'fiscal_document', d.id,
         'no se sabe si el SAT lo timbró · sondeos registrados: '
           || (select count(*)::text from public.fiscal_reconciliations r where r.fiscal_document_id = d.id)
    from public.fiscal_documents d where d.status = 'incierto' and d.reconciled_at is null
  union all
  select 'C5_pedido_cancelado_con_cfdi', 'error', 'order', d.order_id,
         'pedido cancelado con CFDI ' || coalesce(d.uuid, '(sin timbrar)') || ' en estado ' || d.status
    from public.fiscal_documents d join public.orders o on o.id = d.order_id
   where o.status = 'cancelled' and d.status in ('pendiente','en_proceso','timbrado','incierto')
  union all
  select 'C6_proyeccion_vs_documento', 'error', 'order', d.order_id,
         'invoice_meta.fiscal.status=' || coalesce(o.invoice_meta->'fiscal'->>'status', '(nulo)')
           || ' vs documento=' || d.status
    from public.fiscal_documents d join public.orders o on o.id = d.order_id
   where d.status in ('pendiente','en_proceso','timbrado','incierto','cancelado')
     and coalesce(o.invoice_meta->'fiscal'->>'status', '') is distinct from d.status
  union all
  select 'C7_uuid_sin_entorno', 'error', 'fiscal_document', d.id,
         'UUID sin entorno declarado: no se puede saber si es real o de sandbox'
    from public.fiscal_documents d where d.uuid is not null and d.provider_env is null
  union all
  select 'C8_uuid_duplicado', 'error', 'fiscal_document', (array_agg(d.id order by d.created_at))[1],
         'el mismo UUID aparece en ' || count(*)::text || ' documentos'
    from public.fiscal_documents d where d.uuid is not null group by d.uuid having count(*) > 1
  union all
  select 'C9_estado_sin_bitacora', 'error', 'fiscal_document', d.id,
         'estado ' || d.status || ' sin transición registrada'
    from public.fiscal_documents d
   where d.status is distinct from (
           select e.to_status from public.fiscal_document_events e
            where e.fiscal_document_id = d.id order by e.created_at desc, e.id desc limit 1)
  union all
  select 'C10_comprobante_sandbox', 'alerta', 'fiscal_document', d.id,
         'UUID de SANDBOX: no es un comprobante fiscal real'
    from public.fiscal_documents d where d.uuid is not null and d.provider_env = 'sandbox'
  union all
  select 'C11_timbre_legacy_sin_documento', 'error', 'order', o.id,
         'invoice_meta declara CFDI ' || coalesce(o.invoice_meta->>'uuid', '(sin uuid)')
           || ' sin documento fiscal · requiere adopción manual'
    from public.orders o
   where coalesce(o.invoice_meta->>'status', '') in ('timbrada','emitida')
     and not exists (select 1 from public.fiscal_documents d where d.order_id = o.id)
  union all
  -- ── W3-B ───────────────────────────────────────────────────────────────
  -- C12: folio repetido dentro de la identidad del proveedor. Imposible por el
  -- índice; se verifica igual, porque es la colisión que el PAC vería.
  select 'C12_folio_repetido_proveedor', 'error', 'fiscal_document',
         (array_agg(d.id order by d.created_at))[1],
         'folio ' || d.folio || ' repetido en ' || count(*)::text
           || ' documentos del mismo emisor/entorno (la deduplicación del PAC no mira la serie)'
    from public.fiscal_documents d where d.folio is not null
   group by d.provider, coalesce(d.provider_env, ''), coalesce(d.issuer_rfc, ''), d.folio
  having count(*) > 1
  union all
  -- C13: intención que llegó al proveedor sin identidad completa.
  select 'C13_identidad_incompleta', 'error', 'fiscal_document', d.id,
         'estado ' || d.status || ' sin identidad completa ante el proveedor'
    from public.fiscal_documents d
   where d.status in ('en_proceso','timbrado','incierto','cancelado')
     and (d.serie is null or d.folio is null or d.provider_date_sent is null
          or d.issuer_rfc is null or d.provider_env is null)
  union all
  -- C14: la ventana segura de reenvío ya venció y sigue sin resolverse. A partir
  -- de aquí solo la consulta puede cerrarlo: reenviar ya no es una opción.
  select 'C14_ventana_reenvio_vencida', 'alerta', 'fiscal_document', d.id,
         'venció la ventana segura de reenvío (' || public._w3_replay_vence(d.provider_date_sent)::text
           || '); solo queda resolver por consulta o adopción'
    from public.fiscal_documents d
   where d.status in ('en_proceso','incierto')
     and d.provider_date_sent is not null
     and public._w3_replay_vence(d.provider_date_sent) <= now()
  union all
  -- C15: un sondeo encontró comprobante y la intención sigue sin adoptarlo.
  select 'C15_evidencia_positiva_sin_adoptar', 'error', 'fiscal_document', d.id,
         'un sondeo encontró folio fiscal y el documento sigue en ' || d.status
    from public.fiscal_documents d
   where d.status in ('en_proceso','incierto')
     and exists (select 1 from public.fiscal_reconciliations r
                  where r.fiscal_document_id = d.id and r.uuid_found is not null)
  union all
  -- C16: varios candidatos en el proveedor. Nunca se autocorrige.
  select 'C16_candidatos_multiples', 'error', 'fiscal_document', d.id,
         'la consulta devolvió varios comprobantes candidatos · REVISION MANUAL'
    from public.fiscal_documents d
   where d.status in ('en_proceso','incierto')
     and exists (select 1 from public.fiscal_reconciliations r
                  where r.fiscal_document_id = d.id and r.outcome = 'multiple');
end;
$$;
comment on function public.conciliar_cfdi() is
  'Conciliación del libro fiscal: C1…C11 (W3-A) y C12…C16 (W3-B, identidad ante el proveedor). Autocorrige nada: informa. La adopción y la resolución negativa son comandos explícitos.';

-- ---------------------------------------------------------------------------
-- 3) CIERRE DE AUTORIDAD. Internos fuera del alcance de los clientes.
-- ---------------------------------------------------------------------------
revoke all on function
  public._w3_asignar_folio(text, text, text),
  public._w3_replay_vence(text),
  public._w3_plazo_timbrado(),
  public._w3_margen_replay(),
  public._w3_ventana_replay(),
  public._w3_edad_minima_sondeo(),
  public._w3_separacion_sondeos(),
  public.fiscal_numeracion_guard()
  from public, anon, authenticated;

revoke all on function public.reclamar_cfdi(uuid, uuid, text, uuid) from public, anon;
revoke all on function public.registrar_resultado_cfdi(uuid, uuid, uuid, text, text, text, timestamptz, text, text) from public, anon;
revoke all on function public.registrar_sondeo_cfdi(uuid, uuid, text, text, integer, text, text, text) from public, anon;
revoke all on function public.adoptar_cfdi(uuid, uuid, text, text, timestamptz, text, text) from public, anon;
revoke all on function public.resolver_cfdi_inexistente(uuid, uuid, text) from public, anon;
revoke all on function public.evidencia_inexistencia_cfdi(uuid) from public, anon;
revoke all on function public.identidad_cfdi(uuid) from public, anon;

grant execute on function public.reclamar_cfdi(uuid, uuid, text, uuid) to authenticated, service_role;
grant execute on function public.registrar_resultado_cfdi(uuid, uuid, uuid, text, text, text, timestamptz, text, text) to authenticated, service_role;
grant execute on function public.registrar_sondeo_cfdi(uuid, uuid, text, text, integer, text, text, text) to authenticated, service_role;
grant execute on function public.adoptar_cfdi(uuid, uuid, text, text, timestamptz, text, text) to authenticated, service_role;
grant execute on function public.resolver_cfdi_inexistente(uuid, uuid, text) to authenticated, service_role;
grant execute on function public.evidencia_inexistencia_cfdi(uuid) to authenticated, service_role;
grant execute on function public.identidad_cfdi(uuid) to authenticated, service_role;
