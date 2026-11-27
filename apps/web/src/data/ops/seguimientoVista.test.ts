// SEGUIMIENTO · por dónde viaja y en qué va (27 nov 2026, dueño: «¿por qué en Envíos nada más se pueden ver las entregas
// locales? ¿no tienen manera de ver trazabilidad de envíos foráneos?»). Reglas puras de la pantalla.
import { describe, it, expect } from 'vitest'
import { contar, diagnosticoEnAlmacen, esperaEnAlmacen, etapaDe, medioDe, metodoPrometido } from './seguimientoVista'

const HOY = '2026-11-27'
const AYER = '2026-11-26'
const foraneo = (paqueteria: string, salida = HOY) => ({ entrega: { opcion: 'foraneo', tipo: 'foraneo', paqueteria, salida, llega_desde: salida, llega_hasta: salida } })
const local = (salida = HOY) => ({ entrega: { opcion: 'local', tipo: 'local', paqueteria: 'chofer', salida, llega_desde: salida, llega_hasta: salida, horario: { fecha: salida, inicio: '16:00', fin: '18:00' } } })
const p = (shipping_meta: unknown) => ({ shipping_meta }) as never

describe('por dónde viaja un pedido', () => {
  it('sin envío todavía, manda lo que se prometió al vender', () => {
    expect(medioDe(p(foraneo('dhl')), undefined)).toBe('paqueteria')
    expect(medioDe(p(foraneo('estafeta')), undefined)).toBe('paqueteria')
    expect(medioDe(p(local()), undefined)).toBe('chofer')
    expect(medioDe(p({ method: 'recoge' }), undefined)).toBe('recoge')
    expect(medioDe(p({ entrega: { tipo: 'mostrador' } }), undefined)).toBe('recoge')
    expect(medioDe(p(null), undefined)).toBeNull()                               // sin dato no se inventa
  })
  it('con envío, manda la realidad: un foráneo que al final llevó el chofer es del chofer', () => {
    expect(medioDe(p(foraneo('dhl')), { driver_id: 'drv-1' })).toBe('chofer')
    expect(medioDe(p(local()), { driver_id: null })).toBe('paqueteria')
    expect(medioDe(p(null), { driver_id: null })).toBe('paqueteria')
  })
})

describe('en qué va', () => {
  it('se lee del estado del pedido', () => {
    expect(etapaDe({ status: 'paid' } as never)).toBe('por_preparar')
    expect(etapaDe({ status: 'packed' } as never)).toBe('preparado')
    expect(etapaDe({ status: 'shipped' } as never)).toBe('en_camino')
    expect(etapaDe({ status: 'delivered' } as never)).toBe('entregado')
  })
  it('espera en Almacén: liberado (pagado o con crédito) y sin preparar, enviar ni cancelar', () => {
    expect(esperaEnAlmacen({ status: 'paid', payment_status: 'paid' } as never)).toBe(true)
    expect(esperaEnAlmacen({ status: 'pending_payment', payment_status: 'pending' } as never)).toBe(false)            // sin pago no le toca a Almacén
    expect(esperaEnAlmacen({ status: 'pending_payment', payment_status: 'pending' } as never, { liberado: true })).toBe(true)   // crédito autorizado
    expect(esperaEnAlmacen({ status: 'paid', payment_status: 'paid' } as never, { liberado: false })).toBe(false)     // el libro de dinero manda
    for (const s of ['packed', 'shipped', 'delivered', 'cancelled']) expect(esperaEnAlmacen({ status: s, payment_status: 'paid' } as never)).toBe(false)
  })
})

describe('lo que se dice de un pedido que sigue en Almacén', () => {
  it('el método dice la paquetería prometida y que aún no hay guía', () => {
    expect(metodoPrometido(p(foraneo('dhl')))).toBe('DHL · sin guía todavía')
    expect(metodoPrometido(p(foraneo('estafeta')))).toBe('Estafeta · sin guía todavía')
    expect(metodoPrometido(p(foraneo('etn')))).toBe('ETN · sin guía todavía')
    expect(metodoPrometido(p(local()))).toBe('Chofer · sin asignar')
    expect(metodoPrometido(p({ method: 'recoge' }))).toBe('Recoge en sucursal')
    expect(metodoPrometido(p(null))).toBe('Sin asignar')
  })
  it('si sale hoy o después dice cuándo; si ya pasó su fecha queda detenido con el día en que debió salir', () => {
    const hoy = diagnosticoEnAlmacen(p(foraneo('dhl')), HOY, '15:30')
    expect(hoy).toMatchObject({ stuck: false, statusLabel: 'Por preparar', salida: 'Sale hoy antes de las 3:30 p.m. · DHL' })
    const tarde = diagnosticoEnAlmacen(p(foraneo('dhl', AYER)), HOY, '15:30')
    expect(tarde.stuck).toBe(true)
    expect(tarde.reason).toBe('Sigue en Almacén sin preparar · debió salir el 26/11 · DHL')
    const chofer = diagnosticoEnAlmacen(p(local(AYER)), HOY, '15:30')
    expect(chofer.reason).toBe('Sigue en Almacén sin preparar · debió salir el 26/11 · chofer')
    expect(diagnosticoEnAlmacen(p(null), HOY)).toMatchObject({ stuck: false, salida: null })                          // sin promesa no se inventa fecha
  })
})

describe('las cuentas de las fichas', () => {
  const filas = [
    { medio: 'paqueteria' as const, etapa: 'por_preparar' as const }, { medio: 'paqueteria' as const, etapa: 'por_preparar' as const },
    { medio: 'paqueteria' as const, etapa: 'en_camino' as const }, { medio: 'chofer' as const, etapa: 'entregado' as const },
    { medio: 'recoge' as const, etapa: 'en_camino' as const }, { medio: null, etapa: 'preparado' as const },
  ]
  it('por medio cuenta todo; por etapa cuenta solo lo del medio elegido', () => {
    const todos = contar(filas, 'todos')
    expect(todos.porMedio).toEqual({ paqueteria: 3, chofer: 1, recoge: 1 }); expect(todos.total).toBe(6)
    expect(todos.porEtapa).toEqual({ por_preparar: 2, preparado: 1, en_camino: 2, entregado: 1 })
    expect(contar(filas, 'paqueteria').porEtapa).toEqual({ por_preparar: 2, preparado: 0, en_camino: 1, entregado: 0 })
    expect(contar(filas, 'chofer').porEtapa).toEqual({ por_preparar: 0, preparado: 0, en_camino: 0, entregado: 1 })
  })
})
