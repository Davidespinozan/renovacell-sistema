-- ============================================================================
-- SHIPPING · FASE 1 (P0) — anti-doble-guía + autoridad de precio + costo persistido.
--   P0-A: shipping_attempts (intento durable PRE-proveedor) + claim con exclusión real →
--         imposible comprar dos guías por doble clic / carrera / timeout desconocido.
--   P0-B: costo/moneda/servicio/quote_ref persistidos desde el servidor (no del cliente).
--   finalize_shipment: shipment + cierre del intento en UNA transacción (atómico).
-- ADITIVA. No toca los 3 pedidos existentes. No crea shipments históricos. No dedupe.
-- ============================================================================

-- 1) COSTO/REFERENCIA en shipments (para reconciliación futura). customer_charge queda
--    NULL en esta fase (Shipping NO cobra flete al cliente; se registra solo el costo del proveedor).
alter table public.shipments
  add column if not exists provider_cost   numeric,
  add column if not exists customer_charge numeric,   -- NO aplica en Fase 1 (siempre NULL)
  add column if not exists currency        text,
  add column if not exists quote_ref       text;

-- 2) INTENTO DURABLE (pre-proveedor). Separado de shipments. Es la evidencia que impide
--    recomprar una guía ante fallo/timeout, y el registro consultable para reconciliación.
create table if not exists public.shipping_attempts (
  id                   uuid primary key default gen_random_uuid(),
  order_id             uuid not null references public.orders(id) on delete cascade,
  provider             text not null default 'dhl',
  idempotency_key      text not null,
  service_code         text,
  request_fingerprint  text,        -- hash de shipper+receiver+package+service (detecta "cotizó A, compró B")
  status               text not null default 'pending',
                       -- pending | succeeded | failed_safe_to_retry | unknown_requires_reconciliation
  external_reference   text,        -- Message-Reference enviado a DHL (correlación, NO dedup)
  tracking_number      text,
  provider_cost        numeric,
  currency             text,
  quote_ref            text,
  error                text,        -- mensaje seguro (sin secretos)
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint ck_shipping_attempts_status
    check (status in ('pending','succeeded','failed_safe_to_retry','unknown_requires_reconciliation'))
);

-- EXCLUSIÓN REAL: como máximo UN intento ACTIVO/exitoso/bloqueado por pedido. Un intento
-- 'failed_safe_to_retry' NO bloquea (permite reintento). 'unknown_requires_reconciliation'
-- SÍ bloquea (no auto-retry hasta que un humano reconcilie). El claim = INSERT 'pending':
-- dos requests concurrentes → solo uno inserta; el otro recibe 23505 y NO llama al proveedor.
create unique index if not exists uq_shipping_attempts_active
  on public.shipping_attempts (order_id)
  where status in ('pending','succeeded','unknown_requires_reconciliation');

create index if not exists idx_shipping_attempts_order on public.shipping_attempts(order_id);

-- 3) RLS: solo staff de logística LEE; nadie (salvo service_role, que la bypassa) escribe
--    desde el cliente. anon sin acceso. El doctor no ve internals de proveedor/costo.
alter table public.shipping_attempts enable row level security;
drop policy if exists shipping_attempts_select_ops on public.shipping_attempts;
create policy shipping_attempts_select_ops on public.shipping_attempts
  for select to authenticated
  using (public.auth_role() = any (array['admin','warehouse','packing']));

-- 4) FINALIZACIÓN ATÓMICA: inserta el shipment y cierra el intento en una sola transacción.
--    Idempotente: si ya hay guía para el pedido, la reutiliza (no duplica) y cierra el intento.
create or replace function public.finalize_shipment(p_attempt_id uuid, p_shipment jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
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
$fn$;

revoke all on function public.finalize_shipment(uuid, jsonb) from public, anon;
grant execute on function public.finalize_shipment(uuid, jsonb) to authenticated, service_role;
