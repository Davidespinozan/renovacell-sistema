// Cierres de caja (arqueo). W2 · el ESPERADO ya NO lo manda el cliente: lo calcula el
// servidor desde el libro de dinero (`registrar_corte_caja` → `efectivo_esperado`). El
// cajero solo declara el FONDO y lo CONTADO; si hay diferencia, el motivo es obligatorio.
// Un corte no se borra: se ANULA con un contra-registro (`anular_corte_caja`), y solo el
// MÁS RECIENTE del alcance (anular uno intermedio dejaría huecos entre tramos).
//
// D-W2-CASH-CUTOFF · cada corte cierra un TRAMO: el siguiente arquea solo el efectivo
// posterior. El frontend no resta nada — pide el tramo y el esperado al servidor.
import { logAudit } from './auditStore'
import { hasSupabase, supabase } from '../../lib/supabase'
import { makeLive } from './live'
import { registrarCorteCaja as cmdCorte, anularCorteCaja as cmdAnular } from '../ops/money'
import { leerTodo } from './lectura'

export interface Cierre {
  id: string
  fecha: string
  alcance: string
  esperado: number    // efectivo del libro en el alcance (lo calcula el servidor)
  fondo: number       // fondo inicial de cambio con el que abrió el cajón
  contado: number
  diferencia: number  // contado − (esperado + fondo)
  motivo: string | null
  usuario: string
  created_at: string
  voids_closing_id?: string | null  // si viene: este registro ANULA otro corte
  void_reason?: string | null
  // Tramo económico que este corte cerró (D-W2-CASH-CUTOFF): lo fija el servidor.
  cajero?: string | null
  corte_desde?: string | null
  corte_hasta?: string | null
  prev_closing_id?: string | null
}

const live = makeLive<Cierre>(async () => {
  const { data, error } = await leerTodo('los cortes de caja', (a, b) => supabase.from('cash_closings')
    .select('id, fecha, alcance, esperado, fondo, contado, diferencia, motivo, usuario, created_at, voids_closing_id, void_reason, cajero, corte_desde, corte_hasta, prev_closing_id')
    .order('created_at', { ascending: false }).order('id').range(a, b))
  if (error) throw error
  return (data ?? []).map((c) => ({ ...c, fondo: (c as { fondo?: number }).fondo ?? 0 })) as unknown as Cierre[]
}, [])

export const subscribe = live.subscribe
export const getSnapshot = live.getSnapshot

let seq = 0

// ¿Qué cortes siguen VIGENTES? Un corte con anulación (y la anulación misma) no cuenta
// para el punto de corte del arqueo, pero permanece en el historial: nada se borra.
export function anulados(list: Cierre[]): Set<string> {
  const out = new Set<string>()
  list.forEach((c) => { if (c.voids_closing_id) { out.add(c.voids_closing_id); out.add(c.id) } })
  return out
}
export const vigentes = (list: Cierre[]): Cierre[] => { const a = anulados(list); return list.filter((c) => !a.has(c.id)) }

export interface CierreResult { ok: boolean; error?: string; ambiguous?: boolean; cierre?: Cierre }

// REGISTRAR el corte. El `esperado` NO se manda: lo devuelve el servidor y con él se
// arma la fila que se muestra (sin éxito optimista con números inventados).
export async function registrarCierre(opId: string, input: {
  fecha: string; alcance: 'dia' | 'cajero'; fondo: number; contado: number; motivo: string | null; usuario: string; cajero?: string | null
  esperadoDemo?: number
}): Promise<CierreResult> {
  if (!hasSupabase) {
    seq += 1
    const esperado = input.esperadoDemo ?? 0
    const c: Cierre = {
      id: `cc-${seq}`, fecha: input.fecha, alcance: input.alcance, esperado, fondo: input.fondo,
      contado: input.contado, diferencia: input.contado - (esperado + input.fondo),
      motivo: input.motivo, usuario: input.usuario, created_at: new Date().toISOString(),
    }
    live.setLocal([c, ...live.current()])
    bitacora(input.usuario, input.alcance, c.diferencia)
    return { ok: true, cierre: c }
  }

  const r = await cmdCorte(opId, {
    fecha: input.fecha, alcance: input.alcance, fondo: input.fondo, contado: input.contado,
    motivo: input.motivo, cajero: input.cajero ?? null,
  })
  if (!r.ok) return { ok: false, error: r.error, ambiguous: r.ambiguous }
  if (r.status === 'applied') bitacora(input.usuario, input.alcance, r.data.diferencia)
  await live.reload()
  const cierre = live.current().find((c) => c.id === r.data.closing_id)
  return { ok: true, cierre }
}

function bitacora(usuario: string, alcance: string, dif: number) {
  logAudit({ actor: usuario, action: 'Cierre de caja', resource: alcance, detail: dif === 0 ? 'cuadrado' : `${dif > 0 ? 'sobrante' : 'faltante'} $${Math.abs(dif)}` })
}

// ANULAR un corte mal capturado (solo Dirección). No se borra: se registra la anulación
// con motivo, y el arqueo deja de considerar el corte anulado.
export async function anularCierre(opId: string, id: string, motivo: string, usuario?: string): Promise<CierreResult> {
  const c = live.current().find((x) => x.id === id)
  if (!motivo.trim()) return { ok: false, error: 'La anulación necesita un motivo.' }
  if (!hasSupabase) {
    live.setLocal(live.current().filter((x) => x.id !== id))
    logAudit({ actor: usuario ?? c?.usuario ?? 'Administración', action: 'Corte de caja anulado', resource: c?.alcance ?? id, detail: motivo })
    return { ok: true }
  }
  const r = await cmdAnular(opId, { closingId: id, motivo })
  if (!r.ok) return { ok: false, error: r.error, ambiguous: r.ambiguous }
  if (r.status === 'applied') {
    logAudit({ actor: usuario ?? c?.usuario ?? 'Administración', action: 'Corte de caja anulado', resource: c?.alcance ?? id, detail: `${motivo}${c ? ` · contado $${c.contado}` : ''}` })
  }
  await live.reload()
  return { ok: true }
}
