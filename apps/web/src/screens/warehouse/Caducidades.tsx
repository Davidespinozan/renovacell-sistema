// Caducidades: lotes ordenados por fecha de caducidad, con alerta de los más
// cercanos (y de los ya caducados).
import React, { useMemo } from 'react'
import { Icon } from '../../app/icons'
import { PageHead } from '../../app/PageHead'
import { ExportButton } from '../../app/ExportButton'
import { fmtDate } from '../../lib/format'
import { useLots } from '../../data/hooks/useLots'
import { useProducts } from '../../data/hooks/useProducts'
import { daysUntil, severity, sevPill, sevLabel } from './expiry'
import type { ProductSafe } from '../../data/types'

export function Caducidades() {
  const { data: lots, adjust } = useLots()
  const { data: products } = useProducts()

  const darDeBaja = (lotId: string, code: string, qty: number) => {
    if (window.confirm(`¿Dar de baja el lote ${code}? Se retiran ${qty} u del inventario (merma).`)) {
      adjust(lotId, -qty, 'merma', code)
    }
  }

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
      <PageHead title="Por caducar">
        Lotes ordenados por fecha de caducidad: arriba lo más urgente. Procura que salga primero
        lo que está por vencer; si ya caducó, dalo de baja para que no se cuente como disponible.
      </PageHead>

      {urgent.length > 0 && (
        <div className="alert">
          <div className="ico"><Icon name="clock" /></div>
          <div className="x">
            <b>{urgent.length} lote(s) necesitan atención.</b> Hay producto caducado o que vence en menos de 60 días. Dale salida o retíralo.
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '14px 16px 0', display: 'flex' }}>
          <ExportButton
            name="por-caducar"
            style={{ marginLeft: 'auto' }}
            rows={rows.map(({ lot, d }) => ({ producto: byId[lot.product_id]?.name ?? 'Producto', lote: lot.lot_code, caduca: lot.expiry_date, estado: sevLabel(d), cantidad: lot.quantity }))}
            columns={[
              { key: 'producto', label: 'Producto' },
              { key: 'lote', label: 'Lote' },
              { key: 'caduca', label: 'Caduca', format: (v) => (v ? fmtDate(v as string) : '') },
              { key: 'estado', label: 'Estado' },
              { key: 'cantidad', label: 'Cantidad' },
            ]}
          />
        </div>
        <div style={{ padding: '8px 14px 0' }}>
          <table className="tbl-cards">
            <thead>
              <tr><th>Producto</th><th>Lote</th><th>Caduca</th><th>Estado</th><th>Cantidad</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map(({ lot, d }) => {
                const sev = severity(d)
                return (
                  <tr key={lot.id}>
                    <td data-label="Producto">{byId[lot.product_id]?.name ?? 'Producto'}</td>
                    <td data-label="Lote"><span className="lc">{lot.lot_code}</span></td>
                    <td data-label="Caducidad">{fmtDate(lot.expiry_date ?? '')}</td>
                    <td data-label="Estado"><span className={'pill ' + sevPill(sev)}>{sevLabel(d)}</span></td>
                    <td data-label="Cantidad" className="mono">{lot.quantity} {lot.quantity === 1 ? 'pza' : 'pzas'}</td>
                    <td data-label="" style={{ textAlign: 'right' }}>
                      <button className="btn ghost sm" type="button" style={{ color: 'var(--danger)' }} onClick={() => darDeBaja(lot.id, lot.lot_code, lot.quantity)}>Dar de baja</button>
                    </td>
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
