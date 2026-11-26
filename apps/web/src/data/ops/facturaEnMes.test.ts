// FACTURA EN EL MES (26 nov 2026, dueño): solicitud nueva solo hasta el último día del mes de la venta.
import { describe, it, expect } from 'vitest'
import { mensajeDeError } from '../store/escritura'
import mig from '../../../../../supabase/migrations/20270408020000_factura_en_mes.sql?raw'

describe('factura solo dentro del mes de la venta', () => {
  it('el aviso explica la regla y dice las fechas', () => {
    const m = mensajeDeError({ message: 'FACTURA_FUERA_DE_MES: la venta es de 15/10/2026; la factura se pide a más tardar el 31/10/2026 y ahora va en la factura global del mes a público en general', code: '23514' } as never, 'comando')
    expect(m).toMatch(/último día del mes de la venta/)
    expect(m).toMatch(/31\/10\/2026/)
  })
  it('servidor: hora de Culiacán, último día incluido, solo solicitudes nuevas', () => {
    expect(mig).toMatch(/\(o\.created_at at time zone 'America\/Mazatlan'\)::date/)
    expect(mig).toMatch(/if public\.hoy_local\(\) > \(date_trunc\('month', v_venta\) \+ interval '1 month - 1 day'\)::date then/)
    expect(mig.indexOf('FACTURA_FUERA_DE_MES')).toBeGreaterThan(mig.indexOf("v_live.status = 'timbrado'"))
  })
})
