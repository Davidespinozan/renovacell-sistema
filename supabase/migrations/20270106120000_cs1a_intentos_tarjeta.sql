-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
-- CS-1A.1a · INTENTOS DE COBRO CON TARJETA (CyberSource / BanBajío) · migración 184
--   Persistencia de INTENTOS bancarios del portal del doctor (CS-D07) con reserva de saldo, máquina de estados,
--   evidencia mínima para reconstruir un pago interrumpido sin repetirlo, y contabilización idempotente en el ledger W2
--   vía `registrar_cobro` (que NO se toca: SEC-B fija su md5).
--   · `card_payment_attempts`: UN intento activo por pedido (índice único parcial). El intento ES la reserva: cuenta
--     mientras está en created…captured o en unknown_requires_reconciliation; deja de contar en posted/declined/
--     failed_safe_to_retry/expired/amount_changed/closed. El importe se fija en el servidor al abrir (= saldo contable).
--   · `card_payment_attempt_events`: bitácora append-only de transiciones (auditoría).
--   · `saldo_disponible(pedido)` = total − cobrado_neto − reservas activas. `v_order_disponible` lo expone con
--     security_invoker (la RLS de orders decide qué pedidos ve cada quien; NO depende de pedido_visible ni de
--     v_order_money para que las cadenas de rollback previas sigan siendo reversibles).
--   · RPCs: `cs_intento_abrir` (doctor dueño verificado o Dirección; bloquea la fila del pedido), `cs_intento_avanzar`
--     (service_role / Dirección / Facturación; transiciones válidas; authz_sent reconfirma el saldo bajo bloqueo),
--     `cs_intento_contabilizar` (service_role / Dirección / Facturación; op_id derivado del id de pago de CyberSource,
--     igual que hace el webhook de Stripe; external_ref = id de pago → uq_entry_external_ref impide el doble asiento).
--   · `cs_intentos_expirar()` por cron cada 5 min: SOLO intentos anteriores a authz_sent con más de 15 min de inactividad.
--     Nada posterior a authz_sent expira solo (podría haber cargo).
--   Lo que NO hace (CS-1A.1b, bloque aparte): el disparador que hace respetar las reservas a los demás canales.
--   Sin PAN, CVV, tokens transitorios, CAVV ni secretos. Sin red. Sin cambios a comandos existentes.
--   Rollback: supabase/rollback/cs1a_intentos/99_down.sql.
-- ═══════════════════════════════════════════════════════════════════════════════════════════════════
do $pre$ begin
  if to_regclass('public.orders') is null or to_regclass('public.payment_entries') is null then raise exception 'CS1A: falta el ledger W2'; end if;
  if to_regprocedure('public.registrar_cobro(uuid,uuid,text,numeric,date,text,uuid,text)') is null then raise exception 'CS1A: falta registrar_cobro'; end if;
  if to_regprocedure('public.is_verified()') is null or to_regprocedure('public.auth_role()') is null or to_regprocedure('public.hoy_local()') is null then raise exception 'CS1A: faltan helpers'; end if;
  if to_regclass('public.card_payment_attempts') is not null then raise exception 'CS1A: ya aplicada'; end if;
end $pre$;

-- ---------------------------------------------------------------------------------------------------
-- 1) Tablas
-- ---------------------------------------------------------------------------------------------------
create table public.card_payment_attempts (
  id                      uuid primary key default gen_random_uuid(),
  order_id                uuid not null references public.orders(id) on delete restrict,
  doctor_id               uuid not null,
  provider                text not null default 'cybersource' check (provider = 'cybersource'),
  ambiente                text not null check (ambiente in ('test', 'production')),
  amount                  numeric not null check (amount > 0),
  currency                text not null default 'MXN' check (currency = 'MXN'),
  status                  text not null default 'created',
  status_at               timestamptz not null default clock_timestamp(),
  created_at              timestamptz not null default clock_timestamp(),
  updated_at              timestamptz not null default clock_timestamp(),
  cs_capture_context_exp  timestamptz,
  cs_auth_reference_id    text,
  cs_auth_transaction_id  text,
  cs_auth_status          text,
  cs_eci                  text,
  cs_payment_id           text,
  cs_payment_status       text,
  cs_reconciliation_id    text,
  cs_reason               text,
  cs_approval_code        text,
  cs_request_sent_at      timestamptz,
  cs_response_at          timestamptz,
  op_id                   uuid,
  entry_id                uuid,          -- asiento en payment_entries (sin FK: la cadena de rollback W2 debe seguir pudiendo bajar)
  error_safe              text,
  reconciled_at           timestamptz,
  reconciled_by           uuid,
  reconcile_note          text,
  constraint ck_cpa_status check (status in (
    'created','tokenized','auth_setup','auth_pending','auth_challenge','auth_validated','authz_sent',
    'authorized','captured','posted','declined','failed_safe_to_retry','unknown_requires_reconciliation',
    'expired','amount_changed','closed')),
  constraint ck_cpa_posted_con_pago check (status <> 'posted' or (cs_payment_id is not null and entry_id is not null and op_id is not null))
);
comment on table public.card_payment_attempts is
  'CS-1A.1a · intentos de cobro con tarjeta (CyberSource). El intento ES la reserva de saldo mientras está activo. '
  'Sin PAN/CVV/tokens. Escritura SOLO por las RPC cs_intento_*; lectura: el doctor dueño, Dirección y Facturación.';

-- Estados que RESERVAN saldo (activos o inciertos). Inmutable para poder usarla en índices parciales y en la vista.
create function public._cs_estado_activo(p_status text) returns boolean
  language sql immutable parallel safe as
$$ select p_status in ('created','tokenized','auth_setup','auth_pending','auth_challenge','auth_validated','authz_sent','authorized','captured','unknown_requires_reconciliation') $$;

-- UN intento activo/incierto por pedido: el claim = INSERT; dos aperturas concurrentes → solo una entra.
create unique index uq_cpa_activo_por_pedido on public.card_payment_attempts (order_id)
  where status in ('created','tokenized','auth_setup','auth_pending','auth_challenge','auth_validated','authz_sent','authorized','captured','unknown_requires_reconciliation');
create unique index uq_cpa_cs_payment on public.card_payment_attempts (cs_payment_id) where cs_payment_id is not null;
create unique index uq_cpa_op on public.card_payment_attempts (op_id) where op_id is not null;
create index idx_cpa_order on public.card_payment_attempts (order_id, created_at desc);
create index idx_cpa_status on public.card_payment_attempts (status, status_at);

create table public.card_payment_attempt_events (
  id          bigserial primary key,
  attempt_id  uuid not null references public.card_payment_attempts(id) on delete restrict,
  from_status text,
  to_status   text not null,
  actor       uuid,
  actor_role  text,
  detalle     jsonb,
  created_at  timestamptz not null default clock_timestamp()
);
create index idx_cpae_attempt on public.card_payment_attempt_events (attempt_id, id);
comment on table public.card_payment_attempt_events is 'CS-1A.1a · bitácora append-only de transiciones de intentos de tarjeta (auditoría).';

-- Append-only: los eventos no se editan ni borran; los intentos no se borran (se cierran).
create function public._cs_append_only() returns trigger language plpgsql as
$$ begin raise exception 'APPEND_ONLY: % no admite %', tg_table_name, tg_op using errcode = 'insufficient_privilege'; end $$;
create trigger trg_cpae_append_only before update or delete on public.card_payment_attempt_events for each row execute function public._cs_append_only();
create trigger trg_cpa_no_delete before delete on public.card_payment_attempts for each row execute function public._cs_append_only();
create trigger trg_cpae_no_truncate before truncate on public.card_payment_attempt_events execute function public._cs_append_only();
create trigger trg_cpa_no_truncate before truncate on public.card_payment_attempts execute function public._cs_append_only();

-- RLS: solo lectura para clientes; toda escritura por RPC (SECURITY DEFINER, dueño postgres).
alter table public.card_payment_attempts enable row level security;
alter table public.card_payment_attempt_events enable row level security;
revoke all on public.card_payment_attempts, public.card_payment_attempt_events from anon, public, authenticated;
grant select on public.card_payment_attempts, public.card_payment_attempt_events to authenticated;
create policy cpa_select on public.card_payment_attempts for select to authenticated
  using (doctor_id = auth.uid() or public.auth_role() = any (array['admin','billing']));
create policy cpae_select on public.card_payment_attempt_events for select to authenticated
  using (public.auth_role() = any (array['admin','billing']));
revoke all on sequence public.card_payment_attempt_events_id_seq from anon, public, authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 2) Saldo disponible = total − cobrado_neto − reservas activas (distinto del saldo contable de v_order_money)
-- ---------------------------------------------------------------------------------------------------
create function public.cs_reservas_activas(p_order uuid) returns numeric
  language sql stable security definer set search_path = public as
$$ select coalesce(sum(a.amount), 0) from public.card_payment_attempts a where a.order_id = p_order and public._cs_estado_activo(a.status) $$;
revoke all on function public.cs_reservas_activas(uuid) from public, anon;

create function public.saldo_disponible(p_order uuid) returns numeric
  language plpgsql stable security definer set search_path = public as
$$
declare v_total numeric; v_neto numeric;
begin
  -- misma visibilidad que la RLS de orders (pedido_visible es security invoker: ve lo que ve quien llama)
  if not public.pedido_visible(p_order) then return null; end if;
  select coalesce(o.total, 0) into v_total from public.orders o where o.id = p_order;
  if v_total is null then return null; end if;
  select coalesce(sum(case when direction = 'in' then amount else -amount end), 0) into v_neto from public.payment_entries where order_id = p_order;
  return v_total - v_neto - public.cs_reservas_activas(p_order);
end $$;
comment on function public.saldo_disponible(uuid) is 'CS-1A.1a · total − cobrado_neto − reservas activas de tarjeta. NULL si el pedido no es visible para quien llama.';
revoke all on function public.saldo_disponible(uuid) from public, anon;
grant execute on function public.saldo_disponible(uuid) to authenticated, service_role;

-- security_invoker: la RLS de orders filtra para el que consulta (doctor: sus pedidos; Dirección/Facturación: todos).
create view public.v_order_disponible with (security_invoker = true) as
select o.id as order_id, o.external_ref, o.status as order_status,
       coalesce(o.total, 0) as total,
       coalesce(e.neto, 0) as cobrado_neto,
       coalesce(o.total, 0) - coalesce(e.neto, 0) as saldo_contable,
       coalesce(r.reservas, 0) as reservas_activas,
       coalesce(o.total, 0) - coalesce(e.neto, 0) - coalesce(r.reservas, 0) as saldo_disponible,
       r.intento_id as intento_activo_id, r.intento_status as intento_activo_estado
from public.orders o
left join lateral (select sum(case when pe.direction = 'in' then pe.amount else -pe.amount end) as neto from public.payment_entries pe where pe.order_id = o.id) e on true
left join lateral (select sum(a.amount) as reservas, max(a.id::text)::uuid as intento_id, max(a.status) as intento_status
                     from public.card_payment_attempts a where a.order_id = o.id and public._cs_estado_activo(a.status)) r on true;
comment on view public.v_order_disponible is 'CS-1A.1a · saldo contable vs saldo DISPONIBLE para nuevas operaciones (resta reservas activas de tarjeta). security_invoker.';
revoke all on public.v_order_disponible from anon, public, authenticated;   -- los privilegios por defecto darían ALL a authenticated
grant select on public.v_order_disponible to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- 3) Máquina de estados
-- ---------------------------------------------------------------------------------------------------
create function public._cs_transicion_valida(p_de text, p_a text) returns boolean
  language sql immutable parallel safe as
$$
  select case
    when p_de = 'created'        then p_a in ('tokenized','failed_safe_to_retry','expired')
    when p_de = 'tokenized'      then p_a in ('auth_setup','failed_safe_to_retry','expired')
    when p_de = 'auth_setup'     then p_a in ('auth_pending','failed_safe_to_retry','expired')
    when p_de = 'auth_pending'   then p_a in ('auth_challenge','auth_validated','declined','failed_safe_to_retry','expired')
    when p_de = 'auth_challenge' then p_a in ('auth_validated','declined','failed_safe_to_retry','expired')
    when p_de = 'auth_validated' then p_a in ('authz_sent','failed_safe_to_retry','expired')
    when p_de = 'authz_sent'     then p_a in ('authorized','captured','declined','unknown_requires_reconciliation')
    when p_de = 'authorized'     then p_a in ('captured','unknown_requires_reconciliation')
    when p_de = 'captured'       then p_a in ('unknown_requires_reconciliation')          -- a posted solo por cs_intento_contabilizar
    when p_de = 'unknown_requires_reconciliation' then p_a in ('authorized','captured','declined','failed_safe_to_retry')  -- solo con evidencia
    else false
  end
$$;

create function public._cs_evento(p_attempt uuid, p_de text, p_a text, p_detalle jsonb) returns void
  language plpgsql security definer set search_path = public as
$$
begin
  insert into public.card_payment_attempt_events (attempt_id, from_status, to_status, actor, actor_role, detalle)
  values (p_attempt, p_de, p_a, auth.uid(),
          coalesce(nullif(public.auth_role(), ''), case when coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role' then 'service_role' else '' end),
          p_detalle);
end $$;
revoke all on function public._cs_evento(uuid, text, text, jsonb) from public, anon, authenticated;

create function public._cs_es_servidor() returns boolean
  language sql stable set search_path = public as
$$ select coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'service_role' or public.auth_role() = any (array['admin','billing']) $$;
revoke all on function public._cs_es_servidor() from public, anon, authenticated;

-- Texto seguro: sin correos, sin secuencias largas de dígitos (PAN/teléfonos), sin tokens largos; 200 máx.
create function public._cs_texto_seguro(p text) returns text
  language sql immutable parallel safe as
$$ select left(regexp_replace(regexp_replace(regexp_replace(coalesce(p, ''), '[^@\s]+@[^@\s]+', '‹correo›', 'g'), '\d{7,}', '‹número›', 'g'), '[A-Za-z0-9_\-]{32,}', '‹token›', 'g'), 200) $$;

-- op_id derivado del id de pago de CyberSource: MISMA receta que el webhook de Stripe (sha256 → uuid v5/RFC4122).
create function public._cs_op_id(p_payment_id text) returns uuid
  language plpgsql immutable parallel safe as
$$
declare v bytea := sha256(convert_to('cybersource:' || p_payment_id, 'UTF8'));
begin
  v := set_byte(v, 6, (get_byte(v, 6) & 15) | 80);
  v := set_byte(v, 8, (get_byte(v, 8) & 63) | 128);
  return encode(substring(v from 1 for 16), 'hex')::uuid;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- 4) RPC · abrir intento (doctor dueño verificado o Dirección). Bloquea la fila del pedido: es el punto de
--    serialización con registrar_cobro / revisar_pago / cc_checkout_confirmar (todos toman orders FOR UPDATE).
-- ---------------------------------------------------------------------------------------------------
create function public.cs_intento_abrir(p_order uuid, p_ambiente text default 'test') returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_uid uuid := auth.uid(); v_rol text := public.auth_role(); v_o record; v_neto numeric; v_reservas numeric; v_act record; v_id uuid; v_saldo numeric;
begin
  if v_uid is null then raise exception 'NO_AUTORIZADO' using errcode = 'insufficient_privilege'; end if;
  if p_ambiente not in ('test', 'production') then raise exception 'AMBIENTE_INVALIDO' using errcode = 'check_violation'; end if;
  select * into v_o from public.orders where id = p_order for update;
  if not found then raise exception 'PEDIDO_INEXISTENTE' using errcode = 'no_data_found'; end if;
  if not (v_rol = 'admin' or (v_rol = 'doctor' and v_o.doctor_id = v_uid and public.is_verified())) then
    raise exception 'NO_AUTORIZADO: solo el doctor dueño (verificado) o Dirección abren un cobro con tarjeta' using errcode = 'insufficient_privilege';
  end if;
  if v_o.status in ('draft', 'cancelled') then raise exception 'PEDIDO_NO_PAGABLE: % no admite cobros', v_o.status using errcode = 'check_violation'; end if;

  select coalesce(sum(case when direction = 'in' then amount else -amount end), 0) into v_neto from public.payment_entries where order_id = p_order;
  v_saldo := coalesce(v_o.total, 0) - v_neto;
  select * into v_act from public.card_payment_attempts a where a.order_id = p_order and public._cs_estado_activo(a.status) order by a.created_at desc limit 1;
  if found then
    -- recuperación: dos pestañas / recarga / doble clic → el mismo intento (nunca un segundo cargo)
    return jsonb_build_object('status', 'existing', 'attempt_id', v_act.id, 'estado', v_act.status, 'amount', v_act.amount,
                              'total', coalesce(v_o.total, 0), 'cobrado_neto', v_neto, 'saldo', v_saldo,
                              'bloqueado', v_act.status = 'unknown_requires_reconciliation');
  end if;
  if v_saldo <= 0 then raise exception 'SIN_SALDO: el pedido no tiene saldo pendiente' using errcode = 'check_violation'; end if;
  v_reservas := public.cs_reservas_activas(p_order);   -- 0 aquí (no hay intento activo), se deja explícito
  if v_saldo - v_reservas <= 0 then raise exception 'SIN_SALDO: el saldo está reservado por otra operación' using errcode = 'check_violation'; end if;

  v_id := gen_random_uuid();
  insert into public.card_payment_attempts (id, order_id, doctor_id, ambiente, amount)
  values (v_id, p_order, v_o.doctor_id, p_ambiente, v_saldo - v_reservas);   -- CS-D07: el saldo pendiente COMPLETO
  perform public._cs_evento(v_id, null, 'created', jsonb_build_object('amount', v_saldo - v_reservas, 'total', coalesce(v_o.total, 0), 'cobrado_neto', v_neto));
  return jsonb_build_object('status', 'created', 'attempt_id', v_id, 'estado', 'created', 'amount', v_saldo - v_reservas,
                            'total', coalesce(v_o.total, 0), 'cobrado_neto', v_neto, 'saldo', v_saldo, 'bloqueado', false);
end $$;
comment on function public.cs_intento_abrir(uuid, text) is 'CS-1A.1a · abre (o devuelve) el intento activo de tarjeta de un pedido; importe = saldo pendiente completo fijado en servidor.';
revoke all on function public.cs_intento_abrir(uuid, text) from public, anon;
grant execute on function public.cs_intento_abrir(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------
-- 5) RPC · avanzar (servidor: service_role, Dirección o Facturación). Idempotente ante la misma transición repetida.
--    authz_sent: ANTES de llamar al banco; reconfirma el saldo bajo bloqueo → si cambió, cierra 'amount_changed'.
--    unknown → algo: solo con p_datos.evidencia (conciliación con prueba).
-- ---------------------------------------------------------------------------------------------------
create function public.cs_intento_avanzar(p_attempt uuid, p_estado text, p_datos jsonb default '{}'::jsonb) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_a record; v_o record; v_neto numeric; v_saldo numeric; v_pay text; v_detalle jsonb;
begin
  if not public._cs_es_servidor() then raise exception 'NO_AUTORIZADO: solo el servidor avanza intentos' using errcode = 'insufficient_privilege'; end if;
  p_datos := coalesce(p_datos, '{}'::jsonb);
  select * into v_o from public.orders o where o.id = (select order_id from public.card_payment_attempts where id = p_attempt) for update;
  select * into v_a from public.card_payment_attempts where id = p_attempt for update;
  if not found then raise exception 'INTENTO_INEXISTENTE' using errcode = 'no_data_found'; end if;
  if v_a.status = p_estado then
    return jsonb_build_object('status', 'already', 'attempt_id', v_a.id, 'estado', v_a.status, 'amount', v_a.amount);
  end if;
  if not public._cs_transicion_valida(v_a.status, p_estado) then
    raise exception 'TRANSICION_INVALIDA: % → %', v_a.status, p_estado using errcode = 'check_violation';
  end if;
  if v_a.status = 'unknown_requires_reconciliation' and nullif(btrim(coalesce(p_datos ->> 'evidencia', '')), '') is null then
    raise exception 'EVIDENCIA_REQUERIDA: salir de un resultado desconocido exige evidencia del proveedor o de conciliación' using errcode = 'check_violation';
  end if;
  v_pay := coalesce(nullif(btrim(coalesce(p_datos ->> 'cs_payment_id', '')), ''), v_a.cs_payment_id);
  if p_estado in ('authorized', 'captured') and v_pay is null then
    raise exception 'PAGO_SIN_ID: authorized/captured exigen cs_payment_id (evidencia del proveedor)' using errcode = 'check_violation';
  end if;

  if p_estado = 'authz_sent' then
    -- reconfirmación: el importe fijado debe seguir siendo el saldo contable vigente (abonos de otros canales, cambios del pedido)
    select coalesce(sum(case when direction = 'in' then amount else -amount end), 0) into v_neto from public.payment_entries where order_id = v_a.order_id;
    v_saldo := coalesce(v_o.total, 0) - v_neto;
    if v_saldo <> v_a.amount or v_o.status in ('draft', 'cancelled') then
      update public.card_payment_attempts set status = 'amount_changed', status_at = clock_timestamp(), updated_at = clock_timestamp(),
             error_safe = format('saldo vigente %s ≠ importe fijado %s', v_saldo, v_a.amount) where id = p_attempt;
      perform public._cs_evento(p_attempt, v_a.status, 'amount_changed', jsonb_build_object('saldo_vigente', v_saldo, 'amount', v_a.amount, 'order_status', v_o.status));
      return jsonb_build_object('status', 'amount_changed', 'attempt_id', v_a.id, 'estado', 'amount_changed', 'amount', v_a.amount, 'saldo_vigente', v_saldo);
    end if;
  end if;

  update public.card_payment_attempts set
    status = p_estado, status_at = clock_timestamp(), updated_at = clock_timestamp(),
    cs_capture_context_exp = coalesce((p_datos ->> 'cs_capture_context_exp')::timestamptz, cs_capture_context_exp),
    cs_auth_reference_id   = coalesce(nullif(p_datos ->> 'cs_auth_reference_id', ''), cs_auth_reference_id),
    cs_auth_transaction_id = coalesce(nullif(p_datos ->> 'cs_auth_transaction_id', ''), cs_auth_transaction_id),
    cs_auth_status         = coalesce(nullif(p_datos ->> 'cs_auth_status', ''), cs_auth_status),
    cs_eci                 = coalesce(nullif(p_datos ->> 'cs_eci', ''), cs_eci),
    cs_payment_id          = v_pay,
    cs_payment_status      = coalesce(nullif(p_datos ->> 'cs_payment_status', ''), cs_payment_status),
    cs_reconciliation_id   = coalesce(nullif(p_datos ->> 'cs_reconciliation_id', ''), cs_reconciliation_id),
    cs_reason              = coalesce(public._cs_texto_seguro(nullif(p_datos ->> 'cs_reason', '')), cs_reason),
    cs_approval_code       = coalesce(nullif(p_datos ->> 'cs_approval_code', ''), cs_approval_code),
    cs_request_sent_at     = case when p_estado = 'authz_sent' then clock_timestamp() else cs_request_sent_at end,
    cs_response_at         = case when v_a.status = 'authz_sent' and p_estado <> 'unknown_requires_reconciliation' then clock_timestamp() else cs_response_at end,
    error_safe             = coalesce(public._cs_texto_seguro(nullif(p_datos ->> 'error', '')), error_safe),
    reconciled_at          = case when v_a.status = 'unknown_requires_reconciliation' then clock_timestamp() else reconciled_at end,
    reconciled_by          = case when v_a.status = 'unknown_requires_reconciliation' then auth.uid() else reconciled_by end,
    reconcile_note         = case when v_a.status = 'unknown_requires_reconciliation' then public._cs_texto_seguro(p_datos ->> 'evidencia') else reconcile_note end
  where id = p_attempt;
  v_detalle := jsonb_strip_nulls(jsonb_build_object('cs_payment_id', v_pay, 'cs_auth_status', p_datos ->> 'cs_auth_status', 'cs_payment_status', p_datos ->> 'cs_payment_status',
                                                    'error', public._cs_texto_seguro(nullif(p_datos ->> 'error', '')), 'evidencia', public._cs_texto_seguro(nullif(p_datos ->> 'evidencia', ''))));
  perform public._cs_evento(p_attempt, v_a.status, p_estado, v_detalle);
  return jsonb_build_object('status', 'applied', 'attempt_id', v_a.id, 'estado', p_estado, 'amount', v_a.amount, 'cs_payment_id', v_pay);
end $$;
comment on function public.cs_intento_avanzar(uuid, text, jsonb) is 'CS-1A.1a · transición de estado de un intento (solo servidor); authz_sent reconfirma el saldo; unknown exige evidencia.';
revoke all on function public.cs_intento_avanzar(uuid, text, jsonb) from public, anon;
grant execute on function public.cs_intento_avanzar(uuid, text, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------
-- 6) RPC · contabilizar (captured → posted): registrar_cobro con op_id derivado y external_ref = id de pago.
--    Idempotente: replay de la operación (already_applied) o asiento previo con la misma referencia → se enlaza.
--    El dinero real SIEMPRE se contabiliza (si hubiera sobrepago, v_order_money lo marca y CS-D03 lo resuelve).
-- ---------------------------------------------------------------------------------------------------
create function public.cs_intento_contabilizar(p_attempt uuid) returns jsonb
  language plpgsql security definer set search_path = public as
$$
declare v_a record; v_op uuid; v_res jsonb; v_entry uuid; v_m record; v_como text;
begin
  if not public._cs_es_servidor() then raise exception 'NO_AUTORIZADO: solo el servidor contabiliza intentos' using errcode = 'insufficient_privilege'; end if;
  perform 1 from public.orders o where o.id = (select order_id from public.card_payment_attempts where id = p_attempt) for update;
  select * into v_a from public.card_payment_attempts where id = p_attempt for update;
  if not found then raise exception 'INTENTO_INEXISTENTE' using errcode = 'no_data_found'; end if;
  if v_a.status = 'posted' then
    return jsonb_build_object('status', 'already_posted', 'attempt_id', v_a.id, 'entry_id', v_a.entry_id, 'op_id', v_a.op_id);
  end if;
  if v_a.status <> 'captured' then raise exception 'NO_CAPTURADO: solo se contabiliza un intento en captured (está en %)', v_a.status using errcode = 'check_violation'; end if;
  if v_a.cs_payment_id is null then raise exception 'PAGO_SIN_ID' using errcode = 'check_violation'; end if;

  v_op := public._cs_op_id(v_a.cs_payment_id);
  perform set_config('app.cs_attempt', v_a.id::text, true);   -- CS-1A.1b: la reserva propia se consume (el guard la excluirá)
  begin
    v_res := public.registrar_cobro(v_op, v_a.order_id, 'tarjeta', v_a.amount, public.hoy_local(), v_a.cs_payment_id, null, v_a.id::text);
    v_entry := (v_res ->> 'entry_id')::uuid;
    v_como := case when v_res ->> 'status' = 'already_applied' then 'replay' else 'nuevo' end;
  exception when unique_violation then
    -- ya existe un asiento con esa referencia (p. ej. registrado a mano): se enlaza, nunca se duplica
    select id into v_entry from public.payment_entries where external_ref = v_a.cs_payment_id and direction = 'in' and reversal_of is null limit 1;
    if v_entry is null then raise; end if;
    v_como := 'enlazado';
  end;
  perform set_config('app.cs_attempt', '', true);
  update public.card_payment_attempts set status = 'posted', status_at = clock_timestamp(), updated_at = clock_timestamp(), op_id = v_op, entry_id = v_entry where id = p_attempt;
  perform public._cs_evento(p_attempt, 'captured', 'posted', jsonb_build_object('entry_id', v_entry, 'op_id', v_op, 'como', v_como));
  select * into v_m from public.v_order_money where order_id = v_a.order_id;
  return jsonb_build_object('status', 'posted', 'como', v_como, 'attempt_id', v_a.id, 'entry_id', v_entry, 'op_id', v_op,
                            'payment_status', v_m.estado_pago, 'saldo', v_m.saldo, 'sobrepago', v_m.sobrepago);
end $$;
comment on function public.cs_intento_contabilizar(uuid) is 'CS-1A.1a · captured → posted vía registrar_cobro (op_id = sha256(cybersource:pago), external_ref = id de pago). Idempotente.';
revoke all on function public.cs_intento_contabilizar(uuid) from public, anon;
grant execute on function public.cs_intento_contabilizar(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------------------------------
-- 7) Expiración: SOLO antes de authz_sent (nunca hubo llamada al banco) y con 15 min de inactividad.
-- ---------------------------------------------------------------------------------------------------
create function public.cs_intentos_expirar() returns integer
  language plpgsql security definer set search_path = public as
$$
declare r record; n int := 0;
begin
  for r in select id, status from public.card_payment_attempts
            where status in ('created','tokenized','auth_setup','auth_pending','auth_challenge','auth_validated')
              and status_at < clock_timestamp() - interval '15 minutes'
            for update skip locked loop
    update public.card_payment_attempts set status = 'expired', status_at = clock_timestamp(), updated_at = clock_timestamp() where id = r.id;
    perform public._cs_evento(r.id, r.status, 'expired', jsonb_build_object('motivo', 'inactividad > 15 min antes de enviar al banco'));
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.cs_intentos_expirar() from public, anon, authenticated;
-- Firma exacta de cron.schedule (job_name, schedule, command): idempotente al reaplicar.
select cron.schedule('renovacell-cs-intentos', '*/5 * * * *', 'select public.cs_intentos_expirar()');

do $post$ begin
  if to_regclass('public.card_payment_attempts') is null or to_regclass('public.card_payment_attempt_events') is null then raise exception 'CS1A: faltan tablas'; end if;
  if to_regclass('public.v_order_disponible') is null then raise exception 'CS1A: falta la vista'; end if;
  if to_regprocedure('public.cs_intento_abrir(uuid,text)') is null or to_regprocedure('public.cs_intento_avanzar(uuid,text,jsonb)') is null
     or to_regprocedure('public.cs_intento_contabilizar(uuid)') is null or to_regprocedure('public.saldo_disponible(uuid)') is null then raise exception 'CS1A: faltan RPC'; end if;
  if not exists (select 1 from cron.job where jobname = 'renovacell-cs-intentos') then raise exception 'CS1A: falta la tarea de expiración'; end if;
  if (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname in ('card_payment_attempts','card_payment_attempt_events') and not c.relrowsecurity) <> 0 then raise exception 'CS1A: RLS apagada'; end if;
end $post$;
