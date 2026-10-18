// PROMO-2 · Promociones (Dirección / Facturación): crear una promoción con nombre, vigencia y varios productos (precio o
// escalones por cantidad), pausarla o editarla. Se puede PEGAR el texto del proveedor y el sistema propone la promoción;
// la persona revisa, empareja productos y guarda. El precio lo aplica el servidor (precio_de/3) solo mientras dura.
import React, { useEffect, useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import { money } from '../../lib/format'
import { useProducts, isActiveProduct } from '../../data/hooks/useProducts'
import { usePricing } from '../../data/hooks/usePricing'
import { recargarPromos } from '../../data/store/promosStore'
import { hoyNegocio } from '../../data/periodo'
import { ETIQUETA_ESTADO, PILL_ESTADO, difundirPromocion, estadoPromocion, guardarPromocion, leerPromoTexto, listarPromociones, previaDifusion, vigenciaTexto, type CanalDifusion, type PreviaDifusion, type Promocion, type PromoDatos, type ResultadoDifusion } from '../../data/ops/promociones'

const input: React.CSSProperties = { padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10, fontFamily: 'inherit', fontSize: 13, outline: 'none', background: 'var(--card, #fff)', color: 'inherit', width: '100%' }
interface Renglon { product_id: string; min_qty: number; precio: number | '' ; texto?: string }
interface Form { id?: string; nombre: string; descripcion: string; desde: string; hasta: string; listas: string[] | null; lineas: Renglon[] }
const hoyIso = () => hoyNegocio()
const VACIO = (): Form => ({ nombre: '', descripcion: '', desde: hoyIso(), hasta: hoyIso(), listas: null, lineas: [] })

/** Empareja un texto ("Botox", "Skinvive") con un producto del catálogo por nombre (contiene / empieza / palabras). */
export function emparejarProducto(texto: string, productos: Array<{ id: string; name: string }>): string | null {
  const t = texto.toLowerCase().replace(/[^a-z0-9áéíóúñ ]/gi, ' ').trim()
  if (!t) return null
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9áéíóúñ ]/gi, ' ').trim()
  const exacto = productos.find((p) => norm(p.name) === t); if (exacto) return exacto.id
  const empieza = productos.find((p) => norm(p.name).startsWith(t)); if (empieza) return empieza.id
  const contiene = productos.find((p) => norm(p.name).includes(t) || t.includes(norm(p.name))); if (contiene) return contiene.id
  const palabra = t.split(/\s+/)[0]
  const porPalabra = productos.filter((p) => norm(p.name).split(/\s+/).includes(palabra))
  return porPalabra.length === 1 ? porPalabra[0].id : null
}

export function Promociones({ listar = listarPromociones, guardar = guardarPromocion, cambiarEstado = estadoPromocion, previa = previaDifusion, difundir = difundirPromocion }: { listar?: typeof listarPromociones; guardar?: typeof guardarPromocion; cambiarEstado?: typeof estadoPromocion; previa?: typeof previaDifusion; difundir?: typeof difundirPromocion }) {
  const { data: productos } = useProducts()
  const { lists: listas } = usePricing()
  const vendibles = useMemo(() => productos.filter((p) => isActiveProduct(p)).sort((a, b) => a.name.localeCompare(b.name)), [productos])
  const [lista, setLista] = useState<Promocion[] | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [texto, setTexto] = useState('')
  const [pegar, setPegar] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  // PROMO-4 · difusión: vista previa (texto + audiencia) → canales → enviar → resultado.
  const [envio, setEnvio] = useState<{ promo: Promocion; previa: PreviaDifusion | null; canales: CanalDifusion[]; resultado: ResultadoDifusion | null; error: string | null } | null>(null)
  const abrirEnvio = async (p: Promocion) => {
    setEnvio({ promo: p, previa: null, canales: ['correo', 'chat'], resultado: null, error: null })
    const r = await previa(p.id)
    setEnvio((e) => e && e.promo.id === p.id ? { ...e, previa: r.ok ? r.data : null, error: r.ok ? null : r.error } : e)
  }
  const enviar = async () => {
    if (!envio || ocupado || envio.canales.length === 0) return
    setOcupado(true)
    const r = await difundir(envio.promo.id, envio.canales)
    setOcupado(false)
    setEnvio((e) => e && ({ ...e, resultado: r.ok ? r.data : null, error: r.ok ? null : r.error }))
    if (r.ok) await cargar()
  }
  const cargar = async () => { const r = await listar(true); if (r.ok) setLista(r.data); else setError(r.error) }
  useEffect(() => { void cargar() }, [])   // eslint-disable-line react-hooks/exhaustive-deps

  const nombreDe = (id: string) => vendibles.find((p) => p.id === id)?.name ?? 'Producto'
  const precioNormal = (id: string) => vendibles.find((p) => p.id === id)?.price ?? null
  const valido = (f: Form) => f.nombre.trim().length >= 2 && !!f.desde && !!f.hasta && f.desde <= f.hasta && f.lineas.length > 0 && f.lineas.every((l) => l.product_id && l.min_qty >= 1 && typeof l.precio === 'number' && l.precio > 0)

  const guardarForm = async () => {
    if (!form || !valido(form) || ocupado) return
    setOcupado(true); setError(null)
    const d: PromoDatos = { id: form.id, nombre: form.nombre.trim(), descripcion: form.descripcion.trim() || null, desde: form.desde, hasta: form.hasta, listas: form.listas, lineas: form.lineas.map((l) => ({ product_id: l.product_id, min_qty: l.min_qty, precio: Number(l.precio) })) }
    const r = await guardar(d)
    setOcupado(false)
    if (!r.ok) { setError(r.error); return }
    setForm(null); setAviso(`"${r.data.nombre}" guardada · ${ETIQUETA_ESTADO[r.data.estado].toLowerCase()} ${vigenciaTexto(r.data)}.`)
    await cargar(); void recargarPromos()
  }
  const pausar = async (p: Promocion) => {
    setError(null)
    const r = await cambiarEstado(p.id, !p.activa)
    if (!r.ok) { setError(r.error); return }
    await cargar(); void recargarPromos()
  }
  const proponer = () => {
    const l = leerPromoTexto(texto)
    const lineas: Renglon[] = l.lineas.map((x) => ({ product_id: emparejarProducto(x.texto, vendibles) ?? '', min_qty: x.min_qty, precio: x.precio, texto: x.texto }))
    setForm({ nombre: l.nombre ?? 'Promoción', descripcion: '', desde: l.desde ?? hoyIso(), hasta: l.hasta ?? l.desde ?? hoyIso(), listas: null, lineas })
    setPegar(false)
    const sinProducto = lineas.filter((x) => !x.product_id).length
    setAviso(`Leí ${lineas.length} ${lineas.length === 1 ? 'renglón' : 'renglones'}${sinProducto ? `; ${sinProducto} sin producto emparejado: elígelo en la lista` : ''}${l.sinLeer.length ? `; no entendí: ${l.sinLeer.join(' / ')}` : ''}. Revisa y guarda.`)
  }
  const editar = (p: Promocion) => setForm({ id: p.id, nombre: p.nombre, descripcion: p.descripcion ?? '', desde: p.desde.slice(0, 10), hasta: p.hasta.slice(0, 10), listas: p.listas, lineas: p.lineas.map((l) => ({ product_id: l.product_id, min_qty: l.min_qty, precio: l.precio })) })
  const setLinea = (i: number, patch: Partial<Renglon>) => setForm((f) => f && ({ ...f, lineas: f.lineas.map((l, j) => (j === i ? { ...l, ...patch } : l)) }))

  return (
    <div className="grid" style={{ gap: 14 }} data-testid="promociones">
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Promociones</h4>
          <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Varios productos, un periodo. Se aplican solas en el portal, la caja y el chat mientras duran; nunca se cobra más que el precio normal del cliente.</span>
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button className="btn ghost sm" type="button" onClick={() => { setPegar((v) => !v); setForm(null) }} data-testid="promo-pegar">Pegar texto</button>
            <button className="btn sm" type="button" onClick={() => { setForm(VACIO()); setPegar(false) }} data-testid="promo-nueva"><Plus size={14} /> Nueva promoción</button>
          </div>
        </div>
        {aviso && <div role="status" className="ms" style={{ color: 'var(--green-deep)', marginTop: 8 }} data-testid="promo-aviso">{aviso}</div>}
        {error && <div role="alert" className="ms" style={{ color: 'var(--danger)', marginTop: 8 }}>{error}</div>}
        {pegar && (
          <div style={{ marginTop: 10, display: 'grid', gap: 8 }} data-testid="promo-pegar-caja">
            <textarea style={{ ...input, minHeight: 120, fontFamily: 'inherit' }} value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={'Pega aquí el texto, por ejemplo:\nPrecios de promo Allergan\nBotox\n1 pieza $4,000\n5 a 9 piezas $3,800\n10 piezas $3,600\nSkinvive $3,600\ndel 16 al 25 de octubre'} aria-label="Texto de la promoción" />
            <div><button className="btn sm" type="button" disabled={!texto.trim()} onClick={proponer} data-testid="promo-proponer">Leer y proponer</button></div>
          </div>
        )}
        {form && (
          <div style={{ marginTop: 12, border: '1px solid var(--line)', borderRadius: 12, padding: 12, display: 'grid', gap: 10 }} data-testid="promo-form">
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 8 }}>
              <label style={{ fontSize: 12 }}>Nombre<input style={input} value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} aria-label="Nombre de la promoción" /></label>
              <label style={{ fontSize: 12 }}>Desde<input style={input} type="date" value={form.desde} onChange={(e) => setForm({ ...form, desde: e.target.value })} aria-label="Desde" /></label>
              <label style={{ fontSize: 12 }}>Hasta<input style={input} type="date" value={form.hasta} onChange={(e) => setForm({ ...form, hasta: e.target.value })} aria-label="Hasta" /></label>
            </div>
            <label style={{ fontSize: 12 }}>Nota (opcional)<input style={input} value={form.descripcion} maxLength={500} onChange={(e) => setForm({ ...form, descripcion: e.target.value })} aria-label="Nota" /></label>
            {listas.length > 1 && (
              <div style={{ fontSize: 12.5, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }} data-testid="promo-listas">
                <span style={{ color: 'var(--ink-3)' }}>Aplica a:</span>
                <label><input type="radio" checked={form.listas === null} onChange={() => setForm({ ...form, listas: null })} /> Todas las listas</label>
                {listas.map((l) => (
                  <label key={l.id}><input type="checkbox" checked={!!form.listas?.includes(l.id)} onChange={(e) => { const set = new Set(form.listas ?? []); if (e.target.checked) set.add(l.id); else set.delete(l.id); setForm({ ...form, listas: set.size ? [...set] : null }) }} /> {l.name}</label>
                ))}
              </div>
            )}
            <div>
              <div style={{ display: 'grid', gridTemplateColumns: '2.2fr 0.8fr 1fr 1fr auto', gap: 8, fontSize: 10.5, color: 'var(--ink-3)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 4 }}>
                <span>Producto</span><span>Desde (pzas)</span><span>Precio promo</span><span>Precio normal</span><span />
              </div>
              <div style={{ display: 'grid', gap: 6 }}>
                {form.lineas.map((l, i) => {
                  const normal = l.product_id ? precioNormal(l.product_id) : null
                  return (
                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '2.2fr 0.8fr 1fr 1fr auto', gap: 8, alignItems: 'center' }} data-testid={`promo-linea-${i}`}>
                      <div>
                        <select style={input} value={l.product_id} onChange={(e) => setLinea(i, { product_id: e.target.value })} aria-label={`Producto ${i + 1}`}>
                          <option value="">{l.texto ? `Elige el producto para "${l.texto}"` : 'Elige un producto…'}</option>
                          {vendibles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                        </select>
                        {l.texto && !l.product_id && <div style={{ fontSize: 11, color: 'var(--warn)' }}>Del texto: "{l.texto}"</div>}
                      </div>
                      <input style={input} type="number" min={1} step={1} value={l.min_qty} onChange={(e) => setLinea(i, { min_qty: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} aria-label={`Cantidad mínima ${i + 1}`} />
                      <input style={input} type="number" min={0} step="0.01" value={l.precio} onChange={(e) => setLinea(i, { precio: e.target.value === '' ? '' : Number(e.target.value) })} aria-label={`Precio promo ${i + 1}`} />
                      <span className="mono" style={{ fontSize: 13, color: normal != null && typeof l.precio === 'number' && l.precio > normal ? 'var(--warn)' : 'var(--ink-3)' }}>{normal != null ? money(normal) : '—'}{normal != null && typeof l.precio === 'number' && l.precio > normal ? ' · la promo es más cara: no se aplicará' : ''}</span>
                      <button className="btn ghost sm" type="button" onClick={() => setForm({ ...form, lineas: form.lineas.filter((_, j) => j !== i) })} aria-label={`Quitar renglón ${i + 1}`}>×</button>
                    </div>
                  )
                })}
              </div>
              <button className="btn ghost sm" type="button" style={{ marginTop: 8 }} onClick={() => setForm({ ...form, lineas: [...form.lineas, { product_id: '', min_qty: 1, precio: '' }] })} data-testid="promo-agregar-renglon"><Plus size={14} /> Agregar producto o escalón</button>
              <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 6 }}>Escalones: el mismo producto varias veces con distinta cantidad mínima ("desde 1" $4,000 · "desde 5" $3,800 · "desde 10" $3,600).</div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn ghost sm" type="button" onClick={() => setForm(null)}>Cancelar</button>
              <button className="btn sm" type="button" disabled={!valido(form) || ocupado} onClick={guardarForm} data-testid="promo-guardar">{ocupado ? 'Guardando…' : form.id ? 'Guardar cambios' : 'Crear promoción'}</button>
            </div>
          </div>
        )}
      </div>

      {lista === null ? <div className="card" style={{ fontSize: 13, color: 'var(--ink-3)' }}>Cargando…</div> : lista.length === 0 ? (
        <div className="card" style={{ fontSize: 13, color: 'var(--ink-3)' }}>Sin promociones todavía. Crea una o pega el texto del proveedor.</div>
      ) : lista.map((p) => (
        <div key={p.id} className="card" data-testid={`promo-${p.id}`} style={{ opacity: p.estado === 'vencida' || p.estado === 'inactiva' ? 0.75 : 1 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <b style={{ fontSize: 14 }}>{p.nombre}</b>
            <span className={'pill ' + PILL_ESTADO[p.estado]}>{ETIQUETA_ESTADO[p.estado]}</span>
            <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{vigenciaTexto(p)}{p.listas ? ` · solo ${p.listas.map((id) => listas.find((l) => l.id === id)?.name ?? 'lista').join(', ')}` : ' · todas las listas'}</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
              {p.activa && p.estado !== 'vencida' && <button className="btn sm" type="button" onClick={() => abrirEnvio(p)} data-testid={`promo-enviar-${p.id}`}>Enviar a doctores</button>}
              <button className="btn ghost sm" type="button" onClick={() => editar(p)}>Editar</button>
              {p.estado !== 'vencida' && <button className="btn ghost sm" type="button" onClick={() => pausar(p)} data-testid={`promo-pausar-${p.id}`}>{p.activa ? 'Pausar' : 'Activar'}</button>}
            </div>
          </div>
          {p.descripcion && <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 4 }}>{p.descripcion}</div>}
          {p.difusion && (p.difusion.correo > 0 || p.difusion.chat > 0) && (
            <div style={{ fontSize: 12.5, marginTop: 6, color: 'var(--ink-3)' }} data-testid={`promo-difusion-${p.id}`}>
              Enviada a {p.difusion.correo} por correo y {p.difusion.chat} por chat{p.difusion.sin_correo ? ` · ${p.difusion.sin_correo} sin correo registrado` : ''}.
            </div>
          )}
          {envio && envio.promo.id === p.id && (
            <div style={{ marginTop: 10, border: '1px solid var(--line)', borderRadius: 12, padding: 12, display: 'grid', gap: 8 }} data-testid="promo-envio">
              {envio.resultado ? (
                <div role="status" data-testid="promo-envio-resultado" style={{ fontSize: 13 }}>
                  <b>Listo.</b> Audiencia: {envio.resultado.audiencia} doctores · correo: {envio.resultado.correo} en cola · chat: {envio.resultado.chat} entregados{envio.resultado.sin_correo ? ` · ${envio.resultado.sin_correo} sin correo` : ''}{envio.resultado.ya_enviados ? ` · ${envio.resultado.ya_enviados} ya lo tenían` : ''}.
                  <div><button className="btn ghost sm" type="button" style={{ marginTop: 8 }} onClick={() => setEnvio(null)}>Cerrar</button></div>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                    Se manda a los doctores verificados con cuenta{envio.previa ? <> (<b>{envio.previa.audiencia}</b>{envio.previa.sin_correo ? `, ${envio.previa.sin_correo} sin correo registrado` : ''}). {envio.previa.enviados.correo || envio.previa.enviados.chat ? `Ya se envió a ${envio.previa.enviados.correo} por correo y ${envio.previa.enviados.chat} por chat; a ellos no se repite.` : ''}</> : '…'}
                  </div>
                  <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: 13, background: 'var(--surface-2, #fafafa)', padding: 10, borderRadius: 10, margin: 0 }} data-testid="promo-envio-texto">{envio.previa?.texto ?? 'Cargando vista previa…'}</pre>
                  <div style={{ display: 'flex', gap: 14, fontSize: 13, flexWrap: 'wrap' }}>
                    {(['correo', 'chat'] as CanalDifusion[]).map((c) => (
                      <label key={c}><input type="checkbox" checked={envio.canales.includes(c)} onChange={(e) => setEnvio({ ...envio, canales: e.target.checked ? [...envio.canales, c] : envio.canales.filter((x) => x !== c) })} data-testid={`promo-canal-${c}`} /> {c === 'correo' ? 'Correo' : 'Chat del sistema (Habla con Renovacell)'}</label>
                    ))}
                  </div>
                  {envio.error && <div role="alert" style={{ fontSize: 12.5, color: 'var(--danger)' }}>{envio.error}</div>}
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button className="btn ghost sm" type="button" onClick={() => setEnvio(null)}>Cancelar</button>
                    <button className="btn sm" type="button" disabled={ocupado || envio.canales.length === 0 || !envio.previa} onClick={enviar} data-testid="promo-envio-confirmar">{ocupado ? 'Enviando…' : 'Enviar ahora'}</button>
                  </div>
                </>
              )}
            </div>
          )}
          {p.ventas && (p.estado === 'vigente' || p.estado === 'vencida' || p.ventas.pedidos > 0) && (
            <div style={{ fontSize: 12.5, marginTop: 6 }} data-testid={`promo-ventas-${p.id}`}>
              <b>Vendido con esta promo:</b> {p.ventas.pedidos} pedido{p.ventas.pedidos === 1 ? '' : 's'} · {p.ventas.piezas} pza{p.ventas.piezas === 1 ? '' : 's'} · {money(Number(p.ventas.importe))}
            </div>
          )}
          <div style={{ display: 'grid', gap: 3, marginTop: 8 }}>
            {p.lineas.map((l) => (
              <div key={l.id ?? `${l.product_id}-${l.min_qty}`} style={{ display: 'flex', gap: 8, fontSize: 13, alignItems: 'baseline' }}>
                <span style={{ flex: 1 }}>{l.producto ?? nombreDe(l.product_id)}{l.min_qty > 1 ? <span style={{ color: 'var(--ink-3)' }}> · desde {l.min_qty} pzas</span> : null}</span>
                <span className="mono" style={{ color: 'var(--ink-3)', textDecoration: 'line-through' }}>{l.precio_normal != null ? money(l.precio_normal) : ''}</span>
                <b className="mono">{money(l.precio)}</b>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
