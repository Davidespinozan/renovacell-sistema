// ADMIN · Listas de precios (niveles) — "precios por cliente" del Portal del Doctor.
// La lista General usa el precio base (products.price, solo lectura aquí); en las demás
// listas se fija un override por producto. Los doctores se asignan a una lista en Doctores.
import React, { useMemo, useState } from 'react'
import { Plus, Trash2, Pencil, Tag, Check } from 'lucide-react'
import { PageHead } from '../../app/PageHead'
import { money } from '../../lib/format'
import { useProducts, isActiveProduct } from '../../data/hooks/useProducts'
import { usePricing } from '../../data/hooks/usePricing'
import { createList, renameList, deleteList, setListPrice } from '../../data/store/pricingStore'

export function Precios() {
  const { data: products } = useProducts()
  const { lists, priceFor } = usePricing()
  const shown = useMemo(() => products.filter(isActiveProduct), [products])

  const ordered = useMemo(() => [...lists].sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.sort - b.sort), [lists])
  const [activeId, setActiveId] = useState<string>('')
  const active = ordered.find((l) => l.id === activeId) ?? ordered[0]
  const [newName, setNewName] = useState('')

  const addList = () => { const n = newName.trim(); if (!n) return; const id = createList(n); setNewName(''); setActiveId(id) }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <PageHead title="Listas de precios">
        Define niveles de precio (General, Mayoreo, VIP…) y fija el precio de cada producto por lista.
        A cada doctor le asignas una lista desde <b>Doctores</b>; en su portal verá esos precios.
      </PageHead>

      {/* Selector de listas */}
      <div className="card">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {ordered.map((l) => (
            <button key={l.id} type="button" className={'btn sm ' + (active?.id === l.id ? '' : 'ghost')} onClick={() => setActiveId(l.id)}>
              <Tag size={13} /> {l.name}{l.is_default ? ' · base' : ''}
            </button>
          ))}
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addList()} placeholder="Nueva lista (ej. Mayoreo)"
              style={{ padding: '8px 11px', border: '1px solid var(--line)', borderRadius: 10, fontFamily: 'inherit', fontSize: 13, outline: 'none' }} />
            <button className="btn sm" type="button" onClick={addList} disabled={!newName.trim()}><Plus size={14} /> Crear</button>
          </span>
        </div>
        {active && !active.is_default && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            <button className="btn ghost sm" type="button" onClick={() => { const n = window.prompt('Nuevo nombre de la lista', active.name); if (n && n.trim()) renameList(active.id, n.trim()) }}><Pencil size={13} /> Renombrar</button>
            <button className="btn ghost sm" type="button" style={{ color: 'var(--danger)' }} onClick={() => { if (window.confirm(`¿Eliminar la lista "${active.name}"? Los doctores en ella volverán al precio base.`)) { deleteList(active.id); setActiveId('') } }}><Trash2 size={13} /> Eliminar lista</button>
          </div>
        )}
      </div>

      {/* Tabla de precios de la lista activa */}
      {active && (
        <div className="card" style={{ padding: 0 }}>
          <div className="tbl-scroll">
            <table className="tbl-cards">
              <thead><tr><th>Producto</th><th>Precio base</th><th>{active.is_default ? 'Precio' : `Precio en "${active.name}"`}</th></tr></thead>
              <tbody>
                {shown.map((p) => (
                  <PriceRow key={p.id} name={p.name} base={p.price} listId={active.id} isDefault={active.is_default}
                    current={priceFor(p.id, p.price, active.is_default ? undefined : active.id)}
                    onSet={(v) => setListPrice(p.id, active.id, v)} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function PriceRow({ name, base, isDefault, current, onSet }: { name: string; base: number | null; listId: string; isDefault: boolean; current: number | null; onSet: (v: number | null) => void }) {
  // ¿tiene override propio en esta lista? (distinto del base)
  const hasOverride = !isDefault && current != null && current !== base
  const [val, setVal] = useState<string>(hasOverride ? String(current) : '')
  const save = () => { const t = val.trim(); onSet(t === '' ? null : Number(t)) }
  return (
    <tr>
      <td data-label="Producto">{name}</td>
      <td data-label="Precio base" className="mono">{money(base)}</td>
      <td data-label="Precio">
        {isDefault ? (
          <span className="mono" style={{ color: 'var(--ink-3)' }}>{money(base)} (base)</span>
        ) : (
          <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && save()} inputMode="decimal"
              placeholder={base != null ? String(base) : '—'}
              style={{ width: 110, padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 9, fontFamily: 'inherit', fontSize: 13, outline: 'none' }} />
            <button className="btn ghost sm" type="button" title="Guardar" onClick={save}><Check size={13} /></button>
            {hasOverride && <span className="pill p-ok" style={{ fontSize: 10.5 }}>propio</span>}
          </span>
        )}
      </td>
    </tr>
  )
}
