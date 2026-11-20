// BLOQUE1 (20 nov 2026) · efectivo del chofer, alertas de errores y mensajes nuevos.
import { describe, it, expect, vi } from 'vitest'
import { efectivoChofer } from './efectivoChofer'
import { w1Message } from './w1Command'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('efectivo del chofer', () => {
  it('recibir manda op, chofer, contado y motivo; el rechazo llega legible', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'MOTIVO_REQUERIDO: hay una diferencia de -50.00; explica por qué' } }))
    const r = await efectivoChofer(rpc).recibir('d1', 100, null, 'op-1')
    expect(rpc).toHaveBeenCalledWith('recibir_efectivo_chofer', { p_op_id: 'op-1', p_driver: 'd1', p_contado: 100, p_motivo: null })
    expect(r).toEqual({ ok: false, error: 'Hay una diferencia de -50.00; explica por qué' })
  })
  it('sin red: no revienta', async () => {
    const rpc = vi.fn(async () => { throw new Error('x') })
    const r = await efectivoChofer(rpc).mio()
    expect(r.ok).toBe(false)
  })
})

describe('cancelar con factura vigente', () => {
  it('CFDI_VIGENTE dice cómo resolverlo', () => {
    expect(w1Message('CFDI_VIGENTE: el pedido S1 tiene factura vigente')).toMatch(/Cancelar CFDI/)
  })
})

describe('contratos de pantalla', () => {
  const leer = (p: string) => readFileSync(resolve(__dirname, '..', '..', p), 'utf8')
  it('Doctores: ya no «Eliminar»; dar de baja pide motivo y revocar pide confirmación', () => {
    const s = leer('screens/admin/Doctores.tsx')
    expect(s).not.toMatch(/> Eliminar</)
    expect(s).toMatch(/Dar de baja/)
    expect(s).toMatch(/doctor-baja-motivo/)
    expect(s).not.toMatch(/onClick=\{\(\) => revoke\(/)
    expect(leer('data/store/doctorsStore.ts')).toMatch(/action: 'doctor_baja'/)
  })
  it('Seguimiento ofrece regresar al almacén y cambiar chofer', () => {
    const s = leer('screens/logistics/Seguimiento.tsx')
    expect(s).toMatch(/regreso-almacen/)
    expect(s).toMatch(/cambiar-chofer/)
  })
  it('errores: captura global instalada y la escritura desconocida se reporta', () => {
    expect(leer('main.tsx')).toMatch(/instalarCapturaErrores\(\)/)
    expect(leer('data/store/escritura.ts')).toMatch(/registrarError\('escritura'/)
  })
})
