// Blindaje server-side del CFDI omnicanal (Fase 1). Verifica EN EL FUENTE:
//   • RPCs fiscales acotadas (autorización, ownership, solo meta.fiscal, no-timbrado, grants).
//   • cfdi: resolución de receptor snapshot→customer→profile, SIN defaults, validación 6 campos.
//   • cfdi-send: resolución de email canónica.
import { describe, it, expect } from 'vitest'
import rpcSrc from '../../../../../supabase/migrations/20261009120000_fiscal_omnichannel.sql?raw'
import cfdiSrc from '../../../../../supabase/functions/cfdi/index.ts?raw'
import sendSrc from '../../../../../supabase/functions/cfdi-send/index.ts?raw'

describe('RPC upsert_customer_fiscal — master acotado', () => {
  it('SECURITY DEFINER + search_path fijo', () => {
    expect(rpcSrc).toMatch(/create or replace function public\.upsert_customer_fiscal/i)
    expect(rpcSrc).toMatch(/security definer/i)
    expect(rpcSrc).toMatch(/set search_path = public/i)
  })
  it('roles admin/billing/pos o el doctor dueño (profile_id = auth.uid())', () => {
    expect(rpcSrc).toMatch(/array\['admin','billing','pos'\]/)
    expect(rpcSrc).toMatch(/profile_id = auth\.uid\(\)/)
    expect(rpcSrc).toMatch(/NO_AUTORIZADO/)
  })
  it('escribe SOLO meta.fiscal (no full_name/seller/active/profile_id)', () => {
    expect(rpcSrc).toMatch(/jsonb_set\(coalesce\(meta, '\{\}'::jsonb\), '\{fiscal\}'/)
    expect(rpcSrc).not.toMatch(/set full_name/i)
    expect(rpcSrc).not.toMatch(/set profile_id/i)
  })
  it('valida el perfil fiscal antes de escribir', () => {
    expect(rpcSrc).toMatch(/FISCAL_INVALIDO/)
    expect(rpcSrc).toMatch(/_fiscal_error/)
  })
})

describe('RPC set_order_fiscal_snapshot — snapshot por pedido', () => {
  it('SECURITY DEFINER + search_path fijo', () => {
    expect(rpcSrc).toMatch(/create or replace function public\.set_order_fiscal_snapshot/i)
  })
  it('un CFDI ya timbrado NO admite cambio de receptor', () => {
    expect(rpcSrc).toMatch(/YA_TIMBRADO/)
    expect(rpcSrc).toMatch(/in \('timbrada','emitida'\)/)
  })
  it('congela invoice_meta.receiver preservando el resto del jsonb', () => {
    expect(rpcSrc).toMatch(/jsonb_set\(coalesce\(invoice_meta, '\{\}'::jsonb\), '\{receiver\}'/)
    expect(rpcSrc).toMatch(/invoice_requested = true/)
  })
  it('ownership del doctor por doctor_id o customer.profile_id', () => {
    expect(rpcSrc).toMatch(/v_doc = auth\.uid\(\)/)
    expect(rpcSrc).toMatch(/c\.profile_id = auth\.uid\(\)/)
  })
})

describe('Grants fiscales', () => {
  it('helpers privados revocados a authenticated', () => {
    expect(rpcSrc).toMatch(/revoke all on function public\._fiscal_error\(jsonb\)\s+from public, anon, authenticated/i)
  })
  it('RPCs: revocadas a anon, otorgadas a authenticated', () => {
    expect(rpcSrc).toMatch(/revoke all on function public\.upsert_customer_fiscal\(uuid, jsonb\)\s+from public, anon/i)
    expect(rpcSrc).toMatch(/grant execute on function public\.upsert_customer_fiscal\(uuid, jsonb\)\s+to authenticated/i)
    expect(rpcSrc).toMatch(/grant execute on function public\.set_order_fiscal_snapshot\(uuid, jsonb\)\s+to authenticated/i)
  })
})

describe('cfdi Edge — receptor canónico sin defaults', () => {
  it('resuelve en orden snapshot → customer → profile legacy', () => {
    expect(cfdiSrc).toMatch(/normFiscal\(inv\.receiver\)/)
    expect(cfdiSrc).toMatch(/from\('customers'\)\.select\('meta'\)/)
    expect(cfdiSrc).toMatch(/from\('profiles'\)\.select\('meta, email'\)/)
    expect(cfdiSrc).toMatch(/customer_id/) // el select del pedido trae customer_id
  })
  it('NO usa defaults silenciosos 616 / G03 / full_name', () => {
    expect(cfdiSrc).not.toMatch(/\?\?\s*'616'/)
    expect(cfdiSrc).not.toMatch(/\?\?\s*'G03'/)
    expect(cfdiSrc).not.toMatch(/full_name/)
  })
  it('valida los 6 campos y devuelve 422 controlado si faltan', () => {
    expect(cfdiSrc).toMatch(/fiscalFaltantes/)
    expect(cfdiSrc).toMatch(/missing_fiscal/)
  })
  it('conserva el snapshot del receptor al persistir el timbre (#9)', () => {
    expect(cfdiSrc).toMatch(/const stamp = \{ receiver,/)
  })
  it('mantiene el gate de pago existente', () => {
    expect(cfdiSrc).toMatch(/payment_status !== 'paid'/)
  })
})

describe('cfdi-send Edge — email canónico', () => {
  it('resuelve snapshot → customer master → profile legacy (no POS huérfano)', () => {
    expect(sendSrc).toMatch(/receiver/)
    expect(sendSrc).toMatch(/email_facturacion/)
    expect(sendSrc).toMatch(/from\('customers'\)\.select\('meta'\)/)
    expect(sendSrc).toMatch(/email_missing/)
  })
})
