// DIRECCIÓN · Reporte de MERMAS valuadas. El almacén ya da de baja lotes por caducidad/daño
// (ledger inmutable, reason merma/baja); aquí Dirección ve el IMPACTO EN $ (cantidad × costo
// real del lote), por periodo y producto. Antes solo existía la baja, sin reporte ni $.
// SENSIBLE: usa costos → solo Dirección.
import React, { useMemo, useState } from 'react'
import { TriangleAlert } from 'lucide-react'
import { money, fmtDate } from '../../lib/format'
import { ExportButton } from '../../app/ExportButton'
import { useInventory } from '../../data/hooks/useInventory'
import { useLots } from '../../data/hooks/useLots'
import { useProducts } from '../../data/hooks/useProducts'
import { costOf } from '../../data/mock/costs'

const MERMA_REASONS = new Set(['merma', 'baja'])
const reasonLabel = (r: string | null): string => (r === 'baja' ? 'Baja' : r === 'merma' ? 'Merma (caducidad/daño)' : r ?? '—')
const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const ym = (iso: string): string => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` }

export function Mermas() {
  const { data: movements } = useInventory()
  const { data: lots } = useLots()
  const { data: products } = useProducts()
  const [scope, setScope] = useState<'mes' | 'todo'>('mes')

  const now = new Date()
  const curYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const lotById = useMemo(() => Object.fromEntries(lots.map((l) => [l.id, l])), [lots])
  const prodName = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p.name])), [products])

  const rows = useMemo(() => {
    return movements
      .filter((m) => MERMA_REASONS.has(m.reason ?? '') && m.change < 0)
      .filter((m) => scope === 'todo' || ym(m.created_at) === curYm)
      .map((m) => {
        const lot = lotById[m.lot_id]
        const unidades = -m.change
        const costo = lot?.unit_cost ?? costOf(lot?.product_id)
        return {
          id: m.id, fecha: m.created_at,
          producto: prodName[lot?.product_id ?? ''] ?? 'Producto',
          lote: lot?.lot_code ?? '—',
          unidades, motivo: reasonLabel(m.reason),
          valor: unidades * costo,
          referencia: m.reference ?? '',
        }
      })
      .sort((a, b) => (a.fecha < b.fecha ? 1 : -1))
  }, [movements, lotById, prodName, scope, curYm])

  const totalValor = rows.reduce((s, r) => s + r.valor, 0)
  const totalUnid = rows.reduce((s, r) => s + r.unidades, 0)

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <TriangleAlert size={18} />
        <div className="eyebrow" style={{ margin: 0 }}>Dirección · Mermas valuadas</div>
        <div className="seg" style={{ marginLeft: 'auto' }}>
          <button type="button" className={scope === 'mes' ? 'active' : undefined} onClick={() => setScope('mes')}>{MONTHS[now.getMonth()]}</button>
          <button type="button" className={scope === 'todo' ? 'active' : undefined} onClick={() => setScope('todo')}>Histórico</button>
        </div>
      </div>

      <div className="grid sigs">
        <div className="card sig"><div className="chip"><TriangleAlert size={18} /></div><div className="v">{money(totalValor)}</div><div className="k">Pérdida por merma</div><div className="s">{scope === 'mes' ? 'este mes' : 'histórico'} · a costo</div></div>
        <div className="card sig"><div className="chip"><TriangleAlert size={18} /></div><div className="v">{totalUnid}</div><div className="k">Unidades dadas de baja</div><div className="s">caducidad / daño</div></div>
        <div className="card sig"><div className="chip"><TriangleAlert size={18} /></div><div className="v">{rows.length}</div><div className="k">Eventos de merma</div><div className="s">movimientos registrados</div></div>
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '14px 16px 6px', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div className="eyebrow" style={{ margin: 0 }}>Detalle</div>
          <ExportButton
            name="mermas"
            style={{ marginLeft: 'auto' }}
            rows={rows.map((r) => ({ ...r, fecha: r.fecha }))}
            columns={[
              { key: 'fecha', label: 'Fecha', format: (v) => fmtDate(v as string) },
              { key: 'producto', label: 'Producto' },
              { key: 'lote', label: 'Lote' },
              { key: 'unidades', label: 'Unidades' },
              { key: 'motivo', label: 'Motivo' },
              { key: 'valor', label: 'Pérdida ($)' },
              { key: 'referencia', label: 'Referencia' },
            ]}
          />
        </div>
        <div style={{ padding: '0 14px 10px' }}>
          <table className="tbl-cards">
            <thead><tr><th>Fecha</th><th>Producto</th><th>Lote</th><th>Unidades</th><th>Motivo</th><th>Pérdida</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td data-label="Fecha">{fmtDate(r.fecha)}</td>
                  <td data-label="Producto">{r.producto}</td>
                  <td data-label="Lote" className="mono">{r.lote}</td>
                  <td data-label="Unidades" className="mono">{r.unidades}</td>
                  <td data-label="Motivo">{r.motivo}</td>
                  <td data-label="Pérdida" className="mono"><b>{money(r.valor)}</b></td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--ink-3)' }}>Sin mermas registradas {scope === 'mes' ? 'este mes' : ''}.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
