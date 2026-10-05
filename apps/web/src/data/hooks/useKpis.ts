// W5 · KPIs de cabecera para las pantallas. Con backend responde el SERVIDOR
// (`kpi_*`); sin backend (demo) se calculan con el espejo de `data/kpis.ts`.
//
// Tres estados, nunca un cero inventado:
//   · loading → la pantalla muestra "…"
//   · error   → la pantalla muestra "No disponible" y el motivo
//   · data    → la cifra
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { hasSupabase } from '../../lib/supabase'
import { subscribe as subOrders, getSnapshotAll as snapOrders } from '../store/ordersStore'
import { subscribe as subRefunds, getSnapshot as snapRefunds } from '../store/refundsStore'
import { subscribe as subGastos, getSnapshot as snapGastos } from '../store/gastosStore'
import { subscribe as subLots, getSnapshotMovements as snapMovs } from '../store/lotsStore'
import { subscribeMoney, getMoneySnapshot, subscribeEntries, getEntriesSnapshot } from '../store/moneyStore'
import { useOrderMoney } from './useMoney'
import { entriesFromOrders } from '../ops/moneyMock'
import { leerKpiVentas, leerKpiPorCobrar, leerKpiResultado, type LecturaKpi } from '../ops/kpis'
import { calcularVentas, calcularPorCobrar, calcularResultado, type KpiVentas, type KpiPorCobrar, type KpiResultado } from '../kpis'
import { diaNegocio, type Periodo } from '../periodo'

export interface EstadoKpi<T> { data: T | null; loading: boolean; error: string | null }

// Pide al servidor y vuelve a pedir cuando cambia el periodo o cuando cualquiera de los
// datos de origen se recargó (`version`): tras registrar un cobro o un gasto, la cifra
// de cabecera se actualiza sola. Una respuesta vieja nunca pisa a una nueva.
function useServidor<T>(clave: string, version: unknown, pedir: () => Promise<LecturaKpi<T>>): EstadoKpi<T> {
  const [estado, setEstado] = useState<EstadoKpi<T>>({ data: null, loading: hasSupabase, error: null })
  useEffect(() => {
    if (!hasSupabase) return
    let vigente = true
    setEstado((e) => ({ ...e, loading: true }))
    void pedir().then((r) => {
      if (!vigente) return
      setEstado(r.ok ? { data: r.data, loading: false, error: null } : { data: null, loading: false, error: r.error })
    })
    return () => { vigente = false }
    // `pedir` se rearma en cada render; lo que decide repetir es la clave y la versión.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, version])
  return estado
}

/** Ventas y cobranza de un periodo. */
export function useKpiVentas(p: Periodo): EstadoKpi<KpiVentas> {
  const orders = useSyncExternalStore(subOrders, snapOrders, snapOrders)
  const refunds = useSyncExternalStore(subRefunds, snapRefunds, snapRefunds)
  const dinero = useSyncExternalStore(subscribeMoney, getMoneySnapshot, getMoneySnapshot)
  const asientos = useSyncExternalStore(subscribeEntries, getEntriesSnapshot, getEntriesSnapshot)
  const { byOrder } = useOrderMoney()
  const version = useMemo(() => ({}), [orders, refunds, dinero, asientos])
  const servidor = useServidor(p.clave, version, () => leerKpiVentas(p))
  const demo = useMemo(() => {
    if (hasSupabase) return null
    return calcularVentas({ orders, entries: entriesFromOrders(orders, refunds, diaNegocio), money: byOrder }, p)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, refunds, byOrder, p.clave])
  return hasSupabase ? servidor : { data: demo, loading: false, error: null }
}

/** Por cobrar: posición a hoy. */
export function useKpiPorCobrar(): EstadoKpi<KpiPorCobrar> {
  const orders = useSyncExternalStore(subOrders, snapOrders, snapOrders)
  const dinero = useSyncExternalStore(subscribeMoney, getMoneySnapshot, getMoneySnapshot)
  const { byOrder } = useOrderMoney()
  const version = useMemo(() => ({}), [orders, dinero])
  const servidor = useServidor('por_cobrar', version, () => leerKpiPorCobrar())
  const demo = useMemo(() => (hasSupabase ? null : calcularPorCobrar(orders, byOrder)), [orders, byOrder])
  return hasSupabase ? servidor : { data: demo, loading: false, error: null }
}

/** Resultado del periodo (costo y utilidad). Solo Dirección. */
export function useKpiResultado(p: Periodo): EstadoKpi<KpiResultado> {
  const orders = useSyncExternalStore(subOrders, snapOrders, snapOrders)
  const refunds = useSyncExternalStore(subRefunds, snapRefunds, snapRefunds)
  const gastos = useSyncExternalStore(subGastos, snapGastos, snapGastos)
  const movements = useSyncExternalStore(subLots, snapMovs, snapMovs)
  const version = useMemo(() => ({}), [orders, refunds, gastos, movements])
  const servidor = useServidor(p.clave, version, () => leerKpiResultado(p))
  const demo = useMemo(() => {
    if (hasSupabase) return null
    return calcularResultado({ orders, refunds, movements, gastos }, p)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orders, refunds, movements, gastos, p.clave])
  return hasSupabase ? servidor : { data: demo, loading: false, error: null }
}
