// PAQ-B · cliente de `anular_guia`: argumentos exactos, lectura del resultado y traducción de rechazos.
import { describe, it, expect, vi } from 'vitest'
import { anularGuia, mensajeAnular } from './anularGuia'

describe('anularGuia', () => {
  it('llama al comando con la operación, el pedido y el motivo; applied y already_applied son éxito', async () => {
    const rpc = vi.fn().mockResolvedValueOnce({ data: { status: 'applied', guia_anulada: '8664197986' }, error: null }).mockResolvedValueOnce({ data: { status: 'already_applied', guia_anulada: '8664197986' }, error: null })
    expect(await anularGuia('O-1', 'dirección equivocada', 'op-1', rpc)).toEqual({ ok: true, guia: '8664197986' })
    expect(rpc).toHaveBeenCalledWith('anular_guia', { p_op_id: 'op-1', p_order: 'O-1', p_motivo: 'dirección equivocada' })
    expect((await anularGuia('O-1', 'dirección equivocada', 'op-1', rpc)).ok).toBe(true)
  })
  it('rechazo de negocio: mensaje claro y NO ambiguo', async () => {
    for (const [codigo, texto] of [['RECOLECCION_AGENDADA', /cancela la recolección/], ['PAQUETE_EN_PAQUETERIA', /ya no se anula/], ['NO_AUTORIZADO', /Dirección, Almacén o Empaque/], ['MOTIVO_REQUERIDO', /por qué/], ['GUIA_EN_PROCESO', /resolverse/]] as const) {
      const r = await anularGuia('O-1', 'x', 'op', async () => ({ data: null, error: { message: `${codigo}: detalle` } }))
      expect(r.ok).toBe(false); if (!r.ok) { expect(r.error).toMatch(texto); expect(r.ambiguo).toBe(false) }
    }
  })
  it('fallo de red, error sin código o respuesta rara: resultado desconocido (ambiguo), sin filtrar el detalle', async () => {
    const a = await anularGuia('O-1', 'x', 'op', async () => { throw new Error('fetch failed') })
    const b = await anularGuia('O-1', 'x', 'op', async () => ({ data: null, error: { message: 'canceling statement due to statement timeout' } }))
    const c = await anularGuia('O-1', 'x', 'op', async () => ({ data: {}, error: null }))
    for (const r of [a, b, c]) { expect(r.ok).toBe(false); if (!r.ok) { expect(r.ambiguo).toBe(true); expect(r.error).not.toMatch(/timeout|fetch/) } }
  })
  it('código desconocido: mensaje genérico', () => { expect(mensajeAnular('ALGO_NUEVO: x')).toMatch(/No se pudo anular/); expect(mensajeAnular(undefined)).toMatch(/No se pudo anular/) })
})
