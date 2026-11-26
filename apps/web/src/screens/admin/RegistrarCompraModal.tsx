// COMPRA CON FACTURA (26 nov 2026, dueño): registrar lo que se le compró a un proveedor, con todos sus renglones, desde
// el XML del CFDI (exacto), desde el PDF (lo lee la IA y se revisa) o a mano. La factura NO es obligatoria. Cada renglón
// queda «por recibir» para Almacén; el producto elegido para cada renglón se recuerda para la siguiente factura.
import React, { useEffect, useMemo, useState } from 'react'
import { FileUp, Plus, Trash2, X } from 'lucide-react'
import { money } from '../../lib/format'
import { newOpId } from '../../data/ops/w1Command'
import { crearCompra, leerEquivalencias, leerPdfFactura, leerXmlCfdi, subirArchivoCompra, sugerirProducto, type CabeceraCompra, type FacturaLeida } from '../../data/ops/compraFactura'
import type { ProductSafe } from '../../data/types'

interface Fila { key: string; product_id: string; qty: string; unit_cost: string; descripcion: string; clave: string | null }
const filaVacia = (): Fila => ({ key: crypto.randomUUID(), product_id: '', qty: '', unit_cost: '', descripcion: '', clave: null })

export function RegistrarCompraModal({ productos, onClose, onHecho }: { productos: ProductSafe[]; onClose: () => void; onHecho: (texto: string) => void }) {
  const [cab, setCab] = useState<CabeceraCompra>({ proveedor: '', proveedor_rfc: null, factura_folio: null, factura_uuid: null, factura_fecha: null, origen: 'manual', archivo_path: null })
  const [filas, setFilas] = useState<Fila[]>([filaVacia()])
  const [equiv, setEquiv] = useState<Array<{ proveedor_rfc: string; clave: string; product_id: string }>>([])
  const [leyendo, setLeyendo] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [op] = useState(() => newOpId())
  useEffect(() => { void leerEquivalencias().then(setEquiv) }, [])

  const catalogo = useMemo(() => productos.filter((p) => p.active !== false).sort((a, b) => a.name.localeCompare(b.name)), [productos])
  const total = filas.reduce((s, f) => s + (Number(f.qty) || 0) * (Number(f.unit_cost) || 0), 0)
  const listo = cab.proveedor.trim().length >= 2 && filas.length > 0 && filas.every((f) => f.product_id && Number(f.qty) > 0 && Number(f.unit_cost) > 0)
  const set = (k: string, patch: Partial<Fila>) => setFilas((xs) => xs.map((f) => (f.key === k ? { ...f, ...patch } : f)))

  const aplicar = (f: FacturaLeida, origen: 'xml' | 'pdf', path: string) => {
    setCab((c) => ({ ...c, proveedor: f.proveedor || c.proveedor, proveedor_rfc: f.rfc, factura_folio: f.folio, factura_uuid: f.uuid, factura_fecha: f.fecha, subtotal: f.subtotal, total: f.total, origen, archivo_path: path }))
    if (f.renglones.length) {
      setFilas(f.renglones.map((r) => ({ key: crypto.randomUUID(), product_id: sugerirProducto(r, f.rfc, catalogo, equiv) ?? '', qty: String(Math.round(r.cantidad)), unit_cost: r.costo_unitario ? String(r.costo_unitario) : '', descripcion: r.descripcion, clave: r.clave })))
    }
    const sinProducto = f.renglones.filter((r) => !sugerirProducto(r, f.rfc, catalogo, equiv)).length
    setAviso(`Se leyeron ${f.renglones.length} renglones${origen === 'pdf' ? ' del PDF (revísalos: los leyó la IA)' : ' del XML'}.${sinProducto ? ` Elige el producto en ${sinProducto} renglón${sinProducto === 1 ? '' : 'es'}.` : ''} Revisa cantidades y costos antes de registrar.`)
  }

  const cargarArchivo = async (file: File) => {
    setError(null); setAviso(null)
    if (file.size > 10 * 1024 * 1024) { setError('El archivo pesa más de 10 MB.'); return }
    setLeyendo('Subiendo la factura…')
    const up = await subirArchivoCompra(file)
    if (!up.ok) { setLeyendo(null); setError(up.error); return }
    if (up.path.endsWith('.xml')) {
      const f = leerXmlCfdi(await file.text())
      setLeyendo(null)
      if (!f) { setCab((c) => ({ ...c, archivo_path: up.path })); setError('Ese XML no parece un CFDI; la factura quedó adjunta, captura los renglones a mano.'); return }
      aplicar(f, 'xml', up.path); return
    }
    if (up.path.endsWith('.pdf')) {
      setLeyendo('Leyendo el PDF con la IA… (puede tardar unos segundos)')
      const r = await leerPdfFactura(up.path)
      setLeyendo(null)
      if (r.ok) aplicar(r.factura, 'pdf', up.path)
      else { setCab((c) => ({ ...c, archivo_path: up.path, origen: 'pdf' })); setError(`${r.error} La factura quedó adjunta.`) }
      return
    }
    setLeyendo(null); setCab((c) => ({ ...c, archivo_path: up.path })); setAviso('La imagen quedó adjunta; captura los renglones a mano.')
  }

  const guardar = async () => {
    setGuardando(true); setError(null)
    const r = await crearCompra(op, { ...cab, proveedor: cab.proveedor.trim(), total: cab.total ?? Math.round(total * 100) / 100 },
      filas.map((f) => ({ product_id: f.product_id, qty: Math.round(Number(f.qty)), unit_cost: Number(f.unit_cost), descripcion: f.descripcion || null, clave: f.clave })))
    setGuardando(false)
    if (!r.ok) { setError(r.error); return }
    onHecho(`Compra registrada: ${r.renglones} producto${r.renglones === 1 ? '' : 's'} por recibir. Almacén ya la ve en «Recibir mercancía».`)
  }

  const inp: React.CSSProperties = { padding: '7px 9px', border: '1px solid var(--line)', borderRadius: 9, fontSize: 13, background: 'var(--cp-surface)', fontFamily: 'inherit', width: '100%' }
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 860 }} onClick={(e) => e.stopPropagation()} data-testid="registrar-compra">
        <div className="mhead"><h3>Registrar compra a proveedor</h3><button className="mclose" type="button" aria-label="Cerrar" onClick={onClose}><X size={16} /></button></div>
        <div className="mbody" style={{ display: 'grid', gap: 12 }}>
          <label className="sysnote" style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }} data-testid="compra-archivo">
            <FileUp size={18} aria-hidden />
            <span style={{ flex: 1 }}><b>Factura del proveedor (opcional):</b> sube el <b>XML</b> (se lee exacto) o el <b>PDF</b> (lo lee la IA). También puedes capturar todo a mano.</span>
            <input type="file" accept=".xml,.pdf,application/pdf,text/xml,application/xml,image/jpeg,image/png" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void cargarArchivo(f) }} />
            <span className="btn ghost sm">Elegir archivo</span>
          </label>
          {leyendo && <div style={{ fontSize: 13, color: 'var(--ink-3)' }} role="status">{leyendo}</div>}
          {aviso && <div className="sysnote" role="status" data-testid="compra-aviso">{aviso}</div>}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
            <label style={{ fontSize: 12 }}>Proveedor *<input style={inp} value={cab.proveedor} onChange={(e) => setCab({ ...cab, proveedor: e.target.value })} data-testid="compra-proveedor" /></label>
            <label style={{ fontSize: 12 }}>RFC<input style={inp} value={cab.proveedor_rfc ?? ''} onChange={(e) => setCab({ ...cab, proveedor_rfc: e.target.value.toUpperCase() || null })} /></label>
            <label style={{ fontSize: 12 }}>Folio de la factura<input style={inp} value={cab.factura_folio ?? ''} onChange={(e) => setCab({ ...cab, factura_folio: e.target.value || null })} /></label>
            <label style={{ fontSize: 12 }}>Fecha<input type="date" style={inp} value={cab.factura_fecha ?? ''} onChange={(e) => setCab({ ...cab, factura_fecha: e.target.value || null })} /></label>
          </div>
          {cab.factura_uuid && <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Folio fiscal: <span className="mono">{cab.factura_uuid}</span></div>}

          <div style={{ display: 'grid', gap: 6 }}>
            <div className="eyebrow">Productos</div>
            {filas.map((f) => (
              <div key={f.key} style={{ display: 'grid', gridTemplateColumns: 'minmax(180px, 2fr) 90px 120px 32px', gap: 6, alignItems: 'end' }} data-testid="compra-renglon">
                <label style={{ fontSize: 12 }}>{f.descripcion ? <span style={{ color: 'var(--ink-3)' }}>Factura: {f.descripcion}</span> : 'Producto *'}
                  <select style={{ ...inp, borderColor: f.product_id ? 'var(--line)' : 'var(--warn)' }} value={f.product_id} onChange={(e) => set(f.key, { product_id: e.target.value })} data-testid="compra-producto">
                    <option value="">Elige el producto…</option>
                    {catalogo.map((p) => <option key={p.id} value={p.id}>{p.name}{p.sku ? ` · ${p.sku}` : ''}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: 12 }}>Cantidad<input style={inp} inputMode="numeric" value={f.qty} onChange={(e) => set(f.key, { qty: e.target.value.replace(/[^0-9]/g, '') })} data-testid="compra-cantidad" /></label>
                <label style={{ fontSize: 12 }}>Costo unitario<input style={inp} inputMode="decimal" value={f.unit_cost} onChange={(e) => set(f.key, { unit_cost: e.target.value.replace(/[^0-9.]/g, '') })} data-testid="compra-costo" /></label>
                <button type="button" className="btn ghost sm" aria-label="Quitar renglón" disabled={filas.length === 1} onClick={() => setFilas((xs) => xs.filter((x) => x.key !== f.key))}><Trash2 size={14} /></button>
              </div>
            ))}
            <div><button type="button" className="btn ghost sm" onClick={() => setFilas((xs) => [...xs, filaVacia()])} data-testid="compra-agregar"><Plus size={14} /> Agregar producto</button></div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13.5 }}>
            <span style={{ color: 'var(--ink-3)' }}>Costo sin IVA. No suma inventario hasta que Almacén recibe con lote y caducidad.</span>
            <span>Total <b className="mono">{money(total)}</b>{cab.subtotal ? <span style={{ color: 'var(--ink-3)' }}> · factura {money(cab.subtotal)}</span> : null}</span>
          </div>
          {error && <div role="alert" style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--danger-bg)', color: 'var(--danger)', fontSize: 13 }}>{error}</div>}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button className="btn ghost" type="button" onClick={onClose}>Cancelar</button>
            <button className="btn" type="button" disabled={!listo || guardando || !!leyendo} onClick={() => void guardar()} data-testid="compra-registrar">{guardando ? 'Registrando…' : 'Registrar compra'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
