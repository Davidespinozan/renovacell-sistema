// CIERRE DE CAJA (arqueo). Compara el efectivo ESPERADO (ventas POS en efectivo)
// contra lo CONTADO por el cajero, registra la diferencia y su motivo. Da control
// de efectivo del día o del evento. Lógica de esperado en data/ops/finanzas.
import React, { useMemo, useState } from 'react'
import { Wallet, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { money, fmtDate } from '../../lib/format'
import { PageHead } from '../../app/PageHead'
import { ExportButton } from '../../app/ExportButton'
import { useAllOrders } from '../../data/hooks/useOrders'
import { useEvents } from '../../data/hooks/useEvents'
import { useCierres } from '../../data/hooks/useFinanzas'
import { useRole } from '../../auth/RoleContext'
import { efectivoEsperado } from '../../data/ops/finanzas'

export function CierreCaja() {
  const { data: orders } = useAllOrders()
  const { data: events } = useEvents()
  const { data: cierres, registrarCierre } = useCierres()
  const { user } = useRole()

  const today = new Date().toISOString().slice(0, 10)
  // Alcance: caja del día o un evento específico.
  const [scope, setScope] = useState<string>('dia') // 'dia' | eventId
  const ev = events.find((e) => e.id === scope)
  const alcance = ev ? ev.name : 'Caja del día'

  const esperado = useMemo(
    () => (ev ? efectivoEsperado(orders, { eventId: ev.id }) : efectivoEsperado(orders, { day: today })),
    [orders, ev, today],
  )

  const [contado, setContado] = useState('')
  const contadoN = Math.max(0, Number(contado) || 0)
  const diferencia = contadoN - esperado
  const [motivo, setMotivo] = useState('')
  const [done, setDone] = useState(false)

  const needsMotivo = contado !== '' && diferencia !== 0
  const valid = contado !== '' && (!needsMotivo || motivo.trim() !== '')

  const cerrar = () => {
    if (!valid) return
    registrarCierre({ fecha: today, alcance, esperado, contado: contadoN, motivo: motivo.trim() || null, usuario: user?.name ?? 'Cajero' })
    setDone(true); setContado(''); setMotivo('')
    window.setTimeout(() => setDone(false), 2600)
  }

  const sel: React.CSSProperties = { padding: '9px 12px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 13.5, background: '#fff' }
  const fld: React.CSSProperties = { width: '100%', padding: '11px 13px', border: '1px solid var(--line)', borderRadius: 11, fontFamily: 'inherit', fontSize: 16, outline: 'none', marginTop: 6 }
  const lbl: React.CSSProperties = { display: 'block', fontSize: 11.5, fontWeight: 700, letterSpacing: '.03em', textTransform: 'uppercase', color: 'var(--ink-3)', marginTop: 14 }

  return (
    <div className="grid" style={{ gap: 16 }}>
      <PageHead title="Cierre de caja">
        Arqueo del efectivo: el sistema calcula lo <b>esperado</b> (ventas en efectivo) y tú capturas lo
        <b> contado</b>. Si no cuadra, registras el motivo. Queda el historial para control.
      </PageHead>

      <div className="grid two" style={{ alignItems: 'start' }}>
        {/* Arqueo */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <Wallet size={18} style={{ color: 'var(--green-deep)' }} />
            <h3 style={{ fontSize: 16, fontWeight: 600 }}>Nuevo arqueo</h3>
          </div>

          <label style={lbl}>Alcance</label>
          <select style={{ ...sel, width: '100%', marginTop: 6 }} value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="dia">Caja del día ({fmtDate(today)})</option>
            {events.map((e) => <option key={e.id} value={e.id}>Evento · {e.name}</option>)}
          </select>

          <div className="tket-total" style={{ marginTop: 16 }}>
            <span>Efectivo esperado</span><b className="mono">{money(esperado)}</b>
          </div>

          <label style={lbl}>Efectivo contado</label>
          <input type="number" min={0} style={fld} value={contado} onChange={(e) => setContado(e.target.value)} placeholder="0" />

          {contado !== '' && (
            <div className="sysnote" style={{ marginTop: 14, ...(diferencia === 0
              ? { background: 'var(--ok-bg)', borderColor: '#C9E4CF', color: 'var(--green-deep)' }
              : { background: 'var(--danger-bg)', borderColor: '#ECCAC6', color: 'var(--danger)' }) }}>
              {diferencia === 0 ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
              <span>{diferencia === 0 ? 'Cuadra exacto.' : `${diferencia > 0 ? 'Sobrante' : 'Faltante'} de ${money(Math.abs(diferencia))}.`}</span>
            </div>
          )}

          {needsMotivo && (
            <>
              <label style={lbl}>Motivo de la diferencia</label>
              <input style={fld} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="p. ej. cambio mal dado, propina, error de captura" />
            </>
          )}

          <button className="btn" type="button" style={{ width: '100%', marginTop: 18, opacity: valid ? 1 : 0.5, cursor: valid ? 'pointer' : 'not-allowed' }} disabled={!valid} onClick={cerrar}>
            Registrar cierre
          </button>
          {done && <div className="sysnote" style={{ marginTop: 12, background: 'var(--ok-bg)', borderColor: '#C9E4CF', color: 'var(--green-deep)' }}><span>Cierre registrado.</span></div>}
        </div>

        {/* Historial */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '18px 18px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="eyebrow" style={{ margin: 0 }}>Cierres recientes</div>
            <ExportButton name="cierres-de-caja" rows={cierres} style={{ marginLeft: 'auto' }} columns={[
              { key: 'fecha', label: 'Fecha', format: (v) => fmtDate(v as string) },
              { key: 'alcance', label: 'Alcance' },
              { key: 'esperado', label: 'Esperado', format: (v) => money(v as number) },
              { key: 'contado', label: 'Contado', format: (v) => money(v as number) },
              { key: 'diferencia', label: 'Diferencia', format: (v) => money(v as number) },
              { key: 'motivo', label: 'Motivo' },
              { key: 'usuario', label: 'Usuario' },
            ]} />
          </div>
          <div style={{ padding: '0 14px 8px' }}>
            <table className="tbl-cards">
              <thead><tr><th>Fecha</th><th>Alcance</th><th>Esperado</th><th>Contado</th><th>Diferencia</th></tr></thead>
              <tbody>
                {cierres.map((c) => (
                  <tr key={c.id}>
                    <td data-label="Fecha" style={{ whiteSpace: 'nowrap' }}>{fmtDate(c.fecha)}</td>
                    <td data-label="Alcance">{c.alcance}</td>
                    <td data-label="Esperado" className="mono">{money(c.esperado)}</td>
                    <td data-label="Contado" className="mono">{money(c.contado)}</td>
                    <td data-label="Diferencia"><span className={'pill ' + (c.diferencia === 0 ? 'p-ok' : 'p-dang')}>{c.diferencia === 0 ? 'Cuadra' : (c.diferencia > 0 ? '+' : '') + money(c.diferencia)}</span></td>
                  </tr>
                ))}
                {cierres.length === 0 && <tr><td colSpan={5} style={{ color: 'var(--ink-3)' }}>Aún no hay cierres.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
