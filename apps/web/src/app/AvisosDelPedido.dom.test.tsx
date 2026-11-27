// @vitest-environment jsdom
// AVISOS AL CLIENTE, a la vista (27 nov 2026, dueño: «sí les llegan los mensajes por WhatsApp; lo que se me hace raro es
// que en el sistema no hay manera de ver que se envió eso»).
import React from 'react'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { AvisosDelPedido } from './AvisosDelPedido'
import { estadoAviso, leerAvisosDelPedido, nombreAviso, resumenAvisos, type AvisoPedido } from '../data/ops/avisosPedido'

beforeEach(cleanup)
const a = (x: Partial<AvisoPedido>): AvisoPedido => ({ canal: 'whatsapp', aviso: 'pedido_recibido', estado: 'enviado', cuando: '2026-11-26T01:46:00Z', destino: '•••• 2547', respondio: false, detalle: null, ...x })
const LISTA = [
  a({}), a({ canal: 'correo', destino: 'b•••@hotmail.com' }),
  a({ aviso: 'pago_recibido', respondio: true, cuando: '2026-11-26T17:10:00Z' }),
  a({ canal: 'correo', aviso: 'pago_recibido', estado: 'sin_destinatario', destino: null }),
  a({ aviso: 'pedido_enviado', estado: 'pendiente' }),
]

describe('las palabras de cada aviso', () => {
  it('el aviso se nombra como lo entiende cualquiera, nunca con guiones bajos', () => {
    expect(nombreAviso('pedido_recibido')).toBe('Pedido recibido'); expect(nombreAviso('pago_recibido')).toBe('Pago confirmado')
    expect(nombreAviso('pedido_enviado')).toBe('Va en camino'); expect(nombreAviso('pedido_entregado')).toBe('Entregado')
    expect(nombreAviso('algo_nuevo_raro')).toBe('Algo nuevo raro'); expect(nombreAviso('')).toBe('Aviso')
  })
  it('dice qué pasó: salió, está en cola, o no salió y por qué', () => {
    expect(estadoAviso(a({}))).toEqual({ tono: 'ok', texto: 'Enviado' })
    expect(estadoAviso(a({ estado: 'pendiente' })).tono).toBe('espera')
    expect(estadoAviso(a({ canal: 'correo', estado: 'sin_destinatario' }))).toEqual({ tono: 'no', texto: 'No se envió: el cliente no tiene correo' })
    expect(estadoAviso(a({ estado: 'omitido', detalle: 'plantilla sin aprobar' })).texto).toBe('No se envió: plantilla sin aprobar')
    expect(estadoAviso(a({ estado: 'fallido' }))).toEqual({ tono: 'no', texto: 'No se pudo enviar' })
    expect(estadoAviso(a({ estado: 'incierto' })).tono).toBe('no')
  })
  it('el resumen cuenta lo enviado por canal y lo que no salió', () => {
    expect(resumenAvisos(LISTA)).toBe('3 enviados (2 por WhatsApp, 1 por correo) · 1 no salió · 1 en cola')
    expect(resumenAvisos([a({})])).toBe('1 enviado (1 por WhatsApp)'); expect(resumenAvisos([])).toBe('')
  })
})

describe('leer los avisos', () => {
  it('pide los de ESE pedido y descarta lo que no reconoce', async () => {
    const rpc = vi.fn(async () => ({ data: [{ canal: 'whatsapp', aviso: 'pedido_recibido', estado: 'enviado', cuando: '2026-11-26T01:46:00Z', destino: '•••• 2547', respondio: true, detalle: null }, { canal: 'sms', cuando: 'x' }, null], error: null }))
    const r = await leerAvisosDelPedido('o-1', rpc)
    expect(rpc).toHaveBeenCalledWith('avisos_del_pedido', { p_order: 'o-1' })
    expect(r).toEqual([{ canal: 'whatsapp', aviso: 'pedido_recibido', estado: 'enviado', cuando: '2026-11-26T01:46:00Z', destino: '•••• 2547', respondio: true, detalle: null }])
  })
  it('si la base falla devuelve null (no inventa «sin avisos»)', async () => {
    expect(await leerAvisosDelPedido('o-1', async () => ({ data: null, error: { message: 'x' } }))).toBeNull()
    expect(await leerAvisosDelPedido('o-1', async () => { throw new Error('red') })).toBeNull()
  })
})

describe('<AvisosDelPedido>', () => {
  it('lista cada aviso con su canal, a dónde salió, cuándo, y si el cliente respondió', async () => {
    render(<AvisosDelPedido orderId="o-1" leer={async () => LISTA} />)
    const filas = await screen.findAllByTestId('avisos-pedido-fila')
    expect(filas).toHaveLength(5)
    expect(filas[0]).toHaveTextContent('Pedido recibido · WhatsApp a •••• 2547'); expect(filas[0]).toHaveTextContent('Enviado · 25 nov')
    expect(filas[1]).toHaveTextContent('Pedido recibido · Correo a b•••@hotmail.com')
    expect(filas[2]).toHaveTextContent('Pago confirmado · WhatsApp'); expect(filas[2]).toHaveTextContent('el cliente respondió')
    expect(filas[3]).toHaveTextContent('No se envió: el cliente no tiene correo'); expect(filas[3].className).toContain('--no')
    expect(filas[4]).toHaveTextContent('Va en camino'); expect(filas[4]).toHaveTextContent('En cola')
    expect(screen.getByTestId('avisos-pedido-resumen')).toHaveTextContent('3 enviados (2 por WhatsApp, 1 por correo) · 1 no salió · 1 en cola')
  })
  it('sin avisos lo dice; si no se pudieron leer también, sin confundir una cosa con la otra', async () => {
    render(<AvisosDelPedido orderId="o-1" leer={async () => []} />)
    expect(await screen.findByTestId('avisos-pedido-vacio')).toHaveTextContent('todavía no se le ha mandado ningún aviso')
    cleanup()
    render(<AvisosDelPedido orderId="o-1" leer={async () => null} />)
    expect(await screen.findByTestId('avisos-pedido-error')).toHaveTextContent('No se pudieron leer los avisos')
    expect(screen.queryByTestId('avisos-pedido-vacio')).toBeNull()
  })
  it('en modo demostración (sin servidor) no pinta nada', async () => {
    const { container } = render(<AvisosDelPedido orderId="o-1" />)
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })
})

describe('dónde se ve y quién lo puede ver', () => {
  const leer = (ruta: string) => readFileSync(resolve(__dirname, '..', ruta), 'utf8')
  it('está en la venta de Dirección y en Mis ventas del vendedor', () => {
    expect(leer('screens/admin/VentasDetalle.tsx')).toContain('<AvisosDelPedido orderId={order.id} />')
    expect(leer('screens/sales/MisVentas.tsx')).toContain('<AvisosDelPedido orderId={o.id} />')
  })
  it('la función de la base es de solo lectura y no amplía lo que ve Ventas', () => {
    const sql = readFileSync(resolve(__dirname, '../../../../supabase/migrations/20270408070000_avisos_del_pedido.sql'), 'utf8')
    const cuerpo = sql.slice(sql.indexOf('create function public.avisos_del_pedido'))
    expect(cuerpo).not.toMatch(/\b(insert|update|delete)\s/i)
    expect(cuerpo).toContain("v_rol = 'pos' and"); expect(cuerpo).toContain('public._cx0c_venta_pos_propia(o.id)'); expect(cuerpo).toContain('public.order_vendor_email(o.id)')
    expect(cuerpo).toContain("revoke all on function public.avisos_del_pedido(uuid) from public, anon")
    expect(cuerpo).not.toMatch(/'doctor'|'driver'/)                           // chofer y doctor no la usan
    expect(cuerpo).toContain("left(c.to_address, 1) || '•••'"); expect(cuerpo).toContain("'•••• ' || right(")   // el destino nunca va completo
  })
  it('el aviso de pago por WhatsApp también aparece: se liga por el correo espejo, no por el pedido en la clave', () => {
    // La 1.ª versión buscaba 'wa:<evento>:<pedido>'; el de pago lleva el identificador del PAGO y no salía en la venta.
    const sql = readFileSync(resolve(__dirname, '../../../../supabase/migrations/20270408080000_avisos_del_pedido_pago.sql'), 'utf8')
    const cuerpo = sql.slice(sql.indexOf('create or replace function public.avisos_del_pedido'))
    expect(cuerpo).toContain("a.event_key in (select 'wa:' || c2.event_key from public.comm_outbox c2 where c2.order_id = p_order)")
    expect(cuerpo).not.toContain("'wa:pedido_recibido:' ||")
    expect(cuerpo).not.toMatch(/\b(insert|update|delete)\s/i)
    expect(cuerpo).toContain("v_rol = 'pos' and"); expect(cuerpo).toContain('public._cx0c_venta_pos_propia(o.id)')   // misma visibilidad
  })
})
