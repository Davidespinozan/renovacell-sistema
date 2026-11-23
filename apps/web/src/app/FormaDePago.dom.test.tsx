// @vitest-environment jsdom
// COBRO-U · la misma «Forma de pago» en todos los puntos de venta: reglas y pantalla.
import React, { useState } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
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
    expect(faltaEnCobro({ forma: 'transferencia' }, 100, 'pedido', null, hoy)).toMatch(/referencia/)
    expect(faltaEnCobro({ forma: 'transferencia', referencia: 'SPEI 1' }, 100, 'pedido', null, hoy)).toBeNull()
    expect(faltaEnCobro({ forma: 'credito' }, 100, 'pedido', null, hoy)).toMatch(/fecha límite/)
    expect(faltaEnCobro({ forma: 'credito', vence: '2026-11-01' }, 100, 'pedido', null, hoy)).toMatch(/anterior a hoy/)
    expect(faltaEnCobro({ forma: 'credito', vence: sumarDiasISO(hoy, 181) }, 100, 'pedido', null, hoy)).toMatch(/180 días/)
    expect(faltaEnCobro({ forma: 'credito', vence: '2026-12-15' }, 100, 'pedido', null, hoy)).toBeNull()
  })
  it('al servidor solo viaja lo de esa forma', () => {
    expect(cobroParaServidor({ forma: 'efectivo', recibido: 200, referencia: 'x' })).toEqual({ forma: 'efectivo', recibido: 200 })
    expect(cobroParaServidor({ forma: 'transferencia', referencia: ' SPEI 9 ' })).toEqual({ forma: 'transferencia', referencia: 'SPEI 9' })
    expect(cobroParaServidor({ forma: 'credito', vence: '2026-12-15', motivo: '' })).toEqual({ forma: 'credito', vence: '2026-12-15' })
    expect(cobroParaServidor({ forma: 'link' })).toEqual({ forma: 'link' })
  })
  it('resultado en palabras y errores del servidor traducidos', () => {
    expect(resultadoCobro({ forma: 'tarjeta' }).pagado).toBe(true)
    expect(resultadoCobro({ forma: 'credito' }, '2026-12-15').texto).toMatch(/15\/12\/2026/)
    expect(resultadoCobro({ forma: 'link' }).texto).toMatch(/Cobrar pedidos/)
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
  it('efectivo calcula el cambio; transferencia pide referencia; crédito trae fecha a 15 días', () => {
    render(<Prueba modo="pedido" tipoEntrega="local" />)
    fireEvent.click(screen.getByTestId('forma-pago-efectivo'))
    fireEvent.change(screen.getByTestId('forma-pago-recibido'), { target: { value: '1200' } })
    expect(screen.getByText('Cambio')).toBeTruthy()
    fireEvent.click(screen.getByTestId('forma-pago-transferencia'))
    expect(screen.getByTestId('forma-pago-falta').textContent).toMatch(/referencia/)
    fireEvent.change(screen.getByTestId('forma-pago-referencia'), { target: { value: 'SPEI 123' } })
    expect(screen.queryByTestId('forma-pago-falta')).toBeNull()
    fireEvent.click(screen.getByTestId('forma-pago-credito'))
    expect(valor().forma).toBe('credito')
    expect(valor().vence).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    fireEvent.click(screen.getByTestId('forma-pago-al_recibir'))
    expect(valor()).toEqual({ forma: 'al_recibir' })
  })
})
