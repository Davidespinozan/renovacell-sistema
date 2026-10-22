// @vitest-environment jsdom
// CS-1A.4 · orquestación 3DS en el portal con la Edge simulada: frictionless, reto completado/rechazado, setup rechazado, token
// expirado, declined, datos incompletos, timeout, retorno duplicado, navegador cerrado durante el reto, intento ya autenticado,
// transición inválida, recuperación (modo validar). Ninguna llamada de cobro. Todo simulado (no validado en Sandbox).
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'
import { Autenticacion3DS } from './Autenticacion3DS'
import type { Deps } from './Autenticacion3DS'

beforeEach(cleanup)
const ATT = '11111111-1111-4111-8111-111111111111'
const TOKEN = 'eyJraWQiOiIwOCJ9.eyJqdGkiOiJ0cmFuc2llbnRlIn0.firma'
const setupOk = { ok: true as const, data: { estado: 'auth_setup' as const, reference_id: 'ref-1', ddc_url: 'https://centinelapistag.cardinalcommerce.com/V1/Cruise/Collect', ddc_token: 'jwt.ddc', ddc_origen: 'https://centinelapistag.cardinalcommerce.com', ddc_timeout_ms: 50 } }
const reto = { ok: true as const, data: { estado: 'auth_challenge' as const, reto: true, step_up_url: 'https://centinelapistag.cardinalcommerce.com/V2/Cruise/StepUp', step_up_token: 'jwt.stepup', ventana: '02' as const, ventana_px: { w: 390, h: 400 }, retorno_origen: 'https://proy.supabase.co' } }
function deps(over: Partial<{ setup: unknown; enroll: unknown; validate: unknown; ddc: unknown; stepUp: unknown }> = {}): Deps & { llamadas: string[] } {
  const llamadas: string[] = []
  const cs = {
    estado: vi.fn(), abandonar: vi.fn(),
    setup: vi.fn(async () => { llamadas.push('setup'); return over.setup ?? setupOk }),
    enroll: vi.fn(async () => { llamadas.push('enroll'); return over.enroll ?? { ok: true, data: { estado: 'auth_validated' } } }),
    validate: vi.fn(async () => { llamadas.push('validate'); return over.validate ?? { ok: true, data: { estado: 'auth_validated' } } }),
  }
  return {
    llamadas,
    cs3ds: cs as unknown as Deps['cs3ds'],
    recolectar: () => ({ httpBrowserLanguage: 'es-MX', httpBrowserJavaEnabled: false, httpBrowserJavaScriptEnabled: true, httpBrowserColorDepth: '24', httpBrowserScreenHeight: '864', httpBrowserScreenWidth: '1536', httpBrowserTimeDifference: '360' }),
    ddc: vi.fn(async () => { llamadas.push('ddc'); return (over.ddc as { completado: boolean; sessionId: string | null }) ?? { completado: true, sessionId: 's' } }) as unknown as Deps['ddc'],
    stepUp: vi.fn(async () => { llamadas.push('stepUp'); return (over.stepUp as { regreso: boolean }) ?? { regreso: true } }) as unknown as Deps['stepUp'],
    stepUpTimeoutMs: 100,
  }
}
const fase = () => screen.getByTestId('a3ds').getAttribute('data-fase')
const esperarFase = (f: string) => waitFor(() => expect(fase()).toBe(f))

describe('CS-1A.4 · Autenticacion3DS', () => {
  it('frictionless: setup → DDC → enroll autenticada → completada, sin validate; nunca "pago exitoso"', async () => {
    const d = deps(); const onFin = vi.fn()
    render(<Autenticacion3DS attemptId={ATT} token={TOKEN} onFin={onFin} deps={d} />)
    expect(fase()).toBe('preparando')
    await esperarFase('completada')
    expect(d.llamadas).toEqual(['setup', 'ddc', 'enroll'])
    expect((d.cs3ds!.setup as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([ATT, TOKEN])
    expect((d.cs3ds!.enroll as ReturnType<typeof vi.fn>).mock.calls[0].slice(0, 2)).toEqual([ATT, TOKEN])
    expect(onFin).toHaveBeenCalledWith('completada')
    expect(document.body.textContent).toContain('Aún no se ha realizado ningún cargo')
    expect(document.body.textContent).not.toMatch(/pago exitoso|pagado/i)
    expect(document.body.innerHTML).not.toContain(TOKEN)
  })
  it('reto requerido: enroll → step-up → validate autenticada → completada', async () => {
    const d = deps({ enroll: reto })
    render(<Autenticacion3DS attemptId={ATT} token={TOKEN} deps={d} />)
    await esperarFase('completada')
    expect(d.llamadas).toEqual(['setup', 'ddc', 'enroll', 'stepUp', 'validate'])
    const su = (d.stepUp as ReturnType<typeof vi.fn>).mock.calls[0][0]
    expect(su).toMatchObject({ url: reto.data.step_up_url, token: 'jwt.stepup', md: ATT, retornoOrigen: 'https://proy.supabase.co', ventana: { w: 390, h: 400 } })
  })
  it('reto rechazado por el banco y declined en enrolamiento → rechazada, sin reintentos', async () => {
    const d = deps({ enroll: reto, validate: { ok: true, data: { estado: 'declined', message: 'Tu banco no autenticó la tarjeta.' } } })
    render(<Autenticacion3DS attemptId={ATT} token={TOKEN} deps={d} />)
    await esperarFase('rechazada'); expect(d.llamadas.filter((x) => x === 'validate')).toHaveLength(1)
    cleanup()
    const d2 = deps({ enroll: { ok: true, data: { estado: 'declined', message: 'no' } } })
    render(<Autenticacion3DS attemptId={ATT} token={TOKEN} deps={d2} />)
    await esperarFase('rechazada'); expect(d2.llamadas).toEqual(['setup', 'ddc', 'enroll'])
  })
  it('setup rechazado / token expirado → recapturar; error de proveedor → error; datos incompletos → error con mensaje', async () => {
    render(<Autenticacion3DS attemptId={ATT} token={TOKEN} deps={deps({ setup: { ok: false, error: 'token_rechazado', message: 'La tarjeta no pudo verificarse. Vuelve a capturarla.' } })} />)
    await esperarFase('recapturar'); cleanup()
    render(<Autenticacion3DS attemptId={ATT} token={TOKEN} deps={deps({ setup: { ok: false, error: 'proveedor_sin_respuesta', message: 'El banco no respondió.' } })} />)
    await esperarFase('error'); expect(document.body.textContent).toContain('El banco no respondió'); cleanup()
    render(<Autenticacion3DS attemptId={ATT} token={TOKEN} deps={deps({ enroll: { ok: false, error: 'datos_incompletos', message: 'Faltan datos de facturación del pedido.' } })} />)
    await esperarFase('error'); expect(document.body.textContent).toContain('Faltan datos de facturación')
    cleanup()
    render(<Autenticacion3DS attemptId={ATT} token={null} deps={deps()} />)
    await esperarFase('recapturar')
  })
  it('DDC sin respuesta (timeout) no detiene el flujo: se enrola con los campos de respaldo', async () => {
    const d = deps({ ddc: { completado: false, sessionId: null } })
    render(<Autenticacion3DS attemptId={ATT} token={TOKEN} deps={d} />)
    await esperarFase('completada'); expect(d.llamadas).toEqual(['setup', 'ddc', 'enroll'])
  })
  it('reto sin regreso (doctor cerró el recuadro) → pendiente con reintento de confirmación; validación pendiente en el banco → pendiente', async () => {
    const d = deps({ enroll: reto, stepUp: { regreso: false }, validate: { ok: true, data: { estado: 'auth_challenge', pendiente: true, message: 'aún no termina' } } })
    render(<Autenticacion3DS attemptId={ATT} token={TOKEN} deps={d} />)
    await esperarFase('pendiente'); expect(d.llamadas).toEqual(['setup', 'ddc', 'enroll', 'stepUp'])
    fireEvent.click(screen.getByTestId('a3ds-reintentar'))
    await waitFor(() => expect(d.llamadas.filter((x) => x === 'validate')).toHaveLength(1))
    await esperarFase('pendiente')
  })
  it('navegador cerrado durante el reto (desmontaje): no se llama a validate después', async () => {
    let liberar: (v: { regreso: boolean }) => void = () => {}
    const d = deps({ enroll: reto }); d.stepUp = vi.fn(() => new Promise<{ regreso: boolean }>((r) => { liberar = r })) as unknown as Deps['stepUp']
    const { unmount } = render(<Autenticacion3DS attemptId={ATT} token={TOKEN} deps={d} />)
    await esperarFase('reto')
    unmount(); liberar({ regreso: true }); await new Promise((r) => setTimeout(r, 10))
    expect(d.llamadas).not.toContain('validate')
  })
  it('recuperación (modo validar): intento ya autenticado → completada; transición inválida → error; retorno duplicado → una sola validación', async () => {
    const d = deps({ validate: { ok: false, error: 'estado_invalido', estado: 'auth_validated', message: 'La tarjeta ya está autenticada.' } })
    render(<Autenticacion3DS attemptId={ATT} token={null} modo="validar" deps={d} />)
    await esperarFase('completada'); expect(d.llamadas).toEqual(['validate']); cleanup()
    const d2 = deps({ validate: { ok: false, error: 'estado_invalido', estado: 'created', message: 'La verificación no está en el paso de validación.' } })
    render(<Autenticacion3DS attemptId={ATT} token={null} modo="validar" deps={d2} />)
    await esperarFase('error'); cleanup()
    const d3 = deps({ enroll: reto })
    render(<React.StrictMode><Autenticacion3DS attemptId={ATT} token={TOKEN} deps={d3} /></React.StrictMode>)
    await esperarFase('completada')
    expect(d3.llamadas.filter((x) => x === 'validate')).toHaveLength(1)
  })
})
