import { describe, expect, it } from 'vitest'
import { escucharFiltro, pedirFiltro, tomarFiltro, verFiltro } from './filtroInicial'

describe('pendientes que abren ya filtrados', () => {
  it('el filtro pedido se toma una sola vez y solo por su pantalla', () => {
    expect(tomarFiltro('av_fin')).toBeNull()
    pedirFiltro('av_fin', 'por_emitir')
    expect(tomarFiltro('av_ventas')).toBeNull()
    expect(tomarFiltro('av_fin')).toBe('por_emitir')
    expect(tomarFiltro('av_fin')).toBeNull()
  })
  it('un segundo pedido pisa al primero', () => {
    pedirFiltro('av_fin', 'por_emitir'); pedirFiltro('av_fin', 'por_cobrar')
    expect(tomarFiltro('av_fin')).toBe('por_cobrar')
  })
  it('si la pantalla ya está abierta y escuchando, lo recibe al momento y no queda guardado', () => {
    const vistos: string[] = []
    const baja = escucharFiltro('av_ventas', (f) => vistos.push(f))
    pedirFiltro('av_ventas', 'pedido:o1')
    expect(vistos).toEqual(['pedido:o1'])
    expect(tomarFiltro('av_ventas')).toBeNull()
    baja()
    pedirFiltro('av_ventas', 'pedido:o2')
    expect(vistos).toEqual(['pedido:o1'])
    expect(tomarFiltro('av_ventas')).toBe('pedido:o2')
  })
  it('mirar no lo gasta: se puede leer varias veces hasta que la pantalla lo toma', () => {
    pedirFiltro('av_fin', 'por_emitir')
    expect(verFiltro('av_fin')).toBe('por_emitir')
    expect(verFiltro('av_fin')).toBe('por_emitir')
    expect(tomarFiltro('av_fin')).toBe('por_emitir')
    expect(verFiltro('av_fin')).toBeNull()
  })
})
