// @vitest-environment jsdom
// WHATSAPP A TODA LA CARTERA (15 nov 2026)
import React from 'react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { EscribirWhatsApp } from './EscribirWhatsApp'
import { paraEscribir, type PlantillaWA } from '../../data/ops/plantillasWA'
import sql from '../../../../../supabase/migrations/20270407220000_wa_escribir_y_avisos.sql?raw'

afterEach(cleanup)
const SEG: PlantillaWA = { nombre: 'seguimiento_vendedor', etiqueta: 'Seguimiento', categoria: 'MARKETING', cuerpo: 'Hola {{1}}, le saluda {{2}} de Renovacell.', variables: ['cliente', 'vendedor'], botones: ['Sí, por favor'], activa: true }
const AVISO: PlantillaWA = { nombre: 'aviso_pedido_recibido', etiqueta: 'Pedido recibido', categoria: 'UTILITY', cuerpo: 'Hola {{1}}, recibimos su pedido {{2}} por {{3}}.', variables: ['cliente', 'folio', 'total'], activa: true }
const api = (escribir = vi.fn(async () => ({ ok: true as const, conversacion: 'conv-1', ventanaAbierta: false, texto: 'x' }))) => ({
  lista: vi.fn(async () => [SEG, AVISO, { ...SEG, nombre: 'apagada', activa: false }]), promos: vi.fn(async () => []), escribirCliente: escribir,
}) as never

describe('Escribirle por WhatsApp a un cliente de la cartera', () => {
  it('solo ofrece mensajes aprobados para escribir (no los del sistema), muestra cómo llega y abre su conversación', async () => {
    const onListo = vi.fn(); const a = api()
    render(<EscribirWhatsApp cliente={{ id: 'c1', nombre: 'ADRIAN LOERA' }} onCerrar={() => {}} onListo={onListo} api={a} />)
    expect(await screen.findByTestId('escribir-wa-seguimiento_vendedor')).toBeTruthy()
    expect(screen.queryByTestId('escribir-wa-aviso_pedido_recibido')).toBeNull()
    expect(screen.queryByTestId('escribir-wa-apagada')).toBeNull()
    expect(screen.getByTestId('escribir-wa-vista')).toHaveTextContent('Hola Adrian, le saluda')
    fireEvent.click(screen.getByTestId('escribir-wa-mandar'))
    await waitFor(() => expect(onListo).toHaveBeenCalledWith('conv-1', false))
    expect((a as unknown as { escribirCliente: ReturnType<typeof vi.fn> }).escribirCliente).toHaveBeenCalledWith('c1', 'seguimiento_vendedor', null)
  })
  it('dice por qué no se pudo (p. ej. sin celular)', async () => {
    render(<EscribirWhatsApp cliente={{ id: 'c1', nombre: 'X' }} onCerrar={() => {}} onListo={() => {}} api={api(vi.fn(async () => ({ ok: false as const, mensaje: 'Este cliente no tiene un celular de 10 dígitos en su ficha.' })) as never)} />)
    fireEvent.click(await screen.findByTestId('escribir-wa-mandar'))
    expect(await screen.findByTestId('escribir-wa-error')).toHaveTextContent('celular de 10 dígitos')
  })
  it('filtro: datos del sistema fuera', () => {
    expect(paraEscribir(SEG)).toBe(true); expect(paraEscribir(AVISO)).toBe(false)
  })
  it('la base: solo su cartera, liga la conversación al cliente y los avisos de pedido salen del buzón de correos', () => {
    expect(sql).toMatch(/if not public\._dif_es_mio\(p_customer, a\.todos, a\.uid\)/)
    expect(sql).toMatch(/update public\.cc_conversations set customer_id = p_customer/)
    expect(sql).toMatch(/create trigger wa_aviso_pedido after insert on public\.comm_outbox/)
    expect(sql).toMatch(/variables && array\[''mensaje'', ''folio'', ''total'', ''envio'', ''enlace''\]/)
  })
})
