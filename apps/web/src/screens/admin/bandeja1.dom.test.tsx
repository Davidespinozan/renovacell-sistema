// @vitest-environment jsdom
// BANDEJA-1 · cada solicitud dice su origen, el nombre real del contacto, su número y el último mensaje; cada pestaña explica
// qué contiene. Servidor FALSO.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, within } from '@testing-library/react'
import { AtencionComercial, nombreSolicitud } from './AtencionComercial'
import { ClienteAtencion, type PendienteRuteo } from '../../data/ops/atencion'
import { ClienteChat } from '../../data/ops/chat'
import { ClienteCanalOperacion } from '../../data/ops/canalOperacion'

afterEach(cleanup)
const base = (o: Partial<PendienteRuteo>): PendienteRuteo => ({ conversation_id: 'c1', dueno: 'visitante', profile_id: null, nombre: 'Visitante', modo: 'human_requested', seller_id: null, seller_nombre: null,
  ruteo_motivo: 'visitante', origen: 'manual', fuera_horario: false, solicitado_at: null, edad_min: 4, iniciada: false, cart_id: null, n_items: 0, atencion: null, ...o })
const SOL = [
  base({ conversation_id: 'wa', contacto: { fuente: 'whatsapp', nombre: 'dra. ana lópez', detalle: '+5216670007001', ultimo_texto: 'Me interesan 10 piezas de TNM', ultimo_at: null } }),
  base({ conversation_id: 'pt', dueno: 'doctor', profile_id: 'p1', nombre: 'Juan Pérez', contacto: { fuente: 'portal', nombre: null, detalle: null, ultimo_texto: '¿Tienen Nabota de 200?', ultimo_at: null } }),
  base({ conversation_id: 'ig', contacto: { fuente: 'instagram', nombre: null, detalle: null, ultimo_texto: 'hola', ultimo_at: null } }),
]
function rpc() {
  return async (fn: string) => {
    if (fn === 'cc_ruteo_pendientes') return { data: { resumen: { horario: { configurado: true, abierto: true, zona: 'America/Mazatlan', motivo: '' }, sin_vendedor: 2, reasignacion: 0, handoffs_sin_asignar: 0, handoffs_pendientes: 0, vendedores_elegibles: 3 }, conversaciones: SOL, carritos_pendientes: [] }, error: null }
    if (fn === 'cc_vendedores') return { data: [], error: null }
    return { data: null, error: null }
  }
}

describe('nombre visible', () => {
  it('doctor: su cuenta; sin cuenta: el nombre del perfil o "Contacto de <origen> · sin nombre"', () => {
    expect(nombreSolicitud(SOL[1])).toBe('Juan Pérez')
    expect(nombreSolicitud(SOL[0])).toMatch(/Ana López · sin cuenta$/i)
    expect(nombreSolicitud(SOL[2])).toBe('Contacto de Instagram · sin nombre')
    expect(nombreSolicitud(base({}))).toBe('Visitante (visitante)')   // servidor viejo sin 'contacto': como antes
  })
})

describe('<AtencionComercial> · Solicitudes', () => {
  it('cada tarjeta muestra origen, nombre, número y último mensaje; la pestaña explica qué contiene', async () => {
    const r = rpc()
    render(<AtencionComercial pestanas={['pendientes', 'whatsapp']} cliente={new ClienteAtencion(r as never, vi.fn())} chat={new ClienteChat(async () => ({ data: { ok: true }, error: null }), () => null)} canalOp={new ClienteCanalOperacion(r as never, vi.fn())} />)
    const fuentes = await screen.findAllByTestId('fuente-solicitud')
    expect(fuentes.map((f) => f.textContent)).toEqual(['WhatsApp', 'Portal', 'Instagram'])
    expect(screen.getAllByTestId('detalle-solicitud')[0].textContent).toBe('+5216670007001')
    expect(screen.getAllByTestId('ultimo-solicitud')[0].textContent).toBe('«Me interesan 10 piezas de TNM»')
    expect(screen.getByTestId('ayuda-pestana').textContent).toMatch(/de cualquier origen: WhatsApp, Instagram, Messenger, enlace de contacto o portal/)
    expect(screen.queryByText(/\(visitante\)/)).toBeNull()
  })
})
