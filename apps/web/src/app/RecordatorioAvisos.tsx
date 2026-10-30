// PUSH DEL EQUIPO · recordatorio en Inicio: "activa las notificaciones" hasta que este dispositivo las tenga. Sin avisos
// activos, un mensaje del chat del equipo o de un cliente solo se ve con el sistema abierto. "Ahora no" lo esconde 3 días
// en este navegador; activo o sin soporte, no se muestra.
import React, { useEffect, useState } from 'react'
import { Bell, X } from 'lucide-react'
import { activarAvisos as activarPorDefecto, estadoAvisos as estadoPorDefecto, type EstadoAvisos } from '../data/ops/push'

const CLAVE = 'rc_recordatorio_avisos_hasta'
const pospuesto = (): boolean => { try { return Number(localStorage.getItem(CLAVE) ?? 0) > Date.now() } catch { return false } }
const posponer = () => { try { localStorage.setItem(CLAVE, String(Date.now() + 3 * 86_400_000)) } catch { /* sin almacenamiento: solo esta vez */ } }

export function RecordatorioAvisos({ estado = estadoPorDefecto, activar = activarPorDefecto }: { estado?: typeof estadoPorDefecto; activar?: typeof activarPorDefecto }) {
  const [e, setE] = useState<EstadoAvisos | null>(null)
  const [oculto, setOculto] = useState(pospuesto)
  const [msg, setMsg] = useState<string | null>(null); const [ocupado, setOcupado] = useState(false)
  useEffect(() => { void estado().then(setE) }, [estado])
  if (oculto || !e || e === 'activo' || e === 'no_soportado') return null
  const tocar = async () => {
    if (ocupado) return
    setOcupado(true); setMsg(null)
    const r = await activar()
    setOcupado(false)
    if (r.ok) setE('activo'); else setMsg(r.mensaje)
  }
  return (
    <div className="rh-note rh-note--warn" role="note" data-testid="recordatorio-avisos" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
      <Bell size={16} aria-hidden />
      <span style={{ flex: '1 1 220px' }}>
        <b>Activa las notificaciones</b> para enterarte de mensajes del equipo y de tus clientes aunque tengas el sistema cerrado.
        {e === 'requiere_instalar' && ' En iPhone, primero agrega Renovacell a tu pantalla de inicio (Compartir → Agregar a inicio).'}
        {e === 'denegado' && ' Están bloqueadas en el navegador: actívalas desde el candado de la barra de direcciones.'}
        {msg && <span role="status" style={{ display: 'block', marginTop: 4 }}>{msg}</span>}
      </span>
      {e === 'inactivo' && <button className="btn sm" type="button" onClick={() => void tocar()} disabled={ocupado} data-testid="recordatorio-activar">{ocupado ? 'Activando…' : 'Activar'}</button>}
      <button className="btn ghost sm" type="button" onClick={() => { posponer(); setOculto(true) }} aria-label="Ahora no" data-testid="recordatorio-ahora-no"><X size={14} /> Ahora no</button>
    </div>
  )
}
