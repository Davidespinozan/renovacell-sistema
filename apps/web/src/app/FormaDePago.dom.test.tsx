// @vitest-environment jsdom
// COBRO-U · la misma «Forma de pago» en todos los puntos de venta: reglas y pantalla.
import React, { useState } from 'react'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { FormaDePago } from './FormaDePago'
import { cobroParaServidor, faltaEnCobro, formaNoDisponible, resultadoCobro, mensajeCobro, sumarDiasISO, type CobroElegido } from '../data/ops/cobro'

describe('reglas de la forma de pago', () => {
  it('en mostrador el producto sale con pago o crédito: link y «al recibir» no', () => {
    expect(formaNoDisponible('link', 'mostrador')).toMatch(/Enviar o recoger/)
    expect(formaNoDisponible('al_recibir', 'mostrador')).toMatch(/Enviar o recoger/)
    for (const f of ['efectivo', 'tarjeta', 'transferencia', 'credito'] as const) expect(formaNoDisponible(f, 'mostrador')).toBeNull()
  })
  it('en pedido todas; «al recibir» solo con chofer o recoger', () => {
    for (const f of ['efectivo', 'tarjeta', 'transferencia', 'link', 'credito'] as const) expect(formaNoDisponible(f, 'pedido', 'foraneo')).toBeNull()
    expect(formaNoDisponible('al_recibir', 'pedido', 'foraneo')).toMatch(/paquetería/)
    expect(formaNoDisponible('al_recibir', 'pedido', 'local')).toBeNull()
    expect(formaNoDisponible('al_recibir', 'pedido', 'recoge')).toBeNull()
  })
  it('lo que falta: forma, efectivo suficiente, referencia y fecha del crédito', () => {
    const hoy = '2026-11-23'
    expect(faltaEnCobro(null, 100, 'pedido', null, hoy)).toMatch(/Elige/)
    expect(faltaEnCobro({ forma: 'efectivo', recibido: 50 }, 100, 'mostrador', null, hoy)).toMatch(/no alcanza/)
    expect(faltaEnCobro({ forma: 'efectivo' }, 100, 'mostrador', null, hoy)).toBeNull()
    // REF-OPCIONAL (26 nov 2026, dueño) · la referencia de la transferencia ya no detiene la venta: vacía o como sea.
    for (const r of [undefined, '', '9474', 'SCOTIABANK RENATO', 'MBAN01002611230071250489']) {
      expect(faltaEnCobro({ forma: 'transferencia', referencia: r }, 100, 'pedido', null, hoy)).toBeNull()
    }
    expect(faltaEnCobro({ forma: 'credito' }, 100, 'pedido', null, hoy)).toMatch(/fecha límite/)
    expect(faltaEnCobro({ forma: 'credito', vence: '2026-11-01' }, 100, 'pedido', null, hoy)).toMatch(/anterior a hoy/)
    expect(faltaEnCobro({ forma: 'credito', vence: sumarDiasISO(hoy, 181) }, 100, 'pedido', null, hoy)).toMatch(/180 días/)
    expect(faltaEnCobro({ forma: 'credito', vence: '2026-12-15' }, 100, 'pedido', null, hoy)).toBeNull()
    // AL-RECIBIR · hay que decir cómo pagará en la puerta (lo ve el chofer)
    expect(faltaEnCobro({ forma: 'al_recibir' }, 100, 'pedido', 'local', hoy)).toMatch(/Cómo va a pagar/)
    expect(faltaEnCobro({ forma: 'al_recibir', con: 'tarjeta' }, 100, 'pedido', 'local', hoy)).toBeNull()
  })
  it('al servidor solo viaja lo de esa forma', () => {
    expect(cobroParaServidor({ forma: 'efectivo', recibido: 200, referencia: 'x' })).toEqual({ forma: 'efectivo', recibido: 200 })
    expect(cobroParaServidor({ forma: 'transferencia', referencia: ' SPEI 9 ' })).toEqual({ forma: 'transferencia', referencia: 'SPEI 9' })
    expect(cobroParaServidor({ forma: 'credito', vence: '2026-12-15', motivo: '' })).toEqual({ forma: 'credito', vence: '2026-12-15' })
    expect(cobroParaServidor({ forma: 'link' })).toEqual({ forma: 'link' })
    expect(cobroParaServidor({ forma: 'al_recibir', con: 'tarjeta' })).toEqual({ forma: 'al_recibir', con: 'tarjeta' })
  })
  it('resultado en palabras y errores del servidor traducidos', () => {
    expect(resultadoCobro({ forma: 'tarjeta' }).pagado).toBe(true)
    expect(resultadoCobro({ forma: 'credito' }, '2026-12-15').texto).toMatch(/15\/12\/2026/)
    expect(resultadoCobro({ forma: 'link' }).texto).toMatch(/Cobrar pedidos/)
    expect(resultadoCobro({ forma: 'al_recibir', con: 'tarjeta' }).texto).toMatch(/con terminal al entregarlo/)
    expect(mensajeCobro('ERROR: REFERENCIA_REQUERIDA: x')).toMatch(/referencia/)
    expect(mensajeCobro('NO_AUTORIZADO: no puedes cobrar este pedido')).toMatch(/no es venta tuya/)
    expect(mensajeCobro('otra cosa')).toBeNull()
  })
})

function Prueba({ modo, tipoEntrega = null }: { modo: 'mostrador' | 'pedido'; tipoEntrega?: string | null }) {
  const [v, setV] = useState<CobroElegido | null>(null)
  return <><FormaDePago total={1000} modo={modo} tipoEntrega={tipoEntrega} value={v} onChange={setV} /><output data-testid="valor">{JSON.stringify(v)}</output></>
}
const valor = () => JSON.parse(screen.getByTestId('valor').textContent || 'null')

describe('pantalla «Forma de pago»', () => {
  it('muestra las 6 formas; en mostrador link y «al recibir» no se eligen', () => {
    render(<Prueba modo="mostrador" />)
    for (const f of ['efectivo', 'tarjeta', 'transferencia', 'link', 'al_recibir', 'credito']) expect(screen.getByTestId(`forma-pago-${f}`)).toBeTruthy()
    fireEvent.click(screen.getByTestId('forma-pago-link'))
    expect(valor()).toBeNull()
    fireEvent.click(screen.getByTestId('forma-pago-tarjeta'))
    expect(valor()).toEqual({ forma: 'tarjeta' })
  })
  it('efectivo calcula el cambio; transferencia con referencia opcional; crédito trae fecha a 15 días', () => {
    render(<Prueba modo="pedido" tipoEntrega="local" />)
    fireEvent.click(screen.getByTestId('forma-pago-efectivo'))
    fireEvent.click(screen.getByTestId('forma-pago-efectivo-ya'))   // COBRO-ENTREGA · con chofer pregunta si ya lo tiene
    fireEvent.change(screen.getByTestId('forma-pago-recibido'), { target: { value: '1200' } })
    expect(screen.getByText('Cambio')).toBeTruthy()
    fireEvent.click(screen.getByTestId('forma-pago-transferencia'))
    expect(screen.queryByTestId('forma-pago-falta')).toBeNull()   // REF-OPCIONAL · sin referencia ya se puede
    fireEvent.change(screen.getByTestId('forma-pago-referencia'), { target: { value: 'SPEI 123456' } })
    expect(screen.queryByTestId('forma-pago-falta')).toBeNull()
    fireEvent.click(screen.getByTestId('forma-pago-credito'))
    expect(valor().forma).toBe('credito')
    expect(valor().vence).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    fireEvent.click(screen.getByTestId('forma-pago-al_recibir'))
    expect(valor()).toEqual({ forma: 'al_recibir' })
    fireEvent.click(screen.getByTestId('forma-pago-con-tarjeta'))
    expect(valor()).toEqual({ forma: 'al_recibir', con: 'tarjeta' })
    // los grupos no se confunden: tarjeta está en «Ya pagó», paga al recibir en «Paga después»
    expect(screen.getByTestId('forma-pago-grupo-ya').textContent).toMatch(/Ya pagó.*Tarjeta/)
    expect(screen.getByTestId('forma-pago-grupo-despues').textContent).toMatch(/Paga después.*Paga al recibir/)
  })
  it('COBRO-ENTREGA · pedido con chofer: «Efectivo» pregunta si ya lo tiene; «No» lo deja por cobrar al chofer con el monto', () => {
    const onChange = vi.fn()
    const { rerender } = render(<FormaDePago total={1600} modo="pedido" tipoEntrega="local" value={null} onChange={onChange} />)
    fireEvent.click(screen.getByTestId('forma-pago-efectivo'))
    expect(onChange).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('forma-pago-efectivo-al-recibir'))
    expect(onChange).toHaveBeenLastCalledWith({ forma: 'al_recibir', con: 'efectivo' })
    rerender(<FormaDePago total={1600} modo="pedido" tipoEntrega="local" value={{ forma: 'al_recibir', con: 'efectivo' }} onChange={onChange} />)
    expect(screen.getByTestId('forma-pago-al-recibir-monto')).toHaveTextContent('el chofer cobra $1,600')
  })
  it('COBRO-ENTREGA · «Sí, ya me lo dio» lo registra como pagado; en mostrador o paquetería no pregunta', () => {
    const onChange = vi.fn()
    render(<FormaDePago total={900} modo="pedido" tipoEntrega="local" value={null} onChange={onChange} />)
    fireEvent.click(screen.getByTestId('forma-pago-efectivo'))
    fireEvent.click(screen.getByTestId('forma-pago-efectivo-ya'))
    expect(onChange).toHaveBeenLastCalledWith({ forma: 'efectivo' })
    cleanup()
    const o2 = vi.fn()
    render(<FormaDePago total={900} modo="pedido" tipoEntrega="foraneo" value={null} onChange={o2} />)
    fireEvent.click(screen.getByTestId('forma-pago-efectivo'))
    expect(o2).toHaveBeenLastCalledWith({ forma: 'efectivo' })
  })
})

// «¿YA PAGÓ?» (27 nov 2026) · al levantar un pedido primero se contesta sí o todavía no; solo se ven las formas de esa
// respuesta. Son las mismas formas y guardan lo mismo. En Caja y en «Cobrar pedidos» la pantalla no cambia.
function Pregunta({ tipoEntrega = null }: { tipoEntrega?: string | null }) {
  const [v, setV] = useState<CobroElegido | null>(null)
  return <><FormaDePago total={1000} modo="pedido" tipoEntrega={tipoEntrega} value={v} onChange={setV} preguntar /><output data-testid="valor">{JSON.stringify(v)}</output></>
}
describe('«¿Ya pagó?» al levantar un pedido', () => {
  it('al abrir solo está la pregunta: ninguna forma hasta contestar', () => {
    render(<Pregunta />)
    expect(screen.getByTestId('forma-pago-ya-pago')).toHaveTextContent('¿Ya pagó?')
    expect(screen.getByTestId('forma-pago-ya-pago-pista')).toBeTruthy()
    for (const f of ['efectivo', 'tarjeta', 'transferencia', 'por_cobrar', 'link', 'al_recibir', 'credito']) expect(screen.queryByTestId(`forma-pago-${f}`)).toBeNull()
    expect(valor()).toBeNull()
  })
  it('«Sí, ya pagó» muestra solo efectivo, tarjeta y transferencia; se guarda igual que antes', () => {
    render(<Pregunta tipoEntrega="foraneo" />)
    fireEvent.click(screen.getByTestId('forma-pago-ya-pago-si'))
    expect(screen.getByTestId('forma-pago-ya-pago-si').getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByTestId('forma-pago-grupo-ya')).toHaveTextContent('¿Cómo pagó?')
    for (const f of ['efectivo', 'tarjeta', 'transferencia']) expect(screen.getByTestId(`forma-pago-${f}`)).toBeTruthy()
    for (const f of ['por_cobrar', 'link', 'al_recibir', 'credito']) expect(screen.queryByTestId(`forma-pago-${f}`)).toBeNull()
    fireEvent.click(screen.getByTestId('forma-pago-transferencia'))
    expect(valor()).toEqual({ forma: 'transferencia' })
  })
  it('«Todavía no» muestra más tarde, al recibir, link y crédito', () => {
    render(<Pregunta tipoEntrega="local" />)
    fireEvent.click(screen.getByTestId('forma-pago-ya-pago-no'))
    expect(screen.getByTestId('forma-pago-grupo-despues')).toHaveTextContent('¿Cómo va a pagar?')
    for (const f of ['por_cobrar', 'link', 'al_recibir', 'credito']) expect(screen.getByTestId(`forma-pago-${f}`)).toBeTruthy()
    for (const f of ['efectivo', 'tarjeta', 'transferencia']) expect(screen.queryByTestId(`forma-pago-${f}`)).toBeNull()
    fireEvent.click(screen.getByTestId('forma-pago-por_cobrar'))
    expect(valor()).toEqual({ forma: 'por_cobrar' })
  })
  it('cambiar la respuesta borra la forma que ya no aplica (no queda una elegida y escondida)', () => {
    render(<Pregunta tipoEntrega="foraneo" />)
    fireEvent.click(screen.getByTestId('forma-pago-ya-pago-si'))
    fireEvent.click(screen.getByTestId('forma-pago-tarjeta'))
    expect(valor()).toEqual({ forma: 'tarjeta' })
    fireEvent.click(screen.getByTestId('forma-pago-ya-pago-no'))
    expect(valor()).toBeNull()
    expect(screen.queryByTestId('forma-pago-tarjeta')).toBeNull()
    expect(screen.getByTestId('forma-pago-credito')).toBeTruthy()
  })
  it('con chofer, «Efectivo» sigue preguntando si ya lo tiene; «No» lo pasa a «Todavía no» por cobrar al chofer', () => {
    render(<Pregunta tipoEntrega="local" />)
    fireEvent.click(screen.getByTestId('forma-pago-ya-pago-si'))
    fireEvent.click(screen.getByTestId('forma-pago-efectivo'))
    expect(valor()).toBeNull()                                              // todavía no registra nada
    fireEvent.click(screen.getByTestId('forma-pago-efectivo-al-recibir'))
    expect(valor()).toEqual({ forma: 'al_recibir', con: 'efectivo' })
    expect(screen.getByTestId('forma-pago-ya-pago-no').getAttribute('aria-pressed')).toBe('true')   // la respuesta sigue a lo elegido
    expect(screen.getByTestId('forma-pago-al-recibir-monto')).toHaveTextContent('el chofer cobra $1,000')
  })
  it('sin `preguntar` (Caja y Cobrar pedidos) todo sigue a la vista, sin pregunta', () => {
    render(<Prueba modo="pedido" tipoEntrega="local" />)
    expect(screen.queryByTestId('forma-pago-ya-pago')).toBeNull()
    for (const f of ['efectivo', 'tarjeta', 'transferencia', 'por_cobrar', 'link', 'al_recibir', 'credito']) expect(screen.getByTestId(`forma-pago-${f}`)).toBeTruthy()
  })
})
