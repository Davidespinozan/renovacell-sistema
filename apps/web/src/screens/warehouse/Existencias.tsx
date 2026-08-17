// Existencias: stock por producto y por LOTE (lote + caducidad + cantidad).
import React, { useMemo, useState } from 'react'
import { Icon } from '../../app/icons'
import { PageHead } from '../../app/PageHead'
import { ExportButton } from '../../app/ExportButton'
import { fmtDate } from '../../lib/format'
import { useLots } from '../../data/hooks/useLots'
import { useProducts } from '../../data/hooks/useProducts'
import { daysUntil, severity, sevPill, sevLabel } from './expiry'
import { MermaModal } from './MermaModal'
import { AjusteModal } from './AjusteModal'
import type { Lot, ProductSafe } from '../../data/types'

type MermaLot = { id: string; lot_code: string; quantity: number; producto?: string }

export function Existencias() {
  const { data: lots } = useLots()
  const { data: products } = useProducts()
  const [mermaLot, setMermaLot] = useState<MermaLot | null>(null)
  const [ajusteLot, setAjusteLot] = useState<MermaLot | null>(null)

  const groups = useMemo(() => {
    const byProduct = new Map<string, Lot[]>()
    lots.forEach((l) => {
      const arr = byProduct.get(l.product_id) ?? []
      arr.push(l)
      byProduct.set(l.product_id, arr)
    })
    return products
      .map((p) => ({ product: p, lots: (byProduct.get(p.id) ?? []).slice().sort(byExpiry) }))
      .filter((g) => g.lots.length > 0)
  }, [lots, products])

  return (
    <div className="grid" style={{ gap: 16 }}>
      <PageHead title="Lo que hay en almacén">
        Todo el producto guardado, agrupado por tipo y por lote. La etiqueta
        <b> Usar primero</b> marca el lote que debe salir antes, porque es el que caduca más pronto.
      </PageHead>
      {groups.length > 0 && (
        <div style={{ display: 'flex' }}>
          <ExportButton
            name="existencias"
            style={{ marginLeft: 'auto' }}
            rows={groups.flatMap((g) => g.lots.map((l) => ({ producto: g.product.name, linea: g.product.line, lote: l.lot_code, caducidad: l.expiry_date, cantidad: l.quantity, ubicacion: l.location })))}
            columns={[
              { key: 'producto', label: 'Producto' },
              { key: 'linea', label: 'Línea', format: (v) => (v === 'cosm' ? 'Home Care' : 'Professional') },
              { key: 'lote', label: 'Lote' },
              { key: 'caducidad', label: 'Caducidad', format: (v) => (v ? fmtDate(v as string) : '') },
              { key: 'cantidad', label: 'Cantidad' },
              { key: 'ubicacion', label: 'Ubicación' },
            ]}
          />
        </div>
      )}
      {groups.map((g) => (
        <ProductStock key={g.product.id} product={g.product} lots={g.lots} onMerma={setMermaLot} onAjuste={setAjusteLot} />
      ))}
      {groups.length === 0 && (
        <div className="card" style={{ textAlign: 'center', color: 'var(--ink-3)' }}>
          Todavía no hay producto en almacén. Regístralo en “Registrar entradas”.
        </div>
      )}

      {mermaLot && <MermaModal lot={mermaLot} onClose={() => setMermaLot(null)} />}
      {ajusteLot && <AjusteModal lot={ajusteLot} onClose={() => setAjusteLot(null)} />}
    </div>
  )
}

function ProductStock({ product, lots, onMerma, onAjuste }: { product: ProductSafe; lots: Lot[]; onMerma: (l: MermaLot) => void; onAjuste: (l: MermaLot) => void }) {
  const total = lots.reduce((s, l) => s + l.quantity, 0)
  const isProf = product.line === 'prof'
  // El lote FEFO = el primero con stock que no esté caducado.
  const fefoId = lots.find((l) => l.quantity > 0 && (daysUntil(l.expiry_date) ?? 1) >= 0)?.id

  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="lotebox">
        <div className="ph">
          <div className="pn">
            {product.name}{' '}
            <span className={'ltag ' + (isProf ? 'prof' : 'cosm')}>{isProf ? 'Professional' : 'Home Care'}</span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{total} {total === 1 ? 'pieza' : 'piezas'}</div>
        </div>
        {lots.map((l) => {
          const d = daysUntil(l.expiry_date)
          const sev = severity(d)
          return (
            <div key={l.id} className="lote">
              <span className="lc" title="Código de lote">{l.lot_code}</span>
              {l.id === fefoId && (
                <span className="fefo"><Icon name="check" /> Usar primero</span>
              )}
              <span style={{ color: 'var(--ink-3)' }}>{fmtDate(l.expiry_date ?? '')}</span>
              <span className={'pill ' + sevPill(sev)}>{sevLabel(d)}</span>
              <span style={{ color: 'var(--ink-3)', fontSize: 12 }}>{l.location}</span>
              <span className="lq">{l.quantity} {l.quantity === 1 ? 'pza' : 'pzas'}</span>
              <button className="btn ghost sm" type="button" title="Corregir conteo (cuadrar contra el físico)" style={{ marginLeft: 'auto' }}
                onClick={() => onAjuste({ id: l.id, lot_code: l.lot_code, quantity: l.quantity, producto: product.name })}>Ajustar</button>
              {l.quantity > 0 && (
                <button className="btn ghost sm" type="button" title="Dar de baja por merma (parcial o total)" style={{ color: 'var(--danger)' }}
                  onClick={() => onMerma({ id: l.id, lot_code: l.lot_code, quantity: l.quantity, producto: product.name })}>Merma</button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function byExpiry(a: Lot, b: Lot): number {
  if (!a.expiry_date) return 1
  if (!b.expiry_date) return -1
  return a.expiry_date < b.expiry_date ? -1 : a.expiry_date > b.expiry_date ? 1 : 0
}
