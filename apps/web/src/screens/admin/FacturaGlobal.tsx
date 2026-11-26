// FACTURA GLOBAL MENSUAL A PÚBLICO EN GENERAL (26 nov 2026, dueño/Toño). Lo que nadie facturó a su nombre en el mes se
// timbra en UNA factura a público en general. Vista previa sin escribir; timbrar reserva folio y congela las ventas;
// si Facturama no contesta claro, queda «incierto» y se concilia (nunca se timbra dos veces).
import React, { useEffect, useState } from 'react'
import { FileCheck2, RefreshCw } from 'lucide-react'
import { money, fmtDate } from '../../lib/format'
import { avisar, confirmar } from '../../app/dialogos'
import { cfdiTimbrado as clientePorDefecto, FORMAS_TARJETA, type RespuestaCfdi, type ClienteCfdiTimbrado } from '../../data/ops/cfdiTimbrado'
import { hoyNegocio } from '../../data/periodo'

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const ESTADO: Record<string, { t: string; pill: string }> = {
  timbrado: { t: 'Timbrada', pill: 'p-ok' }, en_proceso: { t: 'En proceso', pill: 'p-warn' }, incierto: { t: 'Por conciliar', pill: 'p-warn' },
  fallido: { t: 'Rechazada', pill: 'p-dang' }, cancelado: { t: 'Cancelada', pill: 'p-neu' },
}
/** Mes anterior al de hoy (el que normalmente toca facturar). */
export function mesAnterior(hoy: string): { anio: number; mes: number } {
  const [y, m] = hoy.split('-').map(Number)
  return m === 1 ? { anio: y - 1, mes: 12 } : { anio: y, mes: m - 1 }
}

export function FacturaGlobal({ cliente = clientePorDefecto }: { cliente?: ClienteCfdiTimbrado }) {
  const ini = mesAnterior(hoyNegocio())
  const [anio, setAnio] = useState(ini.anio)
  const [mes, setMes] = useState(ini.mes)
  const [forma, setForma] = useState<string | null>(null)
  const [r, setR] = useState<RespuestaCfdi | null>(null)
  const [cargando, setCargando] = useState(false)
  const [timbrando, setTimbrando] = useState(false)

  const cargar = async () => { setCargando(true); setR(await cliente.globalPreparar(anio, mes, forma)); setCargando(false) }
  useEffect(() => { void cargar() }, [anio, mes, forma])   // eslint-disable-line react-hooks/exhaustive-deps

  const timbrar = async () => {
    if (!r?.resumen) return
    if (!(await confirmar(`¿Timbrar la factura global de ${MESES[mes - 1]} ${anio} a público en general? Incluye ${r.ventas} ventas por ${money(r.resumen.total)}. Esas ventas ya no se podrán facturar a nombre del cliente.`))) return
    setTimbrando(true)
    const t = await cliente.globalTimbrar(anio, mes, forma)
    setTimbrando(false)
    void avisar(t.message ?? (t.status === 'timbrado' ? 'Factura global timbrada.' : 'No se pudo timbrar.'))
    void cargar()
  }
  const conciliar = async (id: string) => { const c = await cliente.globalConciliar(id); void avisar(c.message ?? 'Listo.'); void cargar() }

  const anios = [ini.anio - 1, ini.anio, ini.anio + 1].filter((a, i, xs) => xs.indexOf(a) === i)
  return (
    <section className="card" style={{ padding: 16 }} data-testid="factura-global">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <FileCheck2 size={18} aria-hidden />
        <h3 style={{ margin: 0, fontSize: 16 }}>Factura global del mes · público en general</h3>
        <select className="input" style={{ width: 'auto', marginLeft: 'auto' }} value={mes} onChange={(e) => setMes(Number(e.target.value))} aria-label="Mes" data-testid="fg-mes">
          {MESES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <select className="input" style={{ width: 'auto' }} value={anio} onChange={(e) => setAnio(Number(e.target.value))} aria-label="Año">
          {anios.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <button type="button" className="btn ghost sm" onClick={() => void cargar()} disabled={cargando} aria-label="Actualizar"><RefreshCw size={14} /></button>
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--ink-3)', margin: '8px 0 12px' }}>
        Junta las ventas <b>pagadas</b> del mes que nadie facturó a su nombre (sin canceladas ni las que esperan mercancía) en una factura a
        RFC XAXX010101000. Se emite cuando el mes ya cerró; esas ventas ya no se facturan al cliente.
      </p>
      {cargando && !r ? <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Revisando el mes…</div> : r && (
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 13.5 }} data-testid="fg-resumen">
            <span><b>{r.ventas ?? 0}</b> ventas sin factura</span>
            <span>Total <b className="mono">{money(r.ventas_total ?? 0)}</b></span>
            {r.resumen && <span>Subtotal {money(r.resumen.subtotal)} · IVA {money(r.resumen.iva)} · forma {r.resumen.forma_pago}</span>}
            {r.entorno && <span className="pill p-neu">{r.entorno === 'produccion' ? 'Facturama: producción' : 'Facturama: pruebas'}</span>}
          </div>
          {r.requiere_forma_tarjeta && (
            <label style={{ fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>La mayor parte se cobró con tarjeta:
              <select className="input" style={{ width: 'auto' }} value={forma ?? ''} onChange={(e) => setForma(e.target.value || null)}>
                <option value="">elige…</option>{FORMAS_TARJETA.map((f) => <option key={f.v} value={f.v}>{f.t}</option>)}
              </select>
            </label>
          )}
          {(r.faltantes?.length ?? 0) > 0 && (
            <div className="sysnote" style={{ color: 'var(--warn)' }} data-testid="fg-faltantes">
              <b>Antes de timbrar:</b>
              <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{r.faltantes!.slice(0, 12).map((f) => <li key={f}>{f}</li>)}</ul>
              {r.faltantes!.length > 12 && <div>… y {r.faltantes!.length - 12} más.</div>}
            </div>
          )}
          <div>
            <button type="button" className="btn" disabled={!r.listo || timbrando || !r.configurado} onClick={() => void timbrar()} data-testid="fg-timbrar">
              {timbrando ? 'Timbrando…' : `Timbrar global de ${MESES[mes - 1]} ${anio}`}
            </button>
            {r.listo && !r.configurado && <span style={{ marginLeft: 8, fontSize: 12.5, color: 'var(--ink-3)' }}>Falta conectar Facturama.</span>}
          </div>
          {(r.globales?.length ?? 0) > 0 && (
            <div style={{ marginTop: 6 }} data-testid="fg-historial">
              <div className="eyebrow">Facturas globales emitidas</div>
              {r.globales!.map((g) => (
                <div key={g.id} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 13, padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
                  <b>{MESES[g.mes - 1]} {g.anio}</b>
                  <span className="mono">{g.serie}-{g.folio}</span>
                  <span className={'pill ' + (ESTADO[g.status]?.pill ?? 'p-neu')}>{ESTADO[g.status]?.t ?? g.status}</span>
                  <span>{g.pedidos} ventas · {money(g.total ?? 0)}</span>
                  <span style={{ color: 'var(--ink-3)' }}>{fmtDate(g.created_at)}</span>
                  {g.uuid && <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>{g.uuid}</span>}
                  {g.status === 'fallido' && g.error_message && <span style={{ color: 'var(--danger)' }}>{g.error_message}</span>}
                  {(g.status === 'incierto' || g.status === 'en_proceso') && <button type="button" className="btn ghost sm" onClick={() => void conciliar(g.id)}>Conciliar con Facturama</button>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
