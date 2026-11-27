// @vitest-environment jsdom
// LISTA + DETALLE compartido (27 nov 2026): renglones cortos y el elegido abierto al lado (computadora) o debajo de su
// renglón (celular). El primero —el siguiente por hacer— ya viene abierto.
import React from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'

const h = vi.hoisted(() => ({ ancho: true }))
vi.mock('./useAnchoMinimo', () => ({ useAnchoMinimo: () => h.ancho }))
import { ListaDetalle } from './ListaDetalle'

const PEDIDOS = [{ id: 'a', nombre: 'Dra. Ana' }, { id: 'b', nombre: 'Dr. Beto' }, { id: 'c', nombre: 'Dra. Caro' }]
const pintar = (items = PEDIDOS, casilla = false) => render(
  <ListaDetalle testid="p" items={items} clave={(x) => x.id}
    renglon={(x) => ({ titulo: x.nombre, sub: 'folio ' + x.id, nota: x.id === 'a' ? 'Debió salir ayer' : undefined, aviso: x.id === 'a', pill: { texto: 'Por preparar', clase: 'p-warn' }, antes: casilla ? <input type="checkbox" aria-label={'elegir ' + x.id} /> : undefined })}
    detalle={(x) => <div data-testid="contenido">Detalle de {x.nombre}<button type="button">Hacer {x.id}</button></div>} />,
)
beforeEach(() => { cleanup(); h.ancho = true })

describe('<ListaDetalle> · computadora', () => {
  it('un renglón por pedido y el primero ya abierto al lado', () => {
    pintar()
    expect(screen.getByTestId('p-lista').querySelectorAll('.md-renglon')).toHaveLength(3)
    expect(screen.getAllByTestId('contenido')).toHaveLength(1)
    expect(screen.getByTestId('p-detalle').tagName).toBe('ASIDE')
    expect(screen.getByTestId('p-detalle')).toHaveTextContent('Detalle de Dra. Ana')
    expect(screen.getByTestId('p-abrir-a').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('p-abrir-a')).toHaveTextContent('Debió salir ayer')
  })
  it('tocar otro renglón abre ese pedido; siempre queda uno abierto', () => {
    pintar()
    fireEvent.click(screen.getByTestId('p-abrir-c'))
    expect(screen.getByTestId('p-detalle')).toHaveTextContent('Detalle de Dra. Caro')
    fireEvent.click(screen.getByTestId('p-abrir-c'))                 // tocarlo otra vez no lo cierra
    expect(screen.getByTestId('p-detalle')).toHaveTextContent('Detalle de Dra. Caro')
  })
  it('si el pedido abierto sale de la lista, se abre el primero que queda', () => {
    const v = pintar()
    fireEvent.click(screen.getByTestId('p-abrir-b'))
    v.rerender(<ListaDetalle testid="p" items={[PEDIDOS[0], PEDIDOS[2]]} clave={(x) => x.id} renglon={(x) => ({ titulo: x.nombre })} detalle={(x) => <div data-testid="contenido">Detalle de {x.nombre}</div>} />)
    expect(screen.getByTestId('p-detalle')).toHaveTextContent('Detalle de Dra. Ana')
  })
  it('la casilla del renglón no abre el pedido ni queda dentro del botón', () => {
    pintar(PEDIDOS, true)
    const casilla = screen.getByLabelText('elegir b')
    expect(casilla.closest('button')).toBeNull()
    fireEvent.click(casilla)
    expect(screen.getByTestId('p-detalle')).toHaveTextContent('Detalle de Dra. Ana')   // sigue abierto el primero
    fireEvent.click(screen.getByTestId('p-abrir-b'))
    expect(screen.getByTestId('p-detalle')).toHaveTextContent('Detalle de Dr. Beto')
  })
})

describe('<ListaDetalle> · celular', () => {
  it('el detalle se abre debajo de su renglón, uno a la vez, con el primero ya abierto', () => {
    h.ancho = false
    pintar()
    expect(screen.getByTestId('p-detalle').tagName).toBe('DIV')
    expect(screen.getByTestId('p-detalle')).toHaveTextContent('Detalle de Dra. Ana')
    expect(screen.getByTestId('p-abrir-a').nextElementSibling).toBe(screen.getByTestId('p-detalle'))
    fireEvent.click(screen.getByTestId('p-abrir-b'))
    expect(screen.getAllByTestId('contenido')).toHaveLength(1)
    expect(screen.getByTestId('p-abrir-b').nextElementSibling).toHaveTextContent('Detalle de Dr. Beto')
  })
  it('tocar el renglón abierto lo cierra y deja solo la lista', () => {
    h.ancho = false
    pintar()
    fireEvent.click(screen.getByTestId('p-abrir-a'))
    expect(screen.queryByTestId('p-detalle')).toBeNull()
    expect(screen.getByTestId('p-lista').querySelectorAll('.md-renglon')).toHaveLength(3)
  })
})
