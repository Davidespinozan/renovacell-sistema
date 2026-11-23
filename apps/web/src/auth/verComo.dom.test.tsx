// @vitest-environment jsdom
// VER COMO (23 nov 2026, Toño) · Dirección previsualiza otros roles; solo cambia lo que se ve; «salir» regresa a
// Dirección; otro rol no puede usarlo; volver restaura los permisos de Dirección.
import React from 'react'
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react'
import { RoleProvider, useRole } from './RoleContext'

afterEach(() => cleanup())
let api: ReturnType<typeof useRole> | null = null
function Sonda() { const r = useRole(); api = r; return <div data-testid="estado">{`${r.role}|${r.rolReal}|${r.vistaPrevia ?? '-'}|${r.capabilities.join(',')}|${r.mode}`}</div> }
const estado = () => screen.getByTestId('estado').textContent

describe('Ver como', () => {
  it('Dirección ve como Ventas y «salir» la regresa a Dirección con sus permisos', () => {
    render(<RoleProvider><Sonda /></RoleProvider>)
    act(() => api!.login('admin', true, { name: 'Toño', email: 't@x.mx' }, ['anuncios', 'dueno']))
    act(() => api!.verComo('pos'))
    expect(estado()).toBe('pos|admin|pos|conversaciones,nuevos_clientes|app')
    act(() => api!.verComo('driver'))
    expect(estado()).toBe('driver|admin|driver||app')
    act(() => api!.logout())   // en vista previa, salir = volver a Dirección (no cierra sesión)
    expect(estado()).toBe('admin|admin|-|anuncios,dueno|app')
  })
  it('Dirección SIN el permiso de dueño no cambia de rol', () => {
    render(<RoleProvider><Sonda /></RoleProvider>)
    act(() => api!.login('admin', true, { name: 'Claudia', email: 'c@x.mx' }, ['diseno']))
    act(() => api!.verComo('pos'))
    expect(estado()).toBe('admin|admin|-|diseno|app')
    expect(api!.multirol).toBe(false)
  })
  it('otro rol no puede previsualizar', () => {
    render(<RoleProvider><Sonda /></RoleProvider>)
    act(() => api!.login('pos', true, { name: 'Roberto', email: 'r@x.mx' }, []))
    act(() => api!.verComo('warehouse'))
    expect(estado()).toBe('pos|pos|-||app')
  })
})
