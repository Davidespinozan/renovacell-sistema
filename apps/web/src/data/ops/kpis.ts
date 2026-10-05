// W5 · Lectura de los KPIs de cabecera. La autoridad es el servidor (`kpi_ventas`,
// `kpi_por_cobrar`, `kpi_resultado`): aquí solo se piden y se VALIDAN.
//
// Falla cerrado: si el servidor no responde, niega el permiso o devuelve algo que no
// es la forma esperada, el resultado es un ERROR — nunca un cero. Una pantalla que
// recibe un error muestra "No disponible"; un cero sería una cifra falsa.
import { supabase, hasSupabase } from '../../lib/supabase'
import type { KpiVentas, KpiPorCobrar, KpiResultado } from '../kpis'
import type { Periodo } from '../periodo'

export type LecturaKpi<T> = { ok: true; data: T } | { ok: false; error: string }
type Rango = Pick<Periodo, 'desde' | 'hasta'>

// Estas tres funciones entran a `database.types.ts` al regenerar los tipos después de
// aplicar la migración W5. Hasta entonces, este es el ÚNICO lugar con tipado manual.
type Rpc = { rpc: (f: string, a?: unknown) => PromiseLike<{ data: unknown; error: { message: string } | null }> }
const rpc = (fn: string, args?: Record<string, unknown>) => (supabase as unknown as Rpc).rpc(fn, args)

const SOLO: Record<string, string> = {
  kpi_ventas: 'Las ventas y la cobranza solo las ven Dirección y Facturación.',
  kpi_por_cobrar: 'El saldo por cobrar solo lo ven Dirección y Facturación.',
  kpi_resultado: 'El costo y la utilidad solo los ve Dirección.',
}
const NO_DISPONIBLE = 'No se pudieron cargar los indicadores. Vuelve a intentarlo.'

async function pedir(fn: string, args?: Record<string, unknown>): Promise<LecturaKpi<Record<string, unknown>>> {
  if (!hasSupabase) return { ok: false, error: 'Sin conexión con el servidor.' }
  try {
    const { data, error } = await rpc(fn, args)
    if (error) return { ok: false, error: /NO_AUTORIZADO|permission denied/i.test(error.message) ? (SOLO[fn] ?? NO_DISPONIBLE) : NO_DISPONIBLE }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: NO_DISPONIBLE }
    return { ok: true, data: data as Record<string, unknown> }
  } catch {
    return { ok: false, error: NO_DISPONIBLE }
  }
}

// Toda llave numérica debe venir como número finito; una nulable puede venir null.
function numeros<K extends string>(d: Record<string, unknown>, llaves: readonly K[]): Record<K, number> | null {
  const out = {} as Record<K, number>
  for (const k of llaves) {
    const v = d[k]
    if (v === null || v === undefined || v === '') return null
    const n = Number(v)
    if (!Number.isFinite(n)) return null
    out[k] = n
  }
  return out
}
function nulables<K extends string>(d: Record<string, unknown>, llaves: readonly K[]): Record<K, number | null> | null {
  const out = {} as Record<K, number | null>
  for (const k of llaves) {
    if (!(k in d)) return null
    const v = d[k]
    if (v === null) { out[k] = null; continue }
    const n = Number(v)
    if (!Number.isFinite(n)) return null
    out[k] = n
  }
  return out
}

const rango = (p: Rango) => ({ p_desde: p.desde ?? undefined, p_hasta: p.hasta ?? undefined })

export async function leerKpiVentas(p: Rango): Promise<LecturaKpi<KpiVentas>> {
  const r = await pedir('kpi_ventas', rango(p))
  if (!r.ok) return r
  const n = numeros(r.data, ['ventas', 'pedidos', 'ticket', 'cobrado_entradas', 'cobrado_salidas', 'cobrado_neto', 'saldo_ventas'] as const)
  return n ? { ok: true, data: n } : { ok: false, error: NO_DISPONIBLE }
}

export async function leerKpiPorCobrar(): Promise<LecturaKpi<KpiPorCobrar>> {
  const r = await pedir('kpi_por_cobrar')
  if (!r.ok) return r
  const n = numeros(r.data, ['total', 'pedidos', 'a_credito', 'vencido'] as const)
  return n ? { ok: true, data: n } : { ok: false, error: NO_DISPONIBLE }
}

export async function leerKpiResultado(p: Rango): Promise<LecturaKpi<KpiResultado>> {
  const r = await pedir('kpi_resultado', rango(p))
  if (!r.ok) return r
  const n = numeros(r.data, ['ventas', 'devoluciones', 'ventas_netas', 'unidades_vendidas', 'unidades_sin_costo',
    'unidades_sin_surtir', 'cobertura_pct', 'costo_ventas_conocido', 'gastos', 'mermas_conocidas', 'merma_unidades_sin_costo'] as const)
  const x = nulables(r.data, ['costo_ventas', 'utilidad_bruta', 'margen_bruto_pct', 'utilidad_neta', 'margen_neto_pct'] as const)
  const ok = r.data.costo_confiable, okNeta = r.data.utilidad_neta_confiable
  if (!n || !x || typeof ok !== 'boolean' || typeof okNeta !== 'boolean') return { ok: false, error: NO_DISPONIBLE }
  // Coherencia: el servidor nunca manda una utilidad cuando declara el costo no confiable.
  // Si llegara, se descarta la respuesta completa en vez de pintarla.
  if ((!ok && (x.utilidad_bruta !== null || x.costo_ventas !== null)) || (!okNeta && x.utilidad_neta !== null)) {
    return { ok: false, error: NO_DISPONIBLE }
  }
  return { ok: true, data: { ...n, ...x, costo_confiable: ok, utilidad_neta_confiable: okNeta } }
}
