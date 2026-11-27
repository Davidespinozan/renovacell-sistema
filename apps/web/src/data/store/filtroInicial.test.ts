import { describe, expect, it } from 'vitest'
import { pedirFiltro, tomarFiltro } from './filtroInicial'

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
})
