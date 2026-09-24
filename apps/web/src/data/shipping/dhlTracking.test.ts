// Normalización del tracking DHL: 404 / "No data found" de una guía válida recién
// creada NO es error, es "sin eventos todavía". Auth/400/5xx SIGUEN siendo error.
import { describe, it, expect } from 'vitest'
import { isTrackingNoData, emptyTrackingResult, parseTracking } from '../../../../../supabase/functions/shipping/dhl'

describe('isTrackingNoData — sin eventos vs error real', () => {
  it('404 → sin datos (no error)', () => {
    expect(isTrackingNoData(404, {})).toBe(true)
    expect(isTrackingNoData(404, { detail: 'No data found' })).toBe(true)
  })
  it('detalle "No data found" (2xx/otros <500) → sin datos', () => {
    expect(isTrackingNoData(200, { detail: 'No data found' })).toBe(true)
  })
  it('auth y request inválido → ERROR real (no normaliza)', () => {
    expect(isTrackingNoData(401, { detail: 'No data found' })).toBe(false)
    expect(isTrackingNoData(403, {})).toBe(false)
    expect(isTrackingNoData(400, { detail: 'Invalid tracking' })).toBe(false)
  })
  it('errores 5xx inesperados → ERROR real', () => {
    expect(isTrackingNoData(500, { detail: 'No data found' })).toBe(false)
    expect(isTrackingNoData(503, {})).toBe(false)
  })
})

describe('emptyTrackingResult — forma de dominio', () => {
  it('tracking reconocido, events [], mensaje amigable', () => {
    const r = emptyTrackingResult('7360109201')
    expect(r.tracking).toBe('7360109201')
    expect(r.events).toEqual([])
    expect(r.status).toBe('sin_eventos')
    expect(r.message).toMatch(/a[uú]n no hay eventos/i)
  })
})

describe('parseTracking — con eventos reales no se rompe', () => {
  it('mapea eventos cuando existen', () => {
    const data = { shipments: [{ status: 'transit', events: [{ timestamp: '2026-09-24T10:00:00', typeCode: 'PU', description: 'Recolectado', location: { address: { addressLocality: 'Culiacán' } } }] }] }
    const t = parseTracking(data)
    expect(t.events.length).toBe(1)
    expect(t.events[0].description).toBe('Recolectado')
  })
})
