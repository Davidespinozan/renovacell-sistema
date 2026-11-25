// AVISO DE AHORRO POR MÁS PIEZAS (2 nov 2026). Al cliente: "Agrega 3 piezas más de X y pagas $… c/u"; al vendedor, la
// misma oportunidad como "Ofrécele…". Una sola fuente de cálculo (oportunidadesVolumen) para todas las pantallas.
import React from 'react'
import { oportunidadesVolumen, textoOportunidad, cajasParaMayoreo, MAYOREO_CAJAS, volumeTiers, type VolumeRule } from '../data/ops/volumePricing'
import { useInfoMayoreo } from '../data/hooks/useInfoMayoreo'
import { useProducts } from '../data/hooks/useProducts'
import { esMediaCaja, numeroVista } from '../lib/cajas'

export function AvisoAhorroVolumen({ lineas, reglas, nombreDe, voz = 'cliente', max = 2, onAgregar, disponible }: {
  lineas: ReadonlyArray<{ product_id: string; qty: number; base: number | null }>
  reglas: readonly VolumeRule[]
  nombreDe: (productId: string) => string
  voz?: 'cliente' | 'vendedor'
  max?: number
  /** Si se da, cada aviso trae un botón para agregar esas piezas de una vez. */
  onAgregar?: (productId: string, piezas: number) => void
  /** Existencia que se puede vender de cada producto: no se sugiere llegar a más piezas de las que hay. */
  disponible?: (productId: string) => number | null
}) {
  const qtyDe = new Map(lineas.map((l) => [l.product_id, l.qty]))
  const { data: productos } = useProducts()
  const info = useInfoMayoreo()
  const ops = oportunidadesVolumen(lineas, reglas, info)
    .filter((o) => { const d = disponible?.(o.product_id); return d == null || (qtyDe.get(o.product_id) ?? 0) + o.faltan <= d })
    .slice(0, max)
  // MAYOREO-50 · cuántas cajas lleva para el mayoreo de todo el pedido (solo si ya va encaminado y aún no llega, y si
  // algún producto del pedido de verdad tiene precio de mayoreo).
  const cajas = cajasParaMayoreo(lineas, info)
  const conMayoreo = lineas.some((l) => l.qty > 0 && info[l.product_id]?.junta_mayoreo !== false && volumeTiers(reglas, l.product_id).some((t) => t.nivel === 'mayoreo'))
  const faltanCajas = conMayoreo && cajas >= 10 && cajas < MAYOREO_CAJAS ? Math.ceil(MAYOREO_CAJAS - cajas) : null
  if (!ops.length && faltanCajas == null) return null
  return (
    <div data-testid="aviso-ahorro-volumen" style={{ marginTop: 10, padding: '9px 11px', borderRadius: 10, background: 'var(--ok-bg, #EAF4EC)', display: 'grid', gap: 6 }}>
      {faltanCajas != null && (
        <div style={{ fontSize: 12.5, color: 'var(--green-deep)' }} data-testid="ahorro-cajas-mayoreo">
          {voz === 'cliente' ? 'Llevas' : 'Lleva'} {Math.floor(cajas * 2) / 2} de {MAYOREO_CAJAS} cajas: con {faltanCajas} {faltanCajas === 1 ? 'caja' : 'cajas'} más (de cualquier producto) todo el pedido va a precio de mayoreo. No cuentan microagujas H24/H36/HR ni Mounjaro, Wegovy y Saxenda.
        </div>
      )}
      {ops.map((o) => (
        <div key={o.product_id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--green-deep)' }} data-testid={`ahorro-${o.product_id}`}>
          <span style={{ flex: 1 }}>{textoOportunidad(o, nombreDe(o.product_id), voz, productos.find((x) => x.id === o.product_id))}</span>
          {onAgregar && (
            <button type="button" className="btn ghost sm" style={{ whiteSpace: 'nowrap' }} onClick={() => onAgregar(o.product_id, o.faltan)} data-testid={`ahorro-agregar-${o.product_id}`}>
              {/* CAJAS-MEDIOS · se muestra en cajas; el clic sigue agregando las unidades internas */}
              {(() => { const p = productos.find((x) => x.id === o.product_id); return esMediaCaja(p) ? `+${numeroVista(p, o.faltan)} caja${o.faltan > 2 ? 's' : ''}` : `+${o.faltan}` })()}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
