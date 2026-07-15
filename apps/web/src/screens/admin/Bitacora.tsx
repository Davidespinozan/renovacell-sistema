// BITÁCORA (Administración) — registro inmutable de acciones críticas (Regla 5).
// Solo lectura: quién hizo qué y cuándo. Append-only por diseño (sin editar/borrar).
import React, { useMemo, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useAudit } from '../../data/hooks/useAudit'
import { ExportButton } from '../../app/ExportButton'

const dt = (iso: string): string => {
  try { return new Date(iso).toLocaleString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) }
  catch { return iso }
}

const actionPill = (action: string): string => {
  if (action.includes('verificado')) return 'p-ok'
  if (action.includes('revocado')) return 'p-dang'
  if (action.includes('Entrega') || action.includes('Pago') || action.includes('CFDI')) return 'p-blue'
  return 'p-neu'
}

export function Bitacora() {
  const { data } = useAudit()
  const [area, setArea] = useState<string>('todos')

  const areas = useMemo(() => ['todos', ...Array.from(new Set(data.map((e) => e.actor)))], [data])
  const rows = useMemo(
    () => (area === 'todos' ? data : data.filter((e) => e.actor === area)),
    [data, area],
  )

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div className="eyebrow">Administración · Bitácora</div>
        <ExportButton name="bitacora" rows={rows} style={{ marginLeft: 'auto' }} columns={[
          { key: 'at', label: 'Fecha/hora', format: (v) => dt(v as string) },
          { key: 'actor', label: 'Autor' },
          { key: 'action', label: 'Acción' },
          { key: 'resource', label: 'Recurso' },
          { key: 'detail', label: 'Detalle' },
        ]} />
      </div>

      <div className="sysnote">
        <ShieldCheck size={18} />
        <span>Registro <b>inmutable</b> de acciones críticas con autor y fecha/hora. No se edita ni se borra.</span>
      </div>

      <div className="fchips">
        {areas.map((a) => (
          <button key={a} type="button" className={'fchip' + (area === a ? ' on' : '')} onClick={() => setArea(a)}>
            {a === 'todos' ? 'Todas las áreas' : a}
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 0 }}>
        <div style={{ padding: '8px 14px 0' }}>
          <table className="tbl-cards">
            <thead>
              <tr><th>Fecha/hora</th><th>Autor</th><th>Acción</th><th>Recurso</th></tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td data-label="Fecha/hora" style={{ whiteSpace: 'nowrap' }}>{dt(e.at)}</td>
                  <td data-label="Autor">{e.actor}</td>
                  <td data-label="Acción"><span className={'pill ' + actionPill(e.action)}>{e.action}</span></td>
                  <td data-label="Recurso" className="mono">{e.resource}{e.detail ? <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}> · {e.detail}</span> : null}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={4} style={{ color: 'var(--ink-3)' }}>Sin registros.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
