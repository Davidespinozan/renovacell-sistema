// DESCUENTOS POR CANTIDAD (product_volume_prices) — data layer del admin. La RLS es la
// autoridad de escritura (admin/billing por policy pvp_write); el cálculo definitivo de
// cobro lo hace el servidor con precio_de(product,list,qty). Aquí solo administramos las
// reglas (CRUD) y auditamos. Toda mutación queda en bitácora.
import { hasSupabase, supabase } from '../../lib/supabase'
import { logAudit } from './auditStore'
import { makeLive } from './live'
import { validateVolumeRule, type VolumeRule } from '../ops/volumePricing'
import { confirmar } from './escritura'

// `product_volume_prices` es de una migración posterior a database.types → acceso
// destipado ACOTADO (misma técnica que el RPC nuevo). No usa `any` suelto.
interface PvpQuery {
  select(cols: string): { order(c: string): { order(c: string): Promise<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }> } }
  insert(v: Record<string, unknown>): Promise<{ error: { message: string } | null }>
  update(v: Record<string, unknown>): { eq(c: string, val: string): Promise<{ error: { message: string } | null }> }
  delete(): { eq(c: string, val: string): Promise<{ error: { message: string } | null }> }
}
const pvp = (): PvpQuery => (supabase.from as unknown as (t: string) => PvpQuery)('product_volume_prices')

const live = makeLive<VolumeRule>(async () => {
  const { data, error } = await pvp().select('id, product_id, min_quantity, price, discount_percent, active').order('product_id').order('min_quantity')
  if (error) throw new Error(error.message)
  return (data ?? []).map((r) => ({
    id: r.id as string, product_id: r.product_id as string, min_quantity: Number(r.min_quantity),
    price: Number(r.price), discount_percent: r.discount_percent == null ? null : Number(r.discount_percent), active: !!r.active,
  }))
}, [])

export const subscribe = live.subscribe
export const getSnapshot = live.getSnapshot
export const getVolumeRules = (): VolumeRule[] => live.getSnapshot()

const genId = (): string => globalThis.crypto?.randomUUID?.() ?? `vp-${Date.now()}`

// W4: estas funciones devolvían `{ ok: true }` ANTES de que el servidor respondiera, y
// auditaban antes de confirmar. Ahora la respuesta `ok` significa lo que dice.
type Resultado = { ok: boolean; error?: string; id?: string }

export async function createVolumeRule(input: { product_id: string; product_name?: string; min_quantity: number; price: number; discount_percent?: number | null }): Promise<Resultado> {
  const err = validateVolumeRule(live.current(), input)
  if (err) return { ok: false, error: err }
  const id = genId()
  const row: VolumeRule = { id, product_id: input.product_id, min_quantity: input.min_quantity, price: input.price, discount_percent: input.discount_percent ?? null, active: true }
  if (hasSupabase) {
    const r = await confirmar('crear el descuento por cantidad',
      pvp().insert({ id, product_id: input.product_id, min_quantity: input.min_quantity, price: input.price, discount_percent: input.discount_percent ?? null, active: true }))
    if (!r.ok) return { ok: false, error: r.error }
  }
  live.setLocal([...live.current(), row])
  logAudit({ actor: 'Administración', action: 'Regla de volumen creada', resource: input.product_name ?? input.product_id, detail: `desde ${input.min_quantity} → $${input.price}` })
  return { ok: true, id }
}

export async function updateVolumeRule(id: string, patch: { min_quantity?: number; price?: number; discount_percent?: number | null }, productName?: string): Promise<Resultado> {
  const cur = live.current().find((r) => r.id === id)
  if (!cur) return { ok: false, error: 'Regla no encontrada.' }
  const next = { product_id: cur.product_id, min_quantity: patch.min_quantity ?? cur.min_quantity, price: patch.price ?? cur.price }
  const err = validateVolumeRule(live.current(), next, id)
  if (err) return { ok: false, error: err }
  const before = `desde ${cur.min_quantity} → $${cur.price}`
  const merged: VolumeRule = { ...cur, ...next, discount_percent: patch.discount_percent !== undefined ? patch.discount_percent : cur.discount_percent }
  if (hasSupabase) {
    const r = await confirmar('guardar el descuento por cantidad',
      pvp().update({ min_quantity: merged.min_quantity, price: merged.price, discount_percent: merged.discount_percent, updated_at: new Date().toISOString() }).eq('id', id))
    if (!r.ok) return { ok: false, error: r.error }
  }
  live.setLocal(live.current().map((r) => (r.id === id ? merged : r)))
  logAudit({ actor: 'Administración', action: 'Regla de volumen editada', resource: productName ?? cur.product_id, detail: `${before} ⇒ desde ${merged.min_quantity} → $${merged.price}` })
  return { ok: true }
}

export async function setVolumeActive(id: string, active: boolean, productName?: string): Promise<Resultado> {
  const cur = live.current().find((r) => r.id === id)
  if (!cur) return { ok: false, error: 'Regla no encontrada.' }
  if (hasSupabase) {
    const r = await confirmar(active ? 'activar el descuento por cantidad' : 'desactivar el descuento por cantidad',
      pvp().update({ active, updated_at: new Date().toISOString() }).eq('id', id))
    if (!r.ok) return { ok: false, error: r.error }
  }
  live.setLocal(live.current().map((r) => (r.id === id ? { ...r, active } : r)))
  logAudit({ actor: 'Administración', action: active ? 'Regla de volumen activada' : 'Regla de volumen desactivada', resource: productName ?? cur.product_id, detail: `desde ${cur.min_quantity}` })
  return { ok: true }
}

export async function deleteVolumeRule(id: string, productName?: string): Promise<Resultado> {
  const cur = live.current().find((r) => r.id === id)
  if (!cur) return { ok: false, error: 'Regla no encontrada.' }
  if (hasSupabase) {
    const r = await confirmar('eliminar el descuento por cantidad', pvp().delete().eq('id', id))
    if (!r.ok) return { ok: false, error: r.error }
  }
  live.setLocal(live.current().filter((r) => r.id !== id))
  logAudit({ actor: 'Administración', action: 'Regla de volumen eliminada', resource: productName ?? cur.product_id, detail: `desde ${cur.min_quantity}` })
  return { ok: true }
}
