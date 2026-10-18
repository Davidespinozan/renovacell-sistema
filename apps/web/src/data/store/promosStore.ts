// PROMO-1 · Escalones de promoción VIGENTES (promos_vigentes): lo que el catálogo, la caja y el pedido muestran junto al
// precio. El cobro real lo decide el servidor (precio_de/3). Se recarga al entrar y cuando Dirección guarda una promo.
import { makeLive } from './live'
import { promosVigentes, type PromoVigente } from '../ops/promociones'
import type { VolumeRule } from '../ops/volumePricing'

const live = makeLive<PromoVigente>(promosVigentes, [])
export const subscribePromos = live.subscribe
export const getPromosSnapshot = live.getSnapshot
export const recargarPromos = live.reload
/** Solo vista previa de desarrollo (HomePreview): fija promos sin servidor. */
export const _fijarPromosLocal = live.setLocal

/** Las promos como reglas de precio (min_quantity/price) marcadas con `promo`, para los helpers de previsualización. */
export function promosComoReglas(promos: readonly PromoVigente[], listaId?: string | null): VolumeRule[] {
  // Sin saber la lista (caja): se muestran todas; el servidor aplica solo la que corresponda al cobrar.
  return promos
    .filter((p) => !p.listas || listaId === undefined || (listaId != null && p.listas.includes(listaId)))
    .map((p) => ({ id: `promo-${p.promocion_id}-${p.product_id}-${p.min_qty}`, product_id: p.product_id, min_quantity: p.min_qty, price: p.precio, active: true, promo: { nombre: p.nombre, hasta: p.hasta } }))
}
