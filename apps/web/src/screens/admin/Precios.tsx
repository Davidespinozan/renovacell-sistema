// ADMIN · PRECIOS — herramienta operable, dos conceptos SEPARADOS:
//  GENERAL  = precio base comercial del SKU (products.price).
//  (La lista "Mayoreo" por cliente se retiró el 30 oct 2026: el mayoreo es ahora el 2º nivel por cantidad.)
//  DESCUENTOS POR CANTIDAD = reglas por MISMO SKU desde N unidades (product_volume_prices).
// El servidor es la AUTORIDAD del cobro: precio_de(product, list, qty) = LEAST(base, volumen).
// Aquí solo se administran los datos; toda mutación se audita. RLS admin es la autoridad de escritura.
import React, { useMemo, useState } from 'react'
import { confirmar } from '../../app/dialogos'   // CALIDAD VISUAL · diálogos del sistema
import { Plus, Trash2, Pencil, Check, X, Layers, DollarSign } from 'lucide-react'
import { PageHead } from '../../app/PageHead'
import { money } from '../../lib/format'
import { useProducts, isActiveProduct } from '../../data/hooks/useProducts'
import { useVolumePrices } from '../../data/hooks/useVolumePrices'
import { setBasePrice } from '../../data/store/productsStore'
import { volumeTiers, tierDiscountPct, nombreNivel, type VolumeRule } from '../../data/ops/volumePricing'
import type { ProductSafe } from '../../data/types'
import { aInterno, aVista, esMediaCaja, factor, numeroVista, precioVista } from '../../lib/cajas'

// CAJAS-MEDIOS: la media caja se guarda por MEDIA caja (cantidad y precio internos), pero aquí se edita en
// CAJAS: el mínimo se convierte con aInterno y el precio por caja se divide entre el factor al guardar.
const precioInterno = (p: ProductSafe, porCaja: number): number => Math.round((porCaja / factor(p)) * 100) / 100
const NOTA_CAJAS = 'Se vende por media caja; aquí en cajas.'

type Tab = 'general' | 'volumen'
// SKU comercial = producto vendible (no tarjeta visual/variante padre) y activo.
const isSellableSku = (p: ProductSafe): boolean => isActiveProduct(p) && p.sellable !== false

export function Precios() {
  const { data: products } = useProducts()
  const [tab, setTab] = useState<Tab>('general')
  const skus = useMemo(() => products.filter(isSellableSku).sort((a, b) => a.name.localeCompare(b.name)), [products])

  return (
    <div className="grid" style={{ gap: 16 }}>
      <PageHead title="Precios">
        <b>General</b> es el precio normal de cada producto. En <b>Descuentos por cantidad</b> viven el
        <b> medio mayoreo</b> y el <b>mayoreo</b>, desde N piezas del mismo producto. Reglas del pedido: con 50 cajas en el pedido (juntando productos distintos) o si un producto llega a su mayoreo, todo el pedido va a mayoreo (no cuentan microagujas H24/H36/HR ni Mounjaro, Wegovy y Saxenda); los productos con medio mayoreo de 10 piezas se pueden juntar (5 + 5) para el medio mayoreo.
      </PageHead>

      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        {([['general', 'General'], ['volumen', 'Descuentos por cantidad']] as const).map(([k, lbl]) => (
          <button key={k} type="button" className={tab === k ? 'active' : undefined} onClick={() => setTab(k)}>{lbl}</button>
        ))}
      </div>

      {tab === 'general' && <GeneralTab skus={skus} />}
      {tab === 'volumen' && <VolumenTab skus={skus} />}
    </div>
  )
}

// ============================ GENERAL ============================
function GeneralTab({ skus }: { skus: ProductSafe[] }) {
  const [q, setQ] = useState('')
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? skus.filter((p) => `${p.sku} ${p.name}`.toLowerCase().includes(s)) : skus
  }, [skus, q])
  return (
    <div className="card" style={{ padding: 0 }}>
      <div className="filters" style={{ padding: '14px 16px', gap: 12 }}>
        <div className="eyebrow" style={{ margin: 0 }}><DollarSign size={13} /> Precio general (base) · {list.length}</div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar SKU o producto"
          style={{ marginLeft: 'var(--filters-end, auto)', padding: '8px 11px', border: '1px solid var(--line)', borderRadius: 14, fontFamily: 'inherit', fontSize: 13, outline: 'none' }} />
      </div>
      <div className="tbl-scroll">
        <table className="tbl-cards">
          <thead><tr><th>SKU</th><th>Producto</th><th>Precio general</th><th>Estado</th></tr></thead>
          <tbody>{list.map((p) => <GeneralRow key={p.id} p={p} />)}</tbody>
        </table>
      </div>
    </div>
  )
}

function GeneralRow({ p }: { p: ProductSafe }) {
  const [val, setVal] = useState(p.price != null ? String(precioVista(p, p.price)) : '')   // CAJAS-MEDIOS: por caja
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const dirty = val.trim() !== '' && (p.price == null || Number(val) !== precioVista(p, p.price))
  const [guardando, setGuardando] = useState(false)
  const save = async () => {
    const price = precioInterno(p, Number(val))   // CAJAS-MEDIOS
    setGuardando(true); setMsg(null)
    // "Guardado ✓" solo cuando el servidor confirmó: es el precio que se va a cobrar.
    const r = await setBasePrice(p.id, price, p.name)
    setGuardando(false)
    setMsg(r.ok ? { ok: true, text: 'Guardado ✓' } : { ok: false, text: r.error ?? 'No se guardó' })
    if (r.ok) setTimeout(() => setMsg(null), 2000)
  }
  return (
    <tr>
      <td data-label="SKU" className="mono" style={{ fontSize: 12 }}>{p.sku}</td>
      <td data-label="Producto" data-rol="titulo">{p.name}</td>
      <td data-label="Precio general">
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
          <input value={val} onChange={(e) => setVal(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && dirty && save()} inputMode="decimal"
            style={{ width: 110, padding: '7px 10px', border: '1px solid var(--line)', borderRadius: 14, fontFamily: 'inherit', fontSize: 13, outline: 'none' }} />
          <button className="btn ghost sm" type="button" title="Guardar" disabled={!dirty || guardando} onClick={save}><Check size={13} /></button>
          {msg && <span style={{ fontSize: 11.5, color: msg.ok ? 'var(--green-deep)' : 'var(--danger)' }}>{msg.text}</span>}
        </span>
        {esMediaCaja(p) && <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 3 }}>Precio por caja. {NOTA_CAJAS}</div>}
      </td>
      <td data-label="Estado"><span className="pill p-ok" style={{ fontSize: 10.5 }}>Activo</span></td>
    </tr>
  )
}

// ==================== DESCUENTOS POR CANTIDAD ====================
function VolumenTab({ skus }: { skus: ProductSafe[] }) {
  const { data: rules, createVolumeRule, updateVolumeRule, setVolumeActive, deleteVolumeRule } = useVolumePrices()
  const [q, setQ] = useState('')
  // Productos a mostrar: los que ya tienen reglas + los que coincidan con la búsqueda.
  const withRules = useMemo(() => new Set(rules.map((r) => r.product_id)), [rules])
  const list = useMemo(() => {
    const s = q.trim().toLowerCase()
    if (s) return skus.filter((p) => `${p.sku} ${p.name}`.toLowerCase().includes(s))
    return skus.filter((p) => withRules.has(p.id))
  }, [skus, q, withRules])

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="card filters" style={{ gap: 12 }}>
        <div className="eyebrow" style={{ margin: 0 }}><Layers size={13} /> Descuentos por cantidad (por SKU)</div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar SKU o producto para agregar reglas"
          style={{ marginLeft: 'var(--filters-end, auto)', width: 280, maxWidth: '100%', padding: '8px 11px', border: '1px solid var(--line)', borderRadius: 14, fontFamily: 'inherit', fontSize: 13, outline: 'none' }} />
      </div>
      {list.length === 0 && (
        <div className="card" style={{ color: 'var(--ink-3)' }}>
          {q ? 'Sin coincidencias.' : 'Aún no hay reglas de volumen. Busca un producto para crear la primera.'}
        </div>
      )}
      {list.map((p) => (
        <VolumeCard key={p.id} product={p} tiers={volumeTiers(rules, p.id).length ? rules.filter((r) => r.product_id === p.id).sort((a, b) => a.min_quantity - b.min_quantity) : rules.filter((r) => r.product_id === p.id)}
          onCreate={(min, price, nivel) => createVolumeRule({ product_id: p.id, product_name: p.name, min_quantity: min, price, nivel })}
          onUpdate={(id, min, price, nivel) => updateVolumeRule(id, { min_quantity: min, price, nivel }, p.name)}
          onToggle={(id, active) => setVolumeActive(id, active, p.name)}
          onDelete={(id) => deleteVolumeRule(id, p.name)} />
      ))}
    </div>
  )
}

function VolumeCard({ product, tiers, onCreate, onUpdate, onToggle, onDelete }: {
  product: ProductSafe
  tiers: VolumeRule[]
  onCreate: (min: number, price: number, nivel: Nivel) => Promise<{ ok: boolean; error?: string }>
  onUpdate: (id: string, min: number, price: number, nivel: Nivel) => Promise<{ ok: boolean; error?: string }>
  onToggle: (id: string, active: boolean) => Promise<{ ok: boolean; error?: string }>
  onDelete: (id: string) => Promise<{ ok: boolean; error?: string }>
}) {
  const [addMin, setAddMin] = useState('')
  const [addNivel, setAddNivel] = useState<Nivel>(tiers.some((t) => t.active) ? 'mayoreo' : 'medio')
  const [addPrice, setAddPrice] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const cajas = esMediaCaja(product)
  const add = async () => {
    setErr(null)
    const r = await onCreate(aInterno(product, Number(addMin)), precioInterno(product, Number(addPrice)), addNivel)   // CAJAS-MEDIOS
    if (!r.ok) { setErr(r.error ?? 'No se guardó'); return }
    setAddMin(''); setAddPrice('')
  }
  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <b>{product.name}</b>
        <span className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{product.sku}</span>
        <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--ink-2)' }}>General: <b>{money(product.price == null ? product.price : precioVista(product, product.price))}</b>{cajas ? ' por caja' : ''}</span>
      </div>
      {cajas && <div style={{ fontSize: 11.5, color: 'var(--ink-3)', marginTop: 4 }}>{NOTA_CAJAS}</div>}

      <div className="tbl-scroll" style={{ marginTop: 10 }}>
        <table className="tbl-cards">
          <thead><tr><th>Nivel</th><th>{cajas ? 'Desde (cajas)' : 'Desde (pzas)'}</th><th>{cajas ? 'Precio por caja' : 'Precio c/u'}</th><th>Descuento</th><th>Estado</th><th></th></tr></thead>
          <tbody>
            {tiers.map((t) => { const act = tiers.filter((x) => x.active); const i = act.indexOf(t)
              return <TierRow key={t.id} nivel={i >= 0 ? nombreNivel(act, i) : 'Apagado'} tier={t} product={product} base={product.price} onUpdate={onUpdate} onToggle={onToggle} onDelete={onDelete} /> })}
            <tr>
              <td data-label="Nivel"><SelectorNivel value={addNivel} onChange={setAddNivel} /></td>
              <td data-label="Desde"><input value={addMin} onChange={(e) => setAddMin(e.target.value)} inputMode={cajas ? 'decimal' : 'numeric'} placeholder="5" style={inp(70)} /></td>
              <td data-label="Precio c/u"><input value={addPrice} onChange={(e) => setAddPrice(e.target.value)} inputMode="decimal" placeholder="0.00" style={inp(110)} /></td>
              <td data-label="Descuento" className="mono" style={{ color: 'var(--ink-3)' }}>{addPrice && product.price ? (tierDiscountPct(product.price, precioInterno(product, Number(addPrice))) ?? 0) + '%' : '—'}</td>
              <td />
              <td><button className="btn sm" type="button" onClick={add} disabled={!addMin || !addPrice}><Plus size={13} /> Agregar nivel</button></td>
            </tr>
          </tbody>
        </table>
      </div>
      {err && <div role="alert" style={{ color: 'var(--danger)', fontSize: 12.5, marginTop: 8 }}>{err}</div>}
    </div>
  )
}

type Nivel = 'medio' | 'mayoreo'
// MAYOREO-REGLAS · el nivel decide las reglas del pedido: llegar a un MAYOREO pasa todo el pedido a mayoreo; los MEDIO
// mayoreo de 10 piezas se juntan entre productos.
function SelectorNivel({ value, onChange }: { value: Nivel; onChange: (n: Nivel) => void }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as Nivel)} aria-label="Nivel" style={{ padding: '5px 8px', border: '1px solid var(--line)', borderRadius: 10, fontFamily: 'inherit', fontSize: 12.5, backgroundColor: 'var(--cp-surface)' }}>
      <option value="medio">Medio mayoreo</option>
      <option value="mayoreo">Mayoreo</option>
    </select>
  )
}

function TierRow({ nivel, tier, product, base, onUpdate, onToggle, onDelete }: {
  nivel: string; tier: VolumeRule; product: ProductSafe; base: number | null
  onUpdate: (id: string, min: number, price: number, nivel: Nivel) => Promise<{ ok: boolean; error?: string }>
  onToggle: (id: string, active: boolean) => Promise<{ ok: boolean; error?: string }>
  onDelete: (id: string) => Promise<{ ok: boolean; error?: string }>
}) {
  const [edit, setEdit] = useState(false)
  // CAJAS-MEDIOS: se edita en cajas y precio por caja; se guarda interno.
  const minVista = String(aVista(product, tier.min_quantity)), priceVista = String(precioVista(product, tier.price))
  const [min, setMin] = useState(minVista)
  const [price, setPrice] = useState(priceVista)
  const [err, setErr] = useState<string | null>(null)
  const pct = tierDiscountPct(base, tier.price)
  // La fila solo sale del modo edición si el servidor guardó el cambio.
  const [niv, setNiv] = useState<Nivel>(tier.nivel ?? 'medio')
  const save = async () => { setErr(null); const r = await onUpdate(tier.id!, aInterno(product, Number(min)), precioInterno(product, Number(price)), niv); if (!r.ok) { setErr(r.error ?? 'No se guardó'); return } setEdit(false) }
  return (
    <tr style={{ opacity: tier.active ? 1 : 0.55 }}>
      <td data-label="Nivel">{edit ? <SelectorNivel value={niv} onChange={setNiv} /> : <b>{nivel}</b>}</td>
      <td data-label="Desde">{edit ? <input value={min} onChange={(e) => setMin(e.target.value)} inputMode={esMediaCaja(product) ? 'decimal' : 'numeric'} style={inp(70)} /> : <span className="mono">{numeroVista(product, tier.min_quantity)}</span>}</td>
      <td data-label="Precio c/u">{edit ? <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" style={inp(110)} /> : <span className="mono">{money(precioVista(product, tier.price))}</span>}</td>
      <td data-label="Descuento" className="mono" style={{ color: pct ? 'var(--green-deep)' : 'var(--ink-3)' }}>{pct ? pct + '%' : '—'}</td>
      <td data-label="Estado"><span className={'pill ' + (tier.active ? 'p-ok' : 'p-neu')} style={{ fontSize: 10.5 }}>{tier.active ? 'Activo' : 'Inactivo'}</span></td>
      <td>
        <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {edit ? (
            <>
              <button className="btn ghost sm" type="button" title="Guardar" onClick={save}><Check size={13} /></button>
              <button className="btn ghost sm" type="button" title="Cancelar" onClick={() => { setEdit(false); setMin(minVista); setPrice(priceVista) }}><X size={13} /></button>
            </>
          ) : (
            <>
              <button className="btn ghost sm" type="button" onClick={() => setEdit(true)}><Pencil size={12} /> Editar</button>
              <button className="btn ghost sm" type="button" onClick={() => onToggle(tier.id!, !tier.active)}>{tier.active ? 'Desactivar' : 'Activar'}</button>
              <button className="btn ghost sm" type="button" style={{ color: 'var(--danger)' }} onClick={async () => { if ((await confirmar(`¿Eliminar el nivel desde ${numeroVista(product, tier.min_quantity)} ${esMediaCaja(product) ? 'cajas' : 'pzas'}?`))) onDelete(tier.id!) }}><Trash2 size={12} /></button>
            </>
          )}
          {err && <span role="alert" style={{ color: 'var(--danger)', fontSize: 11.5 }}>{err}</span>}
        </span>
      </td>
    </tr>
  )
}

const inp = (w: number): React.CSSProperties => ({ width: w, padding: '6px 9px', border: '1px solid var(--line)', borderRadius: 14, fontFamily: 'inherit', fontSize: 13, outline: 'none' })
