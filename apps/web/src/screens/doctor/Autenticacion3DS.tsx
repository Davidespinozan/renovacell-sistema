// CS-1A.4 · Autenticación 3DS (Payer Authentication) en el portal del doctor. Orquesta los pasos oficiales con la Edge `cs-3ds`:
// setup → recolección de dispositivo (iframe oculto) → enrolamiento → reto step-up (iframe visible) si el banco lo pide → validación
// en el servidor. El resultado lo decide SIEMPRE el servidor; aquí solo se muestran estados. No cobra: al terminar, el intento queda
// `auth_validated` a la espera de CS-1A.5. El token transitorio solo se reenvía a la Edge; nunca se persiste ni se registra.
import React, { useEffect, useRef, useState } from 'react'
import { Icon } from '../../app/icons'
import { cs3ds as cs3dsReal, recolectarDispositivo as recolectarReal, ejecutarDDC as ddcReal, ejecutarStepUp as stepUpReal, estiloVentanaReto, type RespEnroll } from '../../data/payments/cybersource3ds'

export type Fase = 'preparando' | 'verificando' | 'reto' | 'validando' | 'completada' | 'rechazada' | 'pendiente' | 'error' | 'recapturar'
export interface Deps { cs3ds?: typeof cs3dsReal; recolectar?: typeof recolectarReal; ddc?: typeof ddcReal; stepUp?: typeof stepUpReal; stepUpTimeoutMs?: number }

const TEXTO: Record<Fase, string> = {
  preparando: 'Preparando la autenticación con tu banco…',
  verificando: 'Verificando tu tarjeta con el banco…',
  reto: 'Tu banco requiere una verificación adicional. Complétala en el recuadro.',
  validando: 'Confirmando la verificación…',
  completada: 'Autenticación completada. Aún no se ha realizado ningún cargo; el cobro se habilitará en el siguiente paso.',
  rechazada: 'Tu banco no pudo autenticar esta tarjeta. Por favor usa otra tarjeta u otra forma de pago para completar tu compra; no se realizó ningún cargo.',
  pendiente: 'Pendiente de verificación. Te avisamos en cuanto se resuelva.',
  error: 'No se pudo completar la verificación.',
  recapturar: 'La captura de la tarjeta caducó. Vuelve a capturarla.',
}

export function Autenticacion3DS({ attemptId, token, modo = 'completo', onFin, deps }: {
  attemptId: string
  /** Token transitorio en memoria (viene de Microform). No se necesita en modo 'validar'. */
  token: string | null
  /** 'completo': setup→DDC→enroll(→reto→validate). 'validar': solo validar un reto ya iniciado (recuperación tras interrupción). */
  modo?: 'completo' | 'validar'
  onFin?: (f: Fase) => void
  deps?: Deps
}) {
  const cs = deps?.cs3ds ?? cs3dsReal
  const recolectar = deps?.recolectar ?? recolectarReal
  const ddc = deps?.ddc ?? ddcReal
  const stepUp = deps?.stepUp ?? stepUpReal
  const [fase, setFase] = useState<Fase>('preparando')
  const [detalle, setDetalle] = useState('')
  const [ventana, setVentana] = useState<RespEnroll['ventana'] | null>(null)
  const contenedorDdc = useRef<HTMLDivElement>(null)
  const contenedorReto = useRef<HTMLDivElement>(null)
  const corriendo = useRef(false)
  const validando = useRef(false)   // un retorno duplicado del reto no produce dos validaciones

  const terminar = (f: Fase, d = '') => { setFase(f); setDetalle(d); onFin?.(f) }

  useEffect(() => {
    if (corriendo.current) return
    corriendo.current = true
    let vivo = true
    const validar = async (transactionId?: string | null): Promise<void> => {
      if (validando.current) return
      validando.current = true
      setFase('validando')
      const v = await cs.validate(attemptId, transactionId)
      validando.current = false
      if (!vivo) return
      if (!v.ok) {
        if (v.error === 'tarjeta_expirada') { terminar('recapturar', v.message); return }
        if (v.error === 'estado_invalido' && v.estado === 'auth_validated') { terminar('completada'); return }
        if (v.error === 'estado_invalido' && v.estado === 'declined') { terminar('rechazada'); return }
        terminar('error', v.message); return
      }
      if (v.data.estado === 'auth_validated') { terminar('completada'); return }
      if (v.data.estado === 'declined') { terminar('rechazada', v.data.message ?? ''); return }
      terminar('pendiente', v.data.message ?? 'La verificación con tu banco aún no termina. Intenta de nuevo en un momento.')
    }
    const reto = async (e: RespEnroll): Promise<void> => {
      setFase('reto'); setVentana(e.ventana ?? null)
      await new Promise((r) => setTimeout(r, 0))   // el contenedor existe tras pintar
      if (!vivo || !contenedorReto.current) return
      // CS-BB · ventana 05 = pantalla completa real; el resto, el tamaño exacto de la tabla del manual
      const r = await stepUp({ url: e.step_up_url!, token: e.step_up_token!, md: attemptId, retornoOrigen: e.retorno_origen!, transactionId: e.authentication_transaction_id ?? null, ventana: e.ventana === '05' ? null : (e.ventana_px ?? null), timeoutMs: deps?.stepUpTimeoutMs ?? 10 * 60 * 1000, contenedor: contenedorReto.current })
      if (!vivo) return
      if (!r.regreso) { terminar('pendiente', 'No recibimos la respuesta de tu banco. Puedes reintentar la confirmación.'); return }
      await validar(r.transactionId ?? null)
    }
    ;(async () => {
      if (modo === 'validar') { await validar(); return }
      if (!token) { terminar('recapturar'); return }
      setFase('preparando')
      const s = await cs.setup(attemptId, token)
      if (!vivo) return
      if (!s.ok) {
        // CS-BB · token caducado (15 min) o tarjeta distinta de la autenticada: se vuelve a capturar (nunca un 3DS viejo para otra tarjeta)
        if (s.error === 'token_rechazado' || s.error === 'token_invalido' || s.error === 'tarjeta_expirada' || s.error === 'reautenticar') { terminar('recapturar', s.message); return }
        if (s.error === 'estado_invalido' && s.estado === 'auth_challenge') { await validar(); return }
        if (s.error === 'estado_invalido' && s.estado === 'auth_validated') { terminar('completada'); return }
        terminar('error', s.message); return
      }
      setFase('verificando')
      if (contenedorDdc.current) await ddc({ url: s.data.ddc_url, token: s.data.ddc_token, origen: s.data.ddc_origen, timeoutMs: s.data.ddc_timeout_ms, contenedor: contenedorDdc.current })
      if (!vivo) return
      const e = await cs.enroll(attemptId, token, recolectar())
      if (!vivo) return
      if (!e.ok) {
        if (e.error === 'tarjeta_expirada' || e.error === 'reautenticar' || e.error === 'token_invalido' || e.error === 'token_rechazado') { terminar('recapturar', e.message); return }
        if (e.error === 'datos_incompletos') { terminar('error', e.message); return }
        terminar('error', e.message); return
      }
      if (e.data.estado === 'auth_validated') { terminar('completada'); return }
      if (e.data.estado === 'declined') { terminar('rechazada', e.data.message ?? ''); return }
      if (e.data.estado === 'auth_challenge' && e.data.step_up_url && e.data.step_up_token && e.data.retorno_origen) { await reto(e.data); return }
      terminar('error', e.data.message ?? 'No se pudo verificar la tarjeta con tu banco. Intenta de nuevo.')
    })().catch(() => { if (vivo) terminar('error', 'No se pudo completar la verificación. Intenta de nuevo.') })
    return () => { vivo = false; corriendo.current = false }
  }, [attemptId, token, modo])   // eslint-disable-line react-hooks/exhaustive-deps

  const icono = fase === 'completada' ? 'shield' : fase === 'rechazada' || fase === 'error' || fase === 'recapturar' ? 'x' : 'clock'
  const tono = fase === 'completada' ? { background: 'var(--ok-bg)', borderColor: 'var(--ok-line)', color: 'var(--green-deep)' }
             : fase === 'rechazada' || fase === 'error' || fase === 'recapturar' ? { background: 'var(--danger-bg)', borderColor: 'var(--danger-line)', color: 'var(--danger)' } : {}
  return (
    <div data-testid="a3ds" data-fase={fase}>
      <div className="sysnote" style={{ marginTop: 12, ...tono }}><Icon name={icono} /><span><b>{TEXTO[fase]}</b>{detalle && fase !== 'rechazada' && <> {detalle}</>}</span></div>
      <div ref={contenedorDdc} data-testid="a3ds-ddc" aria-hidden="true" />
      {fase === 'reto' && (() => {
        const st = estiloVentanaReto(ventana)
        return <div ref={contenedorReto} data-testid="a3ds-reto" data-pantalla-completa={st.pantallaCompleta ? 'si' : 'no'} role={st.pantallaCompleta ? 'dialog' : undefined} aria-modal={st.pantallaCompleta ? true : undefined} aria-label="Verificación de tu banco" style={st.contenedor} />
      })()}
      {fase === 'pendiente' && <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}><button type="button" className="btn ghost sm" data-testid="a3ds-reintentar" onClick={() => { validando.current = false; void cs.validate(attemptId).then((v) => { if (!v.ok) { terminar('error', v.message); return } terminar(v.data.estado === 'auth_validated' ? 'completada' : v.data.estado === 'declined' ? 'rechazada' : 'pendiente', v.data.message ?? '') }) }}>Reintentar confirmación</button></div>}
    </div>
  )
}
