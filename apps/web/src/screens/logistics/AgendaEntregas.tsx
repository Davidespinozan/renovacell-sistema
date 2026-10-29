// ENT-H · HORARIOS DE ENTREGA LOCAL: la agenda que ven Dirección, Almacén/Empaque y Chofer. Por día, cada horario de media
// hora con la entrega que lo ocupa (pedido, cliente, dirección, teléfono, estado y chofer) o "libre". Dirección y Almacén
// pueden mover una entrega a otro horario con motivo (queda en el pedido y en la bitácora). Los datos salen SIEMPRE del
// servidor (entrega_horarios_agenda / entrega_horario_reprogramar); aquí no se calcula ninguna disponibilidad.
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../app/icons'
import { PageHead } from '../../app/PageHead'
import { Vacio } from '../../app/EmptyState'
import { HorarioEntregaPicker } from '../../app/HorarioEntregaPicker'
import { useRole } from '../../auth/RoleContext'
import { money } from '../../lib/format'
import { hoyNegocio, sumarDias } from '../../data/periodo'
import { agendaEntregasLocales, fechaCorta, reprogramarHorarioEntrega, type AgendaEntregas as Agenda, type DiaAgenda, type HorarioElegido, type PedidoAgendado, type SlotAgenda } from '../../data/ops/entrega'

// Día de negocio y aritmética de fechas: SIEMPRE por data/periodo.ts (zona del negocio, nunca el reloj del dispositivo ni UTC).
const hoyLocal = () => hoyNegocio()
const ESTADO_PEDIDO: Record<string, string> = { pending_payment: 'Por pagar', draft: 'Borrador', paid: 'Pagado', picking: 'Preparando', packed: 'Empacado', shipped: 'En camino', delivered: 'Entregado', fulfilled: 'Entregado', cancelled: 'Cancelado' }
const ESTADO_ENVIO: Record<string, string> = { por_despachar: 'Por despachar', despachado: 'Despachado', out_for_delivery: 'En reparto', delivered: 'Entregado', incident: 'Incidencia', cancelado: 'Cancelado' }

/** Agenda de entregas locales desde el servidor para un rango; `recargar` vuelve a pedirla. */
export function useAgendaEntregas(desde: string, hasta: string, cargar = agendaEntregasLocales) {
  const [data, setData] = useState<Agenda | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const vivo = useRef(true); const n = useRef(0)
  useEffect(() => { vivo.current = true; return () => { vivo.current = false } }, [])
  const recargar = useCallback(async () => {
    const k = ++n.current
    setCargando(true)
    const r = await cargar(desde, hasta)
    if (!vivo.current || k !== n.current) return
    setCargando(false)
    if (!r.ok) { setError(r.error); return }
    setError(null); setData(r.data)
  }, [desde, hasta, cargar])
  useEffect(() => { void recargar() }, [recargar])
  return { data, error, cargando, recargar }
}

function direccionCorta(p: PedidoAgendado): string {
  const d = p.direccion
  if (!d) return 'Sin dirección en el pedido'
  return [d.line1, d.colonia, d.cp ? `C.P. ${d.cp}` : null, d.city].filter(Boolean).join(', ')
}

// Teléfono legible para marcar: 10 dígitos de México como "667 123 4567" (quita +52/52 delante); otro largo, tal cual.
function telLegible(t: string): string {
  const d = t.replace(/\D/g, '')
  const diez = d.length === 12 && d.startsWith('52') ? d.slice(2) : d
  return diez.length === 10 ? `${diez.slice(0, 3)} ${diez.slice(3, 6)} ${diez.slice(6)}` : t
}

// No hay ícono de teléfono en app/icons (no es de esta pantalla); trazo propio con el mismo grosor.
const IcoTel = () => (
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M5 4h3l2 5-2.5 1.5a11 11 0 0 0 6 6L15 14l5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />
  </svg>
)

type Bloque = { tipo: 'slot'; slot: SlotAgenda } | { tipo: 'libres'; slots: SlotAgenda[] }
/** Junta los horarios libres consecutivos en un solo bloque: la agenda muestra lo ocupado, no 16 filas de "libre". */
function agrupar(slots: SlotAgenda[]): Bloque[] {
  const out: Bloque[] = []
  for (const s of slots) {
    const prev = out[out.length - 1]
    if (s.pedidos.length > 0) out.push({ tipo: 'slot', slot: s })
    else if (prev && prev.tipo === 'libres') prev.slots.push(s)
    else out.push({ tipo: 'libres', slots: [s] })
  }
  return out
}

function Reprogramar({ pedido, actual, onListo, onCancelar, reprogramar = reprogramarHorarioEntrega, cargarHorarios }: {
  pedido: PedidoAgendado; actual: HorarioElegido; onListo: (msg: string) => void; onCancelar: () => void
  reprogramar?: typeof reprogramarHorarioEntrega; cargarHorarios?: React.ComponentProps<typeof HorarioEntregaPicker>['cargar']
}) {
  const [h, setH] = useState<HorarioElegido | null>(null)
  const [motivo, setMotivo] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const puede = !!h && motivo.trim().length >= 3 && !ocupado
  const enviar = async () => {
    if (!puede || !h) return
    setOcupado(true); setError(null)
    const r = await reprogramar(pedido.order_id, h, motivo.trim())
    setOcupado(false)
    if (!r.ok) { setError(r.error); return }
    onListo(`${pedido.folio ?? 'Pedido'} ahora se entrega el ${fechaCorta(r.data.horario.fecha)} de ${r.data.horario.inicio} a ${r.data.horario.fin}.`)
  }
  return (
    <div style={{ marginTop: 10, padding: 12, border: '1px solid var(--line)', borderRadius: 12, background: 'var(--surface-2, #fafafa)', display: 'grid', gap: 10 }} data-testid={`reprogramar-${pedido.order_id}`}>
      <div className="eyebrow" style={{ margin: 0 }}>Cambiar el horario de {pedido.folio ?? 'este pedido'}</div>
      <HorarioEntregaPicker value={h} onChange={setH} excluir={actual} cargar={cargarHorarios} compacto />
      <label style={{ fontSize: 12.5 }}>Motivo del cambio
        <input type="text" maxLength={200} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="p. ej. el cliente pidió más tarde" style={{ marginLeft: 8, width: 'min(100%, 340px)' }} data-testid="reprogramar-motivo" />
      </label>
      {error && <div role="alert" className="ms" style={{ color: 'var(--danger)' }} data-testid="reprogramar-error">{error}</div>}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button type="button" className="btn ghost sm" onClick={onCancelar}>Cancelar</button>
        <button type="button" className="btn sm" disabled={!puede} style={!puede ? { opacity: 0.5, cursor: 'not-allowed' } : undefined} onClick={enviar} data-testid="reprogramar-confirmar"><Icon name="check" /> {ocupado ? 'Guardando…' : 'Mover entrega'}</button>
      </div>
    </div>
  )
}

function Slot({ dia, slot, puedeReprogramar, abierto, onAbrir, onCerrar, onListo, reprogramar, cargarHorarios }: {
  dia: DiaAgenda; slot: SlotAgenda; puedeReprogramar: boolean; abierto: string | null; onAbrir: (orderId: string) => void; onCerrar: () => void; onListo: (msg: string) => void
  reprogramar?: typeof reprogramarHorarioEntrega; cargarHorarios?: React.ComponentProps<typeof HorarioEntregaPicker>['cargar']
}) {
  const libre = slot.pedidos.length === 0
  const lleno = slot.pedidos.length >= slot.cupo
  // Los libres llegan agrupados (agrupar); la píldora solo marca ocupación, con mayúscula inicial.
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(96px, 110px) 1fr', gap: 10, padding: '10px 0', borderTop: '1px solid var(--line)' }} data-testid={`agenda-${dia.fecha}-${slot.inicio}`}>
      <div>
        <div className="mono" style={{ fontSize: 14, fontWeight: 700 }}>{slot.inicio}–{slot.fin}</div>
        {!libre && <span className={'pill ' + (lleno ? 'p-ok' : 'p-warn')} style={{ marginTop: 4 }}>{lleno ? (slot.cupo > 1 ? `Lleno · ${slot.pedidos.length}` : 'Ocupado') : `${slot.pedidos.length} de ${slot.cupo}`}</span>}
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        {libre && <span style={{ fontSize: 12.5, color: 'var(--ink-3)', alignSelf: 'center' }}>Nadie agendado.</span>}
        {slot.pedidos.map((p) => {
          // Si el envío dice lo mismo que el pedido ("Entregado" y "Entregado · Manuel"), una sola píldora con el chofer.
          const ep = ESTADO_PEDIDO[p.estado_pedido ?? ''] ?? p.estado_pedido ?? ''
          const ee = p.envio_estado ? ESTADO_ENVIO[p.envio_estado] ?? p.envio_estado : null
          const mismo = ee != null && ee === ep
          return (
          <div key={p.order_id} style={{ fontSize: 13 }} data-testid={`agenda-pedido-${p.order_id}`}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="mono" style={{ fontWeight: 700 }}>{p.folio ?? '—'}</span>
              <b>{p.cliente}</b>
              <span className={'pill ' + (p.estado_pedido === 'cancelled' ? 'p-dang' : p.estado_pedido === 'shipped' || p.estado_pedido === 'delivered' ? 'p-ok' : p.pagado ? 'p-neu' : 'p-warn')}>{ep}{!p.pagado && p.estado_pedido !== 'cancelled' && p.estado_pedido !== 'delivered' ? ' · sin pagar' : ''}{mismo && p.chofer ? ` · ${p.chofer}` : ''}</span>
              {ee && !mismo && <span className="pill p-neu">{ee}{p.chofer ? ` · ${p.chofer}` : ''}</span>}
            </div>
            <div style={{ color: 'var(--ink-2)', marginTop: 2 }}>{direccionCorta(p)}{p.direccion?.refs ? ` · Ref.: ${p.direccion.refs}` : ''}</div>
            <div style={{ color: 'var(--ink-3)', fontSize: 12, marginTop: 2, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              {p.telefono ? <a href={`tel:${p.telefono}`} className="tap-link pp-tel" aria-label={`Llamar al ${telLegible(p.telefono)}`}><IcoTel /> {telLegible(p.telefono)}</a> : <span>Sin teléfono</span>}
              {p.flete ? <span>Flete {money(p.flete)}</span> : <span>Flete gratis</span>}
              {puedeReprogramar && p.estado_pedido !== 'cancelled' && p.estado_pedido !== 'delivered' && abierto !== p.order_id && (
                <button type="button" className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => onAbrir(p.order_id)} data-testid={`agenda-cambiar-${p.order_id}`}><Icon name="clock" /> Cambiar horario</button>
              )}
            </div>
            {abierto === p.order_id && <Reprogramar pedido={p} actual={{ fecha: dia.fecha, inicio: slot.inicio }} onListo={onListo} onCancelar={onCerrar} reprogramar={reprogramar} cargarHorarios={cargarHorarios} />}
          </div>
          )
        })}
      </div>
    </div>
  )
}

export function AgendaEntregas({ cargar = agendaEntregasLocales, reprogramar = reprogramarHorarioEntrega, cargarHorarios, sinTitulo = false }: {
  cargar?: typeof agendaEntregasLocales; reprogramar?: typeof reprogramarHorarioEntrega
  cargarHorarios?: React.ComponentProps<typeof HorarioEntregaPicker>['cargar']; sinTitulo?: boolean
}) {
  const { role } = useRole()
  const puedeReprogramar = role === 'admin' || role === 'warehouse'
  const hoy = hoyLocal()
  const [desde, setDesde] = useState(hoy)
  const hasta = useMemo(() => sumarDias(desde, 6), [desde])
  const { data, error, cargando, recargar } = useAgendaEntregas(desde, hasta, cargar)
  const [diaSel, setDiaSel] = useState<string | null>(null)
  const [abierto, setAbierto] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const dias = data?.dias ?? []
  const dia = dias.find((d) => d.fecha === diaSel) ?? dias.find((d) => d.fecha === hoy) ?? dias[0] ?? null
  const totalSemana = dias.reduce((s, d) => s + d.entregas, 0)
  const avisar = (msg: string) => { setToast(msg); setAbierto(null); void recargar(); window.setTimeout(() => setToast(null), 4000) }

  return (
    <div className="grid" style={{ gap: 14 }} data-testid="agenda-entregas">
      {!sinTitulo && <PageHead title="Horarios de entrega">{puedeReprogramar ? 'Las entregas locales de cada día, por horario. Si hace falta, mueve una a otro horario.' : 'Las entregas locales de cada día, por horario, tal como se le prometieron al cliente.'}</PageHead>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" className="btn ghost sm" onClick={() => { setDesde(sumarDias(desde, -7)); setDiaSel(null) }} aria-label="Semana anterior" data-testid="agenda-prev"><Icon name="chevronLeft" /></button>
        <b style={{ fontSize: 13.5 }}>{fechaCorta(desde)} – {fechaCorta(hasta)}</b>
        <button type="button" className="btn ghost sm" onClick={() => { setDesde(sumarDias(desde, 7)); setDiaSel(null) }} aria-label="Semana siguiente" data-testid="agenda-next"><Icon name="chevronRight" /></button>
        {desde !== hoy && <button type="button" className="btn ghost sm" onClick={() => { setDesde(hoy); setDiaSel(null) }} data-testid="agenda-hoy">Hoy</button>}
        <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--ink-3)' }} data-testid="agenda-total">{cargando && !data ? 'Cargando…' : `${totalSemana} entrega${totalSemana === 1 ? '' : 's'} esta semana`}</span>
        <button type="button" className="btn ghost sm" onClick={() => void recargar()} data-testid="agenda-actualizar">Actualizar</button>
      </div>
      {error && <div role="alert" className="card" style={{ color: 'var(--danger)', fontSize: 13 }} data-testid="agenda-error">{error}</div>}
      {toast && <div role="status" className="sysnote" data-testid="agenda-toast">{toast}</div>}
      {data && dias.length === 0 && <Vacio icono="clock" titulo="No hay días de entrega en esta semana." pista="Los días de salida del chofer se configuran en la regla de entrega." />}
      {dias.length > 0 && dia && (
        <>
          <div role="tablist" aria-label="Día" style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, scrollbarWidth: 'none' }}>
            {dias.map((d) => {
              const on = d.fecha === dia.fecha
              return (
                <button key={d.fecha} type="button" role="tab" aria-selected={on} onClick={() => { setDiaSel(d.fecha); setAbierto(null) }} data-testid={`agenda-dia-${d.fecha}`}
                  style={{ flex: 'none', minWidth: 72, minHeight: 48, padding: '6px 10px', borderRadius: 11, border: '1px solid ' + (on ? 'var(--green-deep)' : 'var(--line)'), background: on ? 'var(--green-deep)' : 'var(--card, #fff)', color: on ? '#fff' : 'inherit', fontFamily: 'inherit', cursor: 'pointer' }}>
                  <span style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', fontWeight: 700 }}>{d.hoy ? 'hoy' : fechaCorta(d.fecha).split(' ')[0].slice(0, 3)}</span>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 600 }}>{d.fecha.slice(8, 10)}/{d.fecha.slice(5, 7)}</span>
                  <span style={{ display: 'block', fontSize: 10.5, opacity: 0.85 }}>{d.entregas === 0 ? 'sin entregas' : `${d.entregas} entrega${d.entregas === 1 ? '' : 's'}`}</span>
                </button>
              )
            })}
          </div>
          <div className="card" data-testid={`agenda-dia-panel-${dia.fecha}`}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
              <h4 style={{ margin: 0, fontSize: 14.5, fontWeight: 700, textTransform: 'capitalize' }}>{dia.hoy ? 'Hoy · ' : ''}{fechaCorta(dia.fecha)}</h4>
              <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{dia.entregas} entrega{dia.entregas === 1 ? '' : 's'} · {dia.slots.length} {dia.slots.length === 1 ? 'horario' : 'horarios'}</span>
            </div>
            {dia.slots.length === 0 && <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>Ese día no hay horarios configurados.</div>}
            {agrupar(dia.slots).map((b) => b.tipo === 'slot' ? (
              <Slot key={b.slot.inicio} dia={dia} slot={b.slot} puedeReprogramar={puedeReprogramar} abierto={abierto} onAbrir={setAbierto} onCerrar={() => setAbierto(null)} onListo={avisar} reprogramar={reprogramar} cargarHorarios={cargarHorarios} />
            ) : (
              <div key={b.slots[0].inicio} className="pp-libres" data-testid={`agenda-libres-${dia.fecha}-${b.slots[0].inicio}`}>
                <span className="mono">{b.slots[0].inicio}–{b.slots[b.slots.length - 1].fin}</span>
                <span>{b.slots.length === 1 ? 'Horario libre' : `${b.slots.length} horarios libres`}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
