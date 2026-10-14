// MI VERIFICACIÓN · el doctor ve en qué va su verificación y completa o corrige su cédula y las fotos del INE.
// Mandarlo la deja otra vez en revisión y avisa a Dirección y a su vendedor; aprobar nunca es automático.
import React, { useCallback, useEffect, useState } from 'react'
import { useRole } from '../../auth/RoleContext'
import { completarVerificacion as completarPorDefecto, miVerificacion as leerPorDefecto, reducirFoto, type MiVerificacion as Estado } from '../../data/ops/verificacion'
import { textoFaltan } from './AvisoVerificacion'

const ESTADO: Record<string, string> = { pending: 'En revisión', verified: 'Verificada', rejected: 'No aprobada', revoked: 'Acceso retirado' }

export function MiVerificacion({ leer = leerPorDefecto, completar = completarPorDefecto, reducir = reducirFoto }: { leer?: typeof leerPorDefecto; completar?: typeof completarPorDefecto; reducir?: typeof reducirFoto }) {
  const { actualizarVerificacion } = useRole()
  const [v, setV] = useState<Estado | null>(null)
  const [cedula, setCedula] = useState(''); const [frente, setFrente] = useState<string | null>(null); const [reverso, setReverso] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null); const [enviando, setEnviando] = useState(false)
  const cargar = useCallback(async () => { const r = await leer(); if (r) { setV(r); setCedula((c) => c || r.cedula || ''); if (r.verificado) actualizarVerificacion(true) } }, [leer, actualizarVerificacion])
  useEffect(() => { void cargar() }, [cargar])
  const foto = (set: (s: string | null) => void) => async (e: React.ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (!f) return; set(await reducir(f)); setMsg(null) }
  const enviar = async () => {
    if (enviando) return
    setEnviando(true); setMsg(null)
    const r = await completar({ cedula: cedula.trim(), ineFront: frente, ineBack: reverso })
    setEnviando(false)
    if (!r.ok) { setMsg({ ok: false, texto: r.mensaje }); return }
    setFrente(null); setReverso(null); setMsg({ ok: true, texto: 'Listo: lo revisaremos y te avisaremos aquí.' }); await cargar()
  }
  if (!v) return <div className="card" style={{ color: 'var(--ink-3)' }}>Cargando…</div>
  if (v.verificado) return <div className="card" data-testid="mi-verificacion-ok"><b>Tu cuenta está verificada.</b> Ya puedes ver precios y hacer pedidos.</div>
  const rechazado = v.estado === 'rejected' || v.estado === 'revoked'
  const campo: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 15 }
  return (
    <div className="grid" style={{ gap: 14, maxWidth: 640 }} data-testid="mi-verificacion">
      <div className="card">
        <div style={{ fontSize: 12, textTransform: 'uppercase', color: 'var(--ink-3)', letterSpacing: '.06em' }}>Estado</div>
        <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>{ESTADO[v.estado] ?? v.estado}</div>
        {rechazado && v.motivo && <div style={{ marginTop: 6, color: 'var(--danger)' }} data-testid="mi-verificacion-motivo">Motivo: {v.motivo}</div>}
        {v.faltan.length > 0 && <div style={{ marginTop: 6, color: 'var(--ink-2)' }}>Para avanzar nos falta {textoFaltan(v.faltan)}.</div>}
        {!rechazado && v.faltan.length === 0 && <div style={{ marginTop: 6, color: 'var(--ink-2)' }}>Tenemos todo lo necesario; te avisaremos aquí en cuanto se revise.</div>}
      </div>
      <div className="card" style={{ display: 'grid', gap: 12 }}>
        <div style={{ fontWeight: 600 }}>{rechazado ? 'Corrige tus datos' : 'Completa o corrige tus datos'}</div>
        <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>Cédula profesional<input style={campo} value={cedula} onChange={(e) => { setCedula(e.target.value); setMsg(null) }} inputMode="numeric" maxLength={40} aria-label="Cédula profesional" /></label>
        <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>INE · frente<input type="file" accept="image/*" capture="environment" onChange={foto(setFrente)} aria-label="INE frente" data-testid="mi-ine-frente" /></label>
        {frente && <img src={frente} alt="INE frente" style={{ width: 180, borderRadius: 8, border: '1px solid var(--line)' }} />}
        <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>INE · reverso<input type="file" accept="image/*" capture="environment" onChange={foto(setReverso)} aria-label="INE reverso" data-testid="mi-ine-reverso" /></label>
        {reverso && <img src={reverso} alt="INE reverso" style={{ width: 180, borderRadius: 8, border: '1px solid var(--line)' }} />}
        {msg && <div role={msg.ok ? 'status' : 'alert'} style={{ color: msg.ok ? 'var(--green-deep)' : 'var(--danger)', fontSize: 13 }}>{msg.texto}</div>}
        <button type="button" className="btn" disabled={enviando || (!cedula.trim() && !frente && !reverso)} onClick={() => void enviar()} data-testid="mi-verificacion-enviar">{enviando ? 'Enviando…' : 'Enviar a revisión'}</button>
        <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Tus fotos se guardan de forma privada y solo las ve quien revisa tu verificación.</div>
      </div>
    </div>
  )
}
