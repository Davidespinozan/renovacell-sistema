// PROMO-6 · Tarjeta de promoción: la misma pieza en el chat del doctor (mensaje [promo:<id>]) y en la vista previa de
// Dirección. Foto del producto, precio normal tachado, precio promo y escalones; vigencia; botón al catálogo.
import React from 'react'
import { money } from '../lib/format'
import { Icon } from './icons'

export interface ProductoTarjeta { product_id?: string; nombre: string; imagen_url?: string | null; presentacion?: string | null; precio_normal?: number | null; escalones: Array<{ desde: number; precio: number }> }
export interface DatosTarjeta { nombre: string; descripcion?: string | null; vigencia?: string; hasta?: string; productos: ProductoTarjeta[]; flyer_url?: string | null }

/** `densa`: versión del Inicio (PROMO-9): cabecera en una línea, filas más chicas y el pie como enlace, no botón. */
export function TarjetaPromo({ datos, onCatalogo, compacta = false, densa = false }: { datos: DatosTarjeta; onCatalogo?: () => void; compacta?: boolean; densa?: boolean }) {
  const im = densa ? 48 : compacta ? 56 : 72
  return (
    <div className="promo-card" data-testid="tarjeta-promo" style={{ border: '1px solid var(--line)', borderRadius: 16, overflow: 'hidden', background: '#fff', maxWidth: densa ? undefined : compacta ? 420 : 560, boxShadow: densa ? 'var(--sh-card)' : undefined }}>
      <div style={{ background: 'linear-gradient(135deg, #0f3d1d, #007311)', color: '#fff', padding: densa ? '10px 14px' : compacta ? '12px 14px' : '18px 20px', display: densa ? 'flex' : undefined, alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-block', background: '#fff', color: '#005a0d', fontSize: 10, fontWeight: 800, letterSpacing: '1.5px', textTransform: 'uppercase', padding: '3px 8px', borderRadius: 999 }}>Promoción</span>
        <div style={{ fontSize: densa ? 15 : compacta ? 18 : 22, fontWeight: 800, marginTop: densa ? 0 : 6, lineHeight: 1.2 }}>{datos.nombre}</div>
        {datos.vigencia && <div style={{ fontSize: densa ? 12 : 12.5, color: '#d7f0dc', marginTop: densa ? 0 : 4, marginLeft: densa ? 'auto' : undefined }}>{densa ? datos.vigencia : `Válida ${datos.vigencia}`}</div>}
      </div>
      {/* PROMO-9 · el flyer de la promo (pieza vertical) completo, sin recortar */}
      {datos.flyer_url && <div style={{ background: '#0a2412', display: 'grid', placeItems: 'center' }}><img src={datos.flyer_url} alt={`Flyer: ${datos.nombre}`} loading="lazy" style={{ width: '100%', maxHeight: compacta ? 440 : 560, objectFit: 'contain', display: 'block' }} data-testid="tarjeta-promo-flyer" /></div>}
      {datos.descripcion && <div style={{ padding: '10px 14px 0', fontSize: 13, color: 'var(--ink-3)' }}>{datos.descripcion}</div>}
      <div style={{ display: 'grid', gap: densa ? 0 : 8, padding: densa ? '0 14px' : compacta ? 10 : 14 }}>
        {datos.productos.map((p, i) => {
          const base = p.escalones[0]; const resto = p.escalones.slice(1)
          const tachado = p.precio_normal != null && base && Number(p.precio_normal) > Number(base.precio)
          return (
            <div key={p.product_id ?? i} style={densa ? { display: 'flex', gap: 12, alignItems: 'center', padding: '10px 0', borderTop: i === 0 ? 0 : '1px solid var(--line)' } : { display: 'flex', gap: 12, alignItems: 'center', border: '1px solid var(--line)', borderRadius: 12, padding: 10 }} data-testid="tarjeta-promo-producto">
              {p.imagen_url ? <img src={p.imagen_url} alt={p.nombre} width={im} height={im} style={{ objectFit: 'contain', borderRadius: 10, background: 'var(--surface-2, #f6f8f6)', flex: 'none' }} />
                : <div style={{ width: im, height: im, borderRadius: 10, background: 'var(--surface-2, #f6f8f6)', display: 'grid', placeItems: 'center', color: 'var(--ink-3)', flex: 'none' }}><Icon name="bag" /></div>}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: densa ? 14 : 14, lineHeight: 1.25 }}>{p.nombre}</div>
                {p.presentacion && <div style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{p.presentacion}</div>}
                <div style={{ marginTop: 4, display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                  {tachado && <span style={{ fontSize: 12.5, color: 'var(--ink-3)', textDecoration: 'line-through' }}>{money(Number(p.precio_normal))}</span>}
                  {base && <b style={{ fontSize: densa ? 17 : 20, color: 'var(--green-deep)' }}>{money(base.precio)}</b>}
                  {base && base.desde > 1 && <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>desde {base.desde} pzas</span>}
                </div>
                {resto.length > 0 && <div style={{ fontSize: 12, color: 'var(--ink-2)', marginTop: 2 }}>{resto.map((e) => `Desde ${e.desde} pzas: ${money(e.precio)}`).join(' · ')}</div>}
              </div>
            </div>
          )
        })}
      </div>
      {densa ? (
        <div style={{ padding: '4px 14px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderTop: '1px solid var(--line)' }}>
          <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Se aplican solos al pedir.</span>
          {onCatalogo && <button type="button" className="rh-link" onClick={onCatalogo} data-testid="tarjeta-promo-catalogo">Ver el catálogo y pedir <span aria-hidden>›</span></button>}
        </div>
      ) : (
        <div style={{ padding: compacta ? '0 10px 10px' : '0 14px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          {onCatalogo && <button type="button" className="btn sm" onClick={onCatalogo} data-testid="tarjeta-promo-catalogo"><Icon name="bag" /> Ver el catálogo y pedir</button>}
          <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Los precios se aplican solos al hacer tu pedido.</span>
        </div>
      )}
    </div>
  )
}
