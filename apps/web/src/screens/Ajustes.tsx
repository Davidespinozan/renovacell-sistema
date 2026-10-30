// AJUSTES de la app: activar los AVISOS de este dispositivo (Web Push real: permiso del navegador + registro del
// dispositivo en el servidor con activarAvisos). Antes solo pedía el permiso y el dispositivo nunca quedaba registrado,
// así que no llegaba nada. El texto dice exactamente qué avisa hoy. Disponible para todos los usuarios.
import React, { useEffect, useState } from 'react'
import { X, Bell, BellOff, Check } from 'lucide-react'
import { activarAvisos as activarPorDefecto, estadoAvisos as estadoPorDefecto, type EstadoAvisos } from '../data/ops/push'
import { useRoleOpcional } from '../auth/RoleContext'

export const QUE_AVISA_EQUIPO = 'mensajes del Chat del equipo, Avisos del equipo, mensajes de tus clientes (portal y WhatsApp) y doctores por verificar'
export const QUE_AVISA_DOCTOR = 'respuestas de tu asesor y promociones'

export function Ajustes({ onClose, estado = estadoPorDefecto, activar = activarPorDefecto }: { onClose: () => void; estado?: typeof estadoPorDefecto; activar?: typeof activarPorDefecto }) {
  const role = useRoleOpcional()?.role
  const [e, setE] = useState<EstadoAvisos | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { void estado().then(setE) }, [estado])

  const tocar = async () => {
    if (busy) return
    setBusy(true); setMsg(null)
    const r = await activar()
    setBusy(false)
    if (r.ok) setE('activo'); else { setMsg(r.mensaje); void estado().then(setE) }
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(ev) => ev.stopPropagation()}>
        <div className="mhead">
          <div><h3>Ajustes</h3><div className="ms">Preferencias de tu cuenta en este dispositivo.</div></div>
          <button className="mclose" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mbody">
          <div className="eyebrow" style={{ margin: '0 0 4px' }}>Notificaciones</div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 8 }} data-testid="ajustes-que-avisa">
            Te avisamos en este dispositivo, aunque tengas el sistema cerrado, de: {role === 'doctor' ? QUE_AVISA_DOCTOR : QUE_AVISA_EQUIPO}.
          </div>

          {e === 'activo' ? (
            <div className="sysnote" style={{ background: 'var(--ok-bg)', borderColor: 'var(--ok-line)', color: 'var(--green-deep)' }} data-testid="ajustes-avisos-activos">
              <Check size={18} /><span>Avisos activados en este dispositivo.</span>
            </div>
          ) : e === 'denegado' ? (
            <div className="sysnote" style={{ background: 'var(--warn-bg)', borderColor: '#EEDDB6', color: 'var(--warn)' }}>
              <BellOff size={18} /><span>Están bloqueados en el navegador. Actívalos desde el candado de la barra de direcciones y vuelve aquí.</span>
            </div>
          ) : e === 'no_soportado' ? (
            <div className="sysnote"><BellOff size={18} /><span>Este navegador no permite avisos.</span></div>
          ) : e === 'requiere_instalar' ? (
            <div className="sysnote"><BellOff size={18} /><span>En iPhone, primero agrega Renovacell a tu pantalla de inicio (Compartir → Agregar a inicio) y ábrelo desde ahí.</span></div>
          ) : e ? (
            <button className="btn" type="button" onClick={() => void tocar()} disabled={busy} style={{ marginTop: 4 }} data-testid="ajustes-activar-avisos">
              <Bell size={15} /> {busy ? 'Activando…' : 'Activar notificaciones'}
            </button>
          ) : null}
          {msg && <div role="status" style={{ fontSize: 12.5, color: 'var(--danger)', marginTop: 8 }}>{msg}</div>}
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 10 }}>Se activa por dispositivo: hazlo en tu teléfono y en tu computadora.</div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn ghost" type="button" onClick={onClose}>Cerrar</button>
          </div>
        </div>
      </div>
    </div>
  )
}
