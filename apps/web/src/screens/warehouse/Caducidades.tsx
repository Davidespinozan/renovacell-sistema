// Caducidades: lotes ordenados por fecha de caducidad, con alerta de los más
// cercanos (y de los ya caducados).
import React, { useMemo } from 'react'
import { Icon } from '../../app/icons'
import { fmtDate } from '../../lib/format'
import { useLots } from '../../data/hooks/useLots'
import { useProducts } from '../../data/hooks/useProducts'
import { daysUntil, severity, sevPill, sevLabel } from './expiry'
import type { ProductSafe } from '../../data/types'

export function Caducidades() {
  const { data: lots } = useLots()
  const { data: products } = useProducts()

  const byId = useMemo(() => {
    const m: Record<string, ProductSafe | undefined> = {}
    products.forEach((p) => (m[p.id] = p))
    return m
  }, [products])

  const rows = useMemo(
    () =>
      lots
        .filter((l) => l.quantity > 0)
        .map((l) => ({ lot: l, d: daysUntil(l.expiry_date) }))
        .sort((a, b) => (a.d ?? 1e9) - (b.d ?? 1e9)),
    [lots],
  )

  const urgent = rows.filter((r) => severity(r.d) === 'expired' || severity(r.d) === 'critical')

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="eyebrow">Almacén · Caducidades</div>

      {urgent.length > 0 && (
        <div className="alert">
          <div className="ico"><Icon name="clock" /></div>
          <div className="x">
            <b>{urgent.length} lote(s) requieren atención.</b> Hay producto caducado o por vencer en ≤ 60 días. Prioriza su salida o retíralo.
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '8px 14px 0' }}>
          <table>
            <thead>
              <tr><th>Producto</th><th>Lote</th><th>Caducidad</th><th>Restante</th><th>Cant.</th></tr>
            </thead>
            <tbody>
              {rows.map(({ lot, d }) => {
                const sev = severity(d)
                return (
                  <tr key={lot.id}>
                    <td>{byId[lot.product_id]?.name ?? 'Producto'}</td>
                    <td><span className="lc">{lot.lot_code}</span></td>
                    <td>{fmtDate(lot.expiry_date ?? '')}</td>
                    <td><span className={'pill ' + sevPill(sev)}>{sevLabel(d)}</span></td>
                    <td className="mono">{lot.quantity} u</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
