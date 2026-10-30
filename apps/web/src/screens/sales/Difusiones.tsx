// HERRAMIENTAS DEL VENDEDOR · bloque D · "Difusiones": el vendedor arma sus listas (nombre que él elige + los clientes que
// él pone, a mano o por filtro) y les manda un texto, un enlace (un video va como enlace) o una imagen: por correo a quien
// tiene correo y por el chat del portal a quien tiene cuenta. A una lista, a un filtro (doctores / clínicas / especialidad)
// o a toda su cartera. Antes de mandar: a cuántos llega, vista previa del correo y una prueba a su propio correo.
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ImagePlus, Megaphone, Minus, Plus, Search, Send, Trash2, X } from 'lucide-react'
import { difusiones as clientePorDefecto, type Audiencia, type ClienteDifusiones, type ClienteLista, type Contenido, type Difusion, type Lista, type Previa } from '../../data/ops/difusiones'
import { useEspecialidades } from '../../app/PerfilComercialEditor'
import { ETIQUETA_TIPO, type TipoCliente } from '../../data/ops/perfilComercial'
import { renderizar } from '../../../../../supabase/functions/_shared/plantillas'   // el MISMO generador del correo que usa el servidor
import { uploadImage } from '../../lib/uploads'
import { capitalizarNombre } from '../../lib/nombres'
import { fmtDate } from '../../lib/format'

type Vista = 'nueva' | 'listas' | 'enviadas'
const VACIO: Contenido = { titulo: '', texto: '', enlace: '', imagen: '' }

export function Difusiones({ cliente = clientePorDefecto, subir = (f: File) => uploadImage(f, 'difusiones') }: { cliente?: ClienteDifusiones; subir?: (f: File) => Promise<string> }) {
  const [vista, setVista] = useState<Vista>('nueva')
  const [listas, setListas] = useState<Lista[]>([])
  const cargarListas = useCallback(async () => { const r = await cliente.listas(); if (r.ok) setListas(r.data) }, [cliente])
  useEffect(() => { void cargarListas() }, [cargarListas])
  return (
    <div className="grid dif" data-testid="difusiones" style={{ gap: 14 }}>
      <div className="dif-h"><Megaphone size={20} aria-hidden /><div><h2>Difusiones</h2><p>Manda un mensaje, un enlace o una imagen a tus clientes: por correo y por su chat del portal.</p></div></div>
      <div className="seg" style={{ alignSelf: 'flex-start' }} role="tablist">
        {([['nueva', 'Nueva difusión'], ['listas', `Mis listas (${listas.filter((l) => l.es_mia).length})`], ['enviadas', 'Enviadas']] as const).map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={vista === k} className={vista === k ? 'active' : undefined} onClick={() => setVista(k)} data-testid={`dif-vista-${k}`}>{l}</button>
        ))}
      </div>
      {vista === 'nueva' && <NuevaDifusion cliente={cliente} listas={listas} subir={subir} onEnviada={() => setVista('enviadas')} />}
      {vista === 'listas' && <MisListas cliente={cliente} listas={listas} recargar={cargarListas} />}
      {vista === 'enviadas' && <Enviadas cliente={cliente} />}
    </div>
  )
}

function NuevaDifusion({ cliente, listas, subir, onEnviada }: { cliente: ClienteDifusiones; listas: Lista[]; subir: (f: File) => Promise<string>; onEnviada: () => void }) {
  const especialidades = useEspecialidades()
  const [modo, setModo] = useState<'cartera' | 'lista' | 'filtro'>('cartera')
  const [listaId, setListaId] = useState('')
  const [tipo, setTipo] = useState<TipoCliente | null>('doctor')
  const [esp, setEsp] = useState<string | null>(null)
  const [c, setC] = useState<Contenido>(VACIO)
  const [canales, setCanales] = useState<{ correo: boolean; chat: boolean }>({ correo: true, chat: true })
  const [previa, setPrevia] = useState<Previa | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [verCorreo, setVerCorreo] = useState(false)
  const audiencia: Audiencia | null = modo === 'cartera' ? { tipo: 'cartera' } : modo === 'lista' ? (listaId ? { tipo: 'lista', etiqueta_id: listaId } : null) : { tipo: 'filtro', tipo_cliente: tipo, especialidad: esp }
  const clave = JSON.stringify(audiencia)
  useEffect(() => { setPrevia(null); if (audiencia) void cliente.previa(audiencia).then((r) => setPrevia(r.ok ? r.data : null)) }, [clave, cliente])   // eslint-disable-line react-hooks/exhaustive-deps
  const correoPrevia = useMemo(() => renderizar('difusion', { titulo: c.titulo || 'Título de tu difusión', texto: c.texto || 'Aquí va tu mensaje.', enlace: c.enlace || null, imagen_url: c.imagen || null, vendedor: 'Tu nombre', baja_url: 'https://renovacell.mx/baja' }, 'Dra. Ejemplo'), [c])
  const listo = c.titulo.trim().length >= 3 && c.texto.trim().length > 0 && (canales.correo || canales.chat) && !!audiencia && (!c.enlace.trim() || /^https:\/\//.test(c.enlace.trim()))
  const alcance = previa ? (canales.correo ? previa.con_correo : 0) + (canales.chat ? previa.con_cuenta : 0) : 0

  const subirImagen = async (f?: File) => {
    if (!f) return
    if (!/^image\/(jpeg|png|webp)$/.test(f.type) || f.size > 4 * 1024 * 1024) { setMsg({ ok: false, texto: 'La imagen debe ser JPG, PNG o WebP de hasta 4 MB.' }); return }
    setOcupado(true); const url = await subir(f); setOcupado(false)
    if (!/^https:\/\//.test(url)) { setMsg({ ok: false, texto: 'No se pudo subir la imagen.' }); return }
    setC((x) => ({ ...x, imagen: url }))
  }
  const prueba = async () => { setOcupado(true); setMsg(null); const r = await cliente.prueba(c); setOcupado(false); setMsg(r.ok ? { ok: true, texto: `Te mandamos una prueba a ${r.data.para}.` } : { ok: false, texto: r.mensaje }) }
  const enviar = async () => {
    if (!audiencia || !previa) return
    if (!window.confirm(`¿Mandar «${c.titulo.trim()}» a ${previa.total} ${previa.total === 1 ? 'cliente' : 'clientes'}?`)) return
    setOcupado(true); setMsg(null)
    const r = await cliente.enviar(c, audiencia, [...(canales.correo ? ['correo' as const] : []), ...(canales.chat ? ['chat' as const] : [])])
    setOcupado(false)
    if (!r.ok) { setMsg({ ok: false, texto: r.mensaje }); return }
    setC(VACIO)
    window.alert(`Listo: ${r.data.correo} por correo y ${r.data.chat} por chat.${r.data.sin_correo ? ` ${r.data.sin_correo} sin correo.` : ''}${r.data.dados_de_baja ? ` ${r.data.dados_de_baja} se dieron de baja.` : ''}`)
    onEnviada()
  }

  return (
    <div className="dif-nueva">
      <section className="card dif-sec">
        <h3>1 · ¿A quién?</h3>
        <div className="pc-chips" role="radiogroup" aria-label="Audiencia">
          {([['cartera', 'Toda mi cartera'], ['filtro', 'Por tipo y especialidad'], ['lista', 'Una de mis listas']] as const).map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={modo === k} className={'pc-chip' + (modo === k ? ' on' : '')} onClick={() => setModo(k)} data-testid={`dif-aud-${k}`}>{l}</button>
          ))}
        </div>
        {modo === 'filtro' && (
          <div className="dif-filtro">
            <select className="pc-campo" value={tipo ?? ''} onChange={(e) => setTipo((e.target.value || null) as TipoCliente | null)} aria-label="Tipo de cliente"><option value="">Doctores y clínicas</option><option value="doctor">Solo doctores</option><option value="clinica">Solo clínicas</option></select>
            <select className="pc-campo" value={esp ?? ''} onChange={(e) => setEsp(e.target.value || null)} aria-label="Especialidad"><option value="">Cualquier especialidad</option>{especialidades.map((x) => <option key={x.clave} value={x.clave}>{x.nombre}</option>)}</select>
          </div>
        )}
        {modo === 'lista' && (
          listas.length ? <select className="pc-campo" value={listaId} onChange={(e) => setListaId(e.target.value)} aria-label="Lista" data-testid="dif-lista"><option value="">Elige una lista…</option>{listas.map((l) => <option key={l.id} value={l.id}>{l.nombre} ({l.clientes}){l.vendedor ? ` · ${l.vendedor}` : ''}</option>)}</select>
            : <div className="pc-nota">Aún no tienes listas: créalas en «Mis listas».</div>
        )}
        {previa && <div className="dif-previa" data-testid="dif-previa"><span><b>{previa.total}</b> {previa.total === 1 ? 'cliente' : 'clientes'} · {previa.con_correo} por correo · {previa.con_cuenta} por chat del portal
          {previa.sin_correo ? ` · ${previa.sin_correo} sin correo` : ''}{previa.dados_de_baja ? ` · ${previa.dados_de_baja} se dieron de baja` : ''}</span>
          {modo === 'filtro' && previa.total === 0 && <small>Nadie con esa especialidad todavía: clasifica tu cartera en Clientes.</small>}</div>}
      </section>

      <section className="card dif-sec">
        <h3>2 · ¿Qué les mandas?</h3>
        <input className="pc-campo" value={c.titulo} onChange={(e) => setC({ ...c, titulo: e.target.value })} maxLength={120} placeholder="Título (asunto del correo)" aria-label="Título" data-testid="dif-titulo" />
        <textarea className="pc-campo" rows={5} value={c.texto} onChange={(e) => setC({ ...c, texto: e.target.value })} maxLength={2000} placeholder="Tu mensaje" aria-label="Mensaje" data-testid="dif-texto" />
        <input className="pc-campo" value={c.enlace} onChange={(e) => setC({ ...c, enlace: e.target.value })} maxLength={500} placeholder="Enlace o video (opcional): https://…" aria-label="Enlace" inputMode="url" data-testid="dif-enlace" />
        <div className="dif-img">
          {c.imagen ? <><img src={c.imagen} alt="" /><button type="button" className="btn ghost sm" onClick={() => setC({ ...c, imagen: '' })}><X size={14} /> Quitar imagen</button></>
            : <label className="btn ghost sm"><ImagePlus size={15} /> Agregar imagen<input type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => void subirImagen(e.target.files?.[0])} data-testid="dif-imagen" /></label>}
        </div>
        <div className="dif-canales">
          <label className="pc-check"><input type="checkbox" checked={canales.correo} onChange={(e) => setCanales({ ...canales, correo: e.target.checked })} data-testid="dif-canal-correo" /> Por correo</label>
          <label className="pc-check"><input type="checkbox" checked={canales.chat} onChange={(e) => setCanales({ ...canales, chat: e.target.checked })} data-testid="dif-canal-chat" /> Por su chat del portal</label>
          <button type="button" className="btn ghost sm" onClick={() => setVerCorreo((v) => !v)}>{verCorreo ? 'Ocultar' : 'Ver'} cómo llega el correo</button>
        </div>
        {verCorreo && <iframe title="Vista previa del correo" srcDoc={correoPrevia.html} sandbox="" className="dif-iframe" data-testid="dif-previa-correo" />}
        {msg && <div className={'pc-msg' + (msg.ok ? ' ok' : '')} role={msg.ok ? 'status' : 'alert'} data-testid="dif-msg">{msg.texto}</div>}
        <div className="pc-acciones dif-acc">
          <button type="button" className="btn ghost" disabled={ocupado || !listo} onClick={() => void prueba()} data-testid="dif-prueba">Mándame una prueba</button>
          <button type="button" className="btn" disabled={ocupado || !listo || !previa || previa.total === 0} onClick={() => void enviar()} data-testid="dif-enviar"><Send size={15} /> Mandar{alcance ? ` (${alcance})` : ''}</button>
        </div>
      </section>
    </div>
  )
}

function MisListas({ cliente, listas, recargar }: { cliente: ClienteDifusiones; listas: Lista[]; recargar: () => Promise<void> }) {
  const especialidades = useEspecialidades()
  const [sel, setSel] = useState<Lista | null>(null)
  const [q, setQ] = useState('')
  const [soloLista, setSoloLista] = useState(true)
  const [clientes, setClientes] = useState<ClienteLista[]>([])
  const [msg, setMsg] = useState<string | null>(null)
  const [fTipo, setFTipo] = useState<TipoCliente | null>('doctor')
  const [fEsp, setFEsp] = useState<string | null>(null)
  const cargar = useCallback(async () => { if (!sel) return; const r = await cliente.buscarClientes(sel.id, q.trim(), soloLista); if (r.ok) setClientes(r.data) }, [cliente, sel, q, soloLista])
  useEffect(() => { const h = window.setTimeout(() => void cargar(), q ? 300 : 0); return () => window.clearTimeout(h) }, [cargar, q])
  const crear = async () => {
    const nombre = window.prompt('Nombre de la lista (p. ej. «Dermatólogos VIP», «Clínicas Culiacán»):')
    if (!nombre?.trim()) return
    const r = await cliente.guardarLista(null, nombre.trim())
    if (!r.ok) { setMsg(r.mensaje); return }
    await recargar(); setSel({ id: r.data.id, nombre: r.data.nombre, es_mia: true, vendedor: null, clientes: 0 }); setSoloLista(false)
  }
  const cambiar = async (cl: ClienteLista) => {
    if (!sel) return
    const r = await cliente.cambiarClientes(sel.id, [cl.customer_id], !cl.en_lista)
    if (!r.ok) { setMsg(r.mensaje); return }
    setClientes((xs) => xs.map((x) => (x.customer_id === cl.customer_id ? { ...x, en_lista: !x.en_lista } : x)))
    setSel({ ...sel, clientes: r.data.clientes }); void recargar()
  }
  const porFiltro = async () => {
    if (!sel) return
    const r = await cliente.agregarPorFiltro(sel.id, fTipo, fEsp)
    if (!r.ok) { setMsg(r.mensaje); return }
    setSel({ ...sel, clientes: r.data.clientes }); setMsg(`La lista ahora tiene ${r.data.clientes} clientes.`); void recargar(); void cargar()
  }
  const borrar = async () => {
    if (!sel || !window.confirm(`¿Borrar la lista «${sel.nombre}»? Los clientes no se borran.`)) return
    const r = await cliente.borrarLista(sel.id)
    if (!r.ok) { setMsg(r.mensaje); return }
    setSel(null); void recargar()
  }

  if (!sel) return (
    <section className="card dif-sec" data-testid="dif-listas">
      <div className="dif-sec-h"><h3>Mis listas</h3><button type="button" className="btn sm" onClick={() => void crear()} data-testid="dif-nueva-lista"><Plus size={14} /> Nueva lista</button></div>
      {msg && <div className="pce-error" role="alert">{msg}</div>}
      {listas.length === 0 ? <div className="pc-nota">Crea una lista, ponle nombre y agrega a los clientes que quieras (a mano o todos los de una especialidad).</div> : (
        <ul className="pcl-lista">{listas.map((l) => (
          <li key={l.id}><button type="button" className="pcl-prod" onClick={() => { setSel(l); setSoloLista(true); setQ('') }} data-testid="dif-lista-item">
            <span><b>{l.nombre}</b>{l.vendedor && <small>{l.vendedor}</small>}</span><span className="pcl-n">{l.clientes} {l.clientes === 1 ? 'cliente' : 'clientes'}</span>
          </button></li>))}
        </ul>
      )}
    </section>
  )
  return (
    <section className="card dif-sec" data-testid="dif-lista">
      <div className="dif-sec-h"><button type="button" className="btn ghost sm" onClick={() => setSel(null)}>← Mis listas</button><h3>{sel.nombre} <small>({sel.clientes})</small></h3>
        {sel.es_mia && <button type="button" className="rc-ico" onClick={() => void borrar()} aria-label="Borrar lista" title="Borrar lista"><Trash2 size={16} /></button>}</div>
      {sel.es_mia && (
        <div className="dif-filtro">
          <span className="pc-nota">Agregar todos los de:</span>
          <select className="pc-campo" value={fTipo ?? ''} onChange={(e) => setFTipo((e.target.value || null) as TipoCliente | null)} aria-label="Tipo para agregar"><option value="">Doctores y clínicas</option><option value="doctor">Doctores</option><option value="clinica">Clínicas</option></select>
          <select className="pc-campo" value={fEsp ?? ''} onChange={(e) => setFEsp(e.target.value || null)} aria-label="Especialidad para agregar"><option value="">Cualquier especialidad</option>{especialidades.map((x) => <option key={x.clave} value={x.clave}>{x.nombre}</option>)}</select>
          <button type="button" className="btn ghost sm" onClick={() => void porFiltro()} data-testid="dif-agregar-filtro"><Plus size={14} /> Agregar</button>
        </div>
      )}
      <div className="ccar-filtros">
        <span className="searchbox" style={{ flex: 1, minWidth: 200 }}><Search size={15} aria-hidden /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en tu cartera para agregar" aria-label="Buscar cliente" data-testid="dif-lista-q" /></span>
        <label className="pc-check"><input type="checkbox" checked={soloLista} onChange={(e) => setSoloLista(e.target.checked)} /> Solo los de la lista</label>
      </div>
      {msg && <div className="pc-msg ok" role="status">{msg}</div>}
      <ul className="ccar-lista">
        {clientes.map((cl) => (
          <li key={cl.customer_id} className="ccar-fila" data-testid="dif-lista-cliente">
            <span className="ccar-nom"><b>{capitalizarNombre(cl.nombre)}</b><small>{[cl.tipo ? ETIQUETA_TIPO[cl.tipo] : null, cl.especialidad, cl.ciudad, cl.con_correo ? null : 'sin correo', cl.con_cuenta ? 'con portal' : null].filter(Boolean).join(' · ')}</small></span>
            {sel.es_mia && <button type="button" className={'btn sm' + (cl.en_lista ? ' ghost' : '')} onClick={() => void cambiar(cl)}>{cl.en_lista ? <><Minus size={14} /> Quitar</> : <><Plus size={14} /> Agregar</>}</button>}
          </li>
        ))}
        {clientes.length === 0 && <li className="pc-nota">{soloLista ? 'La lista está vacía: busca clientes o agrégalos por especialidad.' : 'Sin clientes con ese nombre.'}</li>}
      </ul>
    </section>
  )
}

function Enviadas({ cliente }: { cliente: ClienteDifusiones }) {
  const [l, setL] = useState<Difusion[] | null>(null)
  useEffect(() => { void cliente.enviadas().then((r) => setL(r.ok ? r.data : [])) }, [cliente])
  if (!l) return <div className="pc-nota">Cargando…</div>
  if (!l.length) return <div className="card pc-nota">Aún no has mandado difusiones.</div>
  return (
    <ul className="card dif-enviadas" data-testid="dif-enviadas">
      {l.map((d) => (
        <li key={d.id}>
          <b>{d.titulo}</b>
          <small>{fmtDate(d.creada)} · {d.audiencia.tipo === 'lista' ? `lista «${d.lista ?? '—'}»` : d.audiencia.tipo === 'cartera' ? 'toda la cartera' : 'por filtro'}{!d.es_mia && d.vendedor ? ` · ${d.vendedor}` : ''}</small>
          <span><Check size={13} aria-hidden /> {d.correo} por correo · {d.chat} por chat{d.sin_correo ? ` · ${d.sin_correo} sin correo` : ''}{d.dados_de_baja ? ` · ${d.dados_de_baja} de baja` : ''}</span>
        </li>
      ))}
    </ul>
  )
}
