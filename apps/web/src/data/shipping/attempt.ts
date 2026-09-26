// Máquina de estados PURA del intento de guía (Shipping P0). Espejo de la orquestación del edge
// `shipping` (create_shipment). Garantiza el invariante: NUNCA se compra una segunda guía por
// doble clic / carrera / timeout / fallo local. Mantener en sync con supabase/functions/shipping.
export type AttemptStatus = 'pending' | 'succeeded' | 'failed_safe_to_retry' | 'unknown_requires_reconciliation'

// Fase alcanzada al intentar crear la guía.
export type ProviderPhase =
  | 'rate_failed'          // falló la (re)cotización, ANTES de crear → seguro reintentar
  | 'service_not_available'// el serviceCode no está en la re-cotización → seguro reintentar
  | 'create_rejected'      // DHL respondió rechazo confirmado (non-2xx) → seguro reintentar
  | 'create_timeout'       // excepción durante el POST de creación → DESCONOCIDO
  | 'create_no_tracking'   // DHL 2xx sin número de guía → DESCONOCIDO
  | 'finalize_failed'      // éxito en DHL pero falló el guardado local → DESCONOCIDO
  | 'success'              // guía creada y persistida

export interface ProviderGate { callProvider: boolean; result: 'idempotent' | 'in_progress' | 'unknown_requires_reconciliation' | 'proceed' }

// ¿Se puede llamar al proveedor? Solo si NO hay guía ni intento activo/desconocido.
export function providerGate(o: { existingShipment: boolean; activeAttempt?: AttemptStatus | null }): ProviderGate {
  if (o.existingShipment) return { callProvider: false, result: 'idempotent' }
  if (o.activeAttempt === 'unknown_requires_reconciliation') return { callProvider: false, result: 'unknown_requires_reconciliation' }
  if (o.activeAttempt === 'pending' || o.activeAttempt === 'succeeded') return { callProvider: false, result: 'in_progress' }
  return { callProvider: true, result: 'proceed' }
}

// Estado final del intento según la fase. D/E (desconocido) NUNCA se convierten en retry normal.
export function attemptStatusForPhase(phase: ProviderPhase): AttemptStatus {
  switch (phase) {
    case 'rate_failed':
    case 'service_not_available':
    case 'create_rejected':
      return 'failed_safe_to_retry'
    case 'create_timeout':
    case 'create_no_tracking':
    case 'finalize_failed':
      return 'unknown_requires_reconciliation'
    case 'success':
      return 'succeeded'
  }
}

// Solo un intento 'failed_safe_to_retry' permite reintentar (volver a llamar a DHL).
export function retryCallsProvider(status: AttemptStatus): boolean {
  return status === 'failed_safe_to_retry'
}

// AUTORIDAD DE PRECIO: la tarifa la elige el SERVIDOR por serviceCode desde la re-cotización;
// el amount/etaDays del cliente se ignoran. Devuelve la tarifa server o null (→ service_not_available).
export interface ServerRate { id?: string; service?: string; serviceCode?: string; amount: number; currency: string; etaDays: number }
export function chooseServerRate(serverRates: readonly ServerRate[], productCode: string): ServerRate | null {
  return serverRates.find((r) => String(r.serviceCode) === productCode) ?? null
}

// Costo persistido: SIEMPRE desde la tarifa del servidor (nunca del cliente). customer_charge NO
// aplica en Fase 1 (Shipping no cobra flete) → null.
export function persistedCost(serverRate: ServerRate): { provider_cost: number; currency: string; customer_charge: null } {
  return { provider_cost: serverRate.amount, currency: serverRate.currency, customer_charge: null }
}
