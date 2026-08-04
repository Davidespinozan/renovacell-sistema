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
  if (msg.includes('NO_AUTORIZADO')) return 'no tienes permiso para importar inventario'
  return msg
}
export async function importLotes(rows: LoteRow[]): Promise<MigrationResult> {
  const res = empty()
  if (!hasSupabase) { res.errors.push('Sin conexión al sistema: la migración requiere el backend.'); return res }

  // Cada lote entra por la RPC `importar_lote`: crea el lote y su movimiento de
  // entrada en UNA transacción (nunca un lote huérfano sin movimiento) y es
  // idempotente (si ya existe, lo omite). Una fila mala no tumba las demás.
  for (const r of rows) {
    const { data, error } = await supabase.rpc('importar_lote', {
      p_sku: (r.sku || '').trim(),
      p_lote: (r.lote || '').trim(),
      p_caducidad: (r.caducidad || '').trim(),
      p_cantidad: Math.trunc(Number(r.cantidad) || 0),
      p_ubicacion: (r.ubicacion || '').trim(),
    })
    if (error) { rej(res, r as unknown as Record<string, unknown>, `Lote ${r.lote || '?'}: ${traducirLote(error.message)}`); continue }
    if ((data as { result?: string } | null)?.result === 'skipped') { res.skipped += 1; continue }
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