// R4-C10 · Manual de ventas (Dirección): lo que la IA y el equipo pueden afirmar de la EMPRESA (quiénes somos, cómo comprar,
// verificación, pagos, envíos, facturación, devoluciones, política comercial…). Borrador → aprobar → retirar, con versión y
// revisión de claims en la base. La IA del canal usa SOLO lo aprobado. Un borrador con "[COMPLETAR" no se aprueba.
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { conocimiento as clientePorDefecto, TEMAS_EMPRESA, tieneMarcaPendiente, type ClienteConocimiento, type VersionEmpresa, type Claim } from '../../data/ops/conocimiento'

const input: React.CSSProperties = { width: '100%', padding: '9px 11px', border: '1px solid var(--line, #e5e7eb)', borderRadius: 10, fontFamily: 'inherit', fontSize: 14, background: 'var(--card, #fff)', color: 'inherit' }
const sutil: React.CSSProperties = { fontSize: 12, color: 'var(--ink-3, #667)' }
const COLOR_ESTADO: Record<string, string> = { draft: '#b45309', approved: '#15803d', retired: '#6b7280' }
const ETIQUETA_ESTADO: Record<string, string> = { draft: 'Borrador', approved: 'Aprobada', retired: 'Retirada' }
const ETIQUETA_AUDIENCIA: Record<string, string> = { public: 'Cualquier contacto', verified: 'Solo doctores verificados', staff: 'Solo equipo' }

type Editor = { id: string | null; rev: number | null; tema: string; titulo: string; contenido: string; audiencia: 'public' | 'verified' }

export function ManualVentas({ cliente = clientePorDefecto }: { cliente?: ClienteConocimiento }) {
  const [versiones, setVersiones] = useState<VersionEmpresa[]>([])
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [verRetiradas, setVerRetiradas] = useState(false)
  const [editor, setEditor] = useState<Editor | null>(null)
  const [claims, setClaims] = useState<Claim[]>([])

  const cargar = useCallback(async () => {
    const r = await cliente.empresaListar()
    if (!r.ok) { setError(r.error); setCargando(false); return }
    setVersiones(r.data ?? []); setError(null); setCargando(false)
  }, [cliente])
  useEffect(() => { void cargar() }, [cargar])

  const porTema = useMemo(() => {
    const m = new Map<string, VersionEmpresa[]>()
    for (const v of versiones) if (verRetiradas || v.estado !== 'retired') m.set(v.tema, [...(m.get(v.tema) ?? []), v])
    return m
  }, [versiones, verRetiradas])
  const resumen = useMemo(() => {
    const aprobados = new Set(versiones.filter((v) => v.estado === 'approved').map((v) => v.tema))
    return { aprobados: aprobados.size, borradores: versiones.filter((v) => v.estado === 'draft').length, vacios: TEMAS_EMPRESA.filter((t) => !aprobados.has(t.key)).length }
  }, [versiones])

  const guardar = async () => {
    if (!editor) return
    const r = await cliente.empresaGuardar({ tema: editor.tema, titulo: editor.titulo.trim(), contenido: editor.contenido, audiencia: editor.audiencia, id: editor.id, rev: editor.rev })
    if (!r.ok) { setError(r.error); return }
    setError(null); setClaims(r.data.claims ?? []); setAviso(`Borrador v${r.data.version} guardado. Revísalo y apruébalo para que la IA lo use.`); setEditor(null); await cargar()
  }
  const aprobar = async (v: VersionEmpresa) => {
    if (tieneMarcaPendiente(v.contenido)) { setError('Este borrador todavía tiene partes marcadas como [COMPLETAR …]. Complétalas antes de aprobar.'); return }
    if (!window.confirm(`¿Aprobar «${v.titulo}»? Desde ese momento la IA y el equipo lo usan al atender clientes.`)) return
    const r = await cliente.empresaAprobar(v.id)
    if (!r.ok) { setError(r.error); return }
    setError(null); setAviso(`Aprobado «${v.titulo}» v${v.version}${r.data.retirada ? ' (la versión anterior quedó retirada)' : ''}.`); await cargar()
  }
  const retirar = async (v: VersionEmpresa) => {
    const motivo = window.prompt('Motivo del retiro:'); if (!motivo) return
    const r = await cliente.empresaRetirar(v.id, motivo); if (!r.ok) { setError(r.error); return }
    setError(null); setAviso('Retirado: la IA deja de usarlo.'); await cargar()
  }
  const nuevo = (tema: string) => { setEditor({ id: null, rev: null, tema, titulo: '', contenido: '', audiencia: 'public' }); setClaims([]) }
  const editar = (v: VersionEmpresa) => { setEditor({ id: v.id, rev: v.rev, tema: v.tema, titulo: v.titulo, contenido: v.contenido, audiencia: v.audiencia === 'verified' ? 'verified' : 'public' }); setClaims([]) }
  const nuevaVersion = (v: VersionEmpresa) => { setEditor({ id: null, rev: null, tema: v.tema, titulo: v.titulo, contenido: v.contenido, audiencia: v.audiencia === 'verified' ? 'verified' : 'public' }); setClaims([]) }
  const hayBorrador = (v: VersionEmpresa) => versiones.some((x) => x.tema === v.tema && x.titulo === v.titulo && x.estado === 'draft')

  return (
    <div className="card" data-testid="manual-ventas">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>Manual de ventas</h2>
          <p style={{ margin: 0, ...sutil }}>Lo que la IA y el equipo saben de Renovacell: cómo comprar, verificación, pagos, envíos, facturación, devoluciones y política comercial. La IA usa solo lo aprobado. Dirección, horario y costos de envío ya salen del ERP.</p>
        </div>
        <label style={{ ...sutil, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={verRetiradas} onChange={(e) => setVerRetiradas(e.target.checked)} data-testid="ver-retiradas" /> Ver retiradas</label>
      </div>
      {error && <div role="alert" style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, background: '#fef2f2', color: '#991b1b', fontSize: 13 }}>{error}</div>}
      {aviso && <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, background: '#f0fdf4', color: '#166534', fontSize: 13 }}>{aviso}</div>}
      {claims.length > 0 && (
        <div style={{ marginTop: 12, padding: '8px 12px', borderRadius: 8, background: '#fffbeb', color: '#92400e', fontSize: 13 }} data-testid="claims">
          Revisión de claims: {claims.map((c) => `${c.tipo}: ${c.motivo}`).join(' · ')}
        </div>
      )}
      <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap', ...sutil }} data-testid="resumen">
        <span>Temas con algo aprobado: <b>{resumen.aprobados}</b> de {TEMAS_EMPRESA.length}</span><span>Borradores por revisar: <b>{resumen.borradores}</b></span>
      </div>
      {cargando && <div style={{ ...sutil, marginTop: 12 }}>Cargando…</div>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 16 }}>
        {TEMAS_EMPRESA.map((t) => {
          const items = porTema.get(t.key) ?? []
          return (
            <section key={t.key} style={{ border: '1px solid var(--line, #e5e7eb)', borderRadius: 12, padding: 12 }} data-testid={`tema-${t.key}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <div><strong>{t.label}</strong> <span style={sutil}>{t.ayuda}</span></div>
                <button type="button" className="btn ghost sm" onClick={() => nuevo(t.key)} data-testid={`nuevo-${t.key}`}>+ Agregar</button>
              </div>

              {editor && editor.tema === t.key && (
                <div style={{ border: '1px solid var(--line, #e5e7eb)', borderRadius: 12, padding: 12, marginTop: 10 }} data-testid="editor">
                  <input style={input} maxLength={160} placeholder="Título (p. ej. «Pago por transferencia»)" value={editor.titulo} disabled={!!editor.id} onChange={(e) => setEditor({ ...editor, titulo: e.target.value })} data-testid="editor-titulo" />
                  <textarea style={{ ...input, minHeight: 140, marginTop: 8 }} maxLength={4000} value={editor.contenido} onChange={(e) => setEditor({ ...editor, contenido: e.target.value })}
                    placeholder="Escríbelo como se lo explicaría tu mejor vendedor. Sin promesas que no se cumplan. Precios de productos: no (salen del portal)." data-testid="editor-contenido" />
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <select style={{ ...input, width: 'auto' }} value={editor.audiencia} onChange={(e) => setEditor({ ...editor, audiencia: e.target.value as Editor['audiencia'] })} data-testid="editor-audiencia">
                      <option value="public">Cualquier contacto</option>
                      <option value="verified">Solo doctores verificados</option>
                    </select>
                    <span style={sutil}>{editor.contenido.length}/4000</span>
                    <button type="button" className="btn btn-primary" onClick={guardar} disabled={!editor.titulo.trim() || !editor.contenido.trim()} data-testid="btn-guardar">Guardar borrador</button>
                    <button type="button" className="btn ghost" onClick={() => setEditor(null)}>Cancelar</button>
                  </div>
                </div>
              )}

              <ul style={{ listStyle: 'none', margin: '10px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
                {items.length === 0 && <li style={sutil}>Sin contenido todavía.</li>}
                {items.map((v) => {
                  const pendiente = v.estado === 'draft' && tieneMarcaPendiente(v.contenido)
                  return (
                    <li key={v.id} style={{ border: '1px solid var(--line, #e5e7eb)', borderRadius: 10, padding: '10px 12px' }} data-testid="version-item">
                      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        <div><strong title={v.importado_de ? `Importado de: ${v.importado_de}` : undefined}>{v.titulo}</strong> <span style={sutil}>v{v.version} · {ETIQUETA_AUDIENCIA[v.audiencia] ?? v.audiencia}</span> <span style={{ fontSize: 12, fontWeight: 600, color: COLOR_ESTADO[v.estado] }}>{ETIQUETA_ESTADO[v.estado]}</span>
                          {pendiente && <span style={{ fontSize: 12, fontWeight: 600, color: '#b91c1c', marginLeft: 6 }} data-testid="marca-pendiente">Falta completar</span>}</div>
                        {/* Acciones de fila en fantasma: el único verde sólido de la vista es «Guardar borrador». */}
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          {v.estado === 'draft' && <><button type="button" className="btn ghost sm" onClick={() => editar(v)}>Editar</button><button type="button" className="btn ghost sm" onClick={() => void aprobar(v)} disabled={pendiente} data-testid="btn-aprobar">Aprobar</button></>}
                          {v.estado === 'approved' && !hayBorrador(v) && <button type="button" className="btn ghost sm" onClick={() => nuevaVersion(v)} data-testid="btn-nueva-version">Nueva versión</button>}
                          {v.estado === 'approved' && <button type="button" className="btn ghost sm" style={{ color: 'var(--danger)' }} onClick={() => void retirar(v)}>Retirar</button>}
                        </div>
                      </div>
                      <div style={{ marginTop: 6, whiteSpace: 'pre-wrap', fontSize: 14 }}>{v.contenido}</div>
                      {/* El origen de importación (clave interna) ya no se pinta: queda como tooltip del título. */}
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
      </div>
    </div>
  )
}
