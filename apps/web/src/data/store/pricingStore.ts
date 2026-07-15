// PRECIOS POR CLIENTE (listas/niveles). La lista "General" (is_default) usa el precio
// BASE del producto; las demás guardan overrides en product_prices. El doctor solo ve
// (RLS) los precios de SU lista → priceFor(productId, base) resuelve su precio sin
// conocer el listId. El admin gestiona listas y precios (pasa listId explícito).
import { hasSupabase, supabase } from '../../lib/supabase'
import { makeLive } from './live'

export interface PriceList { id: string; name: string; is_default: boolean; sort: number }
export interface ProductPrice { product_id: string; list_id: string; price: number }

const listsLive = makeLive<PriceList>(async () => {
  const { data, error } = await supabase.from('price_lists').select('id, name, is_default, sort').order('sort')
  if (error) throw error
  return (data ?? []).map((l) => ({ id: l.id as string, name: l.name as string, is_default: !!l.is_default, sort: (l.sort as number) ?? 0 }))
}, [])

const pricesLive = makeLive<ProductPrice>(async () => {
  const { data, error } = await supabase.from('product_prices').select('product_id, list_id, price')
  if (error) throw error
  return (data ?? []).map((p) => ({ product_id: p.product_id as string, list_id: p.list_id as string, price: Number(p.price) || 0 }))
}, [])

export function subscribe(cb: () => void): () => void {
  const u1 = listsLive.subscribe(cb)
  const u2 = pricesLive.subscribe(cb)
  return () => { u1(); u2() }
}
export const getLists = (): PriceList[] => listsLive.getSnapshot()
export const getPrices = (): ProductPrice[] => pricesLive.getSnapshot()

// Precio de un producto. Sin listId (Portal del Doctor): usa las filas que la RLS le
// deja ver = SU lista. Con listId (admin): esa lista. Si no hay override → precio base.
export function priceFor(productId: string, base: number | null, listId?: string): number | null {
  const rows = pricesLive.current()
  const row = listId
    ? rows.find((r) => r.product_id === productId && r.list_id === listId)
    : rows.find((r) => r.product_id === productId)
  return row ? row.price : base
}

// Admin: fija/actualiza (o borra si price=null) el precio de un producto en una lista.
export function setListPrice(productId: string, listId: string, price: number | null): void {
  const rest = pricesLive.current().filter((r) => !(r.product_id === productId && r.list_id === listId))
  if (price == null || Number.isNaN(price)) {
    pricesLive.setLocal(rest)
    if (hasSupabase) supabase.from('product_prices').delete().eq('product_id', productId).eq('list_id', listId).then(({ error }) => { if (error) console.warn('[pricing] del', error.message); pricesLive.reload() })
    return
  }
  pricesLive.setLocal([...rest, { product_id: productId, list_id: listId, price }])
  if (hasSupabase) supabase.from('product_prices').upsert({ product_id: productId, list_id: listId, price, updated_at: new Date().toISOString() }, { onConflict: 'product_id,list_id' }).then(({ error }) => { if (error) console.warn('[pricing] upsert', error.message); pricesLive.reload() })
}

export function createList(name: string): string {
  const id = hasSupabase ? (globalThis.crypto?.randomUUID?.() ?? `pl-${Date.now()}`) : `pl-${Date.now()}`
  const sort = listsLive.current().length
  listsLive.setLocal([...listsLive.current(), { id, name, is_default: false, sort }])
  if (hasSupabase) supabase.from('price_lists').insert({ id, name, sort }).then(({ error }) => { if (error) console.warn('[pricing] createList', error.message); listsLive.reload() })
  return id
}

export function renameList(id: string, name: string): void {
  listsLive.setLocal(listsLive.current().map((l) => (l.id === id ? { ...l, name } : l)))
  if (hasSupabase) supabase.from('price_lists').update({ name }).eq('id', id).then(({ error }) => { if (error) console.warn('[pricing] rename', error.message); listsLive.reload() })
}

export function deleteList(id: string): void {
  listsLive.setLocal(listsLive.current().filter((l) => l.id !== id))
  if (hasSupabase) supabase.from('price_lists').delete().eq('id', id).then(({ error }) => { if (error) console.warn('[pricing] delList', error.message); listsLive.reload() })
}

// Asigna una lista de precios a un doctor (profiles.price_list_id). Admin por RLS.
export function assignDoctorList(doctorId: string, listId: string | null): void {
  if (hasSupabase) supabase.from('profiles').update({ price_list_id: listId }).eq('id', doctorId).then(({ error }) => { if (error) console.warn('[pricing] assign', error.message) })
}
