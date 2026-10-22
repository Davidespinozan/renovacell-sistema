// @vitest-environment jsdom
// CS-1A.4 · mecánica del navegador: recolección de dispositivo (iframe oculto + postMessage de Cardinal) y reto step-up
// (iframe visible + aviso del returnUrl), con verificación estricta de orígenes, timeouts y limpieza. Sin red.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ejecutarDDC, ejecutarStepUp, recolectarDispositivo, ORIGENES_CARDINAL } from './cybersource3ds'

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms))
beforeEach(() => { document.body.innerHTML = '' })
const DDC = 'https://centinelapistag.cardinalcommerce.com/V1/Cruise/Collect'

describe('CS-1A.4 · recolección de dispositivo', () => {
  it('monta iframe oculto + form POST (JWT) a la URL de Cardinal y resuelve con el postMessage profile.completed del origen correcto', async () => {
    const cont = document.createElement('div'); document.body.appendChild(cont)
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {})
    const p = ejecutarDDC({ url: DDC, token: 'jwt.ddc', origen: ORIGENES_CARDINAL[0], timeoutMs: 2000, contenedor: cont })
    const iframe = cont.querySelector('iframe')!; expect(iframe.getAttribute('width')).toBe('10'); expect(iframe.name).toBe('rc-ddc')
    expect(submit).toHaveBeenCalledTimes(1)
    const form = submit.mock.instances[0] as unknown as HTMLFormElement
    expect(form.method.toUpperCase()).toBe('POST'); expect(form.action).toBe(DDC); expect(form.target).toBe('rc-ddc')
    expect((form.querySelector('input[name=JWT]') as HTMLInputElement).value).toBe('jwt.ddc')
    expect(cont.querySelector('form')).toBeNull()   // el form se retira tras enviarse
    // mensaje de un origen ajeno: ignorado
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.example', data: JSON.stringify({ MessageType: 'profile.completed', SessionId: 'x', Status: true }) }))
    await esperar(5)
    window.dispatchEvent(new MessageEvent('message', { origin: ORIGENES_CARDINAL[0], data: JSON.stringify({ MessageType: 'profile.completed', SessionId: 'sess-1', Status: true }) }))
    expect(await p).toEqual({ completado: true, sessionId: 'sess-1' })
    expect(cont.querySelector('iframe')).toBeNull()   // limpieza
    submit.mockRestore()
  })
  it('sin mensaje a tiempo: continúa como no completado (el enrolamiento lleva los 11 campos de respaldo); URL/origen no permitidos: no monta nada', async () => {
    const cont = document.createElement('div'); document.body.appendChild(cont)
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {})
    expect(await ejecutarDDC({ url: DDC, token: 'jwt', origen: ORIGENES_CARDINAL[0], timeoutMs: 20, contenedor: cont })).toEqual({ completado: false, sessionId: null })
    expect(cont.querySelector('iframe')).toBeNull()
    submit.mockClear()
    expect(await ejecutarDDC({ url: 'https://evil.example/collect', token: 'jwt', origen: 'https://evil.example', timeoutMs: 20, contenedor: cont })).toEqual({ completado: false, sessionId: null })
    expect(await ejecutarDDC({ url: 'https://centinelapi.cardinalcommerce.com/x', token: 'jwt', origen: ORIGENES_CARDINAL[0], timeoutMs: 20, contenedor: cont })).toEqual({ completado: false, sessionId: null })   // origen y URL de ambientes distintos
    expect(submit).not.toHaveBeenCalled()
    submit.mockRestore()
  })
})

describe('CS-1A.4 · reto step-up', () => {
  it('iframe visible con el tamaño indicado, form POST (JWT + MD) a stepUpUrl; termina solo con el aviso del origen de retorno; un segundo aviso no hace nada', async () => {
    const cont = document.createElement('div'); document.body.appendChild(cont)
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {})
    const p = ejecutarStepUp({ url: 'https://centinelapistag.cardinalcommerce.com/V2/Cruise/StepUp', token: 'jwt.stepup', md: 'att-1', retornoOrigen: 'https://proy.supabase.co', ventana: { w: 390, h: 400 }, timeoutMs: 2000, contenedor: cont })
    const iframe = cont.querySelector('iframe')!; expect(iframe.style.width).toBe('390px'); expect(iframe.style.height).toBe('400px'); expect(iframe.name).toBe('rc-stepup')
    const form = submit.mock.instances[0] as unknown as HTMLFormElement
    expect((form.querySelector('input[name=JWT]') as HTMLInputElement).value).toBe('jwt.stepup'); expect((form.querySelector('input[name=MD]') as HTMLInputElement).value).toBe('att-1')
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://evil.example', data: { tipo: 'renovacell-3ds-return' } }))
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://proy.supabase.co', data: { tipo: 'otra-cosa' } }))
    await esperar(5)
    let resuelto = false; void p.then(() => { resuelto = true }); await esperar(5); expect(resuelto).toBe(false)
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://proy.supabase.co', data: { tipo: 'renovacell-3ds-return' } }))
    window.dispatchEvent(new MessageEvent('message', { origin: 'https://proy.supabase.co', data: { tipo: 'renovacell-3ds-return' } }))
    expect(await p).toEqual({ regreso: true })
    expect(cont.querySelector('iframe')).toBeNull()
    submit.mockRestore()
  })
  it('timeout (el doctor abandona el reto) → sin regreso; URL fuera de Cardinal → no monta nada', async () => {
    const cont = document.createElement('div'); document.body.appendChild(cont)
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => {})
    expect(await ejecutarStepUp({ url: 'https://centinelapistag.cardinalcommerce.com/V2/Cruise/StepUp', token: 'j', md: 'a', retornoOrigen: 'https://proy.supabase.co', ventana: null, timeoutMs: 20, contenedor: cont })).toEqual({ regreso: false })
    submit.mockClear()
    expect(await ejecutarStepUp({ url: 'https://evil.example/stepup', token: 'j', md: 'a', retornoOrigen: 'https://proy.supabase.co', ventana: null, timeoutMs: 20, contenedor: cont })).toEqual({ regreso: false })
    expect(submit).not.toHaveBeenCalled()
    submit.mockRestore()
  })
})

describe('CS-1A.4 · campos del navegador', () => {
  it('solo datos no sensibles del navegador', () => {
    const d = recolectarDispositivo()
    expect(Object.keys(d).sort()).toEqual(['httpBrowserColorDepth', 'httpBrowserJavaEnabled', 'httpBrowserJavaScriptEnabled', 'httpBrowserLanguage', 'httpBrowserScreenHeight', 'httpBrowserScreenWidth', 'httpBrowserTimeDifference'])
    expect(d.httpBrowserJavaScriptEnabled).toBe(true)
  })
})
