// @vitest-environment jsdom
// PUSH DEL EQUIPO: tocar el aviso abre ese chat del equipo; Ajustes registra de verdad el dispositivo (antes solo pedía
// permiso y no llegaba nada) y dice qué avisa; Inicio recuerda activarlas hasta que estén activas.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
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

describe('pantalla "Activa las notificaciones" (siempre)', async () => {
  const { PuertaAvisos } = await import('../../app/PuertaAvisos')
  const { pedirAvisos, cerrarPuertaAvisos } = await import('../store/puertaAvisos')
  afterEach(() => { cerrarPuertaAvisos(); try { sessionStorage.clear() } catch { /* */ } })

  it('al entrar se abre sola; activar la cierra; "Ahora no" no la vuelve a abrir en la sesión', async () => {
    const activar = vi.fn(async () => ({ ok: true as const }))
    render(<PuertaAvisos doctor={false} estado={async () => 'inactivo'} activar={activar} sincronizar={async () => false} />)
    fireEvent.click(await screen.findByTestId('puerta-activar'))
    await waitFor(() => expect(screen.queryByTestId('puerta-avisos')).toBeNull())
    expect(activar).toHaveBeenCalled()
    cleanup(); sessionStorage.clear()
    render(<PuertaAvisos doctor={false} estado={async () => 'inactivo'} activar={activar} sincronizar={async () => false} />)
    fireEvent.click(await screen.findByTestId('puerta-ahora-no'))
    expect(screen.queryByTestId('puerta-avisos')).toBeNull()
    pedirAvisos('entrada')
    expect(screen.queryByTestId('puerta-avisos')).toBeNull()   // ya se pidió en esta sesión
  })
  it('con el permiso ya dado, registra el dispositivo en silencio y no abre nada', async () => {
    const sincronizar = vi.fn(async () => true)
    render(<PuertaAvisos doctor={false} estado={async () => 'activo'} sincronizar={sincronizar} />)
    await waitFor(() => expect(sincronizar).toHaveBeenCalled())
    expect(screen.queryByTestId('puerta-avisos')).toBeNull()
  })
  it('doctor: tras escribirle a su asesor vuelve a pedirlo con su motivo; al equipo no', async () => {
    sessionStorage.setItem('rc_puerta_avisos_entrada', '1')
    render(<PuertaAvisos doctor estado={async () => 'inactivo'} sincronizar={async () => false} />)
    await new Promise((r) => setTimeout(r, 0))
    act(() => pedirAvisos('chat'))
    expect(await screen.findByText('¿Te avisamos cuando te respondan?')).toBeTruthy()
    cleanup(); cerrarPuertaAvisos(); sessionStorage.clear(); sessionStorage.setItem('rc_puerta_avisos_entrada', '1')
    render(<PuertaAvisos doctor={false} estado={async () => 'inactivo'} sincronizar={async () => false} />)
    await new Promise((r) => setTimeout(r, 0))
    act(() => pedirAvisos('pedido'))
    expect(screen.queryByTestId('puerta-avisos')).toBeNull()
  })
  it('iPhone sin instalar: explica cómo agregarlo a inicio', async () => {
    render(<PuertaAvisos doctor estado={async () => 'requiere_instalar'} sincronizar={async () => false} />)
    expect(await screen.findByTestId('puerta-instalar')).toHaveTextContent('Agregar a inicio')
  })
})
