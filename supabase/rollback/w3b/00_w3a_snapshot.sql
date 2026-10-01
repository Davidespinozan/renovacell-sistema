-- ============================================================================
-- W3-B · SNAPSHOT PREVIO (estado que dejó W3-A).
--
-- Restaura las definiciones EXACTAS que W3-B reemplaza:
--   · fiscal_documents_guard()   sin el congelado de la identidad ante el proveedor
--   · estado_fiscal_pedido()     sin serie/folio ni ventana de reenvío
--   · conciliar_cfdi()           con C1…C11, sin C12…C16
--
-- Lo invoca supabase/rollback/w3b/99_down.sql. No se ejecuta por separado.
-- ============================================================================

create or replace function public.fiscal_documents_guard() returns trigger
  language plpgsql set search_path = public as
$$
begin
  if current_setting('renovacell.purge', true) = 'on' then return coalesce(new, old); end if;

  if tg_op = 'DELETE' then
    raise exception 'FISCAL_NO_SE_BORRA: un documento fiscal no se elimina; es evidencia. Se cancela o se concilia.'
      using errcode = 'check_violation';
  end if;

  -- Fuera del contexto de comando, nadie escribe: ni cliente, ni Dirección, ni el
  -- dueño de la base. La evidencia fiscal no se edita a mano.
  if coalesce(current_setting('app.trusted', true), '') <> 'on' then
    raise exception 'FISCAL_SOLO_POR_COMANDO: la evidencia fiscal se registra con los comandos del servidor, no editando la tabla.'
      using errcode = 'check_violation';
  end if;

  -- Identidad inmutable.
  if new.id <> old.id or new.order_id <> old.order_id or new.kind <> old.kind
     or new.created_at <> old.created_at then
    raise exception 'FISCAL_IDENTIDAD_INMUTABLE: no se cambia el pedido ni el tipo de un documento fiscal.'
      using errcode = 'check_violation';
  end if;

  -- Todo cambio de estado pasa por _w3_transicion(): así ninguna transición se
  -- queda sin su fila en la bitácora (H-6).
  if new.status is distinct from old.status
     and coalesce(current_setting('renovacell.w3_transicion', true), '') <> 'on' then
    raise exception 'FISCAL_TRANSICION_SOLO_POR_COMANDO: el estado fiscal cambia con la transición registrada, no con un UPDATE directo.'
      using errcode = 'check_violation';
  end if;
  if new.status is distinct from old.status
     and not public._w3_transicion_valida(old.status, new.status) then
    raise exception 'FISCAL_TRANSICION_INVALIDA: % → % no es una transición permitida.', old.status, new.status
      using errcode = 'check_violation';
  end if;

  -- La evidencia del SAT se escribe UNA vez y no se reescribe ni se borra.
  if old.uuid is not null and new.uuid is distinct from old.uuid then
    raise exception 'FISCAL_UUID_INMUTABLE: el UUID del SAT ya registrado no se reescribe (%).', old.uuid
      using errcode = 'check_violation';
  end if;
  if old.uuid is not null and new.provider_env is distinct from old.provider_env then
    raise exception 'FISCAL_ENTORNO_INMUTABLE: el entorno de un comprobante ya timbrado no cambia.'
      using errcode = 'check_violation';
  end if;

  -- Lo que se pidió timbrar solo puede corregirse mientras la solicitud sigue
  -- pendiente. Después es el contenido que salió (o pudo salir) al PAC.
  if old.status <> 'pendiente'
     and (new.receiver is distinct from old.receiver
          or new.request_fingerprint is distinct from old.request_fingerprint) then
    raise exception 'FISCAL_SOLICITUD_CONGELADA: el contenido de la solicitud ya no se modifica en estado %.', old.status
      using errcode = 'check_violation';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.estado_fiscal_pedido(p_order uuid) returns jsonb
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

create or replace function public.conciliar_cfdi()
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
