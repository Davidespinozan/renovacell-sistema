// MIGRACIÓN desde el sistema actual del cliente (Odoo) hacia Renovacell.
//
// Tres cargas, además del catálogo (que vive en productsStore.importCatalog):
//   · Doctores/clientes  → crea su cuenta real y su perfil (queda POR VERIFICAR)
//   · Inventario por lote → existencias iniciales con caducidad (sostiene FEFO y
//     la trazabilidad COFEPRIS desde el día uno)
//   · Costos por producto → habilita el margen en Finanzas
//
// Todas son IDEMPOTENTES: volver a correr el mismo archivo no duplica. Es lo que
// permite migrar por partes, corregir el archivo y reintentar sin ensuciar datos.
import { runW1Command, newOpId } from '../ops/w1Command'
import { hasSupabase, supabase } from '../../lib/supabase'
import { logAudit } from './auditStore'
import { reloadInventory } from './lotsStore'
import type { RejectedRow } from './productsStore'

export interface MigrationResult {
  created: number
  skipped: number   // ya existía (idempotencia)
  errors: string[]
  rejected: RejectedRow[]  // filas que NO entraron (para "Descargar no importados")
}

const empty = (): MigrationResult => ({ created: 0, skipped: 0, errors: [], rejected: [] })
// Registra una fila rechazada: mensaje humano + la fila para poder reexportarla y corregir.
const rej = (res: MigrationResult, fila: Record<string, unknown>, motivo: string) => { res.errors.push(motivo); res.rejected.push({ motivo, fila }) }

// ── DOCTORES / CLIENTES ───────────────────────────────────────────────────────
export interface DoctorRow {
  name: string
  email: string
  phone: string
  organization: string
  cedula: string
  rfc: string
  razonSocial: string
}

// Crea la cuenta real vía la Edge Function `invite-doctor` (service role, solo
// admin). Quedan como NO VERIFICADOS a propósito: migrar un cliente no equivale a
// haber comprobado su cédula. Dirección los verifica después, y así el control
// regulatorio no se salta por la puerta de atrás.
export async function importDoctores(rows: DoctorRow[]): Promise<MigrationResult> {
  const res = empty()
  if (!hasSupabase) { res.errors.push('Sin conexión al sistema: la migración requiere el backend.'); return res }

  const { data: yaHay } = await supabase.from('profiles').select('email').eq('role_id', 'doctor')
  const conocidos = new Set((yaHay ?? []).map((p) => String(p.email ?? '').trim().toLowerCase()).filter(Boolean))

  for (const r of rows) {
    const email = (r.email || '').trim().toLowerCase()
    if (!email) { rej(res, r as unknown as Record<string, unknown>, `${r.name || 'Sin nombre'}: falta el correo (es la llave de la cuenta)`); continue }
    if (conocidos.has(email)) { res.skipped += 1; continue }
    const { data, error } = await supabase.functions.invoke('invite-doctor', {
      body: {
        email,
        full_name: r.name?.trim() || email,
        organization: r.organization?.trim() || null,
        meta: {
          phone: r.phone?.trim() || null,
          cedula: r.cedula?.trim() || null,
          // Datos fiscales con la forma que ya espera la facturación.
          fiscal: (r.rfc || r.razonSocial) ? { rfc: r.rfc?.trim() || '', name: r.razonSocial?.trim() || '' } : undefined,
          migradoDe: 'sistema anterior',
        },
      },
    })
    const err = error?.message ?? (data as { error?: string } | null)?.error
    if (err) { rej(res, r as unknown as Record<string, unknown>, `${r.name || email}: ${err}`); continue }
    conocidos.add(email)
    res.created += 1
  }
  logAudit({ actor: 'Administración', action: 'Doctores migrados', resource: `${res.created} cuentas`, detail: `${res.created} creados · ${res.skipped} ya existían` })
  return res
}

// ── INVENTARIO POR LOTE ───────────────────────────────────────────────────────
export interface LoteRow {
  sku: string
  lote: string
  caducidad: string   // AAAA-MM-DD
  cantidad: number
  ubicacion: string
}

// Da de alta las existencias iniciales igual que lo haría Almacén: crea el lote y
// SU MOVIMIENTO DE ENTRADA. Sin el movimiento, la trazabilidad no podría responder
// "de dónde vino" este lote.
// Traduce los códigos de la RPC importar_lote a mensajes claros.
function traducirLote(msg: string): string {
  if (msg.includes('SKU_INEXISTENTE')) return 'no existe un producto con ese SKU (importa primero el catálogo)'
  if (msg.includes('LOTE_REQUERIDO')) return 'falta el código de lote'
  if (msg.includes('CANTIDAD_INVALIDA')) return 'cantidad inválida'
  if (msg.includes('NO_AUTORIZADO')) return 'solo Dirección puede importar inventario'
  if (msg.includes('CADUCIDAD_REQUERIDA')) return 'falta la caducidad'
  if (msg.includes('CADUCIDAD_INVALIDA')) return 'la caducidad no es una fecha válida (AAAA-MM-DD)'
  if (msg.includes('CADUCADO_NO_RECIBIBLE')) return 'el lote ya está caducado; no entra como stock'
  if (msg.includes('LOTE_CADUCIDAD_DISTINTA')) return 'ese lote ya existe con otra caducidad'
  return ''
}
// ── FECHAS DE CADUCIDAD SIN AMBIGÜEDAD (ensayo 2 nov 2026) ─────────────────────────────────────────────────
// El servidor convertía la fecha con el estilo de EE. UU. (mes/día): "06/07/2027" (6 de julio en México) se guardaba
// como 7 de junio, sin avisar. Aquí se lee como se escribe en México y se manda SIEMPRE como AAAA-MM-DD; lo que no se
// pueda leer con certeza se rechaza con su motivo (nunca se adivina).
const MESES: Record<string, number> = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12,
  jan: 1, apr: 4, aug: 8, dec: 12 }
const iso = (y: number, m: number, d: number): string | null => {
  if (y < 100) y += 2000
  const t = new Date(Date.UTC(y, m - 1, d))
  if (y < 2000 || y > 2100 || t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}
export function fechaCaducidadIso(raw: string): string | null {
  const v = String(raw ?? '').trim().toLowerCase()
  if (!v) return null
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(v)                       // 2027-06-30 · 2027/06/30
  if (m) return iso(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/.exec(v)                    // 30/06/2027 · 30-06-27 (día/mes/año)
  if (m) return iso(+m[3], +m[2], +m[1])
  m = /^(\d{1,2})[-/. ]+([a-záéíóú]{3,})\.?[-/. ]+(?:de[ ]+)?(\d{2}|\d{4})$/.exec(v.replace(/ de /g, ' '))   // 30-jun-2027 · 30 junio 2027
  if (m) { const mes = MESES[m[2].normalize('NFD').replace(/[\u0300-\u036f]/g, '').slice(0, 3)]; return mes ? iso(+m[3], mes, +m[1]) : null }
  m = /^(\d{2})\/(\d{4})$/.exec(v) ?? /^(\d{1,2})[-/](\d{4})$/.exec(v)            // 06/2027: sin día no se adivina
  if (m) return null
  if (/^\d{5}$/.test(v)) { const t = new Date(Date.UTC(1899, 11, 30) + Number(v) * 86_400_000); return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate()) }   // número de serie de Excel
  return null
}

/** Junta las filas repetidas del MISMO lote (mismo SKU y código) sumando piezas; si traen caducidades distintas, el lote
 *  se rechaza completo (no se sabe cuál es la buena). Antes la segunda fila se descartaba como "ya existía". */
export function agruparLotes(rows: LoteRow[]): { filas: LoteRow[]; conflictos: Array<{ fila: LoteRow; motivo: string }> } {
  const porClave = new Map<string, LoteRow>(); const malas = new Set<string>(); const conflictos: Array<{ fila: LoteRow; motivo: string }> = []
  for (const r of rows) {
    const k = `${r.sku.trim().toLowerCase()}|${r.lote.trim().toLowerCase().replace(/\s+/g, ' ')}`
    const ya = porClave.get(k)
    if (!ya) { porClave.set(k, { ...r }); continue }
    if (ya.caducidad !== r.caducidad) { malas.add(k); conflictos.push({ fila: r, motivo: `Lote ${r.lote}: aparece con dos caducidades distintas (${ya.caducidad} y ${r.caducidad})` }); continue }
    ya.cantidad = (Number(ya.cantidad) || 0) + (Number(r.cantidad) || 0)
  }
  for (const k of malas) { const f = porClave.get(k); if (f) conflictos.push({ fila: f, motivo: `Lote ${f.lote}: aparece con dos caducidades distintas` }); porClave.delete(k) }
  return { filas: [...porClave.values()], conflictos }
}

export async function importLotes(rows: LoteRow[]): Promise<MigrationResult> {
  const res = empty()
  if (!hasSupabase) { res.errors.push('Sin conexión al sistema: la migración requiere el backend.'); return res }

  // Cada lote entra por la RPC `importar_lote`: crea el lote y su movimiento de
  // entrada en UNA transacción (nunca un lote huérfano sin movimiento) y es
  // idempotente (si ya existe, lo omite). Una fila mala no tumba las demás.
  // W1: carga inicial = entrada sin orden → solo Dirección (lo impone el servidor), caducidad
  // ESTRICTA (una fecha inválida ya no entra como NULL). Idempotencia: el servidor omite un lote
  // ya existente ('skipped'), así que re-subir el mismo archivo tras una respuesta ambigua no duplica.
  const normalizadas: LoteRow[] = []
  for (const r of rows) {
    const cad = fechaCaducidadIso(r.caducidad)
    const original = String(r.caducidad ?? '').replace(/ \(no se entiende\)$/, '').trim()
    if (!cad) { rej(res, r as unknown as Record<string, unknown>, original ? `Lote ${r.lote || '?'}: no se entiende la caducidad "${original}" (usa día/mes/año, p. ej. 30/06/2027)` : `Lote ${r.lote || '?'}: falta la caducidad`); continue }
    normalizadas.push({ ...r, caducidad: cad })
  }
  const { filas, conflictos } = agruparLotes(normalizadas)
  for (const c of conflictos) rej(res, c.fila as unknown as Record<string, unknown>, c.motivo)
  for (const r of filas) {
    const opId = newOpId()
    const out = await runW1Command<{ result?: string }>('importar_lote', {
      p_op_id: opId,
      p_sku: (r.sku || '').trim(),
      p_lote: (r.lote || '').trim(),
      p_caducidad: (r.caducidad || '').trim(),
      p_cantidad: Math.trunc(Number(r.cantidad) || 0),
    }, opId)
    if (!out.ok) { rej(res, r as unknown as Record<string, unknown>, `Lote ${r.lote || '?'}: ${out.ambiguous ? out.error : traducirLote(out.code ? out.code + ': ' : '') || out.error}`); continue }
    if (out.data.result === 'skipped') { res.skipped += 1; continue }
    res.created += 1
  }
  reloadInventory()
  logAudit({ actor: 'Administración', action: 'Inventario migrado', resource: `${res.created} lotes`, detail: `${res.created} creados · ${res.skipped} ya existían` })
  return res
}

// ── COSTOS POR PRODUCTO ───────────────────────────────────────────────────────
export interface CostoRow { sku: string; costo: number }

// Habilita el margen en Finanzas. Se guarda en la tabla separada `product_costs`,
// que solo Dirección puede leer (el costo nunca viaja al catálogo del doctor).
export async function importCostos(rows: CostoRow[]): Promise<MigrationResult> {
  const res = empty()
  if (!hasSupabase) { res.errors.push('Sin conexión al sistema: la migración requiere el backend.'); return res }

  const { data: prods } = await supabase.from('products').select('id, sku')
  const porSku = new Map((prods ?? []).map((p) => [String(p.sku ?? '').trim().toLowerCase(), p.id as string]))

  for (const r of rows) {
    const sku = (r.sku || '').trim()
    const productId = porSku.get(sku.toLowerCase())
    if (!productId) { rej(res, r as unknown as Record<string, unknown>, `No existe un producto con SKU "${sku}"`); continue }
    if (!Number.isFinite(r.costo) || r.costo < 0) { rej(res, r as unknown as Record<string, unknown>, `SKU ${sku}: costo inválido`); continue }
    const { error } = await supabase.from('product_costs').upsert({ product_id: productId, unit_cost: r.costo }, { onConflict: 'product_id' })
    if (error) { rej(res, r as unknown as Record<string, unknown>, `SKU ${sku}: ${error.message}`); continue }
    res.created += 1
  }
  logAudit({ actor: 'Administración', action: 'Costos migrados', resource: `${res.created} productos`, detail: `${res.created} costos cargados` })
  return res
}