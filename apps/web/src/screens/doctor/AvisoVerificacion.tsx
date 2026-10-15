// CUENTA ≠ VERIFICACIÓN (decisión del dueño, 14 oct 2026): el doctor con cuenta entra al sistema aunque su
// verificación esté pendiente; precios y compras se habilitan al aprobarla (el servidor lo exige). Esta franja dice
// en qué va (pendiente, qué le falta, o rechazado con el motivo) y CONSULTA SOLA al servidor: cuando lo aprueban,
// el portal se desbloquea sin volver a iniciar sesión.
import React, { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useRole } from '../../auth/RoleContext'
import { miVerificacion as leerPorDefecto, type MiVerificacion } from '../../data/ops/verificacion'
import { pedirAbrirChat } from '../../data/store/chatUiStore'
import { PANTALLAS_CHAT } from '../../app/ChatFlotante'

const FALTA: Record<string, string> = { cedula: 'tu cédula profesional', 'ine-front': 'la foto del frente de tu INE', 'ine-back': 'la foto del reverso de tu INE' }
export const textoFaltan = (f: string[]): string => f.map((x) => FALTA[x] ?? x).join(', ').replace(/, ([^,]*)$/, ' y $1')

export function AvisoVerificacion({ leer = leerPorDefecto, intervaloMs = 45_000 }: { leer?: typeof leerPorDefecto; intervaloMs?: number }) {
  const { actualizarVerificacion, setScreen, screen } = useRole()
  const [v, setV] = useState<MiVerificacion | null>(null)
  useEffect(() => {
    let vivo = true
    const tick = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      const r = await leer(); if (!vivo || !r) return
      setV(r)
      if (r.verificado) actualizarVerificacion(true)   // aprobado: precios y compras sin volver a entrar
    }
    void tick()
    const t = setInterval(() => void tick(), intervaloMs)
    document.addEventListener('visibilitychange', tick)
    return () => { vivo = false; clearInterval(t); document.removeEventListener('visibilitychange', tick) }
  }, [leer, intervaloMs, actualizarVerificacion])
  const rechazado = v?.estado === 'rejected' || v?.estado === 'revoked'
  const faltan = v?.faltan ?? []
  return (
    <div className="sysnote" role="status" data-testid="aviso-verificacion" style={{ background: rechazado ? 'var(--danger-bg)' : 'var(--warn-bg)', borderColor: 'transparent', color: 'var(--ink)', marginBottom: 14, alignItems: 'flex-start' }}>
      <ShieldCheck size={18} style={{ color: rechazado ? 'var(--danger)' : 'var(--warn)', flex: 'none', marginTop: 1 }} />
      <span>
        {rechazado
          ? <><b>No pudimos aprobar tu verificación.</b> {v?.motivo ? `Motivo: ${v.motivo}. ` : ''}Corrige tus datos y la revisamos de nuevo.</>
          : <><b>Tu verificación está en revisión.</b> Ya puedes conocer el catálogo y hablar con tu asesor. Los precios y las compras se habilitan en cuanto aprobemos tu cédula{faltan.length ? <>; para avanzar nos falta {textoFaltan(faltan)}</> : null}.</>}
        {(rechazado || faltan.length > 0) && <> <button type="button" className="rc-link" onClick={() => setScreen('mi_verificacion')} data-testid="ir-mi-verificacion">Ir a Mi verificación</button></>}
        {/* CHAT PRO · mientras lo revisan no se queda sin salida: su asesor le contesta por el chat. */}
        {!PANTALLAS_CHAT.has(screen) && <>{' '}<button type="button" className="rc-link" onClick={pedirAbrirChat} data-testid="hablar-asesor">Hablar con mi asesor</button></>}
      </span>
    </div>
  )
}
