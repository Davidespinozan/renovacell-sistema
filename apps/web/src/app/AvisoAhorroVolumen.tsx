// AVISO DE AHORRO POR MÁS PIEZAS (2 nov 2026). Al cliente: "Agrega 3 piezas más de X y pagas $… c/u"; al vendedor, la
// misma oportunidad como "Ofrécele…". Una sola fuente de cálculo (oportunidadesVolumen) para todas las pantallas.
import React from 'react'
import { oportunidadesVolumen, textoOportunidad, type VolumeRule } from '../data/ops/volumePricing'

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
  const ops = oportunidadesVolumen(lineas, reglas)
    .filter((o) => { const d = disponible?.(o.product_id); return d == null || (qtyDe.get(o.product_id) ?? 0) + o.faltan <= d })
    .slice(0, max)
  if (!ops.length) return null
  return (
    <div data-testid="aviso-ahorro-volumen" style={{ marginTop: 10, padding: '9px 11px', borderRadius: 10, background: 'var(--ok-bg, #EAF4EC)', display: 'grid', gap: 6 }}>
      {ops.map((o) => (
        <div key={o.product_id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, color: 'var(--green-deep)' }} data-testid={`ahorro-${o.product_id}`}>
          <span style={{ flex: 1 }}>{textoOportunidad(o, nombreDe(o.product_id), voz)}</span>
          {onAgregar && (
            <button type="button" className="btn ghost sm" style={{ whiteSpace: 'nowrap' }} onClick={() => onAgregar(o.product_id, o.faltan)} data-testid={`ahorro-agregar-${o.product_id}`}>
              +{o.faltan}
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
