// @vitest-environment jsdom
// HERRAMIENTAS DEL VENDEDOR · bloque C: dejar un seguimiento desde el chat (en qué quedó, nota, cuándo retomar) y verlo
// en "Pendientes" (vencidos / hoy / próximos) para abrir el chat, posponer o marcar hecho.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { Seguimientos } from './Seguimientos'
import { PanelCliente } from './chat/PanelCliente'
import { cerrarHoja } from '../data/store/hojaChat'
import { cuandoRetomar, enDias, type ClienteSeguimientos, type Seguimiento } from '../data/ops/seguimientos'
import type { ClienteExpediente, FichaConversacion } from '../data/ops/expediente'

vi.mock('../auth/RoleContext', () => ({ useRoleOpcional: () => ({ role: 'pos', setScreen: vi.fn(), user: null }) }))
afterEach(() => { cleanup(); cerrarHoja('C1') })

const S = (o: Partial<Seguimiento>): Seguimiento => ({ id: 'S1', customer_id: 'CU1', conversation_id: null, estado: 'esperando_pago', nota: 'Transfiere el viernes', recordar_el: '2026-10-30', hecho: false, creado: '', vendedor: 'Roberto', es_mio: true, nombre: 'ANA PEREZ', conversacion: 'C1', ...o })

describe('cuándo retomar', () => {
  it('vencido, hoy, mañana o la fecha', () => {
    expect(cuandoRetomar('2026-10-28', '2026-10-30')).toEqual({ texto: 'vencido hace 2 días', tono: 'dang' })
    expect(cuandoRetomar('2026-10-30', '2026-10-30').texto).toBe('retomar hoy')
    expect(cuandoRetomar('2026-10-31', '2026-10-30').texto).toBe('retomar mañana')
    expect(cuandoRetomar('2026-11-04', '2026-10-30').texto).toBe('retomar el 4 nov')
  })
})

describe('Pendientes', () => {
  it('agrupa vencidos, hoy y próximos; marca hecho y pospone', async () => {
    const c = {
      mios: vi.fn(async () => ({ ok: true as const, data: { hoy: '2026-10-30', seguimientos: [S({ id: 'A', recordar_el: '2026-10-29' }), S({ id: 'B', recordar_el: '2026-10-30', nombre: 'Beto Ruiz' }), S({ id: 'C', recordar_el: '2026-11-05', es_mio: false, vendedor: 'Alejandra' })] } })),
      hecho: vi.fn(async () => ({ ok: true as const, data: S({}) })), posponer: vi.fn(async () => ({ ok: true as const, data: S({}) })),
    }
    render(<Seguimientos cliente={c as unknown as ClienteSeguimientos} />)
    expect(await screen.findByTestId('seguimientos-vencidos')).toHaveTextContent('Ana Perez')
    expect(screen.getByTestId('seguimientos-hoy')).toHaveTextContent('Beto Ruiz')
    expect(screen.getByTestId('seguimientos-proximos')).toHaveTextContent('Alejandra')   // el de otro vendedor (vista de jefe) dice de quién es
    const hoy = screen.getByTestId('seguimientos-hoy')
    fireEvent.click(hoy.querySelector('[data-testid=seguimiento-hecho]')!)
    await waitFor(() => expect(c.hecho).toHaveBeenCalledWith('B'))
    fireEvent.click(screen.getByTestId('seguimientos-vencidos').querySelector('[data-testid=seguimiento-posponer]')!)
    await waitFor(() => expect(c.posponer).toHaveBeenCalledWith('A', enDias(1)))
    expect(screen.getByTestId('seguimientos-proximos').querySelector('[data-testid=seguimiento-hecho]')).toBeNull()   // el de otro no se toca
  })
})

describe('seguimiento desde el chat', () => {
  it('«+» › Dejar seguimiento: en qué quedó, nota y cuándo; luego se ve en la franja', async () => {
    const ficha: FichaConversacion = { vinculado: true, con_cuenta: false, customer_id: 'CU1', por: 'personal', nombre: 'Ana Perez', tiene_cuenta: false, es_tuyo: true, pedidos: 0 }
    const exp = { ficha: vi.fn(async () => ({ ok: true as const, data: ficha })), sugerencias: vi.fn(async () => ({ ok: true as const, data: [] })) } as unknown as ClienteExpediente
    let vigente: Seguimiento | null = null
    const seg = {
      de: vi.fn(async () => ({ ok: true as const, data: vigente })),
      guardar: vi.fn(async (d: { estado: string; nota: string; recordar: string }) => { vigente = S({ estado: d.estado as Seguimiento['estado'], nota: d.nota, recordar_el: d.recordar }); return { ok: true as const, data: vigente } }),
      hecho: vi.fn(),
    }
    render(<PanelCliente conversationId="C1" cliente={exp} seg={seg as unknown as ClienteSeguimientos} />)
    fireEvent.click(await screen.findByTestId('accion-seguimiento'))
    fireEvent.click(screen.getByTestId('seg-estado-cotizacion_enviada'))
    fireEvent.change(screen.getByLabelText('Nota del seguimiento'), { target: { value: 'Le interesa el Dysport de 500' } })
    fireEvent.click(screen.getByTestId('seg-plazo-7'))
    fireEvent.click(screen.getByTestId('seg-guardar'))
    await waitFor(() => expect(seg.guardar).toHaveBeenCalledWith({ customer: 'CU1', conv: 'C1', estado: 'cotizacion_enviada', nota: 'Le interesa el Dysport de 500', recordar: enDias(7) }))
    expect(await screen.findByTestId('pc-seguimiento-tira')).toHaveTextContent('Le mandé cotización')
    expect(screen.getByTestId('pc-msg')).toHaveTextContent(/Te aviso ese día/)
  })
})
