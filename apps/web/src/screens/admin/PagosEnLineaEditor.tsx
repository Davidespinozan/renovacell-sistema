// PAGOS EN LÍNEA · tarjeta de Dirección en Configuración: un interruptor para ofrecer (o no) el pago con tarjeta en línea
// en el portal del doctor. Apagado: el doctor paga por transferencia, o en efectivo o tarjeta en sucursal; el servidor
// también se niega a iniciar cobros con tarjeta. La Caja (tarjeta en terminal) no cambia.
import React, { useEffect, useState } from 'react'
import { CreditCard } from 'lucide-react'
import { ConfirmModal } from '../../app/ConfirmModal'
import { fmtDate } from '../../lib/format'
import { guardarPagosConfig, recargarPagosEnLinea, verPagosConfig, contarBitacoraPruebas, leerBitacoraPruebas, type PagosConfig } from '../../data/ops/pagosEnLinea'
import { bitacoraACsv } from '../../../../../supabase/functions/_shared/csBitacora'
import { hoyNegocio } from '../../data/periodo'

/** Descarga un CSV en el navegador (inyectable en pruebas). */
function descargarCsvPorDefecto(nombre: string, csv: string) {
  const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a'); a.href = url; a.download = nombre; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function PagosEnLineaEditor({ ver = verPagosConfig, guardar = guardarPagosConfig, contarBitacora = contarBitacoraPruebas, leerBitacora = leerBitacoraPruebas, descargar = descargarCsvPorDefecto }: {
  ver?: typeof verPagosConfig; guardar?: typeof guardarPagosConfig
  /** CS-BB · bitácora de pruebas de BanBajío (solo sandbox). */
  contarBitacora?: () => Promise<number>; leerBitacora?: () => ReturnType<typeof leerBitacoraPruebas>; descargar?: (nombre: string, csv: string) => void
} = {}) {
  const [cfg, setCfg] = useState<PagosConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pidiendo, setPidiendo] = useState<boolean | null>(null)   // valor que se quiere poner (confirmación)
  const [guardando, setGuardando] = useState(false)
  useEffect(() => { let vivo = true; void ver().then((r) => { if (!vivo) return; if (r.ok) setCfg(r.data); else setError(r.error) }); return () => { vivo = false } }, [ver])
  // CS-BB · el botón de la bitácora solo aparece si hay filas (pruebas de certificación en sandbox).
  const [filasBitacora, setFilasBitacora] = useState(0)
  const [bajando, setBajando] = useState(false)
  useEffect(() => { let vivo = true; void contarBitacora().then((n) => { if (vivo) setFilasBitacora(n) }); return () => { vivo = false } }, [contarBitacora])
  const bajarBitacora = async () => {
    setBajando(true); setError(null)
    const r = await leerBitacora()
    setBajando(false)
    if (!r.ok) { setError(r.error); return }
    descargar(`bitacora-pruebas-cybersource-${hoyNegocio()}.csv`, bitacoraACsv(r.filas))
  }

  const aplicar = async () => {
    if (pidiendo == null) return
    setGuardando(true); setError(null)
    const r = await guardar(pidiendo)
    setGuardando(false); setPidiendo(null)
    if (!r.ok) { setError(r.error); return }
    setCfg(r.data); void recargarPagosEnLinea()
  }
  const on = cfg?.tarjeta_en_linea === true
  return (
    <div className="card" data-testid="pagos-en-linea">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <CreditCard size={18} style={{ color: 'var(--green-deep)' }} />
        <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Pagos en línea</h3>
        {cfg && <span className={'pill ' + (on ? 'p-ok' : 'p-warn')} data-testid="pagos-estado">{on ? 'Activos' : 'Apagados'}</span>}
      </div>
      <p className="ms" style={{ color: 'var(--ink-3)', margin: '8px 0 12px' }}>
        {on
          ? 'El doctor puede pagar su pedido con tarjeta desde el portal, además de transferencia.'
          : 'El doctor NO ve la opción de tarjeta en el portal: paga por transferencia, o en efectivo o con tarjeta en sucursal. La Caja sigue cobrando con terminal como siempre.'}
      </p>
      {error && <div role="alert" className="ms" style={{ color: 'var(--danger)', marginBottom: 8 }}>{error}</div>}
      {cfg && (
        <button className={on ? 'btn ghost' : 'btn'} type="button" onClick={() => setPidiendo(!on)} disabled={guardando} data-testid="pagos-cambiar">
          {on ? 'Apagar pagos en línea' : 'Activar pagos en línea'}
        </button>
      )}
      {cfg?.updated_at && <div className="ms" style={{ color: 'var(--ink-3)', marginTop: 8 }}>Último cambio: {fmtDate(cfg.updated_at)}</div>}
      {filasBitacora > 0 && (
        <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--line)' }} data-testid="bitacora-pruebas">
          <div className="ms" style={{ color: 'var(--ink-3)', marginBottom: 8 }}>Pruebas de certificación de BanBajío (sandbox): {filasBitacora} {filasBitacora === 1 ? 'llamada registrada' : 'llamadas registradas'}, con datos sensibles enmascarados.</div>
          <button className="btn ghost" type="button" onClick={() => void bajarBitacora()} disabled={bajando} data-testid="bitacora-descargar">
            {bajando ? 'Preparando…' : 'Descargar bitácora de pruebas (CSV)'}
          </button>
        </div>
      )}
      {pidiendo != null && (
        <ConfirmModal
          title={pidiendo ? '¿Activar los pagos en línea?' : '¿Apagar los pagos en línea?'}
          message={pidiendo
            ? 'Los doctores verán la opción de pagar con tarjeta en el portal. Actívalo solo cuando BanBajío esté configurado y probado.'
            : 'Los doctores dejarán de ver la opción de tarjeta; seguirán pagando por transferencia o en sucursal.'}
          confirmLabel={pidiendo ? 'Activar' : 'Apagar'}
          onConfirm={() => void aplicar()}
          onClose={() => setPidiendo(null)}
        />
      )}
    </div>
  )
}
