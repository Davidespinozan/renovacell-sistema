// PROMO-9 · Flyers del portal (Dirección / Facturación): las piezas verticales que la empresa ya manda por WhatsApp e historias
// ("HOY ÚLTIMO DÍA · Botox $3,900", "¡Nuevo lote!") se suben aquí y el doctor las ve en su Inicio. Un flyer se liga a una
// promoción (vive y muere con ella: toma su vigencia, y su correo y su tarjeta del chat lo llevan) o a un producto, o va
// suelto con sus propias fechas. Pausar lo quita del portal sin borrarlo.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Plus } from 'lucide-react'
import { useProducts, isActiveProduct } from '../../data/hooks/useProducts'
import { usePricing } from '../../data/hooks/usePricing'
import { fechaPromo, type Promocion } from '../../data/ops/promociones'
import { ETIQUETA_FLYER, FLYER_MAX_MB, PILL_FLYER, eliminarFlyer, estadoFlyer, guardarFlyer, listarFlyers, revisarImagenFlyer, subirImagenFlyer, type Flyer, type FlyerDatos } from '../../data/ops/flyers'

const input: React.CSSProperties = { padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 10, fontFamily: 'inherit', fontSize: 13, outline: 'none', background: 'var(--card, #fff)', color: 'inherit', width: '100%' }
interface Form { id?: string; titulo: string; imagen_url: string; archivo: File | null; previa: string | null; promocion_id: string; product_id: string; desde: string; hasta: string; listas: string[] | null; orden: number }
const VACIO = (): Form => ({ titulo: '', imagen_url: '', archivo: null, previa: null, promocion_id: '', product_id: '', desde: '', hasta: '', listas: null, orden: 0 })

export function Flyers({ promociones = [], listar = listarFlyers, guardar = guardarFlyer, cambiarEstado = estadoFlyer, eliminar = eliminarFlyer, subir = subirImagenFlyer }:
  { promociones?: Pick<Promocion, 'id' | 'nombre' | 'estado' | 'desde' | 'hasta'>[]; listar?: typeof listarFlyers; guardar?: typeof guardarFlyer; cambiarEstado?: typeof estadoFlyer; eliminar?: typeof eliminarFlyer; subir?: typeof subirImagenFlyer }) {
  const { data: productos } = useProducts()
  const { lists: listas } = usePricing()
  const vendibles = useMemo(() => productos.filter((p) => isActiveProduct(p)).sort((a, b) => a.name.localeCompare(b.name)), [productos])
  const promosElegibles = useMemo(() => promociones.filter((p) => p.estado === 'vigente' || p.estado === 'proxima'), [promociones])
  const [lista, setLista] = useState<Flyer[] | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const archivoRef = useRef<HTMLInputElement | null>(null)
  const cargar = async () => { const r = await listar(true); if (r.ok) setLista(r.data); else setError(r.error) }
  useEffect(() => { void cargar() }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { if (form?.previa) URL.revokeObjectURL(form.previa) }, [form?.previa])

  const elegirArchivo = (f: File | null) => {
    if (!form) return
    if (!f) { setForm({ ...form, archivo: null, previa: null }); return }
    const motivo = revisarImagenFlyer(f)
    if (motivo) { setError(motivo); return }
    setError(null)
    let previa: string | null = null
    try { previa = URL.createObjectURL(f) } catch { previa = null }
    setForm({ ...form, archivo: f, previa, titulo: form.titulo || f.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim() })
  }
  const valido = (f: Form) => f.titulo.trim().length >= 2 && (!!f.archivo || !!f.imagen_url) && (!f.hasta || !f.desde || f.desde <= f.hasta)
  const guardarForm = async () => {
    if (!form || !valido(form) || ocupado) return
    setOcupado(true); setError(null)
    let url = form.imagen_url
    if (form.archivo) {
      const s = await subir(form.archivo)
      if (!s.ok) { setOcupado(false); setError(s.error); return }
      url = s.data
    }
    const d: FlyerDatos = { id: form.id, titulo: form.titulo.trim(), imagen_url: url, promocion_id: form.promocion_id || null, product_id: form.product_id || null, desde: form.desde || null, hasta: form.hasta || null, listas: form.listas, orden: form.orden }
    const r = await guardar(d)
    setOcupado(false)
    if (!r.ok) { setError(r.error); return }
    setForm(null); setAviso(`"${r.data.titulo}" ${form.id ? 'actualizado' : 'publicado'} · ${ETIQUETA_FLYER[r.data.estado].toLowerCase()}${r.data.estado === 'vigente' ? ': ya se ve en el Inicio de los doctores' : ''}.`)
    await cargar()
  }
  const pausar = async (f: Flyer) => { setError(null); const r = await cambiarEstado(f.id, !f.activo); if (!r.ok) { setError(r.error); return } await cargar() }
  const borrar = async (f: Flyer) => {
    if (!window.confirm(`¿Eliminar el flyer "${f.titulo}"? Deja de verse en el portal.`)) return
    setError(null); const r = await eliminar(f.id); if (!r.ok) { setError(r.error); return }
    setAviso(`"${f.titulo}" eliminado.`); await cargar()
  }
  const editar = (f: Flyer) => setForm({ id: f.id, titulo: f.titulo, imagen_url: f.imagen_url, archivo: null, previa: null, promocion_id: f.promocion_id ?? '', product_id: f.product_id ?? '', desde: f.desde?.slice(0, 10) ?? '', hasta: f.hasta?.slice(0, 10) ?? '', listas: f.listas, orden: f.orden })
  const vigenciaDe = (f: Flyer) => f.hasta ? `${fechaPromo(f.desde)} al ${fechaPromo(f.hasta)}` : `desde el ${fechaPromo(f.desde)}`

  return (
    <div className="card" data-testid="flyers">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700 }}>Flyers del portal</h4>
        <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>Las mismas piezas que mandas por WhatsApp e historias, en el Inicio de cada doctor. Vertical (1080 × 1920) se ve mejor.</span>
        <button className="btn sm" type="button" style={{ marginLeft: 'auto' }} onClick={() => { setForm(VACIO()); setError(null) }} data-testid="flyer-nuevo"><Plus size={14} /> Subir flyer</button>
      </div>
      {aviso && <div role="status" className="ms" style={{ color: 'var(--green-deep)', marginTop: 8 }} data-testid="flyer-aviso">{aviso}</div>}
      {error && <div role="alert" className="ms" style={{ color: 'var(--danger)', marginTop: 8 }}>{error}</div>}
      {form && (
        <div style={{ marginTop: 12, border: '1px solid var(--line)', borderRadius: 12, padding: 12, display: 'grid', gridTemplateColumns: 'minmax(120px, 160px) 1fr', gap: 14 }} data-testid="flyer-form">
          <div>
            <button type="button" onClick={() => archivoRef.current?.click()} aria-label="Elegir imagen del flyer" data-testid="flyer-elegir"
              style={{ width: '100%', aspectRatio: '9 / 16', border: '1px dashed var(--line)', borderRadius: 12, background: 'var(--surface-2, #f6f8f6)', display: 'grid', placeItems: 'center', overflow: 'hidden', cursor: 'pointer', padding: 0, fontFamily: 'inherit', color: 'var(--ink-3)', fontSize: 12 }}>
              {form.previa || form.imagen_url ? <img src={form.previa ?? form.imagen_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} data-testid="flyer-previa" /> : <span style={{ padding: 10, textAlign: 'center' }}>Toca para elegir la imagen<br />JPG, PNG o WebP · hasta {FLYER_MAX_MB} MB</span>}
            </button>
            <input ref={archivoRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} aria-label="Imagen del flyer" onChange={(e) => elegirArchivo(e.target.files?.[0] ?? null)} data-testid="flyer-archivo" />
          </div>
          <div style={{ display: 'grid', gap: 10, alignContent: 'start' }}>
            <label style={{ fontSize: 12 }}>Título (para ti y para el lector de pantalla)<input style={input} value={form.titulo} maxLength={80} onChange={(e) => setForm({ ...form, titulo: e.target.value })} aria-label="Título del flyer" /></label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <label style={{ fontSize: 12 }}>Promoción (opcional)
                <select style={input} value={form.promocion_id} onChange={(e) => setForm({ ...form, promocion_id: e.target.value })} aria-label="Promoción ligada" data-testid="flyer-promo">
                  <option value="">Ninguna</option>
                  {promosElegibles.map((p) => <option key={p.id} value={p.id}>{p.nombre} · {fechaPromo(p.desde)} al {fechaPromo(p.hasta)}</option>)}
                </select>
              </label>
              <label style={{ fontSize: 12 }}>Producto (opcional)
                <select style={input} value={form.product_id} onChange={(e) => setForm({ ...form, product_id: e.target.value })} aria-label="Producto ligado">
                  <option value="">Ninguno</option>
                  {vendibles.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </label>
            </div>
            {form.promocion_id ? (
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }} data-testid="flyer-vigencia-promo">Se muestra mientras dure la promoción y se va con ella. Su correo y su tarjeta del chat llevan este flyer.</div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <label style={{ fontSize: 12 }}>Desde (hoy si lo dejas vacío)<input style={input} type="date" value={form.desde} onChange={(e) => setForm({ ...form, desde: e.target.value })} aria-label="Desde" /></label>
                <label style={{ fontSize: 12 }}>Hasta (vacío = sin fecha)<input style={input} type="date" value={form.hasta} onChange={(e) => setForm({ ...form, hasta: e.target.value })} aria-label="Hasta" /></label>
              </div>
            )}
            {listas.length > 1 && (
              <div style={{ fontSize: 12.5, display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ color: 'var(--ink-3)' }}>Lo ven:</span>
                <label><input type="radio" checked={form.listas === null} onChange={() => setForm({ ...form, listas: null })} /> Todas las listas</label>
                {listas.map((l) => (
                  <label key={l.id}><input type="checkbox" checked={!!form.listas?.includes(l.id)} onChange={(e) => { const set = new Set(form.listas ?? []); if (e.target.checked) set.add(l.id); else set.delete(l.id); setForm({ ...form, listas: set.size ? [...set] : null }) }} /> {l.name}</label>
                ))}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
              <label style={{ fontSize: 12, marginRight: 'auto' }}>Orden <input style={{ ...input, width: 70, display: 'inline-block', marginLeft: 6 }} type="number" step={1} value={form.orden} onChange={(e) => setForm({ ...form, orden: Math.floor(Number(e.target.value) || 0) })} aria-label="Orden" /></label>
              <button className="btn ghost sm" type="button" onClick={() => setForm(null)}>Cancelar</button>
              <button className="btn sm" type="button" disabled={!valido(form) || ocupado} onClick={guardarForm} data-testid="flyer-guardar">{ocupado ? 'Subiendo…' : form.id ? 'Guardar cambios' : 'Publicar en el portal'}</button>
            </div>
          </div>
        </div>
      )}
      {lista === null ? <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 10 }}>Cargando…</div> : lista.length === 0 ? (
        <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 10 }}>Sin flyers todavía. Sube el primero y aparece en el Inicio de los doctores.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12, marginTop: 12 }} data-testid="flyers-lista">
          {lista.map((f) => (
            <div key={f.id} data-testid={`flyer-${f.id}`} style={{ border: '1px solid var(--line)', borderRadius: 12, overflow: 'hidden', background: 'var(--card, #fff)', opacity: f.estado === 'vigente' || f.estado === 'programado' ? 1 : 0.7, display: 'grid', gap: 6, paddingBottom: 8 }}>
              <div style={{ aspectRatio: '9 / 16', background: 'var(--surface-2, #f6f8f6)' }}><img src={f.imagen_url} alt={f.titulo} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /></div>
              <div style={{ padding: '0 10px', display: 'grid', gap: 3 }}>
                <b style={{ fontSize: 13, lineHeight: 1.25 }}>{f.titulo}</b>
                <span><span className={'pill ' + PILL_FLYER[f.estado]}>{ETIQUETA_FLYER[f.estado]}</span></span>
                <span style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{f.promocion ? `Promo: ${f.promocion}` : f.producto ? f.producto : vigenciaDe(f)}{f.listas ? ` · solo ${f.listas.map((id) => listas.find((l) => l.id === id)?.name ?? 'lista').join(', ')}` : ''}</span>
              </div>
              <div style={{ padding: '0 10px', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button className="btn ghost sm" type="button" onClick={() => editar(f)}>Editar</button>
                {f.estado !== 'terminado' && <button className="btn ghost sm" type="button" onClick={() => pausar(f)} data-testid={`flyer-pausar-${f.id}`}>{f.activo ? 'Pausar' : 'Activar'}</button>}
                <button className="btn ghost sm" type="button" style={{ color: 'var(--danger)' }} onClick={() => borrar(f)} data-testid={`flyer-eliminar-${f.id}`}>Eliminar</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
