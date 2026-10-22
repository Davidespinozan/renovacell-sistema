// CS-1A.3 · Captura segura de tarjeta con CyberSource Flex Microform v2 (portal del doctor).
// Número y CVV viven en iframes alojados por CyberSource: Renovacell nunca los ve ni los toca. Al "Continuar", Microform
// entrega un TOKEN TRANSITORIO (JWT, 15 min) que este componente guarda SOLO en memoria y entrega al padre vía onToken para el
// siguiente paso (autenticación 3DS, CS-1A.4). Aquí no se cobra, no se autoriza y no se muestra "pago exitoso".
import React, { useEffect, useRef, useState } from 'react'
import { Icon } from '../../app/icons'
import { money } from '../../lib/format'
import { solicitarCaptureContext, cargarLibreriaFlex, type CaptureContextDoctor, type FlexMicroform } from '../../data/payments/cybersource'
import { cs3ds as cs3dsReal } from '../../data/payments/cybersource3ds'

export interface TokenTarjeta { token: string; attemptId: string; amount: number; ambiente: 'test' | 'production' }
type Estado = 'cargando' | 'listo' | 'tokenizando' | 'tokenizado' | 'expirado' | 'no_disponible' | 'error'

const label: React.CSSProperties = { display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 14, marginBottom: 6 }
const caja: React.CSSProperties = { width: '100%', minHeight: 42, padding: '2px 12px', border: '1px solid var(--line)', borderRadius: 14, background: 'var(--surface, #fff)', boxSizing: 'border-box' }
const select: React.CSSProperties = { width: '100%', padding: '10px 12px', border: '1px solid var(--line)', borderRadius: 14, fontFamily: 'inherit', fontSize: 13.5, background: 'var(--surface, #fff)' }

const MESES = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'))
const anioActual = new Date().getFullYear()
const ANIOS = Array.from({ length: 12 }, (_, i) => String(anioActual + i))

const ESTILOS_CAMPOS = { input: { 'font-size': '14px', 'font-family': 'inherit', color: '#1b1f1d' }, ':focus': { color: '#1b1f1d' }, valid: { color: '#1b1f1d' }, invalid: { color: '#b42318' } }

export function MicroformTarjeta({ orderId, onToken, onRecuperar, deps }: {
  orderId: string
  /** Recibe el token transitorio (en memoria) para el siguiente paso. No implica cobro. */
  onToken: (t: TokenTarjeta) => void
  /** CS-1A.4: el intento reutilizado tiene un reto 3DS en curso → el padre solo debe validar (sin volver a capturar). */
  onRecuperar?: (attemptId: string) => void
  /** Inyectable en pruebas. */
  deps?: { solicitar?: typeof solicitarCaptureContext; cargar?: typeof cargarLibreriaFlex; ahora?: () => number; cs3ds?: Pick<typeof cs3dsReal, 'estado' | 'abandonar'> }
}) {
  const solicitar = deps?.solicitar ?? solicitarCaptureContext
  const cargar = deps?.cargar ?? cargarLibreriaFlex
  const cs = deps?.cs3ds ?? cs3dsReal
  const ahora = deps?.ahora ?? (() => Date.now())
  const [estado, setEstado] = useState<Estado>('cargando')
  const [mensaje, setMensaje] = useState<string>('')
  const [ctx, setCtx] = useState<CaptureContextDoctor | null>(null)
  const [mes, setMes] = useState(''); const [anio, setAnio] = useState('')
  const [generacion, setGeneracion] = useState(0)   // reintento tras expirar: nuevo capture context
  const microform = useRef<FlexMicroform | null>(null)
  const numeroRef = useRef<HTMLDivElement>(null); const cvvRef = useRef<HTMLDivElement>(null)
  const inicializado = useRef(false)     // evita doble inicialización (StrictMode, re-render)
  const tokenizando = useRef(false)      // evita doble clic
  const tokenRef = useRef<string | null>(null)   // el token transitorio NUNCA entra al estado de React ni al DOM

  useEffect(() => {
    if (inicializado.current) return
    inicializado.current = true
    let vivo = true
    let temporizador: ReturnType<typeof setTimeout> | undefined
    ;(async () => {
      setEstado('cargando'); setMensaje(''); setCtx(null)
      let r = await solicitar(orderId)
      if (!vivo) return
      // CS-1A.4 · intento reutilizado: si ya hay un reto 3DS en curso, no se vuelve a capturar (solo validar);
      // si el enrolamiento quedó a medias (el token de entonces ya no existe), se abandona y se pide un intento nuevo.
      if (r.ok && r.ctx.reutilizado) {
        const e = await cs.estado(r.ctx.attempt_id)
        if (!vivo) return
        if (e.ok && e.data.puede_validar) { onRecuperar?.(r.ctx.attempt_id); return }
        if (e.ok && (e.data.estado === 'auth_setup' || e.data.estado === 'auth_pending')) {
          await cs.abandonar(r.ctx.attempt_id)
          r = await solicitar(orderId)
          if (!vivo) return
        }
      }
      if (!r.ok) { setEstado(r.motivo === 'no_disponible' || r.motivo === 'no_verificado' || r.motivo === 'sin_saldo' || r.motivo === 'en_proceso' || r.motivo === 'pendiente_verificacion' ? 'no_disponible' : 'error'); setMensaje(r.mensaje); return }
      const restante = new Date(r.ctx.expires_at).getTime() - ahora()
      if (restante <= 0) { setEstado('expirado'); setMensaje('El formulario de tarjeta caducó. Vuelve a intentarlo.'); return }
      try {
        const Flex = await cargar(r.ctx.client_library, r.ctx.client_library_integrity)
        if (!vivo) return
        const flex = new Flex(r.ctx.capture_context)
        const mf = flex.microform({ styles: ESTILOS_CAMPOS })
        microform.current = mf
        setCtx(r.ctx); setEstado('listo')
        // los contenedores existen una vez pintado el estado 'listo'
        setTimeout(() => {
          if (!vivo || !numeroRef.current || !cvvRef.current) return
          mf.createField('number', { placeholder: '•••• •••• •••• ••••' }).load(numeroRef.current)
          mf.createField('securityCode', { placeholder: '•••' }).load(cvvRef.current)
        }, 0)
        temporizador = setTimeout(() => { if (vivo) { setEstado('expirado'); setMensaje('El formulario de tarjeta caducó (15 min). Vuelve a intentarlo.'); tokenRef.current = null } }, restante)
      } catch {
        if (vivo) { setEstado('error'); setMensaje('No se pudo cargar el formulario seguro de tarjeta. Revisa tu conexión e intenta de nuevo.') }
      }
    })()
    return () => {
      vivo = false
      if (temporizador) clearTimeout(temporizador)
      tokenRef.current = null
      try { microform.current?.teardown?.() } catch { /* el SDK ya no está */ }
      microform.current = null
      inicializado.current = false
    }
  }, [orderId, generacion])   // eslint-disable-line react-hooks/exhaustive-deps

  const continuar = () => {
    if (estado !== 'listo' || !microform.current || !ctx || tokenizando.current) return
    if (!mes || !anio) { setMensaje('Indica el mes y el año de vencimiento.'); return }
    tokenizando.current = true; setEstado('tokenizando'); setMensaje('')
    microform.current.createToken({ expirationMonth: mes, expirationYear: anio }, (err, token) => {
      tokenizando.current = false
      if (err || !token) { setEstado('listo'); setMensaje('Revisa los datos de la tarjeta e intenta de nuevo.'); return }
      tokenRef.current = token
      setEstado('tokenizado')
      onToken({ token, attemptId: ctx.attempt_id, amount: ctx.amount, ambiente: ctx.ambiente })
    })
  }

  if (estado === 'cargando') return <div className="sysnote" style={{ marginTop: 16 }} data-testid="mf-cargando"><Icon name="clock" /><span>Preparando el formulario seguro de tarjeta…</span></div>
  if (estado === 'no_disponible' || estado === 'error' || estado === 'expirado') {
    return (
      <div className="sysnote" style={{ marginTop: 16, background: 'var(--danger-bg)', borderColor: 'var(--danger-line)', color: 'var(--danger)' }} data-testid={`mf-${estado}`}>
        <Icon name="x" />
        <span>{mensaje}{estado !== 'no_disponible' && <> <button type="button" className="btn ghost sm" style={{ marginLeft: 8 }} onClick={() => setGeneracion((g) => g + 1)} data-testid="mf-reintentar">Reintentar</button></>}</span>
      </div>
    )
  }
  return (
    <div data-testid="mf-formulario">
      {ctx && <div className="ms" style={{ marginTop: 12 }}>Importe a pagar: <b>{money(ctx.amount)}</b>{ctx.ambiente === 'test' && <span className="pill" style={{ marginLeft: 8, fontSize: 10 }}>SANDBOX</span>}</div>}
      <label style={label}>Número de tarjeta</label>
      <div ref={numeroRef} style={caja} data-testid="mf-numero" />
      <div className="form-grid-2" style={{ marginTop: 0 }}>
        <div>
          <label style={label}>Vence</label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <select style={select} value={mes} onChange={(e) => setMes(e.target.value)} aria-label="Mes de vencimiento" data-testid="mf-mes" disabled={estado !== 'listo'}>
              <option value="">MM</option>{MESES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <select style={select} value={anio} onChange={(e) => setAnio(e.target.value)} aria-label="Año de vencimiento" data-testid="mf-anio" disabled={estado !== 'listo'}>
              <option value="">AAAA</option>{ANIOS.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label style={label}>CVV</label>
          <div ref={cvvRef} style={caja} data-testid="mf-cvv" />
        </div>
      </div>
      {mensaje && <div className="sysnote" style={{ marginTop: 12, background: 'var(--danger-bg)', borderColor: 'var(--danger-line)', color: 'var(--danger)' }}><Icon name="x" /><span>{mensaje}</span></div>}
      {estado === 'tokenizado' ? (
        <div className="sysnote" style={{ marginTop: 12 }} data-testid="mf-tokenizado"><Icon name="shield" /><span>Tarjeta capturada de forma segura. La autenticación bancaria (3D Secure) se habilitará en el siguiente paso; <b>aún no se ha realizado ningún cargo</b>.</span></div>
      ) : (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <button type="button" className="btn" onClick={continuar} disabled={estado !== 'listo'} data-testid="mf-continuar" style={estado !== 'listo' ? { opacity: 0.55, cursor: 'not-allowed' } : undefined}>
            <Icon name="shield" /> {estado === 'tokenizando' ? 'Verificando tarjeta…' : 'Continuar'}
          </button>
        </div>
      )}
      <p style={{ fontSize: 11, color: 'var(--ink-3)', textAlign: 'center', marginTop: 12 }}>Tus datos de tarjeta se capturan en campos seguros de CyberSource; no pasan por los servidores de Renovacell.</p>
    </div>
  )
}
