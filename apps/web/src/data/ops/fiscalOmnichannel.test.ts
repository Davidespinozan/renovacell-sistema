// Blindaje server-side del CFDI omnicanal (Fase 1). Verifica EN EL FUENTE:
//   • RPCs fiscales acotadas (autorización, ownership, solo meta.fiscal, no-timbrado, grants).
//   • cfdi: resolución de receptor snapshot→customer→profile, SIN defaults, validación 6 campos.
//   • cfdi-send: resolución de email canónica.
import { describe, it, expect } from 'vitest'
import rpcSrc from '../../../../../supabase/migrations/20261009120000_fiscal_omnichannel.sql?raw'
import cfdiSrc from '../../../../../supabase/functions/cfdi/index.ts?raw'
import rulesSrc from '../../../../../supabase/functions/cfdi/rules.ts?raw'
import sendSrc from '../../../../../supabase/functions/cfdi-send/index.ts?raw'
import f1Src from '../../../../../supabase/migrations/20261016120000_w3a_f1_schema.sql?raw'
import f2Src from '../../../../../supabase/migrations/20261016120100_w3a_f2_constraints.sql?raw'
import f3Src from '../../../../../supabase/migrations/20261016120200_w3a_f3_commands.sql?raw'
import { normFiscal, fiscalFaltantes } from '../../../../../supabase/functions/cfdi/rules'

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

// W3-A · La resolución del receptor se movió a dos lugares MÁS fuertes que una Edge Function:
//   · cfdi/rules.ts  — normalización pura y probada (entrada de W3-B);
//   · _w3_receptor()  — la cadena de autoridad snapshot → maestro → perfil legacy, server-side,
//     con el receptor CONGELADO en fiscal_documents.receiver y una constraint que prohíbe
//     que exista un documento fiscal con receptor incompleto.
describe('cfdi — receptor canónico sin defaults', () => {
  it('la cadena de autoridad vive en el servidor, no en la Edge Function', () => {
    expect(f3Src).toMatch(/create function public\._w3_receptor/)
    expect(f3Src).toMatch(/v_meta->'receiver'/)                 // 1) snapshot del pedido
    expect(f3Src).toMatch(/from public\.customers c where c\.id = v_cust/) // 2) maestro
    expect(f3Src).toMatch(/from public\.profiles p where p\.id = v_doc/)   // 3) legacy
  })
  it('NO usa defaults silenciosos 616 / G03 / full_name', () => {
    for (const src of [cfdiSrc, rulesSrc, f3Src]) {
      expect(src).not.toMatch(/\?\?\s*'616'/)
      expect(src).not.toMatch(/'616'/)
      expect(src).not.toMatch(/\?\?\s*'G03'/)
    }
    expect(cfdiSrc).not.toMatch(/full_name/)
  })
  it('un receptor incompleto se rechaza, y la base lo prohíbe por constraint', () => {
    expect(fiscalFaltantes(normFiscal({}))).toHaveLength(6)
    expect(f3Src).toMatch(/DATOS_FISCALES_REQUERIDOS/)
    expect(f2Src).toMatch(/ck_fiscal_receptor_completo check \(public\._fiscal_error\(receiver\) is null\)/)
  })
  it('un receptor explícito inválido NO cae a otra fuente', () => {
    expect(f3Src).toMatch(/un receptor explícito INVÁLIDO no se sustituye en silencio/)
  })
  it('el snapshot del receptor queda CONGELADO con el comprobante (#9)', () => {
    expect(f1Src).toMatch(/receiver\s+jsonb not null/)
    expect(f1Src).toMatch(/Congelado: no se recalcula ni se pierde/)
    // Y una vez que la solicitud sale, ya no se puede reescribir.
    expect(f1Src).toMatch(/FISCAL_SOLICITUD_CONGELADA/)
  })
  it('el gate de pago se conserva como regla pura (ver paymentGates)', () => {
    expect(rulesSrc).toMatch(/export function puedeTimbrar/)
    expect(rulesSrc).toMatch(/El pedido debe estar pagado antes de facturarse\./)
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
