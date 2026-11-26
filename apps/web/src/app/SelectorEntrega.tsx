// ENT-2 · Selector de ENTREGA para el personal (Levantar pedido): el servidor manda las opciones con el flete que
// propone la regla y la promesa de llegada (corte 15:30); aquí el vendedor elige y, si quiere cobrar otro flete
// (o regalarlo), lo escribe con su motivo. Nunca se inventa una fecha: todo viene de entrega_opciones.
import React, { useEffect, useRef, useState } from 'react'
import { money } from '../lib/format'
import { MOTIVO_ENTREGA, NOMBRE_PAQUETERIA, fechaCorta, avisoEnvioGratis, faltantePara, fleteTexto, localBajoMinimo, opcionDe, opcionesEntrega, promesaDe, requiereHorario, textoLlegada, type EleccionEntregaServidor, type HorarioElegido, type OpcionEntrega, type OpcionesEntrega, type ServicioElegido } from '../data/ops/entrega'
import { HorarioEntregaPicker } from './HorarioEntregaPicker'
import { AvisoEnvioGratisVista } from './AvisoEnvioGratis'
import { usePromesaDhl } from './PromesaPaqueteria'   // PAQ-SIMPLE · solo la paquetería; DHL promete con su cotización en vivo
import { diasEntre, sumarDias } from '../data/periodo'   // SALIDA PROGRAMADA · fechas del negocio

/** ENT-H · el horario elegido viaja solo cuando existe (sin la llave en null). */
const hor = (v: EleccionEntregaServidor | null | undefined): { horario?: HorarioElegido; servicio?: ServicioElegido; salida_programada?: string } => ({ ...(v?.horario ? { horario: v.horario } : {}), ...(v?.servicio ? { servicio: v.servicio } : {}), ...(v?.salida_programada ? { salida_programada: v.salida_programada } : {}) })   // SALIDA PROGRAMADA · también se conserva   // ENTREGA-SERVICIO · el servicio elegido también se conserva

export function SelectorEntrega({ subtotal, cp, value, onChange, cargar = opcionesEntrega, cargarHorarios, piezas = 0, destino, cargarServicios, preferida = null }: {
  /** ENTREGA PREFERIDA (26 nov 2026) · opción que el cliente ya tiene establecida: se elige sola si está disponible. */
  preferida?: string | null
  subtotal: number
  cp: string | null
  /** PAQ-SIMPLE · piezas del pedido para cotizar la FECHA de DHL (0 = sin cotizar: rango de la regla). */
  piezas?: number
  destino?: { ciudad?: string | null; estado?: string | null }
  cargarServicios?: Parameters<typeof usePromesaDhl>[0]['cargar']
  value: EleccionEntregaServidor | null
  onChange: (e: EleccionEntregaServidor | null, ops: OpcionesEntrega | null) => void
  cargar?: typeof opcionesEntrega
  /** ENT-H · horarios de entrega local (inyectable en pruebas). */
  cargarHorarios?: React.ComponentProps<typeof HorarioEntregaPicker>['cargar']
}) {
  const [ops, setOps] = useState<OpcionesEntrega | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [fleteTxt, setFleteTxt] = useState<string>('')
  const [motivo, setMotivo] = useState('')
  const [ajustar, setAjustar] = useState(false)
  const vivo = useRef(true); const pedido = useRef(0)
  // ENTREGA PREFERIDA · se aplica al cargar opciones y, si llega después, mientras el usuario no haya elegido a mano.
  const preferidaRef = useRef<string | null>(preferida); preferidaRef.current = preferida
  const tocado = useRef(false)
  useEffect(() => { vivo.current = true; return () => { vivo.current = false } }, [])

  // Opciones del servidor: se piden al cambiar el importe de productos o el CP (con una pequeña espera).
  useEffect(() => {
    const n = ++pedido.current
    const t = setTimeout(async () => {
      setCargando(true)
      const r = await cargar('staff', subtotal, cp)
      if (!vivo.current || n !== pedido.current) return
      setCargando(false)
      if (!r.ok) { setError(r.error); setOps(null); onChange(null, null); return }
      setError(null); setOps(r.data)
      // La elección vigente sigue si existe; si no, la sugerida del servidor.
      const actual = opcionDe(r.data, value?.opcion)
      const pref = opcionDe(r.data, preferidaRef.current)
      const prefOk = pref && pref.permitido && pref.disponible ? pref.id : null
      const id = actual && actual.permitido && actual.disponible ? actual.id : prefOk ?? r.data.sugerida ?? r.data.opciones.find((o) => o.permitido && o.disponible)?.id ?? null
      if (!id) { onChange(null, r.data); return }
      const o = opcionDe(r.data, id)!
      if (value?.opcion === id && value.flete != null && value.flete !== o.flete) onChange({ opcion: id, flete: value.flete, motivo: value.motivo, ...hor(value) }, r.data)   // ajuste conservado
      else if (value?.opcion === id) onChange({ opcion: id, ...(value.motivo ? { motivo: value.motivo } : {}), ...hor(value) }, r.data)   // ENT-H · el horario (y ENT-P · el motivo de cortesía) se conservan
      else { onChange({ opcion: id }, r.data); setAjustar(false); setFleteTxt(''); setMotivo('') }
    }, 250)
    return () => clearTimeout(t)
  }, [subtotal, cp])   // eslint-disable-line react-hooks/exhaustive-deps

  const sel = opcionDe(ops, value?.opcion)
  const hoy = ops?.corte.hoy ?? null
  // PAQ-SIMPLE (23 nov 2026) · DHL: la fecha sale de su cotización en vivo (la llegada más tardía de los servicios
  // permitidos); si falla, el rango de la regla. El precio es SIEMPRE el de la regla (sin recargo por servicio).
  const opDhl = ops?.opciones.find((o) => o.tipo === 'foraneo' && o.paqueteria === 'dhl' && o.permitido && o.disponible) ?? null
  const promesaDhl = usePromesaDhl({ activa: !!opDhl && piezas > 0, cp, piezas, destino, cargar: cargarServicios,
    corrimientoDias: opDhl && value?.salida_programada ? diasEntre(opDhl.salida, value.salida_programada) : 0 })
  const esDhl = sel?.tipo === 'foraneo' && sel.paqueteria === 'dhl'
  const servicioQuiere = esDhl ? promesaDhl.servicio : null
  // La promesa de DHL viaja con la elección (la base fija la misma fecha); con otra opción, nada.
  useEffect(() => {
    if (!value || !sel) return
    if ((value.servicio?.cotizacion_id ?? null) === (servicioQuiere?.cotizacion_id ?? null)) return
    const { servicio: _s, ...resto } = value; void _s
    onChange({ ...resto, ...(servicioQuiere ? { servicio: servicioQuiere } : {}) }, ops)
  }, [servicioQuiere?.cotizacion_id, value?.opcion, value?.servicio?.cotizacion_id])   // eslint-disable-line react-hooks/exhaustive-deps
  /** Línea de llegada de una opción foránea: la fecha de DHL cotizada o el rango de la regla. */
  const llegadaForanea = (o: OpcionEntrega) => o.paqueteria === 'dhl' && promesaDhl.llega_fecha ? textoLlegada(promesaDhl.llega_fecha, promesaDhl.llega_fecha, hoy)
    : o.paqueteria === 'dhl' && promesaDhl.estado === 'cargando' ? 'Consultando la fecha con DHL…'
    : textoLlegada(o.llega_desde, o.llega_hasta, hoy)
  useEffect(() => {
    if (!preferida || tocado.current || !ops || value?.opcion === preferida) return
    const o = opcionDe(ops, preferida)
    if (o && o.permitido && o.disponible) { setAjustar(false); setFleteTxt(''); setMotivo(''); onChange({ opcion: preferida }, ops) }
  }, [preferida, ops])   // eslint-disable-line react-hooks/exhaustive-deps
  const elegir = (id: string) => { const o = opcionDe(ops, id); if (!o || !o.permitido || !o.disponible) return; tocado.current = true; setAjustar(false); setFleteTxt(''); setMotivo(''); onChange({ opcion: id }, ops) }
  const aplicarAjuste = (txt: string, mot: string) => {
    if (!sel) return
    const n = Number(txt)
    const conMotivo = localBajoMinimo(ops, sel) && mot.trim() ? { motivo: mot.trim() } : {}   // ENT-P · la cortesía conserva su motivo
    if (txt.trim() === '' || !Number.isFinite(n) || n < 0) { onChange({ opcion: sel.id, ...conMotivo, ...hor(value) }, ops); return }
    if (Math.round(n * 100) === Math.round(sel.flete * 100)) { onChange({ opcion: sel.id, ...conMotivo, ...hor(value) }, ops); return }
    onChange({ opcion: sel.id, flete: Math.round(n * 100) / 100, motivo: mot.trim(), ...hor(value) }, ops)
  }
  // ENT-H · el horario viaja junto con la opción (solo entrega local por chofer); cambiar de opción lo suelta.
  const elegirHorario = (h: HorarioElegido | null) => { if (!sel) return; const { horario: _h, ...resto } = value ?? { opcion: sel.id }; void _h; onChange({ ...resto, opcion: sel.id, ...(h ? { horario: h } : {}) }, ops) }
  const necesitaHorario = requiereHorario(sel)
  const ajusteIncompleto = value != null && value.flete != null && sel != null && value.flete !== sel.flete && !(value.motivo && value.motivo.trim().length >= 3)
  // ENT-P · misma regla que el portal: chofer local gratis desde el mínimo. Abajo del mínimo el vendedor puede darlo como
  // cortesía, pero con motivo (queda en el pedido; el servidor lo exige igual).
  const bajoMinimo = localBajoMinimo(ops, sel)
  const faltaMinimo = sel ? faltantePara(ops!, sel) : null
  const motivoBajoMinimo = (txt: string) => { if (!sel) return; setMotivo(txt); onChange({ ...(value ?? { opcion: sel.id }), opcion: sel.id, motivo: txt.trim() || undefined }, ops) }

  if (error) {
    return <div role="alert" className="ms" style={{ color: 'var(--danger)' }} data-testid="entrega-error">No se pudieron cargar las opciones de entrega: {error}</div>
  }
  if (!ops) return <div className="ms" style={{ color: 'var(--ink-3)' }} data-testid="entrega-cargando">{cargando ? 'Calculando entrega…' : 'Sin opciones de entrega.'}</div>

  return (
    <div data-testid="selector-entrega">
      <div style={{ display: 'grid', gap: 8 }}>
        {ops.opciones.filter((o) => !(o.tipo === 'foraneo' && !o.disponible)).map((o) => {   // PAQ-SIMPLE · paquetería apagada (T1, Estafeta sin activar): no se ofrece
          const on = value?.opcion === o.id
          const puede = o.permitido && o.disponible
          const fueraZona = o.tipo === 'local' && ops.cp != null && !ops.local
          return (
            <label key={o.id} className="addr-opt" data-testid={`entrega-${o.id}`} aria-disabled={!puede}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 11px', border: '1px solid ' + (on ? 'var(--green-deep)' : 'var(--line)'), borderRadius: 11, background: on ? 'var(--ok-bg, #EAF4EC)' : '#fff', cursor: puede ? 'pointer' : 'not-allowed', opacity: puede ? 1 : 0.55 }}
              onClick={() => elegir(o.id)}>
              <input type="radio" name="entrega-staff" checked={on} disabled={!puede} onChange={() => elegir(o.id)} />
              <span style={{ flex: 1 }}>
                <b style={{ display: 'block', fontSize: 13 }}>{o.tipo === 'foraneo' && o.paqueteria ? NOMBRE_PAQUETERIA[o.paqueteria] ?? o.texto : o.texto} <span className="mono" style={{ fontWeight: 600, color: o.flete ? 'var(--ink-2)' : 'var(--green-deep)', marginLeft: 6 }}>{fleteTexto(o.flete, money)}</span></b>
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  {puede ? (requiereHorario(o) ? (on && value?.horario ? promesaDe({ ...o, horario: { ...value.horario, fin: '' } }, hoy) : 'Se agenda en un horario de media hora') : o.tipo === 'foraneo' ? llegadaForanea(o) : promesaDe(o, hoy)) : !o.disponible ? 'Pendiente de integrar' : MOTIVO_ENTREGA[o.motivo ?? ''] ?? 'No aplica'}
                  {fueraZona && puede ? ' · el CP no es de Culiacán: confirma que el chofer sí llega' : ''}
                </span>
                {puede && !on && (() => {
                  // ENT-P · la misma nota de envío gratis que ve el doctor, en voz del vendedor (para ofrecer completar)
                  const f = faltantePara(ops, o)
                  if (!f || f.faltante <= 0 || (o.tipo !== 'local' && o.tipo !== 'foraneo')) return null
                  return <span style={{ display: 'block', fontSize: 11.5, color: 'var(--warn)', marginTop: 2 }} data-testid={`entrega-faltante-${o.id}`}>
                    {o.tipo === 'local' ? `Gratis desde ${money(f.minimo)} · abajo del mínimo solo como cortesía con motivo` : `Gratis desde ${money(f.minimo)} · al cliente le faltan ${money(f.faltante)}`}
                  </span>
                })()}
              </span>
            </label>
          )
        })}
      </div>
      {!bajoMinimo && <AvisoEnvioGratisVista aviso={avisoEnvioGratis(ops, money, 'staff')} testId="entrega-aviso-envio" />}
      {sel && bajoMinimo && faltaMinimo && (
        <div style={{ marginTop: 10, padding: 10, border: '1px solid ' + ((value?.motivo ?? '').trim().length >= 3 ? 'var(--line)' : 'var(--warn)'), borderRadius: 10, background: 'var(--surface-2, #fafafa)', display: 'grid', gap: 6 }} data-testid="entrega-bajo-minimo">
          <div style={{ fontSize: 12.5 }}>
            <b>Al cliente le faltan {money(faltaMinimo.faltante)} para la entrega gratis con chofer</b> (desde {money(faltaMinimo.minimo)}). Abajo del mínimo es cortesía: escribe el motivo, queda en el pedido.
          </div>
          <label style={{ fontSize: 12.5, display: 'grid', gap: 4 }}>Motivo de la cortesía
            <input type="text" maxLength={200} value={motivo} placeholder="p. ej. cliente frecuente, entrega de paso" onChange={(e) => motivoBajoMinimo(e.target.value)} style={{ width: '100%' }} data-testid="entrega-motivo-minimo" />
          </label>
        </div>
      )}
      {sel && esDhl && promesaDhl.aviso && <div className="ms" style={{ marginTop: 8, color: 'var(--ink-3)' }} data-testid="entrega-dhl-regla">{promesaDhl.aviso}</div>}
      {sel && necesitaHorario && (
        <div style={{ marginTop: 10, padding: 10, border: '1px solid ' + (value?.horario ? 'var(--line)' : 'var(--warn)'), borderRadius: 10, background: 'var(--surface-2, #fafafa)' }} data-testid="entrega-horario">
          <div className="eyebrow" style={{ margin: '0 0 8px' }}>Horario de entrega {!value?.horario && <span style={{ fontWeight: 400, color: 'var(--warn)' }}>· elige uno para continuar</span>}</div>
          <HorarioEntregaPicker value={value?.horario ?? null} onChange={elegirHorario} cargar={cargarHorarios} compacto desde={value?.salida_programada ?? null} />
        </div>
      )}
      {sel && sel.tipo !== 'mostrador' && (
        <div style={{ marginTop: 10, padding: '8px 10px', border: '1px solid ' + (value?.salida_programada ? 'var(--green-deep)' : 'var(--line)'), borderRadius: 10, fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }} data-testid="entrega-programar">
          <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <input type="checkbox" checked={!!value?.salida_programada} data-testid="entrega-programar-activar"
              onChange={(e) => { const { salida_programada: _p, horario: _h, ...resto } = value ?? { opcion: sel.id }; void _p; void _h; onChange(e.target.checked ? { ...resto, opcion: sel.id, salida_programada: sumarDias(sel.salida, 7) } : { ...resto, opcion: sel.id }, ops) }} />
            Agendar la salida para otra fecha
          </label>
          {value?.salida_programada && (
            <>
              <input type="date" value={value.salida_programada} min={sel.salida} max={sumarDias(ops.corte.hoy, 90)} data-testid="entrega-programar-fecha"
                onChange={(e) => { if (!e.target.value) return; const { horario: _h, ...resto } = value; void _h; onChange({ ...resto, opcion: sel.id, salida_programada: e.target.value }, ops) }} />
              <span style={{ color: 'var(--ink-3)' }}>Sale el {fechaCorta(value.salida_programada)} · Almacén lo prepara un día antes. Si ese día no hay salida, el sistema te dice la siguiente.</span>
            </>
          )}
        </div>
      )}
      {sel && (
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12.5 }}>
          <span style={{ color: 'var(--ink-3)' }} data-testid="entrega-corte">
            {sel.tipo === 'recoge' ? `${ops.recoge.lugar} · ${ops.recoge.horario}` : ops.corte.antes_de_corte ? `Antes de las ${ops.corte.hora} sale hoy.` : `Después de las ${ops.corte.hora}: sale el siguiente día hábil.`}
          </span>
          {sel.tipo !== 'mostrador' && !ajustar && (
            <button type="button" className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => { setAjustar(true); setFleteTxt(String(value?.flete ?? sel.flete)); setMotivo(value?.motivo ?? '') }} data-testid="entrega-ajustar">
              {value?.flete != null && value.flete !== sel.flete ? `Flete ajustado: ${money(value.flete)}` : 'Cambiar flete'}
            </button>
          )}
        </div>
      )}
      {sel && ajustar && (
        <div style={{ marginTop: 8, padding: 10, border: '1px solid var(--line)', borderRadius: 10, background: 'var(--surface-2, #fafafa)', display: 'grid', gap: 8 }} data-testid="entrega-ajuste">
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12.5 }}>Flete a cobrar
              <input type="number" min={0} step="0.01" value={fleteTxt} onChange={(e) => { setFleteTxt(e.target.value); aplicarAjuste(e.target.value, motivo) }} style={{ marginLeft: 8, width: 110 }} data-testid="entrega-flete" />
            </label>
            <span className="ms" style={{ color: 'var(--ink-3)' }}>La regla propone {fleteTexto(sel.flete, money)}.</span>
          </div>
          {value?.flete != null && value.flete !== sel.flete && (
            <label style={{ fontSize: 12.5 }}>Motivo del cambio
              <input type="text" maxLength={200} value={motivo} placeholder="p. ej. cortesía por volumen" onChange={(e) => { setMotivo(e.target.value); aplicarAjuste(fleteTxt, e.target.value) }} style={{ marginLeft: 8, width: 'min(100%, 320px)' }} data-testid="entrega-motivo" />
            </label>
          )}
          {ajusteIncompleto && <div className="ms" style={{ color: 'var(--warn)' }} data-testid="entrega-motivo-falta">Para cambiar el flete escribe el motivo (queda registrado en el pedido).</div>}
        </div>
      )}
    </div>
  )
}

/** ¿La elección está completa para mandarla al servidor? (un flete distinto al de la regla exige motivo) */
export function eleccionCompleta(value: EleccionEntregaServidor | null, ops: OpcionesEntrega | null): boolean {
  if (!value || !ops) return false
  const o = opcionDe(ops, value.opcion)
  if (!o || !o.permitido || !o.disponible) return false
  if (value.flete != null && value.flete !== o.flete && !(value.motivo && value.motivo.trim().length >= 3)) return false
  if (requiereHorario(o) && !(value.horario && value.horario.fecha && value.horario.inicio)) return false   // ENT-H · la entrega local exige horario
  if (localBajoMinimo(ops, o) && !(value.motivo && value.motivo.trim().length >= 3)) return false   // ENT-P · cortesía abajo del mínimo: con motivo
  return true
}
