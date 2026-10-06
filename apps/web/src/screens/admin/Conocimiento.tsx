// CC-3 · Conocimiento de producto (Dirección): cobertura por producto, versiones por sección,
// borrador → aprobar (T1/T2 exigen fuente; T2 exige habilitación + confirmación) → retirar /
// restaurar, fuentes y la importación del conocimiento ya existente como borrador.
// No muestra ni edita precio, stock, costo ni fiscal: eso tiene sus propias pantallas.
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { conocimiento as clientePorDefecto, SECCIONES, TIPOS_FUENTE, type ClienteConocimiento, type Cobertura, type Fuente, type Version, type Claim } from '../../data/ops/conocimiento'

const input: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid var(--line, #e5e7eb)', borderRadius: 10, fontFamily: 'inherit', fontSize: 14, background: 'var(--card, #fff)', color: 'inherit' }
const sutil: React.CSSProperties = { fontSize: 12, color: 'var(--ink-3, #667)' }
const COLOR_ESTADO: Record<string, string> = { draft: '#b45309', approved: '#15803d', retired: '#6b7280' }
const ETIQUETA_ESTADO: Record<string, string> = { draft: 'Borrador', approved: 'Aprobada', retired: 'Retirada' }
const etiquetaSeccion = (k: string) => SECCIONES.find((s) => s.key === k)?.label ?? k

export function Conocimiento({ cliente = clientePorDefecto }: { cliente?: ClienteConocimiento }) {
  const [cobertura, setCobertura] = useState<Cobertura[]>([])
  const [fuentes, setFuentes] = useState<Fuente[]>([])
  const [filtro, setFiltro] = useState('')
  const [soloFaltantes, setSoloFaltantes] = useState(false)
  const [sel, setSel] = useState<Cobertura | null>(null)
  const [versiones, setVersiones] = useState<Version[]>([])
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [t2, setT2] = useState(false)
  const [editor, setEditor] = useState<{ id: string | null; rev: number | null; seccion: string; contenido: string; source_id: string } | null>(null)
  const [claims, setClaims] = useState<Claim[]>([])
  const [nuevaFuente, setNuevaFuente] = useState<{ tipo: string; referencia: string; documento_url: string; version: string } | null>(null)

  const cargar = useCallback(async () => {
    const [c, f] = await Promise.all([cliente.cobertura(), cliente.fuentes()])
    if (!c.ok) { setError(c.error); setCargando(false); return }
    setCobertura(c.data ?? []); if (f.ok) setFuentes(f.data ?? []); setError(null); setCargando(false)
  }, [cliente])
  const cargarVersiones = useCallback(async (p: Cobertura) => {
    const r = await cliente.listar(p.product_id)
    if (!r.ok) { setError(r.error); return }
    setVersiones(r.data ?? [])
  }, [cliente])
  useEffect(() => { void cargar() }, [cargar])

  const lista = useMemo(() => {
    const q = filtro.trim().toLowerCase()
    return cobertura.filter((c) => (!q || c.nombre.toLowerCase().includes(q) || (c.familia ?? '').toLowerCase().includes(q) || (c.categoria ?? '').toLowerCase().includes(q)) && (!soloFaltantes || c.aprobadas.length === 0))
  }, [cobertura, filtro, soloFaltantes])
  const resumen = useMemo(() => ({ total: cobertura.length, conAlgo: cobertura.filter((c) => c.aprobadas.length > 0).length, conBorrador: cobertura.filter((c) => c.borradores.length > 0).length }), [cobertura])

  const abrir = async (p: Cobertura) => { setSel(p); setEditor(null); setClaims([]); setAviso(null); await cargarVersiones(p) }
  const refrescar = async () => { await cargar(); if (sel) { const s = cobertura.find((c) => c.product_id === sel.product_id); await cargarVersiones(s ?? sel) } }

  const guardar = async () => {
    if (!sel || !editor) return
    const r = await cliente.guardar({ product_id: sel.product_id, seccion: editor.seccion, contenido: editor.contenido, source_id: editor.source_id || null, id: editor.id, rev: editor.rev })
    if (!r.ok) { setError(r.error); return }
    setError(null); setClaims(r.data.claims ?? []); setAviso(`Borrador v${r.data.version} guardado (${r.data.nivel}).`); setEditor(null); await refrescar()
  }
  const aprobar = async (v: Version) => {
    let confirmar = false
    if (v.nivel === 'T2') { confirmar = window.confirm('Contenido clínico/regulatorio (T2). ¿Confirmas que fue revisado y que Renovacell asume su publicación a doctores verificados?'); if (!confirmar) return }
    const r = await cliente.aprobar(v.id, confirmar)
    if (!r.ok) { setError(r.error); return }
    setError(null); setAviso(`Aprobada ${etiquetaSeccion(v.seccion)} v${v.version}${r.data.retirada ? ' (la versión anterior quedó retirada)' : ''}.`); await refrescar()
  }
  const retirar = async (v: Version) => {
    const motivo = window.prompt('Motivo del retiro:'); if (!motivo) return
    const r = await cliente.retirar(v.id, motivo); if (!r.ok) { setError(r.error); return }
    setError(null); setAviso('Versión retirada.'); await refrescar()
  }
  const restaurar = async (v: Version) => {
    const r = await cliente.restaurar(v.id); if (!r.ok) { setError(r.error); return }
    setError(null); setAviso(`Copiada como borrador v${r.data.version}; revísala y apruébala.`); await refrescar()
  }
  const importar = async () => {
    if (!window.confirm('Importa como BORRADOR lo que el catálogo ya sabe (presentación, tagline, chips, folletos, textos del sitio). Nada se aprueba automáticamente. ¿Continuar?')) return
    const r = await cliente.importar(); if (!r.ok) { setError(r.error); return }
    const d = r.data; setAviso(`Importado como borrador: ${Object.entries(d).map(([k, n]) => `${k} ${n}`).join(' · ')}.`); await refrescar()
  }
  const cambiarT2 = async () => {
    const siguiente = !t2
    if (siguiente && !window.confirm('Habilitar T2 permite aprobar y servir contenido clínico/regulatorio a doctores verificados. ¿Dirección lo autoriza?')) return
    const r = await cliente.configurarT2(siguiente); if (!r.ok) { setError(r.error); return }
    setT2(r.data); setAviso(r.data ? 'T2 habilitado.' : 'T2 bloqueado.')
  }
  const registrarFuente = async () => {
    if (!nuevaFuente?.referencia.trim()) return
    const r = await cliente.registrarFuente({ tipo: nuevaFuente.tipo, referencia: nuevaFuente.referencia.trim(), documento_url: nuevaFuente.documento_url.trim() || null, version: nuevaFuente.version.trim() || null })
    if (!r.ok) { setError(r.error); return }
    setNuevaFuente(null); setAviso('Fuente registrada.'); const f = await cliente.fuentes(); if (f.ok) setFuentes(f.data ?? [])
    if (editor) setEditor({ ...editor, source_id: r.data })
  }

  const editarVersion = (v: Version) => { setEditor({ id: v.id, rev: v.rev, seccion: v.seccion, contenido: v.contenido, source_id: v.source_id ?? '' }); setClaims([]) }
  const nuevaSeccion = (seccion: string) => { setEditor({ id: null, rev: null, seccion, contenido: '', source_id: '' }); setClaims([]) }
  const nivelEditor = SECCIONES.find((s) => s.key === editor?.seccion)?.nivel

  return (
    <div className="card" data-testid="conocimiento">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>Conocimiento de producto</h2>
          <p style={{ margin: 0, ...sutil }}>Lo que la IA y el equipo pueden afirmar de cada producto: por sección, con versión, fuente y aprobación de Dirección. Precio, existencias y fiscal viven en sus propias pantallas.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label style={{ ...sutil, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={t2} onChange={cambiarT2} data-testid="t2-switch" /> Contenido clínico (T2) habilitado</label>
          <button type="button" className="btn" onClick={importar} data-testid="btn-importar">Importar lo existente como borrador</button>
        </div>
      </div>
      {error && <div role="alert" style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, background: '#fef2f2', color: '#991b1b', fontSize: 13 }}>{error}</div>}
      {aviso && <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, background: '#f0fdf4', color: '#166534', fontSize: 13 }}>{aviso}</div>}
      <div style={{ display: 'flex', gap: 16, marginTop: 12, ...sutil }} data-testid="resumen">
        <span>Productos: <b>{resumen.total}</b></span><span>Con algo aprobado: <b>{resumen.conAlgo}</b></span><span>Con borradores: <b>{resumen.conBorrador}</b></span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: sel ? 'minmax(260px, 1fr) 2fr' : '1fr', gap: 16, marginTop: 16 }}>
        <section>
          <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
            <input style={input} placeholder="Buscar producto, familia o categoría" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
            <label style={{ ...sutil, whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={soloFaltantes} onChange={(e) => setSoloFaltantes(e.target.checked)} /> Sin aprobadas</label>
          </div>
          {cargando && <div style={sutil}>Cargando…</div>}
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 560, overflow: 'auto' }}>
            {lista.map((c) => (
              <li key={c.product_id}>
                <button type="button" onClick={() => void abrir(c)} data-testid="producto-item" style={{ width: '100%', textAlign: 'left', padding: '8px 10px', borderRadius: 10, border: '1px solid ' + (sel?.product_id === c.product_id ? 'var(--accent, #2563eb)' : 'var(--line, #e5e7eb)'), background: 'var(--card, #fff)', cursor: 'pointer' }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{c.nombre}{c.es_padre ? ' · familia' : ''}</div>
                  <div style={sutil}>{[c.categoria, c.familia].filter(Boolean).join(' · ')} — {c.aprobadas.length} aprobadas{c.borradores.length ? `, ${c.borradores.length} borrador${c.borradores.length > 1 ? 'es' : ''}` : ''}</div>
                </button>
              </li>
            ))}
          </ul>
        </section>

        {sel && (
          <section data-testid="detalle">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <h3 style={{ margin: 0 }}>{sel.nombre}</h3>
              <button type="button" className="btn" onClick={() => { setSel(null); setEditor(null) }}>Cerrar</button>
            </div>
            <div style={{ ...sutil, margin: '4px 0 12px' }}>Faltan T0: {(sel.faltantes_t0 ?? []).map(etiquetaSeccion).join(', ') || 'nada'} · Faltan T1: {(sel.faltantes_t1 ?? []).map(etiquetaSeccion).join(', ') || 'nada'}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {SECCIONES.map((s) => <button key={s.key} type="button" className="btn" style={{ fontSize: 12 }} onClick={() => nuevaSeccion(s.key)} data-testid={`nueva-${s.key}`}>+ {s.label} <span style={sutil}>{s.nivel}</span></button>)}
            </div>

            {editor && (
              <div style={{ border: '1px solid var(--line, #e5e7eb)', borderRadius: 12, padding: 12, marginBottom: 12 }} data-testid="editor">
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                  <strong>{editor.id ? 'Editar borrador' : 'Nueva versión'} · {etiquetaSeccion(editor.seccion)}</strong><span style={sutil}>{nivelEditor}{nivelEditor !== 'T0' ? ' · exige fuente' : ''}{nivelEditor === 'T2' ? ' · requiere T2 habilitado' : ''}</span>
                </div>
                <textarea style={{ ...input, minHeight: 120 }} maxLength={4000} value={editor.contenido} onChange={(e) => setEditor({ ...editor, contenido: e.target.value })} placeholder="Texto que Renovacell puede afirmar. Sin precios, sin existencias, sin promesas." data-testid="editor-contenido" />
                <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <select style={{ ...input, width: 'auto', flex: 1 }} value={editor.source_id} onChange={(e) => setEditor({ ...editor, source_id: e.target.value })} data-testid="editor-fuente">
                    <option value="">Sin fuente</option>
                    {fuentes.map((f) => <option key={f.id} value={f.id}>{f.tipo} · {f.referencia}{f.version ? ` (${f.version})` : ''}</option>)}
                  </select>
                  <button type="button" className="btn" onClick={() => setNuevaFuente({ tipo: 'fabricante', referencia: '', documento_url: '', version: '' })}>+ Fuente</button>
                  <button type="button" className="btn btn-primary" onClick={guardar} disabled={!editor.contenido.trim()} data-testid="btn-guardar">Guardar borrador</button>
                  <button type="button" className="btn" onClick={() => setEditor(null)}>Cancelar</button>
                </div>
                {nuevaFuente && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr auto auto', gap: 8, marginTop: 8, alignItems: 'center' }}>
                    <select style={{ ...input, width: 'auto' }} value={nuevaFuente.tipo} onChange={(e) => setNuevaFuente({ ...nuevaFuente, tipo: e.target.value })}>{TIPOS_FUENTE.map((t) => <option key={t} value={t}>{t}</option>)}</select>
                    <input style={input} placeholder="Referencia (p. ej. Ficha técnica fabricante 2026)" value={nuevaFuente.referencia} onChange={(e) => setNuevaFuente({ ...nuevaFuente, referencia: e.target.value })} />
                    <input style={input} placeholder="URL del documento (https://…)" value={nuevaFuente.documento_url} onChange={(e) => setNuevaFuente({ ...nuevaFuente, documento_url: e.target.value })} />
                    <input style={{ ...input, width: 90 }} placeholder="Versión" value={nuevaFuente.version} onChange={(e) => setNuevaFuente({ ...nuevaFuente, version: e.target.value })} />
                    <button type="button" className="btn btn-primary" onClick={registrarFuente}>Registrar</button>
                  </div>
                )}
              </div>
            )}
            {claims.length > 0 && (
              <div style={{ marginBottom: 12, padding: '8px 12px', borderRadius: 8, background: '#fffbeb', color: '#92400e', fontSize: 13 }} data-testid="claims">
                Revisión de claims: {claims.map((c) => `${c.tipo}: ${c.motivo}`).join(' · ')}
              </div>
            )}

            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {versiones.length === 0 && <li style={sutil}>Sin versiones. Crea la primera con los botones de sección.</li>}
              {versiones.map((v) => (
                <li key={v.id} style={{ border: '1px solid var(--line, #e5e7eb)', borderRadius: 10, padding: '10px 12px' }} data-testid="version-item">
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                    <div><strong>{etiquetaSeccion(v.seccion)}</strong> <span style={sutil}>{v.nivel} · v{v.version}</span> <span style={{ fontSize: 12, fontWeight: 600, color: COLOR_ESTADO[v.estado] }}>{ETIQUETA_ESTADO[v.estado]}</span></div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      {v.estado === 'draft' && <><button type="button" className="btn" onClick={() => editarVersion(v)}>Editar</button><button type="button" className="btn btn-primary" onClick={() => void aprobar(v)} data-testid="btn-aprobar">Aprobar</button></>}
                      {v.estado === 'approved' && <button type="button" className="btn" onClick={() => void retirar(v)}>Retirar</button>}
                      {v.estado === 'retired' && <button type="button" className="btn" onClick={() => void restaurar(v)}>Restaurar como borrador</button>}
                    </div>
                  </div>
                  <div style={{ marginTop: 6, whiteSpace: 'pre-wrap', fontSize: 14 }}>{v.contenido}</div>
                  <div style={{ ...sutil, marginTop: 4 }}>{v.fuente ? `Fuente: ${v.fuente}` : 'Sin fuente'}{v.importado_de ? ` · importado de ${v.importado_de}` : ''}{v.retired_reason ? ` · retiro: ${v.retired_reason}` : ''}</div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  )
}
