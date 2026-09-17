// Cancelación CFDI — tests adversariales del claim atómico (fix de concurrencia). Sin llamadas
// reales a Facturama. La atomicidad real la garantiza Postgres (UPDATE condicional bajo lock de
// fila); aquí verificamos el MECANISMO en el fuente y la lógica pura de los helpers.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { auditarSeguro, construyeClaimMeta, construyeCancelMeta } from '../../../../../supabase/functions/cfdi-cancel/rules'
import { cfdiEnviable, cfdiCancelable } from './cfdi'
import { mkOrder } from '../../test/factories'
import cancelSrc from '../../../../../supabase/functions/cfdi-cancel/index.ts?raw'
import statusSrc from '../../../../../supabase/functions/cfdi-cancel-status/index.ts?raw'

let warnSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => { warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}) })

const posFetch = cancelSrc.indexOf('fetch(')

describe('A/K) claim atómico ANTES del DELETE; sin claim → 409; sin loops', () => {
  it('UPDATE condicional (cancel null / rechazada) con .select() ANTES del fetch', () => {
    const orIdx = cancelSrc.indexOf('invoice_meta->cancel->>status.is.null,invoice_meta->cancel->>status.eq.rechazada')
    expect(orIdx).toBeGreaterThan(-1)
    expect(orIdx).toBeLessThan(posFetch) // el claim precede al DELETE
    expect(cancelSrc).toMatch(/\.select\('id'\)/)
  })
  it('claim de 0 filas → 409 already_requested ANTES de cualquier fetch (0 DELETE)', () => {
    const noClaim = cancelSrc.indexOf('claimed.length === 0')
    expect(noClaim).toBeGreaterThan(-1)
    expect(noClaim).toBeLessThan(posFetch)
  })
  it('sin loops de reintento', () => { expect(cancelSrc).not.toMatch(/\b(for|while)\b/) })
})

describe('C/I) EXACTAMENTE un DELETE por invocación (incluye timeout ambiguo)', () => {
  it('un solo fetch en todo el archivo', () => {
    expect((cancelSrc.match(/fetch\(/g) ?? []).length).toBe(1)
    expect(cancelSrc).toMatch(/method:\s*'DELETE'/)
  })
})

describe('I) network/timeout ambiguo → conserva solicitada, NO libera, NO reintenta', () => {
  it('try/catch alrededor del fetch con fiscal_incierto y sin segundo fetch', () => {
    expect(cancelSrc).toMatch(/fiscal_incierto/)
    // El catch NO libera (no restaura invoice_meta original en la rama de timeout).
    const catchIdx = cancelSrc.indexOf('fiscal_incierto')
    const releaseIdx = cancelSrc.indexOf("cancel->>claim_id")
    // La liberación (por claim_id) ocurre en la rama de error HTTP, DESPUÉS del bloque de timeout.
    expect(releaseIdx).toBeGreaterThan(catchIdx)
  })
})

describe('G/H) liberación SOLO del propio claim (por claim_id) en error HTTP inequívoco', () => {
  it('el release condiciona por cancel->>status=solicitada Y cancel->>claim_id', () => {
    expect(cancelSrc).toMatch(/\.eq\('invoice_meta->cancel->>status', 'solicitada'\)/)
    expect(cancelSrc).toMatch(/\.eq\('invoice_meta->cancel->>claim_id', claimId\)/)
  })
})

describe('J) persist failure post-DELETE → persist_after_cancel, sin revertir claim ni 2º DELETE', () => {
  it('rama persist_after_cancel presente y un solo fetch total', () => {
    expect(cancelSrc).toMatch(/persist_after_cancel/)
    expect((cancelSrc.match(/fetch\(/g) ?? []).length).toBe(1)
  })
})

describe('B) audit best-effort: nunca lanza; no filtra credenciales', () => {
  it('{error} y throw → false', async () => {
    await expect(auditarSeguro(async () => ({ error: { message: 'x' } }))).resolves.toBe(false)
    await expect(auditarSeguro(async () => { throw new Error('down') })).resolves.toBe(false)
  })
  it('no filtra credenciales/acuse en el aviso', async () => {
    await auditarSeguro(async () => { throw new Error('x') })
    const logged = warnSpy.mock.calls.map((c) => c.join(' ')).join(' | ')
    expect(logged).not.toMatch(/Basic|AcuseXmlBase64|base64|password/i)
  })
})

describe('D/E/F) el estado final elimina claim_id', () => {
  const claimed = { uuid: 'U', facturama_id: 'F', status: 'timbrada', simulated: false, cancel: { status: 'solicitada', claim_id: 'CID', motive: '02' } }
  for (const [remote, expected] of [['canceled', 'cancelada'], ['pending', 'pendiente'], ['active', 'rechazada']] as const) {
    it(`${remote} → ${expected} sin claim_id`, () => {
      // El index construye el meta final desde el snapshot ORIGINAL (sin claim), pero aun partiendo
      // del claimed el helper reemplaza cancel completo → nunca conserva claim_id.
      const meta = construyeCancelMeta(claimed, { status: expected, motive: '02', requested_at: 'T1', acuse_available: false })
      expect(JSON.stringify(meta)).not.toMatch(/claim_id/)
      expect((meta.cancel as Record<string, unknown>).status).toBe(expected)
    })
  }
})

describe('E) active/rechazada → CFDI vigente; pendiente/cancelada no; simulado no', () => {
  const meta = (cancel?: unknown) => ({ status: 'timbrada', uuid: 'U', facturama_id: 'F', simulated: false, ...(cancel ? { cancel } : {}) })
  it('activa y rechazada → enviable y cancelable', () => {
    for (const c of [undefined, { status: 'rechazada' }]) {
      const o = mkOrder({ invoice_meta: meta(c) as never })
      expect(cfdiEnviable(o)).toBe(true); expect(cfdiCancelable(o)).toBe(true)
    }
  })
  it('solicitada/pendiente/cancelada → NO enviable NO cancelable', () => {
    for (const s of ['solicitada', 'pendiente', 'cancelada']) {
      const o = mkOrder({ invoice_meta: meta({ status: s }) as never })
      expect(cfdiEnviable(o)).toBe(false); expect(cfdiCancelable(o)).toBe(false)
    }
  })
})

describe('F) cfdi-cancel-status: GET exclusivo; error no muta', () => {
  it('un fetch, sin method DELETE, lee x?.Status', () => {
    expect((statusSrc.match(/fetch\(/g) ?? []).length).toBe(1)
    expect(statusSrc).not.toMatch(/method:\s*'DELETE'/)
    expect(statusSrc).toMatch(/x\?\.Status/)
  })
  it('error remoto retorna 502 antes de update', () => {
    expect(statusSrc.indexOf("error: 'facturama'")).toBeLessThan(statusSrc.indexOf('.update('))
  })
})
