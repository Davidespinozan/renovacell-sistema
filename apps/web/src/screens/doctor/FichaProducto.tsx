// IA-VENDEDORA · FICHA DEL PRODUCTO en el catálogo del doctor: qué es (ficha técnica aprobada por Renovacell, según su
// verificación), cuánto cuesta según las piezas (pieza, medio mayoreo, mayoreo, promoción y si se junta con otros
// productos), agregar al pedido y "Preguntar por este producto" (abre el chat con la pregunta escrita). Abrirla es señal:
// queda registrada para la IA y su vendedor.
import React, { useEffect, useState } from 'react'
import { Icon } from '../../app/icons'
import { money } from '../../lib/format'
import { leerFicha as leerPorDefecto, registrarActividad, SECCIONES_FICHA, type Ficha } from '../../data/ops/actividadCatalogo'
import { nombreNivel, promoTiers, volumeTiers, type VolumeRule } from '../../data/ops/volumePricing'
import { pedirAbrirChat } from '../../data/store/chatUiStore'
import type { ProductSafe } from '../../data/types'

export interface Escalon { etiqueta: string; desde: number; precio: number; nota?: string }
/** La escalera de precio que ve el doctor (la misma que cobra el servidor). */
export function escalera(base: number | null, rules: readonly VolumeRule[], productId: string): Escalon[] {
  const out: Escalon[] = []
  if (base != null) out.push({ etiqueta: 'Pieza', desde: 1, precio: base })
  const tiers = volumeTiers(rules, productId).filter((t) => base == null || t.price < base)
  tiers.forEach((t, i) => {
    const nombre = nombreNivel(tiers, i)
    const nota = nombre === 'Mayoreo' ? 'y todo tu pedido pasa a mayoreo'
      : nombre === 'Medio mayoreo' && t.min_quantity === 10 ? 'puedes juntar piezas con otros productos de 10' : undefined
    out.push({ etiqueta: nombre, desde: t.min_quantity, precio: t.price, nota })
  })
  for (const t of promoTiers(rules, productId)) {
    const [, m, d] = (t.promo?.hasta ?? '').slice(0, 10).split('-').map(Number)
    const hasta = m && d ? ` · hasta el ${d} ${['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][m - 1]}` : ''
    out.push({ etiqueta: t.promo?.nombre ?? 'Promoción', desde: t.min_quantity, precio: t.price, nota: `promoción${hasta}` })
  }
  return out
}

export function FichaProducto({ p, precio, verificado, reglas, qty, puedeAgregar, onAdd, onDec, onClose, leer = leerPorDefecto }: {
  p: ProductSafe; precio: number | null; verificado: boolean; reglas: readonly VolumeRule[]; qty: number; puedeAgregar: boolean
  onAdd: () => void; onDec: () => void; onClose: () => void; leer?: typeof leerPorDefecto
}) {
  const [ficha, setFicha] = useState<Ficha | null | undefined>(undefined)
  useEffect(() => {
    let vivo = true
    registrarActividad('ficha', { product_id: p.id })
    void leer(p.id).then((f) => { if (vivo) setFicha(f) })
    return () => { vivo = false }
  }, [p.id, leer])
  const pasos = verificado ? escalera(precio, reglas, p.id) : []
  const secciones = SECCIONES_FICHA.filter(([k]) => ficha?.conocimiento?.[k]?.contenido)
  const folleto = ficha?.folleto_url ?? (p as { brochure_url?: string | null }).brochure_url ?? null
  const preguntar = () => { pedirAbrirChat(`Hola, me interesa ${p.name}. ¿Me das más información?`); onClose() }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal dcat-ficha" role="dialog" aria-modal="true" aria-label={p.name} onClick={(e) => e.stopPropagation()} data-testid="ficha-producto">
        <div className="mhead">
          <div><h3>{p.name}</h3><div className="ms">{[p.category, (p as { odoo_reference?: string | null }).odoo_reference].filter(Boolean).join(' · ')}</div></div>
          <button className="mclose" type="button" aria-label="Cerrar" onClick={onClose}><Icon name="x" /></button>
        </div>
        <div className="mbody" style={{ display: 'grid', gap: 14 }}>
          {p.image_url && <img src={p.image_url} alt={p.name} style={{ width: '100%', maxHeight: 220, objectFit: 'contain', borderRadius: 12, background: 'var(--hueso)' }} />}

          {verificado ? (
            pasos.length > 0 && (
              <section aria-label="Precio por cantidad" data-testid="ficha-escalera">
                <div className="eyebrow" style={{ margin: '0 0 6px' }}>Precio por cantidad</div>
                <div style={{ display: 'grid', gap: 6 }}>
                  {pasos.map((s) => (
                    <div key={s.etiqueta + s.desde} style={{ display: 'flex', alignItems: 'baseline', gap: 8, padding: '8px 10px', borderRadius: 10, background: 'var(--cp-surface, #fff)', border: '1px solid var(--line)' }}>
                      <span style={{ flex: 1 }}><b>{s.etiqueta}</b>{s.desde > 1 ? <span style={{ color: 'var(--ink-3)' }}> · desde {s.desde} piezas</span> : null}
                        {s.nota && <span style={{ display: 'block', fontSize: 12, color: 'var(--green-deep)' }}>{s.nota}</span>}</span>
                      <span className="mono" style={{ fontWeight: 700 }}>{money(s.precio)}<span style={{ fontWeight: 400, fontSize: 12, color: 'var(--ink-3)' }}> c/u</span></span>
                    </div>
                  ))}
                </div>
              </section>
            )
          ) : (
            <div className="sysnote" data-testid="ficha-sin-precio">Los precios y la ficha técnica completa se habilitan al aprobar tu verificación.</div>
          )}

          {ficha === undefined ? <div style={{ color: 'var(--ink-3)', fontSize: 13 }}>Cargando ficha…</div>
            : secciones.length === 0 ? (
              <div className="sysnote" data-testid="ficha-en-preparacion">La ficha técnica de este producto está en preparación. Pregúntanos lo que necesites saber.</div>
            ) : (
              <section aria-label="Ficha técnica" data-testid="ficha-secciones" style={{ display: 'grid', gap: 10 }}>
                {secciones.map(([k, etiqueta]) => (
                  <div key={k}>
                    <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>{etiqueta}</div>
                    <div style={{ fontSize: 14, whiteSpace: 'pre-line' }}>{ficha!.conocimiento[k].contenido}</div>
                  </div>
                ))}
                {(ficha?.disclaimers ?? []).map((d) => <div key={d} style={{ fontSize: 12, color: 'var(--ink-3)' }}>{d}</div>)}
              </section>
            )}
          {folleto && <a className="btn ghost sm" href={folleto} target="_blank" rel="noreferrer" style={{ justifySelf: 'start' }}><Icon name="download" /> Ver folleto</a>}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', borderTop: '1px solid var(--line)', paddingTop: 12 }}>
            {verificado && puedeAgregar && (qty > 0 ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <button className="btn ghost sm" type="button" aria-label="Quitar uno" onClick={onDec}>−</button>
                <b className="mono">{qty}</b>
                <button className="btn ghost sm" type="button" aria-label="Agregar uno" onClick={onAdd}>+</button>
              </span>
            ) : <button className="btn" type="button" onClick={onAdd} data-testid="ficha-agregar"><Icon name="cart" /> Agregar al pedido</button>)}
            <button className="btn ghost" type="button" onClick={preguntar} data-testid="ficha-preguntar" style={{ marginLeft: 'auto' }}><Icon name="chat" /> Preguntar por este producto</button>
          </div>
        </div>
      </div>
    </div>
  )
}
