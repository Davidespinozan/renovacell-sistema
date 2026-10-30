// @vitest-environment jsdom
// HERRAMIENTAS DEL VENDEDOR · bloque A: buscar una palabra en TODAS las conversaciones (con quién, cuándo y la frase
// resaltada) y dentro de un chat (lupa que salta entre coincidencias); por producto, quién lo compró; más y menos vendidos.
import React from 'react'
import { describe, it, expect, afterEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { BuscadorConversaciones } from './BuscarMensajes'
import { ChatCanonico } from './ChatCanonico'
import { ProductosClientes } from '../sales/ProductosClientes'
import { fragmento, partesResaltadas } from '../../data/ops/busqueda'
import { movimientoProductos } from '../../data/metrics'
import { ClienteChat, type Conversacion } from '../../data/ops/chat'

afterEach(cleanup)

describe('buscar en conversaciones', () => {
  it('fragmento y resaltado ignoran acentos y mayúsculas', () => {
    expect(fragmento('Y la Factúra a nombre de la clínica', 'factura')).toEqual({ antes: 'Y la ', hallado: 'Factúra', despues: ' a nombre de la clínica' })
    expect(partesResaltadas('dysport y DYSPORT', 'Dysport').filter((p) => p.hallado).map((p) => p.t)).toEqual(['dysport', 'DYSPORT'])
  })
  it('escribes una palabra y ves con quién la hablaste, cuándo y la frase; con un toque abres el chat', async () => {
    const buscar = vi.fn(async () => [
      { conversation_id: 'C1', nombre: 'DRA. ANA PEREZ', abierta: true, tuya: true, puede_abrir: true, fecha: '2026-10-20T10:00:00Z', quien: 'doctor', texto: 'Quiero 3 cajas de DYSPORT para el viernes', coincidencias: 2 },
      { conversation_id: 'C2', nombre: 'Beto Ruiz', abierta: false, tuya: false, puede_abrir: false, fecha: '2026-09-01T10:00:00Z', quien: 'seller', texto: 'Te mando el dysport mañana', coincidencias: 1 },
    ])
    const onAbrir = vi.fn()
    render(<BuscadorConversaciones onAbrir={onAbrir} buscar={buscar} />)
    fireEvent.change(screen.getByTestId('buscar-conversaciones'), { target: { value: 'dysport' } })
    const res = await screen.findAllByTestId('busqueda-resultado', {}, { timeout: 2000 })
    expect(buscar).toHaveBeenCalledWith('dysport')
    expect(res[0]).toHaveTextContent('Dra. Ana Perez'); expect(res[0]).toHaveTextContent('2 veces')
    expect(res[0].querySelector('mark')!.textContent).toBe('DYSPORT')
    expect(res[1]).toHaveTextContent('Conversación cerrada'); expect(res[1]).toBeDisabled()   // la ves, pero ya no está a tu cargo
    fireEvent.click(res[0])
    expect(onAbrir).toHaveBeenCalledWith('C1')
  })
  it('con menos de 3 letras no busca', async () => {
    const buscar = vi.fn(async () => [])
    render(<BuscadorConversaciones onAbrir={() => {}} buscar={buscar} />)
    fireEvent.change(screen.getByTestId('buscar-conversaciones'), { target: { value: 'dy' } })
    await new Promise((r) => setTimeout(r, 400))
    expect(buscar).not.toHaveBeenCalled(); expect(screen.queryByTestId('busqueda-mensajes')).toBeNull()
  })
})

describe('lupa dentro del chat', () => {
  it('resalta cada coincidencia y salta entre ellas (empieza por la más reciente)', async () => {
    const ahora = new Date().toISOString()
    const conv: Conversacion = { conversation_id: 'C1', estado: 'abierta', modo: 'human_active', rol: 'asesor', ultimo_seq: 3, mensajes: [
      { id: 'm1', seq: 1, actor: 'doctor', content: 'Quiero Dysport', created_at: ahora, propio: false },
      { id: 'm2', seq: 2, actor: 'seller', content: 'Claro, te lo aparto', created_at: ahora, propio: true },
      { id: 'm3', seq: 3, actor: 'doctor', content: 'y otro dysport de 500', created_at: ahora, propio: false }] }
    const cliente = new ClienteChat(async (_f, { body }) => ({ data: body.action === 'leer' ? conv : { ok: true }, error: null }), () => null)
    render(<ChatCanonico embebido asesor conversationId="C1" cliente={cliente} suscribir={null} respuestas={null} />)
    await screen.findByText('Quiero Dysport')
    fireEvent.click(screen.getByTestId('btn-buscar-chat'))
    fireEvent.change(screen.getByTestId('chat-busqueda-q'), { target: { value: 'DYSPORT' } })
    await waitFor(() => expect(screen.getByTestId('chat-busqueda-n')).toHaveTextContent('1 de 2'))
    expect(document.querySelectorAll('mark.rc-mark-busq')).toHaveLength(2)
    expect(document.querySelector('.rc-msg--hallado')!.getAttribute('data-msg-id')).toBe('m3')
    fireEvent.click(screen.getByLabelText('Anterior (más antigua)'))
    expect(screen.getByTestId('chat-busqueda-n')).toHaveTextContent('2 de 2')
    expect(document.querySelector('.rc-msg--hallado')!.getAttribute('data-msg-id')).toBe('m1')
    fireEvent.click(screen.getByLabelText('Cerrar búsqueda'))
    expect(document.querySelectorAll('mark.rc-mark-busq')).toHaveLength(0)
  })
})

describe('productos y quién los compró', () => {
  it('lista productos con cuántos clientes suyos lo compraron; al elegir uno, quiénes, cuántas veces y cómo contactarlos', async () => {
    const productos = vi.fn(async () => [
      { product_id: 'P1', nombre: 'Dysport 500', sku: 'DYS', categoria: 'Toxina', activo: true, clientes: 2, ultima: '2026-10-20T10:00:00Z' },
      { product_id: 'P2', nombre: 'Sin ventas', sku: null, categoria: null, activo: true, clientes: 0, ultima: null }])
    const compradores = vi.fn(async () => [{ customer_id: 'CU1', nombre: 'DRA. ANA PEREZ', telefono: '6691112233', email: 'ana@x.mx', tiene_cuenta: true, veces: 3, unidades: 7, ultima: '2026-10-20T10:00:00Z', ultimo_folio: 'S100', vendedor: null }])
    render(<ProductosClientes productos={productos} compradores={compradores} />)
    const items = await screen.findAllByTestId('producto')
    expect(items).toHaveLength(1)   // por defecto, solo los que tienen compradores
    expect(items[0]).toHaveTextContent('2 clientes')
    fireEvent.click(items[0])
    const c = await screen.findByTestId('comprador')
    expect(compradores).toHaveBeenCalledWith('P1')
    expect(c).toHaveTextContent('Dra. Ana Perez'); expect(c).toHaveTextContent('Compró 3 veces · 7 piezas'); expect(c).toHaveTextContent('(S100)')
    expect(c.querySelector('a[href="tel:6691112233"]')).toBeTruthy()
  })
})

describe('más y menos vendidos del mes', () => {
  it('por piezas, solo ventas del periodo; los menos incluyen los que no se vendieron', () => {
    const productos = [{ id: 'A', name: 'A' }, { id: 'B', name: 'B' }, { id: 'C', name: 'C' }, { id: 'D', name: 'D', active: false }]
    const pedidos = [
      { status: 'delivered', created_at: '2026-10-10T18:00:00Z', items: [{ product_id: 'A', qty: 5, unit_price: 10 }, { product_id: 'B', qty: 1, unit_price: 10 }] },
      { status: 'cancelled', created_at: '2026-10-10T18:00:00Z', items: [{ product_id: 'C', qty: 50, unit_price: 10 }] },
      { status: 'delivered', created_at: '2026-09-10T18:00:00Z', items: [{ product_id: 'C', qty: 50, unit_price: 10 }] },
      { status: 'paid', created_at: '2026-10-11T18:00:00Z', items: [{ product_id: 'B', qty: 1, unit_price: null }] },
    ]
    const r = movimientoProductos(pedidos, productos, { desde: '2026-10-01', hasta: '2026-10-31' }, 1)
    expect(r.mas.map((p) => [p.id, p.units])).toEqual([['A', 5]])
    expect(r.menos.map((p) => [p.id, p.units])).toEqual([['C', 0]])   // C no se vendió en octubre (el cancelado y el de septiembre no cuentan); D está inactivo
  })
})
