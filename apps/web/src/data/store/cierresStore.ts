// Cierres de caja (POS/eventos). Registra el arqueo: esperado (ventas en efectivo)
// vs. contado (lo que el cajero contó), diferencia y motivo. Mock; con Supabase =
// tabla cash_closings. Da control de efectivo y auditoría.
import { logAudit } from './auditStore'

export interface Cierre {
  id: string
  fecha: string          // ISO YYYY-MM-DD del arqueo
  alcance: string        // 'Caja del día' o nombre del evento
  esperado: number       // ventas en efectivo registradas
  contado: number        // efectivo físico contado
  diferencia: number     // contado - esperado
  motivo: string | null  // motivo de la diferencia (si la hay)
  usuario: string        // quién cerró
  created_at: string
}

let cierres: Cierre[] = []
let seq = 0
const listeners = new Set<() => void>()
let snapshot: Cierre[] = []

function emit() { snapshot = [...cierres]; listeners.forEach((l) => l()) }
export function subscribe(cb: () => void): () => void { listeners.add(cb); return () => listeners.delete(cb) }
export const getSnapshot = (): Cierre[] => snapshot

export function registrarCierre(input: { fecha: string; alcance: string; esperado: number; contado: number; motivo: string | null; usuario: string }): Cierre {
  seq += 1
  const c: Cierre = { id: `cc-${seq}`, ...input, diferencia: input.contado - input.esperado, created_at: new Date().toISOString() }
  cierres = [c, ...cierres]
  emit()
  const dif = c.diferencia
  logAudit({ actor: input.usuario, action: 'Cierre de caja', resource: input.alcance, detail: dif === 0 ? 'cuadrado' : `${dif > 0 ? 'sobrante' : 'faltante'} $${Math.abs(dif)}` })
  return c
}
