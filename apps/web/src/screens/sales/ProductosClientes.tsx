// HERRAMIENTAS DEL VENDEDOR · "Productos": por cada producto, qué clientes lo compraron antes, para volver a ofrecérselo.
// Decisión del dueño: cada vendedor ve SOLO su cartera; el jefe de ventas y Dirección, todos (lo decide la base).
// COMPRADORES × PROMOCIÓN (3 nov 2026): la pestaña "A quién ofrecerle" junta a los clientes que compraron algo que HOY
// está en promoción para su lista, con el mensaje listo para WhatsApp o correo y el botón para llevarlo al embudo.
import React, { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Mail, MessageCircle, Phone, Search, Tag, TrendingUp, Users } from 'lucide-react'
import {
  compradoresProducto as compradoresPorDefecto, mensajeOferta, normalizar, oportunidadesPromo as oportunidadesPorDefecto,
  productosCompradores as productosPorDefecto, textoPromo, whatsappCon,
  type Comprador, type OportunidadPromo, type ProductoCompradores,
} from '../../data/ops/busqueda'
import { crm } from '../../data/ops/crm'
import { capitalizarNombre } from '../../lib/nombres'
import { fmtDate } from '../../lib/format'
import { Customer360Page } from '../../app/Customer360'

type Vista = 'ofrecer' | 'productos'
type AlEmbudo = (customerId: string, titulo: string) => Promise<{ ok: true } | { ok: false; error: string }>
const alEmbudoPorDefecto: AlEmbudo = async (id, titulo) => { const r = await crm().crear(id, titulo); return r.ok ? { ok: true } : { ok: false, error: r.error } }

/** Botones para hablarle: llamada, WhatsApp con el mensaje listo, correo con el mismo texto y, si se pide, al embudo. */
function Contactar({ c, texto, titulo, alEmbudo }: { c: { customer_id: string; telefono: string | null; email: string | null }; texto: string | null; titulo?: string; alEmbudo?: AlEmbudo }) {
  const [embudo, setEmbudo] = useState<string | null>(null)
  return (
    <span className="pcl-acc">
      {c.telefono && <a className="btn ghost sm" href={`tel:${c.telefono}`}><Phone size={14} /> {c.telefono}</a>}
      {texto && <a className="btn ghost sm" href={whatsappCon(c.telefono, texto)} target="_blank" rel="noreferrer" data-testid="oferta-whatsapp"><MessageCircle size={14} /> WhatsApp</a>}
      {c.email && <a className="btn ghost sm" href={`mailto:${c.email}${texto ? `?subject=${encodeURIComponent('Promoción Renovacell')}&body=${encodeURIComponent(texto)}` : ''}`}><Mail size={14} /> Correo</a>}
      {alEmbudo && titulo && (embudo === 'ok' ? <span className="pcl-ok">En tu embudo</span> : (
        <button type="button" className="btn ghost sm" data-testid="oferta-embudo"
          onClick={() => void alEmbudo(c.customer_id, titulo).then((r) => setEmbudo(r.ok ? 'ok' : r.error))}><TrendingUp size={14} /> Al embudo</button>
      ))}
      {embudo && embudo !== 'ok' && <span className="pcl-err" role="alert">{/YA_ABIERTA/.test(embudo) ? 'Ya tiene una oportunidad abierta en el embudo.' : embudo}</span>}
    </span>
  )
}

export function ProductosClientes({ productos = productosPorDefecto, compradores = compradoresPorDefecto, oportunidades = oportunidadesPorDefecto, alEmbudo = alEmbudoPorDefecto }: {
  productos?: typeof productosPorDefecto; compradores?: typeof compradoresPorDefecto; oportunidades?: typeof oportunidadesPorDefecto; alEmbudo?: AlEmbudo
}) {
  const [lista, setLista] = useState<ProductoCompradores[] | null>(null)
  const [ofertas, setOfertas] = useState<OportunidadPromo[] | null>(null)
  const [vista, setVista] = useState<Vista | null>(null)
  const [error, setError] = useState(false)
  const [q, setQ] = useState('')
  const [soloConCompras, setSoloConCompras] = useState(true)
  const [soloPromo, setSoloPromo] = useState(false)
  const [sel, setSel] = useState<ProductoCompradores | null>(null)
  const [quienes, setQuienes] = useState<Comprador[] | null>(null)
  const [ficha, setFicha] = useState<string | null>(null)
  useEffect(() => { void productos().then((r) => { setLista(r ?? []); setError(r === null) }) }, [productos])
  useEffect(() => { void oportunidades().then((r) => setOfertas(r ?? [])) }, [oportunidades])
  useEffect(() => { setQuienes(null); if (sel) void compradores(sel.product_id).then((r) => setQuienes(r ?? [])) }, [sel, compradores])
  // Abre en "A quién ofrecerle" si hay a quién; si no, en la lista de productos.
  const vistaActual: Vista = vista ?? (ofertas && ofertas.length > 0 ? 'ofrecer' : 'productos')
  const visibles = useMemo(() => {
    const b = normalizar(q.trim())
    return (lista ?? []).filter((p) => (!soloConCompras || p.clientes > 0) && (!soloPromo || (p.promos?.length ?? 0) > 0)
      && (!b || normalizar(`${p.nombre} ${p.sku ?? ''} ${p.categoria ?? ''}`).includes(b)))
  }, [lista, q, soloConCompras, soloPromo])
  const ofertasVisibles = useMemo(() => {
    const b = normalizar(q.trim())
    return (ofertas ?? []).filter((o) => !b || normalizar(`${o.nombre} ${o.ofertas.map((f) => `${f.familia} ${f.presentaciones.join(' ')}`).join(' ')}`).includes(b))
  }, [ofertas, q])

  if (ficha) return <Customer360Page customerId={ficha} onBack={() => setFicha(null)} />

  if (sel) {
    const promos = sel.promos ?? []
    return (
      <div className="card pcl" data-testid="compradores">
        <button type="button" className="btn ghost sm" onClick={() => setSel(null)} data-testid="compradores-volver"><ArrowLeft size={15} /> Productos</button>
        <h2 className="pcl-t">{sel.nombre}</h2>
        {promos.length > 0 && (
          <div className="pcl-promo" data-testid="compradores-promo">
            <Tag size={15} aria-hidden />
            <span>{promos.map((p) => <span key={`${p.promocion_id}${p.product_id}`} className="pcl-promo-l"><b>{p.nombre}</b> · {textoPromo(p)} · hasta el {fmtDate(p.hasta)}</span>)}</span>
          </div>
        )}
        <p className="pcl-sub">Clientes {quienes?.some((c) => c.vendedor) ? '' : 'de tu cartera '}que lo han comprado: ofréceselo de nuevo.</p>
        {quienes === null ? <div className="pcl-vacio">Cargando…</div> : quienes.length === 0 ? <div className="pcl-vacio">Ningún cliente de tu cartera lo ha comprado todavía.</div> : (
          <ul className="pcl-lista">
            {quienes.map((c) => {
              const texto = promos.length > 0 && c.promo_aplica ? mensajeOferta(capitalizarNombre(c.nombre), [{ familia: sel.nombre, promos }], fmtDate) : null
              return (
                <li key={c.customer_id} className="pcl-item" data-testid="comprador">
                  <button type="button" className="pcl-nombre" onClick={() => setFicha(c.customer_id)} title="Ver su ficha">{capitalizarNombre(c.nombre)}</button>
                  <span className="pcl-det">Compró {c.veces} {c.veces === 1 ? 'vez' : 'veces'} · {c.unidades} {c.unidades === 1 ? 'pieza' : 'piezas'} · última {fmtDate(c.ultima)}{c.ultimo_folio ? ` (${c.ultimo_folio})` : ''}{c.vendedor ? ` · ${c.vendedor}` : ''}</span>
                  {c.presentaciones && c.presentaciones.length > 0 && <span className="pcl-det">Presentación: {c.presentaciones.join(', ')}</span>}
                  {promos.length > 0 && !c.promo_aplica && <span className="pcl-det">La promoción no aplica a su lista de precios.</span>}
                  <Contactar c={c} texto={texto} titulo={texto ? `Promoción: ${sel.nombre}` : undefined} alEmbudo={texto ? alEmbudo : undefined} />
                </li>
              )
            })}
          </ul>
        )}
      </div>
    )
  }

  const nOfertas = ofertas?.length ?? 0
  return (
    <div className="card pcl" data-testid="productos-clientes">
      <h2 className="pcl-t">Productos</h2>
      <div className="pcl-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={vistaActual === 'ofrecer'} className={`pcl-tab${vistaActual === 'ofrecer' ? ' on' : ''}`} onClick={() => setVista('ofrecer')} data-testid="tab-ofrecer">
          <Tag size={14} aria-hidden /> A quién ofrecerle{nOfertas > 0 ? ` (${nOfertas})` : ''}
        </button>
        <button type="button" role="tab" aria-selected={vistaActual === 'productos'} className={`pcl-tab${vistaActual === 'productos' ? ' on' : ''}`} onClick={() => setVista('productos')} data-testid="tab-productos">
          <Users size={14} aria-hidden /> Por producto
        </button>
      </div>
      <div className="pcl-filtros">
        <span className="searchbox" style={{ flex: 1, minWidth: 200 }}><Search size={15} aria-hidden /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={vistaActual === 'ofrecer' ? 'Buscar cliente o producto' : 'Buscar producto, SKU o categoría'} aria-label="Buscar" data-testid="productos-q" /></span>
        {vistaActual === 'productos' && <>
          <label className="pc-check"><input type="checkbox" checked={soloConCompras} onChange={(e) => setSoloConCompras(e.target.checked)} /> Solo los que tienen compradores</label>
          <label className="pc-check"><input type="checkbox" checked={soloPromo} onChange={(e) => setSoloPromo(e.target.checked)} data-testid="solo-promo" /> Solo en promoción</label>
        </>}
      </div>

      {vistaActual === 'ofrecer' ? (
        <>
          <p className="pcl-sub">Clientes {ofertas?.some((o) => o.vendedor) ? '' : 'de tu cartera '}que ya compraron algo que hoy está en promoción. Háblales primero a los que compraron hace poco.</p>
          {ofertas === null ? <div className="pcl-vacio">Cargando…</div> : ofertasVisibles.length === 0 ? (
            <div className="pcl-vacio" data-testid="ofrecer-vacio">{nOfertas === 0 ? 'Por ahora ningún cliente tuyo compró algo que esté en promoción. Cuando Dirección publique una promoción de algo que tus clientes ya compran, aparecerán aquí.' : 'Nadie coincide con la búsqueda.'}</div>
          ) : (
            <ul className="pcl-lista">
              {ofertasVisibles.map((o) => {
                const texto = mensajeOferta(capitalizarNombre(o.nombre), o.ofertas, fmtDate)
                return (
                  <li key={o.customer_id} className="pcl-item" data-testid="oferta">
                    <button type="button" className="pcl-nombre" onClick={() => setFicha(o.customer_id)} title="Ver su ficha">{capitalizarNombre(o.nombre)}</button>
                    {o.ofertas.map((f) => (
                      <span key={f.familia_id} className="pcl-det">
                        Compró <b>{f.presentaciones.length > 0 ? f.presentaciones.join(', ') : f.familia}</b> {f.veces} {f.veces === 1 ? 'vez' : 'veces'} · última {fmtDate(f.ultima)}
                        {f.promos.map((p) => <span key={`${p.promocion_id}${p.product_id}`} className="pcl-promo-l"><Tag size={12} aria-hidden /> {textoPromo(p)} · {p.nombre} hasta el {fmtDate(p.hasta)}</span>)}
                      </span>
                    ))}
                    {o.vendedor && <span className="pcl-det">Vendedor: {o.vendedor}</span>}
                    <Contactar c={o} texto={texto} titulo={`Promoción: ${o.ofertas.map((f) => f.familia).join(', ')}`.slice(0, 120)} alEmbudo={alEmbudo} />
                  </li>
                )
              })}
            </ul>
          )}
        </>
      ) : (
        <>
          <p className="pcl-sub">Elige un producto para ver qué clientes de tu cartera lo han comprado.</p>
          {error && <div role="alert" className="pcl-vacio">No se pudieron cargar los productos.</div>}
          {lista === null ? <div className="pcl-vacio">Cargando…</div> : visibles.length === 0 ? <div className="pcl-vacio">{soloPromo ? 'Ningún producto con compradores está en promoción.' : soloConCompras ? 'Ningún producto tiene compras de tus clientes todavía.' : 'Sin productos.'}</div> : (
            <ul className="pcl-lista">
              {visibles.map((p) => (
                <li key={p.product_id}>
                  <button type="button" className="pcl-prod" onClick={() => setSel(p)} data-testid="producto">
                    <span><b>{p.nombre}</b><small>{[p.sku, p.categoria].filter(Boolean).join(' · ')}</small>
                      {(p.promos?.length ?? 0) > 0 && <small className="pcl-badge" data-testid="producto-promo"><Tag size={11} aria-hidden /> En promoción hasta el {fmtDate(p.promos![0].hasta)}</small>}</span>
                    <span className="pcl-n"><Users size={14} aria-hidden /> {p.clientes} {p.clientes === 1 ? 'cliente' : 'clientes'}{p.ultima ? <small>última venta {fmtDate(p.ultima)}</small> : null}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  )
}
