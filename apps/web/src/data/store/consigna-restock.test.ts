// Consignación · "pedir reabasto": el vendedor avisa a Almacén/Dirección (sin mover
// inventario). Verifica que la notificación se genera con la audiencia correcta.
import { describe, it, expect } from 'vitest'
import { requestRestock, LOW_CONSIGNA } from './consignaStore'
import { getSnapshot as notifications } from './notificationsStore'

describe('consignación · pedir reabasto', () => {
  it('LOW_CONSIGNA es un umbral pequeño de saldo bajo', () => {
    expect(LOW_CONSIGNA).toBeGreaterThan(0)
    expect(LOW_CONSIGNA).toBeLessThanOrEqual(10)
  })

  it('notifica a Almacén y Dirección y apunta a su pantalla de consignación', () => {
    requestRestock('ventas1@renovacell.mx', 'p-mgp-90', 'Mascarilla GP')
    const n = notifications().find((x) => x.text.includes('reabasto') && x.text.includes('Mascarilla GP'))
    expect(n).toBeTruthy()
    expect(n!.roles).toContain('warehouse')
    expect(n!.roles).toContain('admin')
    expect(n!.screen).toBe('consigna_alm')
  })
})
