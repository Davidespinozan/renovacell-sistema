import { describe, expect, it, vi } from 'vitest'
import { choferSugerido, entregarLoteAlChofer, textoSiguientePaso, type PasosLote } from './entregarChofer'

describe('almacén · chofer que ya viene elegido', () => {
  it('con un solo chofer, es ese', () => { expect(choferSugerido([{ id: 'a' }], null)).toBe('a') })
  it('con varios, el último que se eligió, si sigue en la lista', () => {
    expect(choferSugerido([{ id: 'a' }, { id: 'b' }], 'b')).toBe('b')
    expect(choferSugerido([{ id: 'a' }, { id: 'b' }], 'x')).toBe('')
  })
  it('con varios y sin historial no adivina: se elige', () => { expect(choferSugerido([{ id: 'a' }, { id: 'b' }], null)).toBe('') })
  it('sin choferes no hay sugerencia', () => { expect(choferSugerido([], 'a')).toBe('') })
})

describe('almacén · el botón dice el paso que sigue', () => {
  it('según cómo se vendió', () => {
    expect(textoSiguientePaso('recoge')).toBe('Listo para recoger')
    expect(textoSiguientePaso('chofer')).toBe('Entregar al chofer')
    expect(textoSiguientePaso('paqueteria')).toBe('Generar guía')
    expect(textoSiguientePaso(null)).toBe('Asignar envío')
  })
})

describe('almacén · entregar varios al chofer de una vez', () => {
  const PEDIDOS = [{ id: 'o1', folio: 'S1' }, { id: 'o2', folio: 'S2' }, { id: 'o3', folio: 'S3' }]
  const pasos = (x: Partial<PasosLote> = {}): PasosLote => ({
    asignar: vi.fn(async (id: string) => ({ ok: true as const, envioId: 'e-' + id })),
    darSalida: vi.fn(async () => ({ ok: true })),
    enCamino: vi.fn(async () => ({ ok: true })),
    ...x,
  })
  it('cada pedido hace los tres pasos, en orden y uno tras otro', async () => {
    const orden: string[] = []
    const p = pasos({
      asignar: vi.fn(async (id: string) => { orden.push('asignar ' + id); return { ok: true as const, envioId: 'e-' + id } }),
      darSalida: vi.fn(async (envio: string) => { orden.push('salida ' + envio); return { ok: true } }),
      enCamino: vi.fn(async (id: string) => { orden.push('camino ' + id); return { ok: true } }),
    })
    const avance: number[] = []
    const r = await entregarLoteAlChofer(PEDIDOS, 'drv-1', p, (n) => avance.push(n))
    expect(r).toEqual({ entregados: ['o1', 'o2', 'o3'], fallas: [] })
    expect(orden).toEqual(['asignar o1', 'salida e-o1', 'camino o1', 'asignar o2', 'salida e-o2', 'camino o2', 'asignar o3', 'salida e-o3', 'camino o3'])
    expect(p.asignar).toHaveBeenCalledWith('o2', 'drv-1'); expect(p.darSalida).toHaveBeenCalledWith('e-o2', 'S2'); expect(p.enCamino).toHaveBeenCalledWith('o2', 'drv-1')
    expect(avance).toEqual([1, 2, 3])
  })
  it('si uno no se pudo asignar, no se le da salida y los demás siguen', async () => {
    const p = pasos({ asignar: vi.fn(async (id: string) => (id === 'o2' ? { ok: false as const, error: 'Ya tiene un envío.' } : { ok: true as const, envioId: 'e-' + id })) })
    const r = await entregarLoteAlChofer(PEDIDOS, 'drv-1', p)
    expect(r.entregados).toEqual(['o1', 'o3'])
    expect(r.fallas).toEqual([{ id: 'o2', folio: 'S2', mensaje: 'No se asignó el chofer. Ya tiene un envío.' }])
    expect(p.darSalida).toHaveBeenCalledTimes(2); expect(p.enCamino).toHaveBeenCalledTimes(2)
  })
  it('si la salida falla, el pedido NO pasa a En camino y lo dice', async () => {
    const p = pasos({ darSalida: vi.fn(async (envio: string) => (envio === 'e-o1' ? { ok: false, error: 'Sin conexión.' } : { ok: true })) })
    const r = await entregarLoteAlChofer(PEDIDOS, 'drv-1', p)
    expect(r.fallas).toEqual([{ id: 'o1', folio: 'S1', mensaje: 'Quedó asignado, pero NO salió. Sin conexión.' }])
    expect(p.enCamino).not.toHaveBeenCalledWith('o1', 'drv-1')
    expect(r.entregados).toEqual(['o2', 'o3'])
  })
  it('si salió pero el pedido no cambió de paso, también lo dice', async () => {
    const p = pasos({ enCamino: vi.fn(async (id: string) => (id === 'o3' ? { ok: false, error: 'Intenta de nuevo.' } : { ok: true })) })
    const r = await entregarLoteAlChofer(PEDIDOS, 'drv-1', p)
    expect(r.fallas).toEqual([{ id: 'o3', folio: 'S3', mensaje: 'La carga salió, pero el pedido NO pasó a En camino. Intenta de nuevo.' }])
  })
})
