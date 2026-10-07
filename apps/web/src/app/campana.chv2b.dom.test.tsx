// @vitest-environment jsdom
// CHV2-B · La campana: conteo numérico de no leídos (historial, no cola de trabajo) y apertura profunda
// de un aviso comercial solo hacia un destino de la navegación del rol.
import React from 'react'
import { describe, it, expect, beforeEach } from 'vitest'
import { screen, fireEvent, act, cleanup } from '@testing-library/react'
import { renderWithRole } from '../test/utils'
import { TopBar } from './TopBar'
import { _simularLlegada, getSnapshot, markAllRead } from '../data/store/notificationsStore'
import { intentoActual, consumirIntento } from '../data/store/navIntentStore'

beforeEach(() => { cleanup(); markAllRead(getSnapshot().map((n) => n.id)); const i = intentoActual(); if (i) consumirIntento(i.id) })

describe('campana', () => {
  it('R · conteo numérico de no leídos y etiqueta accesible', () => {
    renderWithRole(<TopBar onMenu={() => {}} />)   // RoleProvider arranca como Dirección
    expect(screen.queryByTestId('campana-n')).toBeNull()
    act(() => { _simularLlegada({ id: 'r1', text: 'Aviso 1', at: '2026-10-06T22:00:00Z', read: false, roles: ['admin'] }); _simularLlegada({ id: 'r2', text: 'Aviso 2', at: '2026-10-06T22:01:00Z', read: false, roles: ['admin'] }) })
    expect(screen.getByTestId('campana-n')).toHaveTextContent('2')
    expect(screen.getByTestId('campana').getAttribute('aria-label')).toBe('Notificaciones, 2 sin leer')
    act(() => markAllRead(['r1', 'r2']))
    expect(screen.queryByTestId('campana-n')).toBeNull()
  })
  it('S · un aviso comercial abre la solicitud exacta (Dirección → Atención comercial)', () => {
    renderWithRole(<TopBar onMenu={() => {}} />)
    act(() => _simularLlegada({ id: 's1', text: 'Solicitud de asesor sin vendedor: Dra. López', at: '2026-10-06T22:00:00Z', read: false, roles: ['admin'], kind: 'handoff_sin_vendedor', conversationId: 'CS', screen: 'av_atencion' }))
    fireEvent.click(screen.getByTestId('campana'))
    fireEvent.mouseDown(screen.getByText(/Solicitud de asesor sin vendedor/))
    expect(intentoActual()).toMatchObject({ destino: 'av_atencion', conversationId: 'CS', origen: 'campana' })
  })
})
