// @vitest-environment jsdom
// AVISO RUIDOSO · la alarma del equipo suena (tres tonos fuertes), vibra y hace parpadear la pestaña; nunca rompe sin audio.
// El push urgente (no se quita solo, vibra) lo arman la Edge y el service worker.
import { describe, it, expect, vi } from 'vitest'
import { sonarAlarma, KINDS_ALARMA, textoAlarma } from './alarma'
import pushSrc from '../../../../supabase/functions/push/index.ts?raw'
import pushShared from '../../../../supabase/functions/_shared/push.ts?raw'
import sw from '../../public/sw.js?raw'

describe('alarma del equipo', () => {
  it('suena con tres tonos fuertes cuando hay audio, y sin audio no truena', () => {
    const osc = { type: '', frequency: { value: 0 }, connect: vi.fn(() => ({ connect: vi.fn() })), start: vi.fn(), stop: vi.fn() }
    const gain = { gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() }, connect: vi.fn() }
    osc.connect = vi.fn(() => gain) as never
    class FakeCtx { state = 'running'; currentTime = 0; destination = {}; createOscillator() { return osc } createGain() { return gain } resume() { return Promise.resolve() } }
    ;(window as unknown as { AudioContext: unknown }).AudioContext = FakeCtx
    sonarAlarma()
    expect(osc.start).toHaveBeenCalledTimes(3)
    delete (window as unknown as { AudioContext?: unknown }).AudioContext
    expect(() => sonarAlarma()).not.toThrow()
  })
  it('suenan las alertas que piden actuar ya', () => {
    for (const k of ['handoff_asignado', 'retoma', 'cliente_escribe', 'handoff_escalado']) expect(KINDS_ALARMA.has(k)).toBe(true)
    expect(KINDS_ALARMA.has('sesion_por_cerrar')).toBe(false)
    expect(textoAlarma('cliente_escribe')).toMatch(/escribiendo/)
  })
  it('push urgente: la Edge lo marca y el service worker no lo deja ir solo', () => {
    expect(pushSrc).toMatch(/p\?\.action === 'aviso'/); expect(pushSrc).toMatch(/urgente: true/)
    expect(pushShared).toMatch(/o\.para === 'personal' \? \{ urgente: true \}/)
    expect(sw).toMatch(/d\.urgente \? \{ requireInteraction: true, vibrate:/)
  })
})
