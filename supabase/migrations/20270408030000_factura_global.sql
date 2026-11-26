-- ============================================================================
-- FACTURA GLOBAL MENSUAL A PÚBLICO EN GENERAL (26 nov 2026, dueño/Toño: «ármalo de una vez»).
--   · Junta las ventas PAGADAS de un mes que nadie facturó a su nombre y las timbra en UN CFDI a público en general
--     (RFC XAXX010101000, régimen 616, uso S01, InformacionGlobal periodicidad 04 = mensual).
--   · Mismo camino seguro que la factura normal: la intención y su identidad (serie, folio y Date) se fijan ANTES de
--     salir a Facturama; lo que no demuestra «no hubo efecto» queda `incierto` y se concilia por serie+folio, nunca se
--     reintenta a ciegas. Folio de la misma serie y contador que las facturas normales (no hay choque).
--   · Una venta solo entra a UNA global (fiscal_global_pedidos.order_id único). Si el timbrado falla, se liberan.
--   · Una venta en una global ya no se factura a nombre del cliente (solicitar_cfdi → FACTURA_EN_GLOBAL).
--   · No entran: canceladas, no pagadas, con factura propia (pedida o timbrada) y las que esperan mercancía.
--   · El cálculo de conceptos lo hace la Edge cfdi (mismas reglas que la factura normal: IVA desde el precio final y
--     configuración fiscal VALIDADA por producto). Sin claves validadas, se responde qué falta y no se consume folio.
-- Rollback: supabase/rollback/factura_global/99_down.sql
-- ============================================================================
create table public.fiscal_globales (
  id uuid primary key default gen_random_uuid(),
  anio integer not null check (anio between 2024 and 2100),
  mes integer not null check (mes between 1 and 12),
  status text not null check (status in ('en_proceso', 'timbrado', 'fallido', 'incierto', 'cancelado')),
  serie text not null, folio text not null, provider_date_sent text not null, issuer_rfc text not null,
  provider_env text not null check (provider_env in ('sandbox', 'produccion')),
  claim_id uuid not null, claimed_at timestamptz not null default now(), claimed_by uuid,
  pedidos integer not null default 0, subtotal numeric, iva numeric, total numeric, forma_pago text,
  uuid text, provider_ref text, stamped_at timestamptz, error_code text, error_message text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint ck_fg_uuid check ((uuid is not null) = (status in ('timbrado', 'cancelado')))
);
create unique index uq_fg_mes_vivo on public.fiscal_globales (anio, mes) where status in ('en_proceso', 'timbrado', 'incierto');
create unique index uq_fg_uuid on public.fiscal_globales (uuid) where uuid is not null;
create unique index uq_fg_serie_folio on public.fiscal_globales (provider_env, issuer_rfc, serie, folio);
comment on table public.fiscal_globales is 'Facturas globales mensuales a público en general (una viva por mes)';

create table public.fiscal_global_pedidos (
  global_id uuid not null references public.fiscal_globales(id) on delete restrict,
  order_id uuid not null references public.orders(id) on delete restrict,
  total numeric not null,
  primary key (global_id, order_id)
);
create unique index uq_fgp_pedido on public.fiscal_global_pedidos (order_id);
comment on table public.fiscal_global_pedidos is 'Ventas incluidas en una factura global (cada venta, en una sola)';

alter table public.fiscal_globales enable row level security;
alter table public.fiscal_global_pedidos enable row level security;
create policy fg_leer on public.fiscal_globales for select to authenticated using (public.auth_role() in ('admin', 'billing'));
create policy fgp_leer on public.fiscal_global_pedidos for select to authenticated using (public.auth_role() in ('admin', 'billing'));
revoke insert, update, delete on public.fiscal_globales, public.fiscal_global_pedidos from authenticated, anon;

-- ¿La venta ya está en una factura global viva? (bloquea la factura a nombre del cliente)
create function public._pedido_en_global(p_order uuid)
 returns boolean language sql stable security definer set search_path to 'public'
as $function$
  select exists (select 1 from public.fiscal_global_pedidos gp join public.fiscal_globales g on g.id = gp.global_id
                  where gp.order_id = p_order and g.status in ('en_proceso', 'timbrado', 'incierto'));
$function$;
revoke all on function public._pedido_en_global(uuid) from public, anon, authenticated;

-- Ventas que entran a la global del mes.
create function public._fg_elegibles(p_anio integer, p_mes integer)
 returns setof uuid language sql stable security definer set search_path to 'public'
as $function$
  select o.id from public.orders o
   where (o.created_at at time zone 'America/Mazatlan')::date >= make_date(p_anio, p_mes, 1)
     and (o.created_at at time zone 'America/Mazatlan')::date < (make_date(p_anio, p_mes, 1) + interval '1 month')::date
     and o.status <> 'cancelled' and o.payment_status = 'paid' and coalesce(o.total, 0) > 0
     and not exists (select 1 from public.fiscal_documents f where f.order_id = o.id and f.kind = 'ingreso' and f.status in ('pendiente', 'en_proceso', 'timbrado', 'incierto'))
     and not exists (select 1 from public.fiscal_global_pedidos gp where gp.order_id = o.id)
     and not public._pedido_esperando_mercancia(o.id)
     and not coalesce((select p.interna from public.profiles p where p.id::text = o.shipping_meta ->> 'seller_profile_id'), false);
$function$;
revoke all on function public._fg_elegibles(integer, integer) from public, anon, authenticated;

-- Lo que la Edge necesita para armar la global (sin escribir nada).
create function public.factura_global_preparar(p_anio integer, p_mes integer)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare cs record; env public.fiscal_concepto_envio; v_falta text[] := '{}'; v_pedidos jsonb; v_fin date;
begin
  perform public._pf_autorizar();
  if p_anio is null or p_mes is null or p_mes not between 1 and 12 then raise exception 'PERIODO_INVALIDO' using errcode = 'check_violation'; end if;
  v_fin := (make_date(p_anio, p_mes, 1) + interval '1 month - 1 day')::date;
  select razon_social, rfc, regimen_fiscal, cp into cs from public.company_settings where id = 'default';
  select * into env from public.fiscal_concepto_envio where id = 'envio';
  if public.hoy_local() <= v_fin then v_falta := v_falta || ('El mes todavía no cierra: la global de ' || to_char(make_date(p_anio, p_mes, 1), 'MM/YYYY') || ' se emite a partir del ' || to_char(v_fin + 1, 'DD/MM/YYYY') || ' (hasta ese día los clientes aún pueden pedir su factura).'); end if;
  if exists (select 1 from public.fiscal_globales g where g.anio = p_anio and g.mes = p_mes and g.status in ('en_proceso', 'timbrado', 'incierto')) then
    v_falta := v_falta || 'Ese mes ya tiene una factura global (timbrada o en proceso).'::text; end if;
  if nullif(btrim(coalesce(cs.rfc, '')), '') is null or nullif(btrim(coalesce(cs.razon_social, '')), '') is null
     or nullif(btrim(coalesce(cs.regimen_fiscal, '')), '') is null or coalesce(cs.cp, '') !~ '^[0-9]{5}$' then
    v_falta := v_falta || 'Faltan datos fiscales del emisor (Configuración): RFC, razón social, régimen o CP.'::text; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'order_id', o.id, 'folio', o.external_ref, 'total', o.total, 'shipping_cost', coalesce(o.shipping_cost, 0),
           'lineas', (select coalesce(jsonb_agg(jsonb_build_object('product_id', i.product_id, 'sku', p.sku, 'nombre', p.name, 'qty', i.qty, 'unit_price', i.unit_price,
                        'clave_prod_serv', f.clave_prod_serv, 'clave_unidad', f.clave_unidad, 'objeto_imp', f.objeto_imp, 'tratamiento_iva', f.tratamiento_iva,
                        'iva_tasa', f.iva_tasa, 'descripcion_fiscal', f.descripcion_fiscal, 'validado', coalesce(f.validado, false)) order by i.created_at, i.id), '[]'::jsonb)
                        from public.order_items i join public.products p on p.id = i.product_id left join public.product_fiscal f on f.product_id = i.product_id
                       where i.order_id = o.id and i.unit_price is not null),
           'cobros', (select coalesce(jsonb_agg(jsonb_build_object('method', m, 'amount', a) order by a desc), '[]'::jsonb)
                        from (select e.method m, sum(case when e.direction = 'in' then e.amount else -e.amount end) a
                                from public.payment_entries e where e.order_id = o.id and e.refund_id is null group by e.method) t where a > 0)
         ) order by o.created_at), '[]'::jsonb)
    into v_pedidos
    from public.orders o where o.id in (select public._fg_elegibles(p_anio, p_mes));

  return jsonb_build_object('anio', p_anio, 'mes', p_mes, 'periodo_fin', v_fin,
    'emisor', jsonb_build_object('rfc', upper(btrim(coalesce(cs.rfc, ''))), 'razon_social', cs.razon_social, 'regimen_fiscal', cs.regimen_fiscal, 'cp', cs.cp),
    'envio', case when env.id is not null then jsonb_build_object('clave_prod_serv', env.clave_prod_serv, 'clave_unidad', env.clave_unidad, 'objeto_imp', env.objeto_imp,
               'tratamiento_iva', env.tratamiento_iva, 'iva_tasa', env.iva_tasa, 'descripcion_fiscal', env.descripcion_fiscal, 'validado', env.validado) end,
    'pedidos', v_pedidos, 'faltantes', to_jsonb(v_falta),
    'globales', (select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'anio', g.anio, 'mes', g.mes, 'status', g.status, 'serie', g.serie, 'folio', g.folio,
                   'uuid', g.uuid, 'pedidos', g.pedidos, 'total', g.total, 'provider_env', g.provider_env, 'error_message', g.error_message, 'created_at', g.created_at) order by g.created_at desc), '[]'::jsonb)
                   from public.fiscal_globales g));
end;
$function$;

-- Reclamo: congela las ventas (exactamente las que se mandan) y fija la identidad. Sin efectos si algo no cuadra.
create function public.factura_global_reclamar(p_anio integer, p_mes integer, p_provider_env text, p_pedidos uuid[], p_subtotal numeric, p_iva numeric, p_total numeric, p_forma_pago text)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_id uuid := gen_random_uuid(); v_claim uuid := gen_random_uuid(); v_serie text; v_folio text; v_date text; v_rfc text; v_n int; v_suma numeric;
begin
  perform public._pf_autorizar();
  if p_provider_env not in ('sandbox', 'produccion') then raise exception 'ENTORNO_FISCAL_INVALIDO'; end if;
  if public.hoy_local() <= (make_date(p_anio, p_mes, 1) + interval '1 month - 1 day')::date then raise exception 'GLOBAL_MES_ABIERTO: el mes todavía no cierra'; end if;
  perform pg_advisory_xact_lock(hashtext('factura_global:' || p_anio || '-' || p_mes));
  if exists (select 1 from public.fiscal_globales g where g.anio = p_anio and g.mes = p_mes and g.status in ('en_proceso', 'timbrado', 'incierto')) then
    raise exception 'GLOBAL_YA_EXISTE: ese mes ya tiene una factura global'; end if;
  if coalesce(array_length(p_pedidos, 1), 0) = 0 then raise exception 'GLOBAL_SIN_VENTAS: no hay ventas para la factura global'; end if;
  -- Exactamente las elegibles de hoy: si algo cambió entre la vista previa y el reclamo, no se timbra.
  if exists (select unnest(p_pedidos) except select public._fg_elegibles(p_anio, p_mes)) then
    raise exception 'GLOBAL_CAMBIO: alguna venta ya no es elegible (se facturó, se canceló o cambió); vuelve a revisar'; end if;
  select sum(o.total) into v_suma from public.orders o where o.id = any (p_pedidos);
  if abs(v_suma - p_total) > 0.02 then raise exception 'GLOBAL_TOTAL: los conceptos (%) no cuadran con las ventas (%)', p_total, v_suma; end if;

  select upper(btrim(coalesce(rfc, ''))) into v_rfc from public.company_settings where id = 'default';
  if coalesce(v_rfc, '') = '' then raise exception 'EMISOR_SIN_RFC'; end if;
  select serie into v_serie from public.fiscal_series where activa and provider = 'facturama' order by serie limit 1;
  if v_serie is null then raise exception 'SERIE_FISCAL_INEXISTENTE'; end if;
  v_folio := public._w3_asignar_folio('facturama', p_provider_env, v_rfc);
  v_date := to_char(now() at time zone 'America/Mazatlan', 'YYYY-MM-DD"T"HH24:MI:SS');

  insert into public.fiscal_globales (id, anio, mes, status, serie, folio, provider_date_sent, issuer_rfc, provider_env, claim_id, claimed_by, pedidos, subtotal, iva, total, forma_pago)
  values (v_id, p_anio, p_mes, 'en_proceso', v_serie, v_folio, v_date, v_rfc, p_provider_env, v_claim, auth.uid(), array_length(p_pedidos, 1), p_subtotal, p_iva, p_total, p_forma_pago);
  insert into public.fiscal_global_pedidos (global_id, order_id, total) select v_id, o.id, o.total from public.orders o where o.id = any (p_pedidos);
  get diagnostics v_n = row_count;
  if v_n <> array_length(p_pedidos, 1) then raise exception 'GLOBAL_CAMBIO: no se pudieron congelar todas las ventas'; end if;
  insert into public.audit_logs (actor, action, resource_type, resource_id, payload, created_at)
  values (auth.uid(), 'Factura global', 'app', v_serie || '-' || v_folio, jsonb_build_object('area', 'Facturación', 'detail', format('Global %s/%s: %s ventas, total %s', lpad(p_mes::text, 2, '0'), p_anio, v_n, p_total)), now());
  return jsonb_build_object('id', v_id, 'serie', v_serie, 'folio', v_folio, 'provider_date_sent', v_date, 'order_number', 'G-' || v_id::text, 'claim_id', v_claim, 'issuer_rfc', v_rfc);
end;
$function$;

-- Resultado del PAC. Fallido (sin efecto) libera las ventas; incierto se concilia.
create function public.factura_global_registrar(p_id uuid, p_claim uuid, p_resultado text, p_uuid text default null, p_provider_ref text default null, p_error_code text default null, p_error_message text default null)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare g public.fiscal_globales;
begin
  perform public._pf_autorizar();
  select * into g from public.fiscal_globales where id = p_id for update;
  if not found then raise exception 'GLOBAL_INEXISTENTE'; end if;
  if g.claim_id <> p_claim then raise exception 'GLOBAL_RECLAMO_AJENO'; end if;
  if g.status not in ('en_proceso', 'incierto') then raise exception 'GLOBAL_ESTADO: la global está en %', g.status; end if;
  if p_resultado = 'timbrado' then
    if p_uuid is null or p_uuid !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'UUID_INVALIDO'; end if;
    update public.fiscal_globales set status = 'timbrado', uuid = p_uuid, provider_ref = p_provider_ref, stamped_at = now(), error_code = null, error_message = null, updated_at = now() where id = p_id;
  elsif p_resultado = 'fallido' then
    delete from public.fiscal_global_pedidos where global_id = p_id;
    update public.fiscal_globales set status = 'fallido', error_code = left(p_error_code, 80), error_message = left(p_error_message, 400), updated_at = now() where id = p_id;
  elsif p_resultado = 'incierto' then
    update public.fiscal_globales set status = 'incierto', error_code = left(p_error_code, 80), error_message = left(p_error_message, 400), updated_at = now() where id = p_id;
  else raise exception 'RESULTADO_INVALIDO'; end if;
  return jsonb_build_object('id', p_id, 'status', p_resultado);
end;
$function$;

-- Identidad para conciliar una global incierta (o reenviarla con la misma serie, folio y Date).
create function public.factura_global_identidad(p_id uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare g public.fiscal_globales;
begin
  perform public._pf_autorizar();
  select * into g from public.fiscal_globales where id = p_id;
  if not found then raise exception 'GLOBAL_INEXISTENTE'; end if;
  return jsonb_build_object('id', g.id, 'anio', g.anio, 'mes', g.mes, 'status', g.status, 'serie', g.serie, 'folio', g.folio, 'provider_date_sent', g.provider_date_sent,
    'order_number', 'G-' || g.id::text, 'claim_id', g.claim_id, 'claimed_at', g.claimed_at, 'provider_env', g.provider_env,
    'pedidos', (select coalesce(jsonb_agg(order_id), '[]'::jsonb) from public.fiscal_global_pedidos where global_id = g.id),
    'replay_permitido', public._w3_replay_vence(g.provider_date_sent) > now());
end;
$function$;

revoke all on function public.factura_global_preparar(integer, integer) from public, anon;
revoke all on function public.factura_global_reclamar(integer, integer, text, uuid[], numeric, numeric, numeric, text) from public, anon;
revoke all on function public.factura_global_registrar(uuid, uuid, text, text, text, text, text) from public, anon;
revoke all on function public.factura_global_identidad(uuid) from public, anon;
grant execute on function public.factura_global_preparar(integer, integer) to authenticated, service_role;
grant execute on function public.factura_global_reclamar(integer, integer, text, uuid[], numeric, numeric, numeric, text) to authenticated, service_role;
grant execute on function public.factura_global_registrar(uuid, uuid, text, text, text, text, text) to authenticated, service_role;
grant execute on function public.factura_global_identidad(uuid) to authenticated, service_role;

-- solicitar_cfdi: bloquea ventas que ya están en una global.
CREATE OR REPLACE FUNCTION public.solicitar_cfdi(p_op_id uuid, p_order_id uuid, p_receiver jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_trusted text := coalesce(current_setting('app.trusted', true), '');
  v_req jsonb; v_prev jsonb; v_role text := public.auth_role();
  v_doctor uuid; v_cust uuid; v_status text; v_total numeric; v_curr text; v_venta date;
  v_recv jsonb; v_fp text; v_live public.fiscal_documents; v_res jsonb;
begin
  if p_order_id is null then raise exception 'PEDIDO_REQUERIDO'; end if;
  v_req := jsonb_build_object('order', p_order_id,
             'receiver', case when p_receiver is null then null else public._fiscal_clean(p_receiver) end);
  v_prev := public._w3_op_begin(p_op_id, 'cfdi_solicitado', v_req);
  if v_prev is not null then return v_prev; end if;

  select o.doctor_id, o.customer_id, o.status, o.total, o.currency, (o.created_at at time zone 'America/Mazatlan')::date
    into v_doctor, v_cust, v_status, v_total, v_curr, v_venta
    from public.orders o where o.id = p_order_id for update;
  if not found then raise exception 'PEDIDO_INEXISTENTE'; end if;

  -- Autorización: Dirección/Facturación/Punto de venta, o el propio dueño del pedido.
  if v_role = any (array['admin','billing']) or (v_role = 'pos' and public._sec_c1_pos_ve_pedido(p_order_id)) then null;   -- FISCAL-1: Ventas, solo sus pedidos
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

  -- FACTURA GLOBAL (26 nov 2026): una venta incluida en la global del mes ya no se factura a nombre del cliente.
  if public._pedido_en_global(p_order_id) then
    raise exception 'FACTURA_EN_GLOBAL: esta venta ya está en la factura global del mes a público en general; no se puede facturar a nombre del cliente'
      using errcode = 'check_violation';
  end if;

  -- FACTURA EN EL MES (26 nov 2026, dueño): el cliente pide su factura a más tardar el ÚLTIMO DÍA del mes de la venta
  -- (hora de Culiacán). Después, la venta va a la factura global del mes a público en general y ya no se factura a su
  -- nombre. Solo frena solicitudes NUEVAS: una pedida a tiempo se puede corregir y timbrar.
  if public.hoy_local() > (date_trunc('month', v_venta) + interval '1 month - 1 day')::date then
    raise exception 'FACTURA_FUERA_DE_MES: la venta es de %; la factura se pide a más tardar el % y ahora va en la factura global del mes a público en general',
      to_char(v_venta, 'DD/MM/YYYY'), to_char((date_trunc('month', v_venta) + interval '1 month - 1 day')::date, 'DD/MM/YYYY')
      using errcode = 'check_violation';
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
$function$;
