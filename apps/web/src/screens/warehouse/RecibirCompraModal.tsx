// RECIBIR LA COMPRA COMPLETA (27 nov 2026, «sistema sencillo por rol»). Una compra con varios productos se recibía
// producto por producto: una ventana por renglón. Aquí todos los renglones abiertos de la misma compra van en UNA
// pantalla, cada uno con su lote, su caducidad y lo que llegó. Lo que no llegó se deja en blanco y queda por recibir.
// Reglas intactas: cada renglón entra con el comando de siempre (recibir_lote contra SU orden) y su propio op_id, así
// que reintentar no duplica y un renglón que falla no arrastra a los demás. La ventana de un solo producto
// (RecibirMercanciaModal) sigue igual para parciales, excedentes y cierres.
import React, { useState } from 'react'
import { Check, PackageCheck, X } from 'lucide-react'
import { useLots } from '../../data/hooks/useLots'
import { useProducts } from '../../data/hooks/useProducts'
import { hasSupabase } from '../../lib/supabase'
import { newOpId } from '../../data/ops/w1Command'
import { fmtDate } from '../../lib/format'
import { markReceivedLocal, pendingQty, type PurchaseOrder } from '../../data/store/comprasStore'
import { estadoLinea, resumenRecepcion, type CompraPorRecibir } from '../../data/ops/recibirCompra'
import { aInterno, aVista, cantidadVista, esMediaCaja } from '../../lib/cajas'

interface Fila { lote: string; caducidad: string; cantidad: string; hecho: boolean; error: string | null }

export function RecibirCompraModal({ compra, onClose, onDone }: { compra: CompraPorRecibir; onClose: () => void; onDone: (msg: string) => void }) {
  const { recibirLote } = useLots()
  const { data: products } = useProducts()
  const prodDe = (o: PurchaseOrder) => products.find((p) => p.id === o.product_id)
  const [ops] = useState<Record<string, string>>(() => Object.fromEntries(compra.lineas.map((l) => [l.id, newOpId()])))   // un op_id por renglón
  const [filas, setFilas] = useState<Record<string, Fila>>(() => Object.fromEntries(compra.lineas.map((l) => [l.id, { lote: '', caducidad: '', cantidad: String(aVista(prodDe(l), pendingQty(l))), hecho: false, error: null }])))
  const [busy, setBusy] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const set = (id: string, patch: Partial<Fila>) => setFilas((f) => ({ ...f, [id]: { ...f[id], ...patch } }))
  // CAJAS-MEDIOS: en media caja se escribe en cajas (acepta ½) y se manda en internas, igual que la ventana de un producto.
  const interno = (o: PurchaseOrder, c: string) => { const p = prodDe(o); return esMediaCaja(p) ? aInterno(p, Number(c) || 0) : Math.max(0, parseInt(c, 10) || 0) }
  const u = (o: PurchaseOrder, n: number) => { const p = prodDe(o); return esMediaCaja(p) ? cantidadVista(p, n) : `${n} u` }

  const estados = compra.lineas.map((o) => {
    const f = filas[o.id]
    return { o, f, e: f.hecho ? ({ estado: 'hecha' } as const) : estadoLinea({ lote: f.lote, caducidad: f.caducidad, cantidad: interno(o, f.cantidad) }, pendingQty(o)) }
  })
  const listas = estados.filter((x) => x.e.estado === 'lista')
  const falta = estados.find((x) => x.e.estado === 'falta')
  const vacias = estados.filter((x) => x.e.estado === 'vacia').length
  const puede = listas.length > 0 && !falta && !busy
  // Un botón apagado dice qué falta.
  const pista = falta && falta.e.estado === 'falta' ? `A ${falta.o.product_name} le falta ${falta.e.falta}.`
    : listas.length === 0 ? 'Captura el lote y la caducidad de lo que llegó.'
    : vacias ? `${vacias} producto${vacias === 1 ? '' : 's'} sin capturar se queda${vacias === 1 ? '' : 'n'} por recibir.` : null

  const confirmar = async () => {
    if (!puede) return
    setBusy(true); setAviso(null)
    const rs: Array<{ producto: string; ok: boolean; error?: string }> = []
    for (const { o, f } of listas) {
      const n = interno(o, f.cantidad)
      const r = await recibirLote({ product_id: o.product_id, lot_code: f.lote.trim(), expiry_date: f.caducidad, quantity: n, location: null, unit_cost: o.unit_cost, replenishment_id: o.id, kind: 'orden', op_id: ops[o.id] })
      if (r.ok) { if (!hasSupabase) markReceivedLocal(o.id, n); set(o.id, { hecho: true, error: null }) }
      else set(o.id, { error: r.error ?? 'No se pudo recibir.' })
      rs.push({ producto: o.product_name, ok: r.ok, error: r.error })
    }
    setBusy(false)
    const res = resumenRecepcion(rs, vacias)
    if (res.ok) onDone(res.texto)
    else setAviso(res.texto)
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal rc-modal" onClick={(e) => e.stopPropagation()} data-testid="recibir-compra">
        <div className="mhead">
          <div>
            <h3>Recibir la compra completa</h3>
            <div className="ms">{compra.proveedor ?? 'Proveedor'} · registrada el {fmtDate(compra.fecha)} · {compra.lineas.length} productos</div>
          </div>
          <button className="mclose" type="button" aria-label="Cerrar" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mbody">
          <div className="sysnote" style={{ marginBottom: 12 }}><span>Captura el <b>lote</b> y la <b>caducidad</b> que vienen en cada caja. Lo que no llegó déjalo en blanco: queda por recibir.</span></div>
          <div className="rc-filas">
            {estados.map(({ o, f, e }) => (
              <div key={o.id} className={'rc-fila' + (f.hecho ? ' rc-fila--hecha' : '')} data-testid="rc-fila">
                <div className="rc-fila-prod">
                  <b>{o.product_name}</b>
                  <span>{f.hecho ? <><Check size={13} aria-hidden /> Recibido</> : <>Pendiente {u(o, pendingQty(o))}</>}</span>
                </div>
                <label>Lote<input value={f.lote} disabled={f.hecho || busy} onChange={(ev) => set(o.id, { lote: ev.target.value })} placeholder="p. ej. LT-2026-014" aria-label={`Lote de ${o.product_name}`} /></label>
                <label>Caducidad<input type="date" value={f.caducidad} disabled={f.hecho || busy} onChange={(ev) => set(o.id, { caducidad: ev.target.value })} aria-label={`Caducidad de ${o.product_name}`} /></label>
                <label>Llegaron{esMediaCaja(prodDe(o)) ? ' (cajas)' : ''}<input type="number" min={esMediaCaja(prodDe(o)) ? 0.5 : 1} step={esMediaCaja(prodDe(o)) ? 0.5 : 1} value={f.cantidad} disabled={f.hecho || busy} onChange={(ev) => set(o.id, { cantidad: ev.target.value })} aria-label={`Cantidad que llegó de ${o.product_name}`} /></label>
                {f.error && <div className="rc-fila-error" role="alert">{f.error}</div>}
                {e.estado === 'falta' && !f.error && <div className="rc-fila-falta">Falta {e.falta}.</div>}
              </div>
            ))}
          </div>
          {aviso && <div className="sysnote" role="alert" style={{ background: 'var(--danger-bg)', borderColor: 'var(--danger-line)', color: 'var(--danger)', marginTop: 12 }} data-testid="rc-aviso"><span>{aviso}</span></div>}
          {pista && <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 12 }} data-testid="rc-pista">{pista}</div>}
          <div style={{ display: 'flex', gap: 10, marginTop: 14, justifyContent: 'flex-end' }}>
            <button className="btn ghost" type="button" onClick={onClose}>{estados.some((x) => x.f.hecho) ? 'Cerrar' : 'Cancelar'}</button>
            <button className="btn" type="button" disabled={!puede} onClick={() => void confirmar()} data-testid="rc-confirmar">
              <PackageCheck size={15} /> {busy ? 'Registrando…' : aviso ? 'Reintentar lo que falta' : `Confirmar recepción${listas.length ? ` (${listas.length} producto${listas.length === 1 ? '' : 's'})` : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
