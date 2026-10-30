// @vitest-environment jsdom
// PUSH DEL EQUIPO: tocar el aviso abre ese chat del equipo; Ajustes registra de verdad el dispositivo (antes solo pedía
// permiso y no llegaba nada) y dice qué avisa; Inicio recuerda activarlas hasta que estén activas.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { leerAbrir, aplicarAbrir } from './abrirAviso'
import { intentoActual, consumirIntento } from '../store/navIntentStore'
import { Ajustes } from '../../screens/Ajustes'
import { RecordatorioAvisos } from '../../app/RecordatorioAvisos'
import swSrc from '../../../public/sw.js?raw'

vi.mock('../../auth/RoleContext', () => ({ useRoleOpcional: () => ({ role: 'pos' }) }))
afterEach(() => { cleanup(); try { localStorage.clear() } catch { /* */ } })
const C = '3f1c2b9e-1111-4222-8333-944455556666'

describe('abrir desde el aviso', () => {
  it('lee el destino del enlace y deja la intención para el chat', () => {
    expect(leerAbrir(`/sistema?abrir=chat&conv=${C}`)).toEqual({ screen: 'chat', conv: C })
    expect(leerAbrir('/sistema?abrir=avisos')).toEqual({ screen: 'comun', conv: null })
    expect(leerAbrir('/sistema?abrir=chat&conv=<script>')).toEqual({ screen: 'chat', conv: null })
    expect(leerAbrir('/sistema')).toBeNull()
    const ir = vi.fn()
    aplicarAbrir({ screen: 'chat', conv: C }, ir)
    expect(ir).toHaveBeenCalledWith('chat')
    const i = intentoActual(); expect(i?.destino).toBe('chat'); expect(i?.conversationId).toBe(C); consumirIntento(i!.id)
  })
  it('con el sistema ya abierto, el service worker le pide navegar', () => {
    expect(swSrc).toMatch(/postMessage\(\{ tipo: 'rc-abrir', url: destino \}\)/)
  })
})

describe('Ajustes', () => {
  it('activa los avisos de verdad (registra el dispositivo) y dice qué avisa', async () => {
    const activar = vi.fn(async () => ({ ok: true as const }))
    render(<Ajustes onClose={() => {}} estado={async () => 'inactivo'} activar={activar} />)
    expect(screen.getByTestId('ajustes-que-avisa')).toHaveTextContent('Chat del equipo')
    expect(screen.getByTestId('ajustes-que-avisa')).not.toHaveTextContent(/stock bajo|tareas asignadas/)
    fireEvent.click(await screen.findByTestId('ajustes-activar-avisos'))
    await waitFor(() => expect(activar).toHaveBeenCalled())
    expect(await screen.findByTestId('ajustes-avisos-activos')).toBeTruthy()
  })
})

describe('recordatorio en Inicio', () => {
  it('se ve hasta activarlas; "Ahora no" lo esconde', async () => {
    const activar = vi.fn(async () => ({ ok: true as const }))
    const { unmount } = render(<RecordatorioAvisos estado={async () => 'inactivo'} activar={activar} />)
    fireEvent.click(await screen.findByTestId('recordatorio-activar'))
    await waitFor(() => expect(screen.queryByTestId('recordatorio-avisos')).toBeNull())
    unmount()
    render(<RecordatorioAvisos estado={async () => 'inactivo'} activar={activar} />)
    fireEvent.click(await screen.findByTestId('recordatorio-ahora-no'))
    expect(screen.queryByTestId('recordatorio-avisos')).toBeNull()
    cleanup()
    render(<RecordatorioAvisos estado={async () => 'inactivo'} activar={activar} />)
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByTestId('recordatorio-avisos')).toBeNull()
  })
  it('ya activas: no estorba', async () => {
    render(<RecordatorioAvisos estado={async () => 'activo'} />)
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByTestId('recordatorio-avisos')).toBeNull()
  })
})
