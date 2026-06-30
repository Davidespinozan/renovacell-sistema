// AJUSTES de la app. Hoy: activar NOTIFICACIONES (permiso real del navegador +
// preferencia local). La ENTREGA real de push (service worker + web-push desde
// el backend) entra en la fase Supabase; aquí queda el opt-in real y la
// preferencia. Disponible para todos los usuarios.
import React, { useState } from 'react'
import { X, Bell, BellOff, Check } from 'lucide-react'

const KEY = 'rc.notif.pref'
type Perm = 'default' | 'granted' | 'denied' | 'unsupported'

export const notifPermission = (): Perm => (typeof Notification === 'undefined' ? 'unsupported' : (Notification.permission as Perm))
export const notifPref = (): boolean => { try { return localStorage.getItem(KEY) === '1' } catch { return false } }
export const setNotifPref = (on: boolean) => { try { localStorage.setItem(KEY, on ? '1' : '0') } catch { /* ignore */ } }

export function Ajustes({ onClose }: { onClose: () => void }) {
  const [perm, setPerm] = useState<Perm>(notifPermission())
  const [pref, setPref] = useState<boolean>(notifPref())
  const [busy, setBusy] = useState(false)

  const activar = async () => {
    if (perm === 'unsupported') return
    setBusy(true)
    try {
      const res = await Notification.requestPermission()
      setPerm(res as Perm)
      if (res === 'granted') {
        setNotifPref(true); setPref(true)
        try { new Notification('Renovacell', { body: 'Notificaciones activadas ✓' }) } catch { /* ignore */ }
      }
    } finally { setBusy(false) }
  }

  const togglePref = () => { const v = !pref; setPref(v); setNotifPref(v) }

  const fld: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--line)' }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="mhead">
          <div><h3>Ajustes</h3><div className="ms">Preferencias de tu cuenta en este dispositivo.</div></div>
          <button className="mclose" type="button" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="mbody">
          <div className="eyebrow" style={{ margin: '0 0 4px' }}>Notificaciones</div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 8 }}>
            Recibe avisos de <b>mensajes nuevos</b>, pedidos, tareas asignadas y stock bajo — sin tener que estar revisando.
          </div>

          {perm === 'granted' ? (
            <div className="sysnote" style={{ background: 'var(--ok-bg)', borderColor: '#C9E4CF', color: 'var(--green-deep)' }}>
              <Check size={18} /><span>Notificaciones permitidas en este dispositivo.</span>
            </div>
          ) : perm === 'denied' ? (
            <div className="sysnote" style={{ background: 'var(--warn-bg)', borderColor: '#EEDDB6', color: 'var(--warn)' }}>
              <BellOff size={18} /><span>Están bloqueadas en el navegador. Actívalas desde el candado de la barra de direcciones para recibirlas.</span>
            </div>
          ) : perm === 'unsupported' ? (
            <div className="sysnote"><BellOff size={18} /><span>Este navegador no soporta notificaciones.</span></div>
          ) : (
            <button className="btn" type="button" onClick={activar} disabled={busy} style={{ marginTop: 4 }}>
              <Bell size={15} /> {busy ? 'Pidiendo permiso…' : 'Activar notificaciones'}
            </button>
          )}

          {perm === 'granted' && (
            <label style={{ ...fld, marginTop: 8, cursor: 'pointer', borderBottom: 'none' }}>
              <Bell size={16} style={{ color: 'var(--green-deep)' }} />
              <span style={{ flex: 1 }}>
                <span style={{ fontWeight: 600 }}>Mensajes y actividad</span>
                <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-3)' }}>Avísame de mensajes y pendientes nuevos.</span>
              </span>
              <input type="checkbox" checked={pref} onChange={togglePref} />
            </label>
          )}

          <div className="sysnote" style={{ marginTop: 14, alignItems: 'flex-start' }}>
            <span>Aquí das el permiso. El <b>envío</b> de las notificaciones (incluso con la app cerrada) se activa al conectar el backend; la base ya queda lista.</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn ghost" type="button" onClick={onClose}>Cerrar</button>
          </div>
        </div>
      </div>
    </div>
  )
}
