// @vitest-environment jsdom
// CS-1A.5 · ConfirmacionPago: una sola solicitud de cobro por intento (StrictMode, remontaje, doble montaje), "Pago confirmado"
// SOLO con posted, rechazado, pendiente (desconocido/captured), autorizado sin captura, recuperables (importe cambió, token),
// error de red tras enviar → consulta de estado sin reenviar, y recuperación sin token (solo estado). Todo simulado.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor } from '@testing-library/react'
import { ConfirmacionPago, _reiniciarEnviadosPago } from './ConfirmacionPago'
import type { DepsPago } from './ConfirmacionPago'

beforeEach(() => { cleanup(); _reiniciarEnviadosPago() })
const ATT = '11111111-1111-4111-8111-111111111111'
const TOKEN = 'eyJraWQiOiIwOCJ9.eyJqdGkiOiJ0cmFuc2llbnRlIn0.firma'
const resp = (estado: string, extra: Record<string, unknown> = {}) => ({ ok: true as const, data: { estado, pagado: estado === 'posted', amount: 6000, ambiente: 'test' as const, message: null, ...extra } })
function deps(pagar: unknown = resp('posted', { payment_status: 'paid', saldo: 0 }), estado: unknown = resp('posted', { payment_status: 'paid' })) {
  const llamadas: string[] = []
  const cs = { pagar: vi.fn(async () => { llamadas.push('pagar'); return typeof pagar === 'function' ? pagar() : pagar }), estado: vi.fn(async () => { llamadas.push('estado'); return typeof estado === 'function' ? estado() : estado }) }
  return { llamadas, csPago: cs as unknown as DepsPago['csPago'] }
}
const fase = () => screen.getByTestId('cpago').getAttribute('data-fase')
const esperar = (f: string) => waitFor(() => expect(fase()).toBe(f))

describe('CS-1A.5 · ConfirmacionPago', () => {
  it('posted → "Pago confirmado"; una sola solicitud aunque StrictMode monte dos veces', async () => {
    const d = deps(); const onFin = vi.fn()
    render(<React.StrictMode><ConfirmacionPago attemptId={ATT} token={TOKEN} amount={6000} onFin={onFin} deps={d} /></React.StrictMode>)
    expect(['procesando', 'consultando']).toContain(fase())
    await esperar('confirmado')
    expect(d.llamadas.filter((x) => x === 'pagar')).toHaveLength(1)
    expect(document.body.textContent).toContain('Pago confirmado y registrado'); expect(document.body.textContent).toContain('pedido pagado')
    expect(onFin).toHaveBeenCalledWith('confirmado', expect.objectContaining({ estado: 'posted' }))
    expect(document.body.innerHTML).not.toContain(TOKEN)
  })
  it('remontaje del mismo intento (cerrar/abrir el modal) NO reenvía el cobro: solo consulta el estado', async () => {
    const d = deps()
    const { unmount } = render(<ConfirmacionPago attemptId={ATT} token={TOKEN} amount={6000} deps={d} />)
    await esperar('confirmado'); unmount()
    render(<ConfirmacionPago attemptId={ATT} token={TOKEN} amount={6000} deps={d} />)
    await esperar('confirmado')
    expect(d.llamadas).toEqual(['pagar', 'estado'])
  })
  it('declined → rechazado; captured (asiento pendiente) y desconocido → pendiente; authorized sin captura → mensaje sin segundo cargo', async () => {
    render(<ConfirmacionPago attemptId={ATT} token={TOKEN} amount={6000} deps={deps(resp('declined', { detalle: 'DECLINED · INSUFFICIENT_FUND' }))} />)
    await esperar('rechazado'); expect(document.body.textContent).toContain('INSUFFICIENT_FUND'); cleanup(); _reiniciarEnviadosPago()
    render(<ConfirmacionPago attemptId={ATT} token={TOKEN} amount={6000} deps={deps(resp('captured'))} />)
    await esperar('pendiente'); cleanup(); _reiniciarEnviadosPago()
    render(<ConfirmacionPago attemptId={ATT} token={TOKEN} amount={6000} deps={deps(resp('unknown_requires_reconciliation', { message: 'Pago pendiente de verificación con el banco.' }))} />)
    await esperar('pendiente'); expect(document.body.textContent).not.toMatch(/Pago confirmado/); cleanup(); _reiniciarEnviadosPago()
    render(<ConfirmacionPago attemptId={ATT} token={TOKEN} amount={6000} deps={deps(resp('authorized'))} />)
    await esperar('autorizado_sin_captura'); expect(document.body.textContent).toContain('No se realizará otro cargo')
  })
  it('importe cambió / token caducado → recuperable (sin cargo) y el intento vuelve a poder enviarse; en_proceso → pendiente', async () => {
    const d = deps({ ok: false, error: 'importe_cambio', message: 'El importe del pedido cambió.', saldo_vigente: 4500 })
    render(<ConfirmacionPago attemptId={ATT} token={TOKEN} amount={6000} deps={d} />)
    await esperar('recuperable'); expect(document.body.textContent).toContain('4,500'); cleanup()
    const d2 = deps({ ok: false, error: 'token_invalido', message: 'La captura de la tarjeta caducó.' })
    render(<ConfirmacionPago attemptId={ATT} token={TOKEN} amount={6000} deps={d2} />)
    await esperar('recuperable'); expect(d2.llamadas).toEqual(['pagar']); cleanup()
    const d3 = deps({ ok: false, error: 'en_proceso', message: 'Tu pago ya se está procesando.' })
    render(<ConfirmacionPago attemptId={ATT} token={TOKEN} amount={6000} deps={d3} />)
    await esperar('pendiente'); expect(d3.llamadas).toEqual(['pagar'])
  })
  it('error de red tras enviar → consulta el estado (nunca reenvía); recuperación sin token → solo estado', async () => {
    const d = deps({ ok: false, error: 'error', message: 'fetch failed' }, resp('posted', { payment_status: 'paid' }))
    render(<ConfirmacionPago attemptId={ATT} token={TOKEN} amount={6000} deps={d} />)
    await esperar('confirmado'); expect(d.llamadas).toEqual(['pagar', 'estado']); cleanup()
    const d2 = deps(resp('posted'), resp('unknown_requires_reconciliation'))
    render(<ConfirmacionPago attemptId={ATT} token={null} amount={6000} deps={d2} />)
    await esperar('pendiente'); expect(d2.llamadas).toEqual(['estado'])
  })
})
