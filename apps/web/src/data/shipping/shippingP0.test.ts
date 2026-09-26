// Blindaje server-side Shipping P0 (source-guards). Verifica EN EL FUENTE el cierre de:
//   P0-A doble-guía (claim durable + exclusión + unknown-sin-retry + finalize atómico)
//   P0-B autoridad de precio (origen y tarifa server-side; nunca del cliente)
//   Blocker-C origen requerido desde company_settings (fail-closed)
import { describe, it, expect } from 'vitest'
import migSrc from '../../../../../supabase/migrations/20261011120000_shipping_p0.sql?raw'
import edgeSrc from '../../../../../supabase/functions/shipping/index.ts?raw'
import providerSrc from './provider.ts?raw'

describe('migración P0', () => {
  it('shipping_attempts con estados y columnas de reconciliación', () => {
    expect(migSrc).toMatch(/create table if not exists public\.shipping_attempts/)
    expect(migSrc).toMatch(/pending','succeeded','failed_safe_to_retry','unknown_requires_reconciliation/)
    expect(migSrc).toMatch(/idempotency_key/)
    expect(migSrc).toMatch(/request_fingerprint/)
    expect(migSrc).toMatch(/external_reference/)
  })
  it('EXCLUSIÓN REAL: índice único parcial que bloquea pending/succeeded/unknown por pedido', () => {
    expect(migSrc).toMatch(/create unique index if not exists uq_shipping_attempts_active/)
    expect(migSrc).toMatch(/where status in \('pending','succeeded','unknown_requires_reconciliation'\)/)
  })
  it('shipments: costo/moneda/quote_ref; customer_charge nullable (Fase 1 NULL)', () => {
    expect(migSrc).toMatch(/add column if not exists provider_cost\s+numeric/)
    expect(migSrc).toMatch(/add column if not exists currency\s+text/)
    expect(migSrc).toMatch(/add column if not exists quote_ref\s+text/)
    expect(migSrc).toMatch(/add column if not exists customer_charge numeric/)
  })
  it('finalize_shipment atómico (shipment + cierre del intento), SECURITY DEFINER', () => {
    expect(migSrc).toMatch(/create or replace function public\.finalize_shipment/)
    expect(migSrc).toMatch(/security definer/i)
    expect(migSrc).toMatch(/insert into public\.shipments/)
    expect(migSrc).toMatch(/update public\.shipping_attempts\s+set status = 'succeeded'/)
  })
  it('RLS: solo staff logística LEE shipping_attempts; anon sin acceso', () => {
    expect(migSrc).toMatch(/alter table public\.shipping_attempts enable row level security/)
    expect(migSrc).toMatch(/for select to authenticated/)
    expect(migSrc).toMatch(/auth_role\(\) = any \(array\['admin','warehouse','packing'\]\)/)
  })
  it('aditiva: no dedupe / no unique de email / no borra shipments', () => {
    expect(migSrc).not.toMatch(/delete from public\.shipments/i)
  })
})

describe('edge create_shipment — orden e invariantes', () => {
  it('Blocker-C: ORIGEN desde company_settings server-side, 422 si falta (antes de DHL)', () => {
    expect(edgeSrc).toMatch(/companyShipper\(admin\)/)
    expect(edgeSrc).toMatch(/shipping_origin_not_configured/)
    expect(edgeSrc).toMatch(/from\('company_settings'\)/)
    // NO se usa el shipper del cliente en el flujo neutro:
    expect(edgeSrc).not.toMatch(/const shipper = p\.shipper/)
  })
  it('CLAIM durable ANTES de crear en DHL (insert shipping_attempts precede al POST /shipments)', () => {
    const claim = edgeSrc.indexOf("from('shipping_attempts')\n        .insert")
    const createPost = edgeSrc.indexOf('`${base}/shipments`')
    expect(claim).toBeGreaterThan(-1)
    expect(createPost).toBeGreaterThan(claim) // el claim ocurre antes del POST de creación
  })
  it('carrera perdida (claimErr) → in_progress, sin llamar a DHL', () => {
    expect(edgeSrc).toMatch(/if \(claimErr \|\| !claim\) return json\(409, \{ error: 'in_progress'/)
  })
  it('P0-B: re-cotización server-side es autoridad; ignora amount/eta del cliente', () => {
    expect(edgeSrc).toMatch(/serverRate = parseRates\(rd\)\.find/)
    expect(edgeSrc).toMatch(/provider_cost: serverRate\.amount/)
    expect(edgeSrc).toMatch(/const etaDays = Number\(serverRate\.etaDays/)
    // El flujo NEUTRO ya no ecoa el precio/eta del cliente al éxito (patrón viejo eliminado):
    expect(edgeSrc).not.toMatch(/amount: Number\(rate\.amount \?\? 0\)/)
    expect(edgeSrc).not.toMatch(/etaDays: Number\(rate\.etaDays \?\? 2\)/)
  })
  it('timeout/excepción durante creación → unknown_requires_reconciliation (sin retry)', () => {
    expect(edgeSrc).toMatch(/markUnknown\(admin, attemptId, `create timeout\/network/)
    expect(edgeSrc).toMatch(/unknown_requires_reconciliation/)
  })
  it('rechazo confirmado / servicio no disponible → failed_safe_to_retry', () => {
    expect(edgeSrc).toMatch(/failAttempt\(admin, attemptId, dhlErrorMessage\(shipResp\.status/)
    expect(edgeSrc).toMatch(/failAttempt\(admin, attemptId, 'service_not_available'\)/)
  })
  it('finalize atómico vía RPC; su fallo → unknown (la guía existe, no recompra)', () => {
    expect(edgeSrc).toMatch(/admin\.rpc\('finalize_shipment'/)
    expect(edgeSrc).toMatch(/markUnknown\(admin, attemptId, `finalize:/)
  })
  it('etiqueta best-effort (su fallo NO recompra ni invalida la guía)', () => {
    expect(edgeSrc).toMatch(/etiqueta recuperable después/)
  })
  it('guía existente → idempotente sin llamar a DHL', () => {
    expect(edgeSrc).toMatch(/if \(existing\?\.tracking_number\) return json\(200, \{ idempotent: true/)
  })
})

describe('frontend fail-closed (#18)', () => {
  it('con backend, DHL no configurado NO cae a mock (lanza error)', () => {
    expect(providerSrc).toMatch(/if \(r === NOT_CONFIGURED\) throw new Error\('shipping_not_configured'\)/)
  })
})
