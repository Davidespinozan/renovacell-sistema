// Envío CFDI — el fix del REVIEW ISSUE: una auditoría fallida NUNCA convierte un envío ya
// realizado en error para el frontend (evita reintentos que dupliquen el CFDI), y un fallo de
// auditoría en la rama de error NO enmascara el 502 original de Facturama.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { auditarSeguro, envioExitoso } from '../../../../../supabase/functions/cfdi-send/rules'
// Código fuente de la función como texto (Vite ?raw) para el test estructural D — sin node:fs.
import indexSrc from '../../../../../supabase/functions/cfdi-send/index.ts?raw'

let warnSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => { warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {}) })

describe('auditarSeguro — best-effort, nunca lanza, nunca altera el envío', () => {
  it('A) rpc devuelve {error} → resuelve false sin lanzar (el envío exitoso se mantiene 200)', async () => {
    const rpc = vi.fn(async () => ({ error: { message: 'boom' } }))
    await expect(auditarSeguro(rpc)).resolves.toBe(false) // no throw
    // La rama de éxito ignora este valor: envioExitoso decide, y sigue siendo éxito → 200/ok:true.
    expect(envioExitoso(200, { success: true })).toBe(true)
  })

  it('B) rpc LANZA/rechaza → resuelve false sin propagar (el envío exitoso se mantiene 200)', async () => {
    const rpc = vi.fn(async () => { throw new Error('network down') })
    await expect(auditarSeguro(rpc)).resolves.toBe(false) // no throw
    expect(envioExitoso(200, { success: true })).toBe(true)
  })

  it('rpc ok → true', async () => {
    await expect(auditarSeguro(async () => ({ error: null }))).resolves.toBe(true)
    await expect(auditarSeguro(async () => null)).resolves.toBe(true)
  })

  it('no filtra email/payload/credenciales en el aviso', async () => {
    await auditarSeguro(async () => { throw new Error('x') })
    await auditarSeguro(async () => ({ error: 'x' }))
    const logged = warnSpy.mock.calls.map((c) => c.join(' ')).join(' | ')
    expect(logged).not.toMatch(/@/) // sin email
    expect(logged).not.toMatch(/facturama_id|Basic|password|uuid/i)
  })
})

describe('C) rama de error: envioExitoso decide 502; la auditoría no puede cambiarlo', () => {
  it('success:false o no-2xx → NO éxito (rama 502), y auditarSeguro tolera el fallo sin lanzar', async () => {
    expect(envioExitoso(200, { success: false })).toBe(false)
    expect(envioExitoso(502, { success: true })).toBe(false)
    // Aunque la auditoría del fallo también falle, no lanza → el 502 ORIGINAL se conserva.
    await expect(auditarSeguro(async () => { throw new Error('audit down') })).resolves.toBe(false)
  })
})

describe('D) la lógica interna hace UN solo POST a Facturama (sin reintentos)', () => {
  it('index.ts tiene exactamente un fetch a /Cfdi y ningún bucle de reintento', () => {
    const fetches = indexSrc.match(/fetch\(/g) ?? []
    expect(fetches.length).toBe(1)
    expect(indexSrc).toMatch(/\/Cfdi\?/)
    // No hay bucles alrededor del envío (nada de retry/while/for sobre el POST).
    expect(indexSrc).not.toMatch(/\b(for|while)\b/)
  })
})
