// CRM · EMBUDO DE VENTAS (2 nov 2026). Columnas Nuevo → Calificado → Propuesta → Ganado; Perdido aparte. Cada tarjeta:
// cliente, monto, días en la etapa, origen; se mueve con un clic (Perdido pide motivo) y abre su conversación.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PageHead } from '../../app/PageHead'
import { Vacio, Cargando, ErrorCarga } from '../../app/EmptyState'
import { money } from '../../lib/format'
import { useRoleOpcional } from '../../auth/RoleContext'
import { irAConversacion } from '../../data/store/navIntentStore'
import { crm as crearCliente, ETAPAS, ORIGEN, totalesPorEtapa, type Etapa, type Oportunidad, type ResumenCrm } from '../../data/ops/crm'
import { SelectorClienteVentas } from '../pos/SelectorCliente'
import { BuscadorClientes } from '../../data/ops/buscarClientes'

export function Embudo({ cliente = crearCliente() }: { cliente?: ReturnType<typeof crearCliente> }) {
  const rol = useRoleOpcional()
  const [ops, setOps] = useState<Oportunidad[] | null>(null)
  const [resumen, setResumen] = useState<ResumenCrm | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [vendedor, setVendedor] = useState<string>('')
  const [verPerdidas, setVerPerdidas] = useState(false)
  const [perdiendo, setPerdiendo] = useState<Oportunidad | null>(null)
  const [motivo, setMotivo] = useState('')
  const [nueva, setNueva] = useState(false)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [etapaMovil, setEtapaMovil] = useState<Etapa>('nuevo')   // CALIDAD VISUAL · en celular se ve una etapa a la vez
  const buscador = useRef(new BuscadorClientes())

  const cargar = useCallback(async () => {
    const [r, s] = await Promise.all([cliente.embudo(vendedor || null), cliente.resumen(30)])
    if (!r.ok) { setError(r.error); return }
    setError(null); setOps(r.data); setResumen(s.ok ? s.data : null)   // el resumen solo lo reciben Dirección y el jefe de ventas
  }, [cliente, vendedor])
  useEffect(() => { void cargar() }, [cargar])

  const tot = useMemo(() => totalesPorEtapa(ops ?? []), [ops])
  const veTodo = !!resumen
  const mover = async (o: Oportunidad, etapa: Etapa, m?: string) => {
    setOcupado(o.id)
    const r = await cliente.mover(o.id, etapa, m)
    setOcupado(null)
    if (!r.ok) { setError(r.error); return }
    setOps((xs) => (xs ?? []).map((x) => (x.id === o.id ? r.data : x)))
  }
  const columnas = [...ETAPAS, ...(verPerdidas ? [{ key: 'perdido' as Etapa, label: 'Perdido', pista: 'Con su motivo' }] : [])]
  const activa: Etapa = columnas.some((c) => c.key === etapaMovil) ? etapaMovil : 'nuevo'
  const sig = (e: Etapa): Etapa | null => { const i = ETAPAS.findIndex((x) => x.key === e); return i >= 0 && i < ETAPAS.length - 1 ? ETAPAS[i + 1].key : null }

  return (
    <div className="grid" style={{ gap: 16 }} data-testid="crm-embudo">
      <PageHead title="Embudo de ventas">
        Cada oportunidad avanza sola: escribe → <b>Nuevo</b>; se verifica o se liga a su ficha → <b>Calificado</b>; recibe cotización o pedido → <b>Propuesta</b>; paga → <b>Ganado</b>. También la puedes mover tú.
      </PageHead>
      {veTodo && resumen && (
        <div className="card" style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }} data-testid="crm-resumen">
          <span>Conversión (30 días): <b>{resumen.conversion == null ? '—' : `${resumen.conversion}%`}</b></span>
          <span>Ganado (30 días): <b>{money(resumen.por_etapa.ganado?.monto ?? 0)}</b></span>
          <label style={{ marginLeft: 'auto' }}>Vendedor{' '}
            <select value={vendedor} onChange={(e) => setVendedor(e.target.value)} data-testid="crm-filtro-vendedor">
              <option value="">Todos</option>
              {resumen.por_vendedor.filter((v) => v.vendedor_id).map((v) => <option key={v.vendedor_id!} value={v.vendedor_id!}>{v.vendedor ?? 'Sin nombre'} · {v.abiertas} abiertas · {v.ganadas} ganadas</option>)}
            </select>
          </label>
        </div>
      )}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn" onClick={() => setNueva(true)} data-testid="crm-nueva">Nueva oportunidad</button>
        <label style={{ fontSize: 12.5, display: 'flex', gap: 6, alignItems: 'center' }}><input type="checkbox" checked={verPerdidas} onChange={(e) => setVerPerdidas(e.target.checked)} /> Ver perdidas ({tot.perdido.n})</label>
        {error && ops !== null && <span role="alert" className="ms" style={{ color: 'var(--danger)' }}>{error}</span>}
      </div>
      {ops === null ? (error ? <ErrorCarga titulo="No se pudo cargar el embudo" detalle={error} onReintentar={() => { setError(null); void cargar() }} /> : <Cargando filas={4} />) : ops.length === 0 ? (
        <Vacio icono="usercheck" titulo="Aún no hay oportunidades." pista="Se crean solas cuando un cliente escribe, se le cotiza o se le levanta un pedido." />
      ) : (
        <>
        <div className="seg seg--pestanas crm-tabs" role="tablist" aria-label="Etapas del embudo" data-testid="crm-tabs">
          {columnas.map((col) => (
            <button key={col.key} type="button" role="tab" aria-selected={activa === col.key} className={activa === col.key ? 'active' : undefined} onClick={() => setEtapaMovil(col.key)}>{col.label}<span className="seg-conteo">{tot[col.key].n}</span></button>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${verPerdidas ? 5 : 4}, minmax(220px, 1fr))`, gap: 10, overflowX: 'auto' }} className="crm-columnas">
          {columnas.map((col) => (
            <div key={col.key} className={'card crm-col' + (activa === col.key ? ' activa' : '')} style={{ padding: 10, minWidth: 220 }} data-testid={`crm-col-${col.key}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                <b style={{ fontSize: 13.5 }}>{col.label} <span style={{ color: 'var(--ink-3)', fontWeight: 400 }}>{tot[col.key].n}</span></b>
                <span className="mono" style={{ fontSize: 12, color: 'var(--ink-3)' }}>{money(tot[col.key].monto)}</span>
              </div>
              <div style={{ display: 'grid', gap: 8 }}>
                {tot[col.key].n === 0 && <div className="crm-vacia">Sin oportunidades en {col.label.toLowerCase()}.</div>}
                {(ops ?? []).filter((o) => o.etapa === col.key).map((o) => (
                  <div key={o.id} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 9, fontSize: 12.5, background: '#fff' }} data-testid="crm-tarjeta">
                    <b style={{ display: 'block', fontSize: 13 }}>{o.cliente}</b>
                    <span style={{ color: 'var(--ink-3)' }}>{o.titulo ?? ''}</span>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, color: 'var(--ink-3)' }}>
                      <span>{ORIGEN[o.origen] ?? o.origen} · {o.dias_en_etapa} {o.dias_en_etapa === 1 ? 'día' : 'días'}{veTodo && o.vendedor ? ` · ${o.vendedor}` : ''}</span>
                      {o.monto != null && <b className="mono" style={{ color: 'var(--ink-2)' }}>{money(o.monto)}</b>}
                    </div>
                    {o.etapa === 'perdido' && o.motivo_perdida && <div style={{ marginTop: 4, color: 'var(--warn)' }}>{o.motivo_perdida}</div>}
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      {o.conversation_id && rol && <button type="button" className="btn ghost sm" onClick={() => irAConversacion(rol.setScreen, o.conversation_id!, { origen: 'inicio' })}>Conversación</button>}
                      {o.etapa !== 'ganado' && o.etapa !== 'perdido' && sig(o.etapa) && sig(o.etapa) !== 'ganado' && (
                        <button type="button" className="btn ghost sm" disabled={ocupado === o.id} onClick={() => void mover(o, sig(o.etapa)!)} data-testid="crm-avanzar">→ {ETAPAS.find((x) => x.key === sig(o.etapa))?.label}</button>
                      )}
                      {o.etapa !== 'ganado' && o.etapa !== 'perdido' && <button type="button" className="btn ghost sm" style={{ color: 'var(--danger)' }} onClick={() => { setPerdiendo(o); setMotivo('') }} data-testid="crm-perder">Perdido</button>}
                      {o.etapa === 'perdido' && <button type="button" className="btn ghost sm" disabled={ocupado === o.id} onClick={() => void mover(o, 'nuevo')}>Reabrir</button>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        </>
      )}
      {perdiendo && (
        <div className="overlay" onClick={() => setPerdiendo(null)}>
          <div className="modal" role="dialog" aria-label="Marcar como perdida" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600 }}>¿Por qué se perdió?</h3>
            <p className="ms" style={{ color: 'var(--ink-3)' }}>{perdiendo.cliente}</p>
            <input type="text" maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="p. ej. compró con otro proveedor / precio / ya no lo necesita" style={{ width: '100%', marginTop: 8 }} data-testid="crm-motivo" />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
              <button type="button" className="btn ghost" onClick={() => setPerdiendo(null)}>Cancelar</button>
              <button type="button" className="btn" disabled={motivo.trim().length < 3} onClick={() => { void mover(perdiendo, 'perdido', motivo.trim()); setPerdiendo(null) }} data-testid="crm-motivo-guardar">Marcar perdida</button>
            </div>
          </div>
        </div>
      )}
      {nueva && (
        <SelectorClienteVentas buscador={buscador.current} onClose={() => setNueva(false)} onPick={async (c) => {
          setNueva(false)
          if (!c) return
          const r = await cliente.crear(c.id, 'Oportunidad')
          if (!r.ok) { setError(r.error); return }
          setOps((xs) => [r.data, ...(xs ?? [])])
        }} />
      )}
    </div>
  )
}
