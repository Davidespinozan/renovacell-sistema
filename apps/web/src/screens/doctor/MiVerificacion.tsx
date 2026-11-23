// MI VERIFICACIÓN · el doctor ve en qué va su verificación y completa o corrige su cédula.
// SIN-INE (23 nov 2026, dueño: «ya no lo vamos a pedir»): solo cédula; ya no se piden fotos de la INE.
// Mandarlo la deja otra vez en revisión y avisa a Dirección y a su vendedor; aprobar nunca es automático.
import React, { useCallback, useEffect, useState } from 'react'
import { Cargando } from '../../app/EmptyState'
import { useRole } from '../../auth/RoleContext'
import { completarVerificacion as completarPorDefecto, miVerificacion as leerPorDefecto, type MiVerificacion as Estado } from '../../data/ops/verificacion'
import { textoFaltan } from './AvisoVerificacion'
import { Icon } from '../../app/icons'

const ESTADO: Record<string, string> = { pending: 'En revisión', verified: 'Verificada', rejected: 'No aprobada', revoked: 'Acceso retirado' }

export function MiVerificacion({ leer = leerPorDefecto, completar = completarPorDefecto }: { leer?: typeof leerPorDefecto; completar?: typeof completarPorDefecto }) {
  const { actualizarVerificacion, setScreen } = useRole()
  const [v, setV] = useState<Estado | null>(null)
  const [cedula, setCedula] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null); const [enviando, setEnviando] = useState(false)
  const cargar = useCallback(async () => { const r = await leer(); if (r) { setV(r); setCedula((c) => c || r.cedula || ''); if (r.verificado) actualizarVerificacion(true) } }, [leer, actualizarVerificacion])
  useEffect(() => { void cargar() }, [cargar])
  const enviar = async () => {
    if (enviando) return
    setEnviando(true); setMsg(null)
    const r = await completar({ cedula: cedula.trim() })
    setEnviando(false)
    if (!r.ok) { setMsg({ ok: false, texto: r.mensaje }); return }
    setMsg({ ok: true, texto: 'Listo: lo revisaremos y te avisaremos aquí.' }); await cargar()
  }
  if (!v) return <Cargando filas={4} />
  // Verificada: bloque de éxito con salida directa al catálogo (antes era una frase suelta sin acción).
  if (v.verificado) return (
    <div className="card pp-verif-ok" data-testid="mi-verificacion-ok">
      <span className="pp-verif-ic" aria-hidden="true"><Icon name="check" /></span>
      <div className="pp-verif-t">Cuenta verificada</div>
      <div className="pp-verif-d">Ya puedes ver precios y hacer pedidos.</div>
      <button type="button" className="btn" onClick={() => setScreen('catalogo')} data-testid="mi-verificacion-ver-catalogo">Ver catálogo</button>
    </div>
  )
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
        {msg && <div role={msg.ok ? 'status' : 'alert'} style={{ color: msg.ok ? 'var(--green-deep)' : 'var(--danger)', fontSize: 13 }}>{msg.texto}</div>}
        <button type="button" className="btn" disabled={enviando || !cedula.trim()} onClick={() => void enviar()} data-testid="mi-verificacion-enviar">{enviando ? 'Enviando…' : 'Enviar a revisión'}</button>
        <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Tu cédula solo la ve quien revisa tu verificación.</div>
      </div>
    </div>
  )
}
