// CRM · EMBUDO DE VENTAS (2 nov 2026). Columnas Primer contacto → En seguimiento → Cotizado → Ganado; Perdido aparte. Cada tarjeta:
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
import { Hoja } from '../../app/Hoja'
import { hoyNegocio, sumarDias } from '../../data/periodo'

const diaCorto = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'short', day: 'numeric', month: 'short' })

export function Embudo({ cliente: inyectado }: { cliente?: ReturnType<typeof crearCliente> }) {
  // UNA instancia por montaje: creada en cada render, `cargar` cambiaba siempre y el efecto recargaba sin fin.
  const cliente = useRef(inyectado ?? crearCliente()).current
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
  const [editando, setEditando] = useState<Oportunidad | null>(null)
  const [paso, setPaso] = useState({ texto: '', fecha: '', monto: '' })
  const [soloQuietas, setSoloQuietas] = useState(false)
  const abrirPaso = (o: Oportunidad) => { setEditando(o); setPaso({ texto: o.proximo_paso ?? '', fecha: o.proximo_at ?? sumarDias(hoyNegocio(), 1), monto: o.monto != null ? String(o.monto) : '' }) }
  const guardarPaso = async () => {
    if (!editando) return
    setOcupado(editando.id)
    const t = paso.texto.trim()
    const r = await cliente.paso(editando.id, t || null, t ? paso.fecha || null : null)
    let final = r.ok ? r.data : null
    const m = paso.monto.trim() === '' ? null : Number(paso.monto.replace(/[$,\s]/g, ''))
    if (r.ok && m != null && Number.isFinite(m) && m >= 0 && m !== editando.monto) {
      const e = await cliente.editar(editando.id, { monto: m })
      if (e.ok) final = e.data; else { setOcupado(null); setError(e.error); return }
    }
    setOcupado(null)
    if (!r.ok) { setError(r.error); return }
    setOps((xs) => (xs ?? []).map((x) => (x.id === editando.id ? final! : x)))
    setEditando(null)
  }

  const cargar = useCallback(async () => {
    const [r, s] = await Promise.all([cliente.embudo(vendedor || null), cliente.resumen(30)])
    if (!r.ok) { setError(r.error); return }
    setError(null); setOps(r.data); setResumen(s.ok ? s.data : null)   // el resumen solo lo reciben Dirección y el jefe de ventas
  }, [cliente, vendedor])
  useEffect(() => { void cargar() }, [cargar])

  const tot = useMemo(() => totalesPorEtapa(ops ?? []), [ops])
  const nQuietas = (ops ?? []).filter((o) => o.quieta).length
  const nHoy = (ops ?? []).filter((o) => o.paso_hoy).length
  const visibles = (ops ?? []).filter((o) => !soloQuietas || o.quieta || o.paso_hoy)
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
        Cada oportunidad avanza sola: escribe → <b>Primer contacto</b>; sabemos quién es (ficha o verificación) → <b>En seguimiento</b>; recibe cotización o pedido → <b>Cotizado</b>; paga → <b>Ganado</b>.
        Para moverla tú: en su tarjeta toca <b>«→ siguiente etapa»</b> o elige cualquier etapa en <b>«Mover a…»</b>.
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
        {(nQuietas > 0 || nHoy > 0) && (
          <button type="button" className={'crm-quietas' + (soloQuietas ? ' on' : '')} onClick={() => setSoloQuietas((v) => !v)} aria-pressed={soloQuietas} data-testid="crm-quietas">
            {[nHoy ? `${nHoy} ${nHoy === 1 ? 'toca' : 'tocan'} hoy` : null, nQuietas ? `${nQuietas} ${nQuietas === 1 ? 'quieta' : 'quietas'}` : null].filter(Boolean).join(' · ')}{soloQuietas ? ' · ver todas' : ''}
          </button>
        )}
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
                {visibles.filter((o) => o.etapa === col.key).map((o) => (
                  <div key={o.id} className={'crm-tarjeta' + (o.quieta ? ' crm-tarjeta--quieta' : '') + (o.paso_hoy ? ' crm-tarjeta--hoy' : '')} style={{ border: '1px solid var(--line)', borderRadius: 10, padding: 9, fontSize: 12.5, background: '#fff' }} data-testid="crm-tarjeta">
                    <b style={{ display: 'block', fontSize: 13 }}>{o.cliente}</b>
                    <span style={{ color: 'var(--ink-3)' }}>{o.titulo ?? ''}</span>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, color: 'var(--ink-3)' }}>
                      <span>{ORIGEN[o.origen] ?? o.origen} · {o.dias_en_etapa} {o.dias_en_etapa === 1 ? 'día' : 'días'}{veTodo && o.vendedor ? ` · ${o.vendedor}` : ''}</span>
                      {o.monto != null && <b className="mono" style={{ color: 'var(--ink-2)' }} title={o.folio_cotizacion ? `De la cotización ${o.folio_cotizacion}` : undefined}>{money(o.monto)}</b>}
                    </div>
                    {o.etapa !== 'ganado' && o.etapa !== 'perdido' && (
                      <button type="button" className={'crm-paso' + (o.paso_hoy ? ' crm-paso--hoy' : o.quieta ? ' crm-paso--quieta' : '')} onClick={() => abrirPaso(o)} data-testid="crm-paso">
                        {o.proximo_paso && o.proximo_at
                          ? <><b>{o.paso_hoy ? 'Hoy' : o.quieta ? `Venció ${diaCorto(o.proximo_at)}` : diaCorto(o.proximo_at)}:</b> {o.proximo_paso}</>
                          : o.quieta ? <><b>Quieta {o.dias_en_etapa} días.</b> ¿Qué sigue?</> : <>+ Próximo paso</>}
                      </button>
                    )}
                    {o.etapa === 'perdido' && o.motivo_perdida && <div style={{ marginTop: 4, color: 'var(--warn)' }}>{o.motivo_perdida}</div>}
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      {o.conversation_id && rol && <button type="button" className="btn ghost sm" onClick={() => irAConversacion(rol.setScreen, o.conversation_id!, { origen: 'inicio' })}>Conversación</button>}
                      {o.etapa !== 'ganado' && o.etapa !== 'perdido' && sig(o.etapa) && sig(o.etapa) !== 'ganado' && (
                        <button type="button" className="btn ghost sm" disabled={ocupado === o.id} onClick={() => void mover(o, sig(o.etapa)!)} data-testid="crm-avanzar">→ {ETAPAS.find((x) => x.key === sig(o.etapa))?.label}</button>
                      )}
                      {o.etapa !== 'ganado' && o.etapa !== 'perdido' && <button type="button" className="btn ghost sm" style={{ color: 'var(--danger)' }} onClick={() => { setPerdiendo(o); setMotivo('') }} data-testid="crm-perder">Perdido</button>}
                      {o.etapa === 'perdido' && <button type="button" className="btn ghost sm" disabled={ocupado === o.id} onClick={() => void mover(o, 'nuevo')}>Reabrir</button>}
                      {/* MOVER A CUALQUIER ETAPA (19 nov 2026, Alejandra: «¿cómo los voy avanzando de zona?») */}
                      <select className="crm-mover" aria-label={`Mover a ${o.cliente} a otra etapa`} value="" disabled={ocupado === o.id} data-testid="crm-mover"
                        onChange={(e) => { const et = e.target.value as Etapa; if (!et) return; if (et === 'perdido') { setPerdiendo(o); setMotivo('') } else void mover(o, et) }}>
                        <option value="">Mover a…</option>
                        {([...ETAPAS.map((x) => [x.key, x.label]), ['perdido', 'Perdido']] as Array<[Etapa, string]>).filter(([k]) => k !== o.etapa).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        </>
      )}
      <Hoja abierta={!!editando} onCerrar={() => setEditando(null)} titulo={editando ? `¿Qué sigue con ${editando.cliente}?` : ''} testid="crm-hoja-paso"
        pie={<button type="button" className="btn" disabled={!!editando && ocupado === editando.id || (paso.texto.trim().length > 0 && (paso.texto.trim().length < 3 || !paso.fecha))} onClick={() => void guardarPaso()} data-testid="crm-paso-guardar">{paso.texto.trim() ? 'Guardar' : 'Guardar sin paso'}</button>}>
        {editando && (
          <div className="crm-paso-form">
            <label>Próximo paso
              <input type="text" maxLength={140} value={paso.texto} onChange={(e) => setPaso({ ...paso, texto: e.target.value })} placeholder="p. ej. mandarle cotización de Golden / llamarle para cerrar" data-testid="crm-paso-texto" />
            </label>
            <div className="crm-paso-dias">
              {[['Hoy', 0], ['Mañana', 1], ['En 3 días', 3], ['En una semana', 7]].map(([l, n]) => (
                <button key={l as string} type="button" className={'pc-chip' + (paso.fecha === sumarDias(hoyNegocio(), n as number) ? ' on' : '')} onClick={() => setPaso({ ...paso, fecha: sumarDias(hoyNegocio(), n as number) })}>{l}</button>
              ))}
              <input type="date" value={paso.fecha} min={hoyNegocio()} max={sumarDias(hoyNegocio(), 180)} onChange={(e) => setPaso({ ...paso, fecha: e.target.value })} aria-label="Día" data-testid="crm-paso-fecha" />
            </div>
            <label>Monto estimado
              <input type="text" inputMode="decimal" value={paso.monto} onChange={(e) => setPaso({ ...paso, monto: e.target.value })} placeholder="$0" data-testid="crm-paso-monto" />
              <small>{editando.folio_cotizacion ? `Viene de la cotización ${editando.folio_cotizacion}; se actualiza solo con cada cotización o pedido.` : 'Se llena solo cuando le mandas una cotización o le levantas un pedido.'}</small>
            </label>
          </div>
        )}
      </Hoja>
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
          if (c.nuevo) { void cargar(); return }   // NUEVO PROSPECTO · la base ya le abrió su oportunidad en «Primer contacto»
          const r = await cliente.crear(c.id, 'Oportunidad')
          if (!r.ok) { setError(r.error); return }
          setOps((xs) => [r.data, ...(xs ?? [])])
        }} />
      )}
    </div>
  )
}
