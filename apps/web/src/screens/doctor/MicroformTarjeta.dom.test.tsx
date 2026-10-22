// @vitest-environment jsdom
// CS-1A.3 · MicroformTarjeta: inicialización única, carga simulada de Flex, expiración, tokenización en memoria, doble clic,
// limpieza al desmontar, estados de no disponibilidad/error, y ausencia de PAN/CVV/token en DOM, almacenamiento y solicitudes.
import React from 'react'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor, act } from '@testing-library/react'
import { MicroformTarjeta } from './MicroformTarjeta'
import type { FlexCtor, FlexMicroform, CaptureContextDoctor } from '../../data/payments/cybersource'

beforeEach(() => { cleanup(); try { localStorage.clear(); sessionStorage.clear() } catch { /* jsdom */ } })

const TOKEN = 'eyJraWQiOiIwOCJ9.eyJ0b2tlbiI6InRyYW5zaWVudGUtZGUtcHJ1ZWJhIn0.firma'
const ctx = (over: Partial<CaptureContextDoctor> = {}) => ({
  ok: true as const,
  ctx: { attempt_id: '11111111-1111-4111-8111-111111111111', amount: 6000, currency: 'MXN' as const, ambiente: 'test' as const, capture_context: 'cc.jwt.x',
         client_library: 'https://flex.cybersource.com/microform/bundle/v2/flex-microform.min.js', client_library_integrity: 'sha256-abc', expires_at: new Date(Date.now() + 900_000).toISOString(), reutilizado: false, ...over },
})
function flexFalso(opts: { tokenErr?: unknown; token?: string } = {}) {
  const loads: Array<{ tipo: string; el: unknown }> = []
  const createToken = vi.fn((_o: { expirationMonth: string; expirationYear: string }, cb: (e: unknown, t?: string) => void) => { setTimeout(() => cb(opts.tokenErr ?? null, opts.tokenErr ? undefined : (opts.token ?? TOKEN)), 0) })
  const teardown = vi.fn()
  const mf: FlexMicroform = { createField: (tipo) => ({ load: (el) => { loads.push({ tipo, el }) } }), createToken, teardown }
  const microform = vi.fn(() => mf)
  const Ctor = vi.fn(function (this: unknown) { return { microform } }) as unknown as FlexCtor
  const cargar = vi.fn(async () => Ctor)
  return { cargar, Ctor, microform, createToken, teardown, loads }
}

describe('CS-1A.3 · MicroformTarjeta', () => {
  it('inicializa UNA vez, carga la librería desde la URL+integridad del contexto, monta número y CVV en iframes y muestra el importe', async () => {
    const f = flexFalso(); const solicitar = vi.fn(async () => ctx())
    render(<MicroformTarjeta orderId="o-1" onToken={() => {}} deps={{ solicitar, cargar: f.cargar }} />)
    expect(screen.getByTestId('mf-cargando')).toBeTruthy()
    await screen.findByTestId('mf-formulario')
    await waitFor(() => expect(f.loads).toHaveLength(2))
    expect(solicitar).toHaveBeenCalledTimes(1); expect(solicitar).toHaveBeenCalledWith('o-1')
    expect(f.cargar).toHaveBeenCalledWith('https://flex.cybersource.com/microform/bundle/v2/flex-microform.min.js', 'sha256-abc')
    expect(f.Ctor).toHaveBeenCalledTimes(1); expect(f.Ctor).toHaveBeenCalledWith('cc.jwt.x')
    expect(f.microform).toHaveBeenCalledTimes(1)
    expect(f.loads.map((l) => l.tipo)).toEqual(['number', 'securityCode'])
    expect(screen.getByTestId('mf-formulario').textContent).toContain('6,000')
    expect(screen.getByTestId('mf-formulario').textContent).toContain('SANDBOX')
    // ningún <input> propio para número ni CVV: solo contenedores vacíos para los iframes de CyberSource
    expect(screen.getByTestId('mf-numero').querySelector('input')).toBeNull(); expect(screen.getByTestId('mf-cvv').querySelector('input')).toBeNull()
  })
  it('tokeniza en memoria: entrega el token al padre, NO lo pinta en el DOM ni lo guarda; doble clic = un solo createToken; sin "pago exitoso"', async () => {
    const f = flexFalso(); const onToken = vi.fn()
    render(<MicroformTarjeta orderId="o-1" onToken={onToken} deps={{ solicitar: async () => ctx(), cargar: f.cargar }} />)
    await screen.findByTestId('mf-formulario')
    fireEvent.click(screen.getByTestId('mf-continuar'))
    expect(f.createToken).not.toHaveBeenCalled()   // falta vencimiento
    expect(screen.getByTestId('mf-formulario').textContent).toContain('mes y el año')
    fireEvent.change(screen.getByTestId('mf-mes'), { target: { value: '05' } }); fireEvent.change(screen.getByTestId('mf-anio'), { target: { value: String(new Date().getFullYear() + 2) } })
    fireEvent.click(screen.getByTestId('mf-continuar')); fireEvent.click(screen.getByTestId('mf-continuar'))
    await screen.findByTestId('mf-tokenizado')
    expect(f.createToken).toHaveBeenCalledTimes(1)
    expect(f.createToken.mock.calls[0][0]).toEqual({ expirationMonth: '05', expirationYear: String(new Date().getFullYear() + 2) })
    expect(onToken).toHaveBeenCalledTimes(1)
    expect(onToken.mock.calls[0][0]).toEqual({ token: TOKEN, attemptId: '11111111-1111-4111-8111-111111111111', amount: 6000, ambiente: 'test' })
    expect(document.body.innerHTML).not.toContain(TOKEN)
    expect(JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage })).not.toContain(TOKEN)
    expect(document.body.textContent).not.toMatch(/pago exitoso|pagado|cobrado/i)
    expect(screen.getByTestId('mf-tokenizado').textContent).toContain('aún no se ha realizado ningún cargo')
    expect(screen.queryByTestId('mf-continuar')).toBeNull()
  })
  it('rechazo de tokenización: vuelve a "listo" con mensaje y permite reintentar', async () => {
    const f = flexFalso({ tokenErr: { reason: 'VALIDATION_ERROR' } }); const onToken = vi.fn()
    render(<MicroformTarjeta orderId="o-1" onToken={onToken} deps={{ solicitar: async () => ctx(), cargar: f.cargar }} />)
    await screen.findByTestId('mf-formulario')
    fireEvent.change(screen.getByTestId('mf-mes'), { target: { value: '01' } }); fireEvent.change(screen.getByTestId('mf-anio'), { target: { value: String(new Date().getFullYear() + 1) } })
    fireEvent.click(screen.getByTestId('mf-continuar'))
    await waitFor(() => expect(screen.getByTestId('mf-formulario').textContent).toContain('Revisa los datos'))
    expect(onToken).not.toHaveBeenCalled(); expect((screen.getByTestId('mf-continuar') as HTMLButtonElement).disabled).toBe(false)
  })
  it('expiración del contexto: ya vencido al llegar y vencimiento durante el llenado; reintentar pide un contexto nuevo', async () => {
    vi.useFakeTimers()
    try {
      const f = flexFalso(); const solicitar = vi.fn(async () => ctx({ expires_at: new Date(Date.now() + 2_000).toISOString() }))
      render(<MicroformTarjeta orderId="o-1" onToken={() => {}} deps={{ solicitar, cargar: f.cargar }} />)
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })
      expect(screen.getByTestId('mf-formulario')).toBeTruthy()
      await act(async () => { await vi.advanceTimersByTimeAsync(2_500) })
      expect(screen.getByTestId('mf-expirado').textContent).toContain('caducó')
      fireEvent.click(screen.getByTestId('mf-reintentar'))
      await act(async () => { await vi.advanceTimersByTimeAsync(10) })
      expect(solicitar).toHaveBeenCalledTimes(2)
    } finally { vi.useRealTimers() }
    cleanup()
    const f2 = flexFalso()
    render(<MicroformTarjeta orderId="o-2" onToken={() => {}} deps={{ solicitar: async () => ctx({ expires_at: new Date(Date.now() - 1000).toISOString() }), cargar: f2.cargar }} />)
    await screen.findByTestId('mf-expirado')
    expect(f2.cargar).not.toHaveBeenCalled()
  })
  it('no disponible (501 / sin saldo / en proceso) y error del proveedor: estado controlado, sin cargar Flex ni tokens simulados', async () => {
    const f = flexFalso()
    render(<MicroformTarjeta orderId="o-1" onToken={() => {}} deps={{ solicitar: async () => ({ ok: false, motivo: 'no_disponible', mensaje: 'El pago con tarjeta aún no está disponible. Usa Transferencia.' }), cargar: f.cargar }} />)
    const nd = await screen.findByTestId('mf-no_disponible'); expect(nd.textContent).toContain('Usa Transferencia'); expect(screen.queryByTestId('mf-reintentar')).toBeNull()
    cleanup()
    render(<MicroformTarjeta orderId="o-1" onToken={() => {}} deps={{ solicitar: async () => ({ ok: false, motivo: 'proveedor', mensaje: 'No se pudo preparar el formulario de tarjeta. Intenta de nuevo.' }), cargar: f.cargar }} />)
    const er = await screen.findByTestId('mf-error'); expect(er.textContent).toContain('Intenta de nuevo'); expect(screen.getByTestId('mf-reintentar')).toBeTruthy()
    cleanup()
    const cargarFalla = vi.fn(async () => { throw new Error('bloqueado por red') })
    render(<MicroformTarjeta orderId="o-1" onToken={() => {}} deps={{ solicitar: async () => ctx(), cargar: cargarFalla }} />)
    expect((await screen.findByTestId('mf-error')).textContent).toContain('formulario seguro')
    expect(f.cargar).not.toHaveBeenCalled(); expect(f.createToken).not.toHaveBeenCalled()
  })
  it('desmontaje: teardown del microform y sin inicializaciones duplicadas en StrictMode', async () => {
    const f = flexFalso(); const solicitar = vi.fn(async () => ctx())
    const { unmount } = render(<React.StrictMode><MicroformTarjeta orderId="o-1" onToken={() => {}} deps={{ solicitar, cargar: f.cargar }} /></React.StrictMode>)
    await screen.findByTestId('mf-formulario')
    await waitFor(() => expect(f.loads.length).toBeGreaterThanOrEqual(2))
    unmount()
    expect(f.teardown).toHaveBeenCalled()
    expect(f.microform).toHaveBeenCalledTimes(1)                 // StrictMode monta/desmonta/monta: UNA sola instancia viva de Microform
    expect(f.Ctor).toHaveBeenCalledTimes(1)
    expect(solicitar.mock.calls.length).toBeLessThanOrEqual(2)   // el primer contexto (del montaje descartado) se desecha sin usarse
  })
})
