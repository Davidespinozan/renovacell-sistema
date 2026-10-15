// AVISOS PUSH · "Activar avisos": un toque (el navegador exige que lo pida la persona) y este dispositivo recibe un
// aviso cuando le escriben en el chat, aunque tenga la pestaña cerrada. Ya activos, no se muestra nada.
import React, { useEffect, useState } from 'react'
import { Bell } from 'lucide-react'
import { activarAvisos as activarPorDefecto, estadoAvisos as estadoPorDefecto, type EstadoAvisos } from '../data/ops/push'

export function BotonAvisos({ className, estado = estadoPorDefecto, activar = activarPorDefecto }: { className?: string; estado?: typeof estadoPorDefecto; activar?: typeof activarPorDefecto }) {
  const [e, setE] = useState<EstadoAvisos | null>(null)
  const [msg, setMsg] = useState<string | null>(null); const [ocupado, setOcupado] = useState(false)
  useEffect(() => { void estado().then(setE) }, [estado])
  if (!e || e === 'activo' || e === 'no_soportado') return null
  const tocar = async () => {
    if (ocupado) return
    setOcupado(true); setMsg(null)
    const r = await activar()
    setOcupado(false)
    if (r.ok) setE('activo'); else setMsg(r.mensaje)
  }
  return (
    <>
      <button type="button" className={className} onClick={() => void tocar()} disabled={ocupado} data-testid="activar-avisos"><Bell size={15} /> {ocupado ? 'Activando…' : 'Activar avisos'}</button>
      {msg && <span role="status" className="rc-avisos-msg" data-testid="avisos-msg">{msg}</span>}
    </>
  )
}
