// @vitest-environment jsdom
// PENDIENTES QUE ABREN YA FILTRADOS (27 nov 2026): el renglón deja el filtro y luego navega; uno sin filtro navega igual.
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { ListaTareas, type Task } from './Bandeja'
import { tomarFiltro } from '../data/store/filtroInicial'

const t = (o: Partial<Task>): Task => ({ id: 'x', icon: 'receipt', title: 'Tarea', detail: '', count: 1, tone: 'warn', screen: 'av_fin', ...o })
beforeEach(() => { cleanup(); tomarFiltro('av_fin'); tomarFiltro('av_ventas') })

describe('<ListaTareas> · renglones con filtro', () => {
  it('«CFDI por emitir» deja el filtro «por_emitir» para Facturación y navega', () => {
    const onGo = vi.fn()
    render(<ListaTareas tareas={[t({ id: 'cfdi', title: 'CFDI por emitir', filtro: 'por_emitir' })]} onGo={onGo} />)
    fireEvent.click(screen.getByText('CFDI por emitir'))
    expect(onGo).toHaveBeenCalledWith('av_fin')
    expect(tomarFiltro('av_fin')).toBe('por_emitir')
  })
  it('un renglón sin filtro navega como siempre y no deja nada', () => {
    const onGo = vi.fn()
    render(<ListaTareas tareas={[t({ id: 'atorados', title: 'Envíos atorados', screen: 'seguimiento' })]} onGo={onGo} />)
    fireEvent.click(screen.getByText('Envíos atorados'))
    expect(onGo).toHaveBeenCalledWith('seguimiento')
    expect(tomarFiltro('seguimiento')).toBeNull()
  })
})
