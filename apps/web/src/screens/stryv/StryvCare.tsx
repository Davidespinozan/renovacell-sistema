// STRYV Care (solo Dirección): el plan de mantenimiento e infraestructura del sistema. Estado de la suscripción,
// próximo cobro, tarjeta, recibos y los botones que llevan a las páginas seguras de Stripe. Mismo contenido y flujo
// que el panel de Fukuroll; la tarjeta se pone una sola vez en Stripe y se cobra sola cada mes.
import React, { useCallback, useEffect, useState } from 'react'
import { Check, ExternalLink, ShieldCheck } from 'lucide-react'
import { stryvCare, CLAVE_REGRESO_CARE, ESTADO_CARE, INCLUYE_CARE, fechaCare, pesosCare, type StatusCare } from '../../data/ops/stryvCare'

export function StryvCare({ cliente = stryvCare }: { cliente?: typeof stryvCare } = {}) {
  const [d, setD] = useState<StatusCare | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [abriendo, setAbriendo] = useState<'checkout' | 'portal' | null>(null)
  // Aviso de regreso de Stripe (lo deja AppShell): se lee una vez.
  const [regreso] = useState<string | null>(() => { try { const v = sessionStorage.getItem(CLAVE_REGRESO_CARE); sessionStorage.removeItem(CLAVE_REGRESO_CARE); return v } catch { return null } })

  const cargar = useCallback(async () => {
    const r = await cliente.estado()
    if (r.ok) { setD(r.data); setError(null) } else setError(r.message)
  }, [cliente])
  useEffect(() => { void cargar() }, [cargar])

  const ir = async (accion: 'checkout' | 'portal') => {
    setAbriendo(accion)
    const r = accion === 'checkout' ? await cliente.activar() : await cliente.portal()
    if (r.ok && r.data.url) { window.location.href = r.data.url; return }
    setAbriendo(null)
    window.alert(r.ok ? 'No pudimos abrir Stripe. Intenta de nuevo.' : r.message)
  }

  const estado = d ? ESTADO_CARE[d.estado] ?? { tono: 'neu' as const, texto: String(d.estado) } : null
  const activo = d && d.estado !== 'inactivo' && d.estado !== 'no_disponible'

  return (
    <div className="care" data-testid="stryv-care">
      <section className="care-card">
        <div className="care-top">
          <div className="care-brand">STRYV <span>Care</span></div>
          {estado && d?.estado !== 'no_disponible' && <span className={`pill p-${estado.tono === 'neu' ? 'neu' : estado.tono}`} data-testid="care-estado">{estado.texto}</span>}
        </div>

        {regreso === 'ok' && <div className="care-ok" role="status" data-testid="care-regreso">STRYV Care activado. ¡Gracias!</div>}
        {error && <div className="care-error" role="alert">No pudimos consultar STRYV Care. {error} <button type="button" className="btn ghost sm" onClick={() => void cargar()}>Reintentar</button></div>}
        {!d && !error && <div className="care-cargando">Cargando…</div>}

        {d?.estado === 'no_disponible' && <p className="care-p">Aún no está disponible. STRYV te avisará cuando puedas activarlo.</p>}

        {d && d.estado !== 'no_disponible' && (
          <>
            <div className="care-precio">{pesosCare(d.monto_centavos)}<small> MXN al mes</small></div>
            <p className="care-p">Mantenimiento e infraestructura de tu sistema, operado por STRYV.</p>
          </>
        )}

        <ul className="care-lista">{INCLUYE_CARE.map((t) => <li key={t}><Check size={15} aria-hidden /> {t}</li>)}</ul>

        {d?.estado === 'inactivo' && (
          <div className="care-accion">
            <button type="button" className="btn" onClick={() => void ir('checkout')} disabled={abriendo != null} data-testid="care-activar">
              <ShieldCheck size={16} /> {abriendo === 'checkout' ? 'Abriendo Stripe…' : 'Activar STRYV Care'}
            </button>
            <p className="care-nota">Pones tu tarjeta una sola vez en la página segura de Stripe y se cobra automáticamente cada mes.</p>
          </div>
        )}

        {activo && d && (
          <>
            <div className="care-datos">
              <div><span>{d.termina ? 'Termina el' : 'Próximo cobro'}</span><b>{fechaCare(d.termina ?? d.proximo_cobro)}</b></div>
              <div><span>Tarjeta</span><b>{d.tarjeta ? `${String(d.tarjeta.marca).toUpperCase()} ···· ${d.tarjeta.last4}` : '—'}</b></div>
            </div>
            <button type="button" className="btn ghost" onClick={() => void ir('portal')} disabled={abriendo != null} data-testid="care-portal">
              {abriendo === 'portal' ? 'Abriendo Stripe…' : 'Cambiar tarjeta o descargar recibos'}
            </button>
            {d.recibos && d.recibos.length > 0 && (
              <div className="care-recibos">
                <div className="care-h">Recibos</div>
                {d.recibos.map((r) => (
                  <div key={`${r.fecha}-${r.monto_centavos}`} className="care-recibo">
                    <span>{fechaCare(r.fecha)}<small>{r.estado === 'paid' ? 'Pagado' : r.estado ?? ''}</small></span>
                    <span><b>{pesosCare(r.monto_centavos)}</b>{r.url && <a href={r.url} target="_blank" rel="noopener noreferrer"> Ver <ExternalLink size={12} /></a>}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </section>
      <a className="care-link" href="https://stryvstudio.com" target="_blank" rel="noopener noreferrer"><span className="live" aria-hidden /> Operado por <b>STRYV</b> · stryvstudio.com</a>
    </div>
  )
}
