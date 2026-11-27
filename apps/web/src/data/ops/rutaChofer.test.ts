import { describe, expect, it, vi } from 'vitest'
import { cargaPorConfirmar, confirmarTodaLaCarga, nombreSugerido, pedirParada, resumenCarga, tomarParada } from './rutaChofer'

describe('chofer · recibir toda la carga de un toque', () => {
  it('solo cuenta lo que Almacén ya despachó y el chofer no ha confirmado', () => {
    const envios = [{ id: 'a', status: 'despachado' }, { id: 'b', status: 'por_despachar' }, { id: 'c', status: 'out_for_delivery' }, { id: 'd', status: 'despachado' }]
    expect(cargaPorConfirmar(envios).map((e) => e.id)).toEqual(['a', 'd'])
  })

  it('confirma cada pedido con el mismo comando de siempre', async () => {
    const confirmar = vi.fn(async () => ({ ok: true }))
    const r = await confirmarTodaLaCarga([{ id: '1', folio: 'S1' }, { id: '2', folio: 'S2' }], 'Manuel', confirmar)
    expect(confirmar).toHaveBeenCalledTimes(2)
    expect(confirmar).toHaveBeenNthCalledWith(2, '2', 'Manuel', 'S2')
    expect(r).toEqual({ ok: true, texto: 'Carga recibida: 2 pedidos.' })
  })

  it('si uno falla, sigue con los demás y lo dice con su folio', async () => {
    const confirmar = vi.fn(async (id: string) => (id === '2' ? { ok: false, error: 'Sin conexión.' } : { ok: true }))
    const r = await confirmarTodaLaCarga([{ id: '1', folio: 'S1' }, { id: '2', folio: 'S2' }, { id: '3', folio: 'S3' }], 'Manuel', confirmar)
    expect(confirmar).toHaveBeenCalledTimes(3)
    expect(r.ok).toBe(false)
    expect(r.texto).toBe('Se confirmaron 2 de 3. No quedó: S2. Sin conexión.')
  })

  it('un solo pedido se dice en singular y sin carga no inventa nada', () => {
    expect(resumenCarga([{ folio: 'S1', ok: true }]).texto).toBe('Carga recibida: 1 pedido.')
    expect(resumenCarga([])).toEqual({ ok: true, texto: 'No hay carga por confirmar.' })
  })
})

describe('chofer · quién recibe', () => {
  it('sugiere el nombre del cliente para tocarlo', () => {
    expect(nombreSugerido('  Dra. Ana Morales ')).toBe('Dra. Ana Morales')
  })
  it('no sugiere nombres genéricos ni vacíos: ahí se escribe quién recibió de verdad', () => {
    for (const n of ['', '  ', null, undefined, 'Cliente', 'Mostrador', 'Público en general', 'publico general', 'ab']) expect(nombreSugerido(n)).toBeNull()
  })
})

describe('chofer · llegar a la parada desde Inicio', () => {
  it('la parada pedida se toma una sola vez', () => {
    expect(tomarParada()).toBeNull()
    pedirParada('env-9')
    expect(tomarParada()).toBe('env-9')
    expect(tomarParada()).toBeNull()
  })
})
