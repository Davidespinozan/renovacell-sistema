// PUSH SIEMPRE · pantalla "Activa las notificaciones". El navegador no deja activarlas sin un toque de la persona, así que
// el toque se vuelve inevitable: se abre al entrar en cada sesión hasta que este dispositivo las tenga y, para el doctor,
// también tras escribirle a su asesor o hacer un pedido. Si el permiso ya estaba dado, registra el dispositivo en silencio
// (sin abrir nada). En iPhone sin instalar explica cómo agregarlo a la pantalla de inicio; bloqueadas, cómo desbloquearlas.
import React, { useEffect, useState } from 'react'
import { Bell, BellOff, Share, PlusSquare } from 'lucide-react'
import { activarAvisos as activarPorDefecto, estadoAvisos as estadoPorDefecto, sincronizarAvisos as sincronizarPorDefecto, type EstadoAvisos } from '../data/ops/push'
import { pedirAvisos, cerrarPuertaAvisos, usePuertaAvisos, type MotivoAvisos } from '../data/store/puertaAvisos'

const TITULO: Record<MotivoAvisos, { equipo: string; doctor: string }> = {
  entrada: { equipo: 'Activa las notificaciones', doctor: 'Activa las notificaciones' },
  chat: { equipo: 'Activa las notificaciones', doctor: '¿Te avisamos cuando te respondan?' },
  pedido: { equipo: 'Activa las notificaciones', doctor: '¿Te avisamos de tu pedido?' },
}
const TEXTO: Record<MotivoAvisos, { equipo: string; doctor: string }> = {
  entrada: {
    equipo: 'Para que te enteres al momento de los mensajes del equipo, de tus clientes y de los avisos, aunque tengas el sistema cerrado.',
    doctor: 'Te avisamos en cuanto tu asesor de Renovacell te responda y cuando haya promociones para ti, aunque no tengas la página abierta.',
  },
  chat: {
    equipo: 'Para que te enteres al momento de los mensajes del equipo, de tus clientes y de los avisos.',
    doctor: 'Tu asesor te va a contestar por aquí. Activa las notificaciones y te avisamos en tu teléfono en cuanto lo haga, sin tener que estar revisando.',
  },
  pedido: {
    equipo: 'Para que te enteres al momento de los mensajes del equipo, de tus clientes y de los avisos.',
    doctor: 'Si tu asesor necesita confirmarte algo de este pedido, te avisamos en tu teléfono al momento. Activa las notificaciones.',
  },
}

export function PuertaAvisos({ doctor, estado = estadoPorDefecto, activar = activarPorDefecto, sincronizar = sincronizarPorDefecto }: {
  doctor: boolean; estado?: typeof estadoPorDefecto; activar?: typeof activarPorDefecto; sincronizar?: typeof sincronizarPorDefecto
}) {
  const motivo = usePuertaAvisos()
  const [e, setE] = useState<EstadoAvisos | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  // Al entrar: con permiso ya dado, se registra solo; si falta el toque, se abre la pantalla (una vez por sesión).
  useEffect(() => {
    let vivo = true
    void (async () => {
      let x = await estado()
      if (x === 'activo' || (typeof Notification !== 'undefined' && Notification.permission === 'granted')) {
        if (await sincronizar()) x = 'activo'
        else x = await estado()
      }
      if (!vivo) return
      setE(x)
      if (x !== 'activo' && x !== 'no_soportado') pedirAvisos('entrada')
    })()
    return () => { vivo = false }
  }, [estado, sincronizar])

  // Los motivos de compra (chat, pedido) son del doctor; al equipo solo se le pide al entrar.
  useEffect(() => { if (motivo && motivo !== 'entrada' && !doctor) cerrarPuertaAvisos() }, [motivo, doctor])
  if (!motivo || !e || e === 'activo' || e === 'no_soportado' || (motivo !== 'entrada' && !doctor)) return null
  const quien = doctor ? 'doctor' : 'equipo'
  const tocar = async () => {
    if (ocupado) return
    setOcupado(true); setMsg(null)
    const r = await activar()
    setOcupado(false)
    if (r.ok) { setE('activo'); cerrarPuertaAvisos() } else { setMsg(r.mensaje); setE(await estado()) }
  }

  return (
    <div className="overlay" data-testid="puerta-avisos" role="dialog" aria-modal="true" aria-labelledby="puerta-avisos-titulo">
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="mbody" style={{ textAlign: 'center', padding: '28px 22px 20px' }}>
          <div aria-hidden style={{ width: 56, height: 56, borderRadius: 28, margin: '0 auto 14px', display: 'grid', placeItems: 'center', background: 'var(--ok-bg)', color: 'var(--green-deep)' }}>
            {e === 'denegado' ? <BellOff size={26} /> : <Bell size={26} />}
          </div>
          <h3 id="puerta-avisos-titulo" style={{ margin: '0 0 8px' }}>{TITULO[motivo][quien]}</h3>
          <p style={{ margin: '0 0 16px', color: 'var(--ink-2)', fontSize: 14 }}>{TEXTO[motivo][quien]}</p>

          {e === 'inactivo' && (
            <button className="btn" type="button" style={{ width: '100%', justifyContent: 'center', minHeight: 46 }} onClick={() => void tocar()} disabled={ocupado} data-testid="puerta-activar">
              <Bell size={16} /> {ocupado ? 'Activando…' : 'Activar notificaciones'}
            </button>
          )}
          {e === 'requiere_instalar' && (
            <ol style={{ textAlign: 'left', margin: '0 0 6px', paddingLeft: 20, fontSize: 14, lineHeight: 1.6 }} data-testid="puerta-instalar">
              <li>Toca <Share size={14} aria-label="Compartir" style={{ verticalAlign: '-2px' }} /> <b>Compartir</b> en la barra de Safari.</li>
              <li>Elige <PlusSquare size={14} aria-hidden style={{ verticalAlign: '-2px' }} /> <b>Agregar a inicio</b>.</li>
              <li>Abre Renovacell desde ese ícono y toca <b>Activar notificaciones</b>.</li>
            </ol>
          )}
          {e === 'denegado' && (
            <p style={{ textAlign: 'left', fontSize: 13.5, margin: 0 }} data-testid="puerta-bloqueadas">
              Están bloqueadas para este sitio. Toca el candado (o los ajustes del sitio) junto a la dirección, permite las <b>notificaciones</b> y vuelve a abrir Renovacell.
            </p>
          )}
          {msg && <div role="status" style={{ fontSize: 12.5, color: 'var(--danger)', marginTop: 10 }}>{msg}</div>}
          <button className="btn ghost sm" type="button" style={{ marginTop: 12 }} onClick={cerrarPuertaAvisos} data-testid="puerta-ahora-no">Ahora no</button>
        </div>
      </div>
    </div>
  )
}
