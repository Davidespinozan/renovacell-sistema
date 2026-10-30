// HERRAMIENTAS DEL VENDEDOR · "Productos": por cada producto, qué clientes lo compraron antes, para volver a ofrecérselo.
// Decisión del dueño: cada vendedor ve SOLO su cartera; el jefe de ventas y Dirección, todos (lo decide la base).
import React, { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Mail, Phone, Search, Users } from 'lucide-react'
import { compradoresProducto as compradoresPorDefecto, normalizar, productosCompradores as productosPorDefecto, type Comprador, type ProductoCompradores } from '../../data/ops/busqueda'
import { capitalizarNombre } from '../../lib/nombres'
import { fmtDate } from '../../lib/format'
import { Customer360Page } from '../../app/Customer360'

export function ProductosClientes({ productos = productosPorDefecto, compradores = compradoresPorDefecto }: { productos?: typeof productosPorDefecto; compradores?: typeof compradoresPorDefecto }) {
  const [lista, setLista] = useState<ProductoCompradores[] | null>(null)
  const [error, setError] = useState(false)
  const [q, setQ] = useState('')
  const [soloConCompras, setSoloConCompras] = useState(true)
  const [sel, setSel] = useState<ProductoCompradores | null>(null)
  const [quienes, setQuienes] = useState<Comprador[] | null>(null)
  const [ficha, setFicha] = useState<string | null>(null)
  useEffect(() => { void productos().then((r) => { setLista(r ?? []); setError(r === null) }) }, [productos])
  useEffect(() => { setQuienes(null); if (sel) void compradores(sel.product_id).then((r) => setQuienes(r ?? [])) }, [sel, compradores])
  const visibles = useMemo(() => {
    const b = normalizar(q.trim())
    return (lista ?? []).filter((p) => (!soloConCompras || p.clientes > 0) && (!b || normalizar(`${p.nombre} ${p.sku ?? ''} ${p.categoria ?? ''}`).includes(b)))
  }, [lista, q, soloConCompras])

  if (ficha) return <Customer360Page customerId={ficha} onBack={() => setFicha(null)} />

  if (sel) return (
    <div className="card pcl" data-testid="compradores">
      <button type="button" className="btn ghost sm" onClick={() => setSel(null)} data-testid="compradores-volver"><ArrowLeft size={15} /> Productos</button>
      <h2 className="pcl-t">{sel.nombre}</h2>
      <p className="pcl-sub">Clientes {quienes?.some((c) => c.vendedor) ? '' : 'de tu cartera '}que lo han comprado: ofréceselo de nuevo.</p>
      {quienes === null ? <div className="pcl-vacio">Cargando…</div> : quienes.length === 0 ? <div className="pcl-vacio">Ningún cliente de tu cartera lo ha comprado todavía.</div> : (
        <ul className="pcl-lista">
          {quienes.map((c) => (
            <li key={c.customer_id} className="pcl-item" data-testid="comprador">
              <button type="button" className="pcl-nombre" onClick={() => setFicha(c.customer_id)} title="Ver su ficha">{capitalizarNombre(c.nombre)}</button>
              <span className="pcl-det">Compró {c.veces} {c.veces === 1 ? 'vez' : 'veces'} · {c.unidades} {c.unidades === 1 ? 'pieza' : 'piezas'} · última {fmtDate(c.ultima)}{c.ultimo_folio ? ` (${c.ultimo_folio})` : ''}{c.vendedor ? ` · ${c.vendedor}` : ''}</span>
              <span className="pcl-acc">
                {c.telefono && <a className="btn ghost sm" href={`tel:${c.telefono}`}><Phone size={14} /> {c.telefono}</a>}
                {c.email && <a className="btn ghost sm" href={`mailto:${c.email}`}><Mail size={14} /> Correo</a>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  return (
    <div className="card pcl" data-testid="productos-clientes">
      <h2 className="pcl-t">Productos</h2>
      <p className="pcl-sub">Elige un producto para ver qué clientes de tu cartera lo han comprado.</p>
      <div className="pcl-filtros">
        <span className="searchbox" style={{ flex: 1, minWidth: 200 }}><Search size={15} aria-hidden /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar producto, SKU o categoría" aria-label="Buscar producto" data-testid="productos-q" /></span>
        <label className="pc-check"><input type="checkbox" checked={soloConCompras} onChange={(e) => setSoloConCompras(e.target.checked)} /> Solo los que tienen compradores</label>
      </div>
      {error && <div role="alert" className="pcl-vacio">No se pudieron cargar los productos.</div>}
      {lista === null ? <div className="pcl-vacio">Cargando…</div> : visibles.length === 0 ? <div className="pcl-vacio">{soloConCompras ? 'Ningún producto tiene compras de tus clientes todavía.' : 'Sin productos.'}</div> : (
        <ul className="pcl-lista">
          {visibles.map((p) => (
            <li key={p.product_id}>
              <button type="button" className="pcl-prod" onClick={() => setSel(p)} data-testid="producto">
                <span><b>{p.nombre}</b><small>{[p.sku, p.categoria].filter(Boolean).join(' · ')}</small></span>
                <span className="pcl-n"><Users size={14} aria-hidden /> {p.clientes} {p.clientes === 1 ? 'cliente' : 'clientes'}{p.ultima ? <small>última venta {fmtDate(p.ultima)}</small> : null}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
