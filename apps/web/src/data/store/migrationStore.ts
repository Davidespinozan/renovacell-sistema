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

export interface MigrationResult {
  created: number
  skipped: number   // ya existía (idempotencia)
  errors: string[]
}

const empty = (): MigrationResult => ({ created: 0, skipped: 0, errors: [] })

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
    if (!email) { res.errors.push(`${r.name || 'Sin nombre'}: falta el correo (es la llave de la cuenta)`); continue }
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
    if (err) { res.errors.push(`${r.name || email}: ${err}`); continue }
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
export async function importLotes(rows: LoteRow[]): Promise<MigrationResult> {
  const res = empty()
  if (!hasSupabase) { res.errors.push('Sin conexión al sistema: la migración requiere el backend.'); return res }

  const { data: prods } = await supabase.from('products').select('id, sku')
  const porSku = new Map((prods ?? []).map((p) => [String(p.sku ?? '').trim().toLowerCase(), p.id as string]))
  const { data: lotesYa } = await supabase.from('lots').select('lot_code, product_id')
  const existentes = new Set((lotesYa ?? []).map((l) => `${l.product_id}|${String(l.lot_code ?? '').trim().toLowerCase()}`))

  for (const r of rows) {
    const sku = (r.sku || '').trim()
    const productId = porSku.get(sku.toLowerCase())
    if (!productId) { res.errors.push(`Lote ${r.lote || '?'}: no existe un producto con SKU "${sku}" (importa primero el catálogo)`); continue }
    const code = (r.lote || '').trim()
    if (!code) { res.errors.push(`SKU ${sku}: falta el código de lote`); continue }
    if (!Number.isFinite(r.cantidad) || r.cantidad <= 0) { res.errors.push(`Lote ${code}: cantidad inválida`); continue }
    if (existentes.has(`${productId}|${code.toLowerCase()}`)) { res.skipped += 1; continue }

    const ins = await supabase.from('lots').insert({
      product_id: productId, lot_code: code,
      expiry_date: r.caducidad?.trim() || null,
      quantity: r.cantidad,
      location: r.ubicacion?.trim() || 'Bodega central',
    }).select('id').single()
    if (ins.error || !ins.data) { res.errors.push(`Lote ${code}: ${ins.error?.message ?? 'no se pudo crear'}`); continue }

    const mv = await supabase.from('inventory_movements').insert({
      lot_id: ins.data.id, change: r.cantidad, reason: 'entrada', reference: 'MIGRACION',
    })
    if (mv.error) res.errors.push(`Lote ${code}: se creó, pero falló su movimiento de entrada (${mv.error.message})`)
    existentes.add(`${productId}|${code.toLowerCase()}`)
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
    if (!productId) { res.errors.push(`No existe un producto con SKU "${sku}"`); continue }
    if (!Number.isFinite(r.costo) || r.costo < 0) { res.errors.push(`SKU ${sku}: costo inválido`); continue }
    const { error } = await supabase.from('product_costs').upsert({ product_id: productId, unit_cost: r.costo }, { onConflict: 'product_id' })
    if (error) { res.errors.push(`SKU ${sku}: ${error.message}`); continue }
    res.created += 1
  }
  logAudit({ actor: 'Administración', action: 'Costos migrados', resource: `${res.created} productos`, detail: `${res.created} costos cargados` })
  return res
}