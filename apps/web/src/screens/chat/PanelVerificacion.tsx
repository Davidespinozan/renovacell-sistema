// VERIF-VENDEDOR · panel dentro de Conversaciones: si quien escribe es un doctor con verificación PENDIENTE y quien
// atiende puede verificarlo, aquí ve su cédula y las fotos del INE, y lo aprueba o rechaza (sin verificación automática).
import React, { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { candidatosEnlace as candidatosPorDefecto, capturarCedula as capturarPorDefecto, evidenciaDoctor, pendienteDeConversacion, unirEnlace as unirPorDefecto, verificarDoctor, type CandidatoEnlace, type DoctorPendiente } from '../../data/ops/verificacion'

const ETIQUETA: Record<string, string> = { 'ine-front': 'INE · frente', 'ine-back': 'INE · reverso' }

export function PanelVerificacion({ conversationId, leer = pendienteDeConversacion, verificar = verificarDoctor, evidencia = evidenciaDoctor, capturar = capturarPorDefecto, candidatos = candidatosPorDefecto, unir = unirPorDefecto, onCambio, onDoctor, version = 0 }: {
  conversationId: string; leer?: typeof pendienteDeConversacion; verificar?: typeof verificarDoctor; evidencia?: typeof evidenciaDoctor; capturar?: typeof capturarPorDefecto; onCambio?: () => void
  candidatos?: typeof candidatosPorDefecto; unir?: typeof unirPorDefecto   // CHAT PRO · unir la conversación del enlace
  onDoctor?: (d: DoctorPendiente | null) => void   // FOTOS · quien monta sabe si hay un doctor por verificar (para "Usar como INE")
  version?: number                                 // FOTOS · cambiarla recarga la evidencia (tras usar una foto del chat)
}) {
  const [d, setD] = useState<DoctorPendiente | null>(null)
  const [fotos, setFotos] = useState<Record<string, string>>({})
  const [nota, setNota] = useState(''); const [rechazando, setRechazando] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null); const [ocupado, setOcupado] = useState(false)
  const [cedula, setCedula] = useState(''); const [editCed, setEditCed] = useState(false)
  const [enlaces, setEnlaces] = useState<CandidatoEnlace[]>([])
  useEffect(() => {
    let vivo = true
    setD(null); setFotos({}); setMsg(null); setEnlaces([])
    void leer(conversationId).then(async (x) => {
      if (!vivo) return; onDoctor?.(x); if (!x) return; setD(x)
      const [f, c] = await Promise.all([evidencia(x.profile_id), candidatos(x.profile_id)])
      if (vivo) { setFotos(f); setEnlaces(c) }
    })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, leer, evidencia, candidatos, version])
  if (!d) return msg?.ok ? <div className="rc-contacto-ficha" role="status" data-testid="verificacion-hecha">{msg.texto}</div> : null
  const decidir = async (aprobar: boolean) => {
    if (ocupado) return
    setOcupado(true); setMsg(null)
    const r = await verificar(d.profile_id, aprobar, nota.trim() || null)
    setOcupado(false)
    if (!r.ok) { setMsg({ ok: false, texto: r.mensaje }); return }
    setMsg({ ok: true, texto: aprobar ? `${d.nombre ?? 'El doctor'} quedó verificado: ya ve precios y puede comprar.` : 'Verificación rechazada. El doctor sigue sin acceso a precios.' })
    setD(null); onDoctor?.(null); onCambio?.()
  }
  return (
    <div className="rc-contacto-ficha" data-testid="panel-verificacion">
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}><ShieldCheck size={16} style={{ color: 'var(--warn)' }} /><b>Verificación pendiente</b><span style={{ color: 'var(--mid)', fontSize: 12 }}>· tú puedes verificarlo</span></div>
      <div className="rc-contacto-datos">
        <span>{d.nombre ?? '—'}</span><span>{d.cedula ? `Cédula ${d.cedula}` : 'Sin cédula'}</span>
        {d.telefono && <a href={`tel:${d.telefono}`}>{d.telefono}</a>}{d.organizacion && <span>{d.organizacion}</span>}
      </div>
      {/* Sin SEP (decisión del dueño): la cédula la revisa una persona. Si el doctor la pasa por el chat, se captura aquí. */}
      {!editCed ? (
        <div><button type="button" className="rc-link" onClick={() => { setEditCed(true); setCedula(d.cedula ?? '') }} data-testid="btn-capturar-cedula">{d.cedula ? 'Corregir cédula' : 'Capturar cédula'}</button></div>
      ) : (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={cedula} onChange={(e) => setCedula(e.target.value)} inputMode="numeric" maxLength={20} placeholder="Número de cédula" aria-label="Cédula profesional del doctor" style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line)', minHeight: 34 }} />
          <button type="button" className="btn sm" disabled={ocupado || !cedula.trim()} onClick={() => void (async () => {
            setOcupado(true); setMsg(null)
            const r = await capturar(d.profile_id, cedula.trim())
            setOcupado(false)
            if (!r.ok) { setMsg({ ok: false, texto: r.mensaje }); return }
            setD({ ...d, cedula: cedula.replace(/\s+/g, '') }); setEditCed(false)
          })()} data-testid="btn-guardar-cedula">Guardar cédula</button>
          <button type="button" className="btn ghost sm" onClick={() => setEditCed(false)}>Cancelar</button>
        </div>
      )}
      {Object.keys(fotos).length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
          {Object.entries(fotos).filter(([k]) => ETIQUETA[k]).map(([k, u]) => <a key={k} href={u} target="_blank" rel="noreferrer" title={ETIQUETA[k] ?? k} data-testid={`evidencia-${k}`}><img src={u} alt={ETIQUETA[k] ?? k} style={{ width: 110, height: 70, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line)' }} /></a>)}
        </div>
      )}
      {/* CHAT PRO · se registró en otro dispositivo: su conversación del enlace se une a su cuenta (lo decide una persona). */}
      {enlaces.map((e) => (
        <div key={e.visitor_id} className="rc-enlace-cand" data-testid="candidato-enlace">
          <span>Escribió por el enlace de contacto como <b>{e.nombre}</b> ({e.mensajes} mensaje{e.mensajes === 1 ? '' : 's'}; coincide por {e.coincide}).</span>
          <button type="button" className="btn ghost sm" disabled={ocupado} onClick={() => void (async () => {
            setOcupado(true); setMsg(null)
            const r = await unir(d.profile_id, e.visitor_id)
            setOcupado(false)
            if (!r.ok) { setMsg({ ok: false, texto: r.mensaje }); return }
            setEnlaces((xs) => xs.filter((x) => x.visitor_id !== e.visitor_id)); onCambio?.()
          })()} data-testid="btn-unir-enlace">Unir a su cuenta</button>
        </div>
      ))}
      {Object.keys(d.evidencia ?? {}).length === 0 && <div style={{ fontSize: 12, color: 'var(--mid)' }}>Sin fotos de identificación: pídeselas por el chat antes de aprobar.</div>}
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
        <button type="button" className="btn sm" disabled={ocupado} onClick={() => void decidir(true)} data-testid="btn-aprobar-verificacion">Aprobar verificación</button>
        {!rechazando ? <button type="button" className="btn ghost sm" onClick={() => setRechazando(true)} data-testid="btn-rechazar-verificacion">Rechazar</button> : (<>
          <input value={nota} onChange={(e) => setNota(e.target.value)} maxLength={300} placeholder="Motivo del rechazo" aria-label="Motivo del rechazo" style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line)', minHeight: 34 }} />
          <button type="button" className="btn ghost sm" style={{ color: 'var(--danger)' }} disabled={ocupado || !nota.trim()} onClick={() => void decidir(false)} data-testid="btn-confirmar-rechazo">Rechazar verificación</button>
        </>)}
      </div>
      {msg && !msg.ok && <div role="alert" style={{ color: 'var(--danger)', fontSize: 12.5 }}>{msg.texto}</div>}
    </div>
  )
}
