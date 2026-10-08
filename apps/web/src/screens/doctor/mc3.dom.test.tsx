// @vitest-environment jsdom
// MC-3 · Barra contextual del carrito en móvil: solo en Catálogo, ≤900px, con unidades, sin checkout/modal/chat
// abiertos; «Revisar pedido» abre el MISMO CheckoutCanonico; cantidad y total estimado del mismo estado del panel;
// sube la burbuja (clase en <body>) y la baja al ocultarse o al salir de la pantalla; reacciona al girar.
// Modo demo (sin backend): ninguna llamada al servidor, ningún pedido.
import React from 'react'
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
import { Catalogo } from './Catalogo'
import { BarraCarrito, CLASE_BODY_BARRA } from './BarraCarrito'
import catalogoSrc from './Catalogo.tsx?raw'

type Oyente = () => void
let movil = true
const oyentes = new Set<Oyente>()
const original = window.matchMedia
function stubMedia() {
  window.matchMedia = ((query: string) => ({
    get matches() { return movil && query.includes('max-width: 900px') }, media: query, onchange: null,
    addEventListener: (_: string, f: Oyente) => oyentes.add(f), removeEventListener: (_: string, f: Oyente) => oyentes.delete(f),
    addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}
const girar = (m: boolean) => act(() => { movil = m; oyentes.forEach((f) => f()) })

beforeEach(() => { movil = true; oyentes.clear(); stubMedia() })
afterEach(() => { cleanup(); window.matchMedia = original; document.body.className = '' })

const agregar = (n = 1) => { for (let i = 0; i < n; i++) fireEvent.click(screen.getAllByText('Agregar')[0]) }

describe('MC-3 · visibilidad', () => {
  it('carrito vacío: sin barra (ni clase en <body>)', () => {
    render(<Catalogo />)
    expect(screen.queryByTestId('barra-carrito')).toBeNull()
    expect(document.body.classList.contains(CLASE_BODY_BARRA)).toBe(false)
  })
  it('con productos en móvil: unidades, total estimado y «Revisar pedido» con nombre accesible y 44px (clase .rc-cart-bar-btn)', () => {
    render(<Catalogo />)
    agregar(2)
    const barra = screen.getByTestId('barra-carrito')
    expect(within(barra).getByTestId('barra-carrito-resumen')).toHaveTextContent(/2 productos/)
    expect(within(barra).getByTestId('barra-carrito-resumen')).toHaveTextContent(/Total estimado \$/)
    const b = within(barra).getByTestId('barra-carrito-revisar')
    expect(b.tagName).toBe('BUTTON'); expect(b.className).toContain('rc-cart-bar-btn')
    expect(b.getAttribute('aria-label')).toMatch(/^Revisar pedido: 2 productos · total estimado \$/)
    expect(document.body.classList.contains(CLASE_BODY_BARRA)).toBe(true)
  })
  it('el total de la barra es el MISMO estimado del panel del carrito', () => {
    render(<Catalogo />)
    agregar(3)
    const totalBarra = screen.getByTestId('barra-carrito').querySelector('.rc-cart-bar-total b')!.textContent
    const panel = document.querySelector('.card.ticket')!   // el panel del carrito (CartPanel)
    expect(panel.textContent).toContain(totalBarra!)
  })
  it('escritorio: sin barra aunque haya productos', () => {
    movil = false
    render(<Catalogo />)
    agregar()
    expect(screen.queryByTestId('barra-carrito')).toBeNull()
  })
  it('girar el dispositivo / cambiar de tamaño: aparece y desaparece con el viewport (y la clase de <body> la sigue)', async () => {
    render(<Catalogo />)
    agregar()
    expect(screen.getByTestId('barra-carrito')).toBeInTheDocument()
    await girar(false)
    expect(screen.queryByTestId('barra-carrito')).toBeNull(); expect(document.body.classList.contains(CLASE_BODY_BARRA)).toBe(false)
    await girar(true)
    expect(screen.getByTestId('barra-carrito')).toBeInTheDocument(); expect(document.body.classList.contains(CLASE_BODY_BARRA)).toBe(true)
  })
  it('vaciar el carrito la oculta', () => {
    render(<Catalogo />)
    agregar()
    fireEvent.click(screen.getByText('Vaciar'))
    expect(screen.queryByTestId('barra-carrito')).toBeNull()
  })
})

describe('MC-3 · convivencia con checkout, modales y chat', () => {
  it('«Revisar pedido» abre el CheckoutCanonico existente; con el checkout abierto no hay barra; al cerrar vuelve sin tocar el carrito', () => {
    render(<Catalogo />)
    agregar(2)
    fireEvent.click(screen.getByTestId('barra-carrito-revisar'))
    expect(screen.getByTestId('checkout-canonico')).toBeInTheDocument()
    expect(screen.queryByTestId('barra-carrito')).toBeNull(); expect(document.body.classList.contains(CLASE_BODY_BARRA)).toBe(false)
    fireEvent.click(screen.getByText('Cancelar'))
    expect(screen.getByTestId('barra-carrito-resumen')).toHaveTextContent(/2 productos/)   // mismas cantidades
  })
  it('chat abierto (body.chat-open, lo marca ChatFlotante): sin barra; al cerrarlo, vuelve', async () => {
    render(<Catalogo />)
    agregar()
    await act(async () => { document.body.classList.add('chat-open') })
    expect(screen.queryByTestId('barra-carrito')).toBeNull()
    await act(async () => { document.body.classList.remove('chat-open') })
    expect(screen.getByTestId('barra-carrito')).toBeInTheDocument()
  })
  it('salir de Catálogo (desmontar) retira la clase: la burbuja vuelve a su lugar en otras pantallas', () => {
    const v = render(<Catalogo />)
    agregar()
    expect(document.body.classList.contains(CLASE_BODY_BARRA)).toBe(true)
    v.unmount()
    expect(document.body.classList.contains(CLASE_BODY_BARRA)).toBe(false)
  })
  it('carrito convertido o inaccesible (bloqueada): sin barra', () => {
    render(<BarraCarrito unidades={3} totalEstimado={1050} bloqueada onRevisar={() => {}} />)
    expect(screen.queryByTestId('barra-carrito')).toBeNull()
  })
  it('Catálogo bloquea la barra con checkout, modal o un carrito del servidor que no es el ACTIVO', () => {
    expect(catalogoSrc).toMatch(/bloqueada=\{checkout \|\| !!openFamily \|\| \(hasSupabase && \(!canon\.cart \|\| canon\.cart\.estado !== 'active'\)\)\}/)
    expect(catalogoSrc).toMatch(/onRevisar=\{\(\) => setCheckout\(true\)\}/)   // el MISMO checkout del panel
    expect(catalogoSrc).toMatch(/<CartPanel lines=\{lines\} total=\{total\}/); expect(catalogoSrc).toMatch(/totalEstimado=\{lines\.length \? total : null\}/)   // el MISMO estimado (con volumen) del panel
  })
  it('la barra no roba el foco ni hace nada por sí sola (sin llamadas, sin cambios de cantidad)', () => {
    let llamadas = 0
    const antes = document.activeElement
    render(<BarraCarrito unidades={1} totalEstimado={350} bloqueada={false} onRevisar={() => { llamadas++ }} />)
    expect(document.activeElement).toBe(antes); expect(llamadas).toBe(0)
  })
})
