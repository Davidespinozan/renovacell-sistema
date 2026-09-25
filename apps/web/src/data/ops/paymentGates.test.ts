// Blindaje server-side de pagos (Pagos Fase 1). Verifica EN EL FUENTE que:
//  - el CFDI no se timbra sin pago (gate real, no solo el front),
//  - report-transfer valida la cuenta bancaria y marca el reporte como pendiente,
//  - la RPC de revisión es SECURITY DEFINER, solo Dirección/Facturación e idempotente.
// Sin llamadas reales a la base ni a las Edge Functions.
import { describe, it, expect } from 'vitest'
import cfdiSrc from '../../../../../supabase/functions/cfdi/index.ts?raw'
import reportSrc from '../../../../../supabase/functions/report-transfer/index.ts?raw'
import rpcSrc from '../../../../../supabase/migrations/20261008120000_review_transfer_payment.sql?raw'

describe('GATE CFDI · no se timbra un pedido sin pagar', () => {
  it('trae payment_status en el select del pedido', () => {
    expect(cfdiSrc).toMatch(/payment_status/)
  })
  it("bloquea con 422 cuando payment_status !== 'paid'", () => {
    expect(cfdiSrc).toMatch(/payment_status !== 'paid'/)
    expect(cfdiSrc).toMatch(/El pedido debe estar pagado antes de facturarse\./)
    expect(cfdiSrc).toMatch(/422/)
  })
  it('el gate de pago ocurre ANTES de construir/timbrar el comprobante', () => {
    const gate = cfdiSrc.indexOf("payment_status !== 'paid'")
    const fiscal = cfdiSrc.indexOf('missing_fiscal')
    expect(gate).toBeGreaterThan(-1)
    expect(fiscal).toBeGreaterThan(gate)
  })
})

describe('report-transfer · endurecido', () => {
  it('valida que la cuenta bancaria exista y esté ACTIVA (no solo el formato UUID)', () => {
    expect(reportSrc).toMatch(/company_bank_accounts/)
    expect(reportSrc).toMatch(/acct\.active !== true/)
  })
  it('marca el nuevo intento como pendiente de revisión', () => {
    expect(reportSrc).toMatch(/review:\s*\{\s*status:\s*'pending'\s*\}/)
  })
  it('archiva el intento previo en history[] (traza multi-intento, sin tabla nueva)', () => {
    expect(reportSrc).toMatch(/history/)
  })
  it('no duplica el aviso cuando ya había un reporte pendiente', () => {
    expect(reportSrc).toMatch(/alreadyPending/)
  })
  it('sigue rechazando un pedido ya pagado y validando dueño', () => {
    expect(reportSrc).toMatch(/payment_status === 'paid'/)
    expect(reportSrc).toMatch(/doctor_id !== who\.user\.id/)
  })
})

describe('RPC review_transfer_payment · autoridad y máquina de estados', () => {
  it('es SECURITY DEFINER con search_path fijo', () => {
    expect(rpcSrc).toMatch(/security definer/i)
    expect(rpcSrc).toMatch(/set search_path = public/i)
  })
  it('solo Dirección/Facturación (admin/billing); el doctor NO', () => {
    expect(rpcSrc).toMatch(/auth_role\(\)\s*=\s*any\s*\(array\['admin','billing'\]\)/i)
    expect(rpcSrc).toMatch(/NO_AUTORIZADO/)
  })
  it('confirmar es idempotente (ya pagado/confirmado → no-op)', () => {
    expect(rpcSrc).toMatch(/already_confirmed/)
  })
  it('no confirma un reporte previamente rechazado', () => {
    expect(rpcSrc).toMatch(/REPORTE_RECHAZADO/)
  })
  it('no rechaza un pago ya confirmado y exige motivo', () => {
    expect(rpcSrc).toMatch(/YA_CONFIRMADO/)
    expect(rpcSrc).toMatch(/MOTIVO_REQUERIDO/)
  })
  it('solo el confirm pone payment_status = paid', () => {
    expect(rpcSrc).toMatch(/payment_status = 'paid'/)
  })
  it('se revoca a public/anon y se otorga solo a authenticated', () => {
    expect(rpcSrc).toMatch(/revoke all on function public\.review_transfer_payment/i)
    expect(rpcSrc).toMatch(/grant execute on function public\.review_transfer_payment.*to authenticated/i)
  })
})
