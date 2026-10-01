-- ============================================================================
-- W3-B · B2 — RECLAMO CON ASIGNACIÓN DE IDENTIDAD.
--
-- Serie, folio, `Date` y RFC del emisor se asignan ATÓMICAMENTE en la misma
-- transacción que mueve la intención a `en_proceso`. Esa transacción CONFIRMA
-- antes de que el adaptador hable con el PAC: cuando el proveedor pueda producir
-- un efecto, su identidad ya es durable.
--
-- Orden deliberado dentro del comando:
--   1. BLOQUEO de la fila y comprobación de que sigue `pendiente`.
--   2. recién entonces se asigna el folio.
--   3. se escriben los campos de identidad (aún en `pendiente`).
--   4. transición `pendiente → en_proceso`.
--
-- Por qué ese orden y no otro: si se asignara el folio antes del bloqueo, dos
-- reclamos simultáneos consumirían DOS folios y el perdedor dejaría un hueco
-- innecesario. Bloqueando primero, el perdedor aborta sin haber tocado el
-- contador. Y si algo falla después, el rollback libera la asignación.
--
-- El perdedor ABORTA con excepción, no devuelve null: hace falta que la
-- transacción se revierta para que su folio no quede consumido.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) ASIGNACIÓN DE FOLIO — transaccional, monótona, nunca aleatoria.
--    El dominio es la identidad REAL ante el proveedor (sin serie), porque la
--    deduplicación de Facturama es (Folio, Date) y no incluye serie.
-- ---------------------------------------------------------------------------
create function public._w3_asignar_folio(p_provider text, p_env text, p_rfc text)
returns text
  language plpgsql security definer set search_path = public as
$$
declare
  v_trusted text := coalesce(current_setting('app.trusted', true), '');
  v_folio bigint;
begin
  if nullif(btrim(coalesce(p_rfc, '')), '') is null then
    raise exception 'EMISOR_SIN_RFC: falta el RFC fiscal de la empresa en Configuración; sin él no se puede numerar un comprobante';
  end if;
  if p_env not in ('sandbox','produccion') then
    raise exception 'ENTORNO_FISCAL_INVALIDO: el entorno debe declararse explícitamente (sandbox o produccion)';
  end if;

  perform set_config('app.trusted', 'on', true);
  -- Un solo enunciado atómico: crea el dominio o incrementa el contador. El
  -- ON CONFLICT toma el bloqueo de fila, así que dos sesiones se serializan y
  -- jamás reciben el mismo número.
  insert into public.fiscal_folio_domains (provider, provider_env, issuer_rfc, next_folio)
  values (p_provider, p_env, upper(btrim(p_rfc)), 2)
  on conflict (provider, provider_env, issuer_rfc)
  do update set next_folio = public.fiscal_folio_domains.next_folio + 1, updated_at = now()
  returning next_folio - 1 into v_folio;
  perform set_config('app.trusted', v_trusted, true);

  return v_folio::text;
end;
$$;
comment on function public._w3_asignar_folio(text, text, text) is
  'Entrega el siguiente folio del dominio del proveedor. Transaccional: un rollback libera la asignación. Nunca recicla un folio ya entregado.';

-- ---------------------------------------------------------------------------
-- 2) ¿Sigue siendo seguro reenviar? Ventana OPERATIVA, no la frontera legal.
-- ---------------------------------------------------------------------------
create function public._w3_replay_vence(p_date_sent text) returns timestamptz
  language sql stable set search_path = public as
$$
  select case when p_date_sent is null then null
         else (p_date_sent::timestamp at time zone 'America/Mazatlan') + public._w3_ventana_replay()
         end;
$$;
comment on function public._w3_replay_vence(text) is
  'Instante en que deja de ser seguro reenviar el comprobante: provider_date_sent + 66 h (72 h del SAT menos 6 h de margen). La Fecha se interpretó en el huso del negocio, que es el mismo en que se generó.';

-- ---------------------------------------------------------------------------
-- 3) RECLAMAR — el comando que fija la identidad ante el proveedor.
-- ---------------------------------------------------------------------------
create function public.reclamar_cfdi(
  p_op_id uuid, p_doc_id uuid, p_provider_env text, p_claim_id uuid default null
) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare
  v_trusted text := coalesce(current_setting('app.trusted', true), '');
  v_req jsonb; v_prev jsonb; v_role text := public.auth_role();
  v_st text; v_serie text; v_folio text; v_date text; v_rfc text;
  v_claim uuid := coalesce(p_claim_id, gen_random_uuid());
  v_t jsonb; v_n int;
begin
  if not (v_role = any (array['admin','billing'])
          or coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role','') = 'service_role') then
    raise exception 'NO_AUTORIZADO: solo Dirección o Facturación inicia un timbrado';
  end if;
  v_req := jsonb_build_object('doc', p_doc_id, 'env', p_provider_env);
  v_prev := public._w3_op_begin(p_op_id, 'cfdi_reclamado', v_req);
  if v_prev is not null then return v_prev; end if;

  -- (1) BLOQUEO primero: el perdedor de una carrera aborta sin consumir folio.
  select status into v_st from public.fiscal_documents where id = p_doc_id for update;
  if not found then raise exception 'FISCAL_DOCUMENTO_INEXISTENTE'; end if;
  if v_st = 'timbrado' then
    raise exception 'CFDI_YA_TIMBRADO: este pedido ya tiene comprobante; no se vuelve a timbrar';
  elsif v_st = 'incierto' then
    raise exception 'CFDI_INCIERTO: no se sabe si el SAT ya timbró este pedido. Dirección debe conciliar; no se asigna otro folio.';
  elsif v_st = 'en_proceso' then
    raise exception 'CFDI_EN_PROCESO: ya hay un timbrado en curso para este pedido';
  elsif v_st <> 'pendiente' then
    raise exception 'FISCAL_ESTADO_NO_RECLAMABLE: no se puede timbrar una intención en estado %', v_st;
  end if;

  -- Emisor: se congela el RFC vigente (lo exige la consulta de estatus del SAT).
  select upper(btrim(coalesce(rfc, ''))) into v_rfc from public.company_settings where id = 'default';
  if coalesce(v_rfc, '') = '' then
    raise exception 'EMISOR_SIN_RFC: captura el RFC fiscal de la empresa en Configuración antes de facturar';
  end if;

  select serie into v_serie from public.fiscal_series where activa and provider = 'facturama' order by serie limit 1;
  if v_serie is null then raise exception 'SERIE_FISCAL_INEXISTENTE: no hay una serie fiscal activa configurada'; end if;

  -- (2) Folio, ya con el bloqueo tomado.
  v_folio := public._w3_asignar_folio('facturama', p_provider_env, v_rfc);

  -- (3) `Date`: se genera UNA vez, en el huso del negocio (es la fecha local del
  --     lugar de expedición), y se guarda como el TEXTO EXACTO que irá al PAC.
  v_date := to_char(now() at time zone 'America/Mazatlan', 'YYYY-MM-DD"T"HH24:MI:SS');

  perform set_config('app.trusted', 'on', true);
  update public.fiscal_documents
     set serie = v_serie, folio = v_folio, provider_date_sent = v_date,
         issuer_rfc = v_rfc, provider_env = p_provider_env
   where id = p_doc_id and status = 'pendiente';
  get diagnostics v_n = row_count;
  perform set_config('app.trusted', v_trusted, true);
  if v_n = 0 then
    raise exception 'CFDI_EN_PROCESO: otra sesión tomó esta intención; no se asigna un segundo folio';
  end if;

  -- (4) Transición. Si la pierde, se ABORTA para revertir la asignación.
  v_t := public._w3_transicion(p_doc => p_doc_id, p_to => 'en_proceso', p_event => 'claim',
           p_from_expected => 'pendiente', p_reason => 'identidad fiscal asignada',
           p_claim => v_claim, p_op => p_op_id);
  if v_t is null then
    raise exception 'CFDI_EN_PROCESO: la intención cambió de estado durante el reclamo';
  end if;

  return public._w3_op_finish(p_op_id, 'cfdi_reclamado', v_req, jsonb_build_object(
    'status', 'applied', 'doc_id', p_doc_id, 'serie', v_serie, 'folio', v_folio,
    'provider_date_sent', v_date, 'issuer_rfc', v_rfc, 'provider_env', p_provider_env,
    'order_number', p_doc_id,            -- OrderNumber = id de la intención: estable por construcción
    'claim_id', v_claim,
    'replay_vence_en', public._w3_replay_vence(v_date)));
end;
$$;
comment on function public.reclamar_cfdi(uuid, uuid, text, uuid) is
  'Fija la identidad de la operación ante el PAC (serie, folio, Date, RFC del emisor) y pasa la intención a en_proceso. Esta transacción CONFIRMA antes de cualquier llamada al proveedor. Un reclamo perdido aborta para no consumir folio. OrderNumber es el propio id del documento: no hay nada que mantener sincronizado.';

-- ---------------------------------------------------------------------------
-- 4) PAYLOAD DE IDENTIDAD para el adaptador. Devuelve lo que hay que reenviar
--    byte-idéntico, y si el reenvío sigue siendo seguro.
-- ---------------------------------------------------------------------------
create function public.identidad_cfdi(p_doc_id uuid) returns jsonb
  language plpgsql stable security definer set search_path = public as
$$
declare d public.fiscal_documents;
begin
  if not (public.auth_role() = any (array['admin','billing'])
          or coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role','') = 'service_role') then
    raise exception 'NO_AUTORIZADO: solo Dirección o Facturación';
  end if;
  select * into d from public.fiscal_documents where id = p_doc_id;
  if not found then raise exception 'FISCAL_DOCUMENTO_INEXISTENTE'; end if;
  return jsonb_build_object(
    'doc_id', d.id, 'status', d.status, 'serie', d.serie, 'folio', d.folio,
    'provider_date_sent', d.provider_date_sent, 'issuer_rfc', d.issuer_rfc,
    'provider_env', d.provider_env, 'order_number', d.id,
    'receiver', d.receiver, 'total', d.total, 'currency', d.currency,
    'uuid', d.uuid, 'provider_ref', d.provider_ref,
    'replay_vence_en', public._w3_replay_vence(d.provider_date_sent),
    'replay_permitido', d.provider_date_sent is not null
                        and public._w3_replay_vence(d.provider_date_sent) > now()
                        and d.status in ('en_proceso','incierto'));
end;
$$;
comment on function public.identidad_cfdi(uuid) is
  'Identidad congelada que un reenvío debe reutilizar byte-idéntica, más si el reenvío sigue dentro de la ventana segura. No construye importes ni impuestos: D-W3-4 sigue abierta.';

-- ---------------------------------------------------------------------------
-- 5) RETIRO AUTORIZADO de `_w3_reclamar` (W3-A).
--
-- Reclamaba una intención SIN asignarle identidad ante el proveedor. Después de
-- B1 eso ya no es un estado válido: `ck_fiscal_identidad_proveedor` exige que
-- toda intención que haya llegado al proveedor lleve serie, folio, Date, RFC del
-- emisor y entorno. Conservarlo dejaría abierto un camino capaz de producir un
-- `en_proceso` sin identidad —justo lo que la constraint prohíbe—, así que se
-- elimina en vez de dejarlo como trampa.
--
-- Su reemplazo es reclamar_cfdi(), que hace lo mismo y además fija la identidad.
-- Mismo patrón con el que W2 retiró review_transfer_payment y W2-C event_sell.
-- ---------------------------------------------------------------------------
drop function if exists public._w3_reclamar(uuid, uuid);
