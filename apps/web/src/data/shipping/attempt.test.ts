// Shipping P0 — máquina de estados del intento (anti-doble-guía + autoridad de precio).
// Matriz A-O: cada caso demuestra 0 llamadas a DHL o el estado correcto sin recompra.
import { describe, it, expect } from 'vitest'
import { providerGate, attemptStatusForPhase, retryCallsProvider, chooseServerRate, persistedCost } from './attempt'

describe('providerGate — ¿se llama al proveedor?', () => {
  it('H) guía existente → NO llama (idempotente)', () => {
    expect(providerGate({ existingShipment: true })).toEqual({ callProvider: false, result: 'idempotent' })
  })
  it('D/E) intento desconocido → NO llama (requiere reconciliación)', () => {
    expect(providerGate({ existingShipment: false, activeAttempt: 'unknown_requires_reconciliation' }))
      .toEqual({ callProvider: false, result: 'unknown_requires_reconciliation' })
  })
  it('G) intento pending (carrera/doble clic) → NO llama (in_progress)', () => {
    expect(providerGate({ existingShipment: false, activeAttempt: 'pending' }))
      .toEqual({ callProvider: false, result: 'in_progress' })
  })
  it('intento succeeded → NO llama', () => {
    expect(providerGate({ existingShipment: false, activeAttempt: 'succeeded' }).callProvider).toBe(false)
  })
  it('sin guía ni intento activo → procede', () => {
    expect(providerGate({ existingShipment: false, activeAttempt: null })).toEqual({ callProvider: true, result: 'proceed' })
  })
  it('intento previo failed_safe_to_retry → procede (permite reintento)', () => {
    expect(providerGate({ existingShipment: false, activeAttempt: 'failed_safe_to_retry' }).callProvider).toBe(true)
  })
})

describe('attemptStatusForPhase — semántica de fallo', () => {
  it('B) rechazo confirmado de DHL → failed_safe_to_retry', () => {
    expect(attemptStatusForPhase('create_rejected')).toBe('failed_safe_to_retry')
  })
  it('C) fallo de cotización antes de crear → failed_safe_to_retry', () => {
    expect(attemptStatusForPhase('rate_failed')).toBe('failed_safe_to_retry')
  })
  it('K) servicio no disponible → failed_safe_to_retry', () => {
    expect(attemptStatusForPhase('service_not_available')).toBe('failed_safe_to_retry')
  })
  it('D) timeout durante creación → unknown_requires_reconciliation', () => {
    expect(attemptStatusForPhase('create_timeout')).toBe('unknown_requires_reconciliation')
  })
  it('2xx sin tracking → unknown_requires_reconciliation', () => {
    expect(attemptStatusForPhase('create_no_tracking')).toBe('unknown_requires_reconciliation')
  })
  it('E) éxito DHL + fallo de guardado local → unknown_requires_reconciliation', () => {
    expect(attemptStatusForPhase('finalize_failed')).toBe('unknown_requires_reconciliation')
  })
  it('éxito → succeeded', () => {
    expect(attemptStatusForPhase('success')).toBe('succeeded')
  })
})

describe('retry NUNCA re-llama DHL salvo failed_safe_to_retry', () => {
  it('unknown/pending/succeeded no reintentan; failed_safe sí', () => {
    expect(retryCallsProvider('unknown_requires_reconciliation')).toBe(false)
    expect(retryCallsProvider('pending')).toBe(false)
    expect(retryCallsProvider('succeeded')).toBe(false)
    expect(retryCallsProvider('failed_safe_to_retry')).toBe(true)
  })
})

describe('autoridad de precio (P0-B) — el servidor decide, el cliente NO', () => {
  const rates = [
    { serviceCode: 'N', service: 'DHL Nacional', amount: 180, currency: 'MXN', etaDays: 2, id: 'q-N' },
    { serviceCode: 'P', service: 'DHL Prioridad', amount: 320, currency: 'MXN', etaDays: 1, id: 'q-P' },
  ]
  it('I/J) elige tarifa por serviceCode; ignora amount/eta del cliente', () => {
    const chosen = chooseServerRate(rates, 'N')!
    expect(chosen.amount).toBe(180) // no el amount que mande el cliente
    expect(persistedCost(chosen)).toEqual({ provider_cost: 180, currency: 'MXN', customer_charge: null })
  })
  it('K) serviceCode inexistente → null (no se crea guía)', () => {
    expect(chooseServerRate(rates, 'ZZ')).toBeNull()
  })
  it('customer_charge SIEMPRE null en Fase 1 (no se cobra flete)', () => {
    expect(persistedCost(rates[1]).customer_charge).toBeNull()
  })
})
