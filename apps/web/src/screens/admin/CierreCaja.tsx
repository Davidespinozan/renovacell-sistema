// CIERRE DE CAJA (arqueo). W2 · el efectivo ESPERADO lo calcula el SERVIDOR desde el
// libro de dinero: el cajero NO lo teclea ni el cliente lo deriva, así un arqueo no puede
// cuadrarse cambiando el esperado. Aquí solo se capturan el FONDO y lo CONTADO.
//
// D-W2-CASH-CUTOFF · cortes por TURNO reales: un corte cerrado establece un límite
// económico y el siguiente arquea SOLO el efectivo posterior. El tramo lo determina el
// servidor (`tramo_corte_caja`) y esta pantalla únicamente lo MUESTRA para que el cajero
// entienda qué está contando. Un corte no se borra: se ANULA con motivo, y al anularlo su
// tramo vuelve a quedar por arquear.
import React, { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Wallet, AlertTriangle, CheckCircle2, Printer, Trash2 } from 'lucide-react'
import { money, fmtDate } from '../../lib/format'
import { montoEnLetras } from '../../lib/enLetras'
import { PageHead } from '../../app/PageHead'
import { ExportButton } from '../../app/ExportButton'
import { useAllOrders } from '../../data/hooks/useOrders'
import { useCierres, useRefunds } from '../../data/hooks/useFinanzas'
import { useRole } from '../../auth/RoleContext'
import { efectivoEsperado, localDay } from '../../data/ops/finanzas'
import { tramoCorteCaja, type TramoCorte } from '../../data/ops/money'
import { vigentes, anulados, type Cierre } from '../../data/store/cierresStore'
import { hasSupabase, currentUserId } from '../../lib/supabase'
import { useOpId } from '../../data/hooks/useOpId'
import { AMBIGUO_MSG, newOpId as newOpIdLocal } from '../../data/ops/w1Command'

// Imprime SOLO el ticket: marca el <body>, imprime, y limpia la clase en `afterprint`
// (nunca por timer — quitarla antes reintroduce la app y salen hojas en blanco).
function imprimirCorte() {
  document.body.classList.add('printing-corte')
  const cleanup = () => { document.body.classList.remove('printing-corte'); window.removeEventListener('afterprint', cleanup) }
  window.addEventListener('afterprint', cleanup)
  window.print()
}

// Plantilla del ticket (se usa en el preview en pantalla y en el portal de impresión).
function CorteTicketView({ c }: { c: Cierre }) {
  const cuadra = Math.abs(Math.round(c.diferencia * 100)) === 0
  return (
    <div className="corte-ticket">
      <div className="ct-head">
        <div className="ct-brand">RENOVACELL</div>
        <div className="ct-sub">Comprobante interno de caja</div>
      </div>
      <div className="ct-title">Corte de caja</div>
      <div className="ct-row"><span className="k">Alcance</span><span className="v">{c.alcance}</span></div>
      <div className="ct-row"><span className="k">Fecha</span><span className="v">{fmtDate(c.fecha)}</span></div>
      <div className="ct-row"><span className="k">Realizó</span><span className="v">{c.usuario}</span></div>
      <div className="ct-sep" />
      {c.corte_desde && (
        <div className="ct-row"><span className="k">Tramo arqueado</span><span className="v" style={{ fontSize: 10 }}>
          {new Date(c.corte_desde).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
          {' → '}
          {c.corte_hasta ? new Date(c.corte_hasta).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}
        </span></div>
      )}
      <div className="ct-row"><span className="k">Efectivo del tramo</span><span className="v">{money(c.esperado)}</span></div>
      {c.fondo > 0 && <div className="ct-row"><span className="k">Fondo inicial</span><span className="v">{money(c.fondo)}</span></div>}
      <div className="ct-row"><span className="k">Esperado en cajón</span><span className="v">{money(c.esperado + c.fondo)}</span></div>
      <div className="ct-row"><span className="k">Efectivo contado</span><span className="v">{money(c.contado)}</span></div>
      <div className={'ct-dif ' + (cuadra ? 'ok' : 'bad')}>
        <span>{cuadra ? 'La caja cuadra' : c.diferencia > 0 ? 'Sobrante' : 'Faltante'}</span>
        <span>{cuadra ? money(0) : money(Math.abs(c.diferencia))}</span>
      </div>
      <div className="ct-letra">Efectivo contado, son: {montoEnLetras(c.contado)}</div>
      {c.motivo && <div className="ct-row" style={{ marginTop: 6 }}><span className="k">Motivo</span><span className="v" style={{ maxWidth: '60%', textAlign: 'right', fontWeight: 500 }}>{c.motivo}</span></div>}
      <div className="ct-foot">No es un comprobante fiscal (CFDI) · {fmtDate(c.created_at)}</div>
    </div>
  )
}

// Copia oculta montada en <body> que solo se ve al imprimir.
function CorteTicketPrint({ c }: { c: Cierre }) {
  return createPortal(<div className="corte-print-root"><CorteTicketView c={c} /></div>, document.body)
}

export function CierreCaja() {
  const { data: orders } = useAllOrders()
  const { data: cierres, registrarCierre, anularCierre } = useCierres()
  const { data: refunds } = useRefunds()
  const { user } = useRole()
  const { opId, renew } = useOpId()

  const today = localDay(new Date()) // día LOCAL del negocio (no UTC), para que el corte no pierda ventas
  // Alcance del corte, tal como lo entiende el servidor: todo el día o solo un cajero.
  // Los eventos quedan fuera mientras el inventario en custodia siga deshabilitado.
  const [scope, setScope] = useState<'dia' | 'mia'>('dia')
  const esMia = scope === 'mia'
  const alcanceDb: 'dia' | 'cajero' = esMia ? 'cajero' : 'dia'
  const cajero = esMia ? currentUserId() : null
  const alcance = esMia ? `Mi caja · ${user?.name ?? 'Cajero'}` : 'Caja del día'

  // TRAMO + ESPERADO: los dice el servidor. El tramo arranca donde terminó el último corte
  // vigente de este alcance (o al inicio del día si es el primero) y llega hasta ahora.
  // Sin backend se estima con la función pura, solo para que la demo muestre el flujo.
  const [tramo, setTramo] = useState<TramoCorte | null>(null)
  const [esperado, setEsperado] = useState(0)
  const [leyendo, setLeyendo] = useState(hasSupabase)
  const [recargar, setRecargar] = useState(0)
  React.useEffect(() => {
    let vivo = true
    if (!hasSupabase) {
      setEsperado(efectivoEsperado(orders, { day: today, seller: esMia ? (user?.email ?? '') : undefined }, refunds))
      setTramo(null); setLeyendo(false); return
    }
    setLeyendo(true)
    void tramoCorteCaja(today, alcanceDb, cajero).then((t) => {
      if (!vivo) return
      setTramo(t); setEsperado(t?.esperado ?? 0); setLeyendo(false)
    })
    return () => { vivo = false }
  }, [today, alcanceDb, cajero, orders, refunds, esMia, user?.email, recargar])

  // Cortes VIGENTES de este alcance, para mostrar de dónde viene el límite del tramo.
  const previos = useMemo(
    () => vigentes(cierres).filter((c) => c.alcance === alcanceDb && (c.cajero ?? null) === cajero),
    [cierres, alcanceDb, cajero],
  )
  const yaArqueado = previos.reduce((s, c) => s + c.esperado, 0)
  const hora = (iso?: string | null): string => (iso ? new Date(iso).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—')

  // Fondo de caja inicial (el efectivo de cambio con el que abre el cajón). El cajón
  // físico trae fondo + efectivo del libro, así que el esperado a contar es la suma.
  const [fondo, setFondo] = useState('')
  const fondoN = Math.max(0, Number(fondo) || 0)
  const [contado, setContado] = useState('')
  const contadoN = Math.max(0, Number(contado) || 0)
  const esperadoEnCajon = esperado + fondoN
  const diferencia = contadoN - esperadoEnCajon
  // Tolerancia de centavos: un descuadre de sub-centavo por redondeo NO es faltante.
  const cuadra = Math.abs(Math.round(diferencia * 100)) === 0
  const [motivo, setMotivo] = useState('')
  const [done, setDone] = useState(false)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [ticket, setTicket] = useState<Cierre | null>(null) // último corte, para el ticket imprimible
  const sinEfecto = anulados(cierres)
  // Solo se puede anular la COLA de cada cadena: el corte al que nadie continúa.
  const esUltimo = (c: Cierre): boolean => !cierres.some((x) => x.prev_closing_id === c.id)

  const needsMotivo = contado !== '' && !cuadra
  const valid = contado !== '' && (!needsMotivo || motivo.trim() !== '') && !leyendo

  const cerrar = async () => {
    if (!valid || busy) return
    setBusy(true); setErr('')
    const r = await registrarCierre(opId, {
      fecha: today, alcance: alcanceDb, fondo: fondoN, contado: contadoN,
      motivo: motivo.trim() || null, usuario: user?.name ?? 'Cajero', cajero, esperadoDemo: esperado,
    })
    setBusy(false)
    if (!r.ok) { setErr(r.ambiguous ? AMBIGUO_MSG : (r.error ?? 'No se pudo registrar el cierre.')); return }
    renew()
    setRecargar((n) => n + 1)   // el tramo se movió: vuelve a preguntarle al servidor
    if (r.cierre) setTicket(r.cierre)
    setDone(true); setContado(''); setMotivo('') // el fondo se conserva (mismo cajón)
    window.setTimeout(() => setDone(false), 2600)
  }

  const anular = async (c: Cierre) => {
    const m = window.prompt(`Motivo para anular el corte del ${fmtDate(c.fecha)} (queda registrado; el corte NO se borra).`)
    if (m == null) return
    if (!m.trim()) { window.alert('La anulación necesita un motivo.'); return }
    const r = await anularCierre(newOpIdLocal(), c.id, m, user?.name)
    if (!r.ok) { window.alert(r.ambiguous ? AMBIGUO_MSG : (r.error ?? 'No se pudo anular el corte.')); return }
    setRecargar((n) => n + 1)   // el tramo del corte anulado vuelve a estar por arquear
  }

  // Reimprimir un corte del historial: primero se monta su ticket, luego se imprime
  // (doble rAF asegura que el portal ya pintó antes de abrir el diálogo).
  const printCierre = (c: Cierre) => {
    setTicket(c)
    requestAnimationFrame(() => requestAnimationFrame(() => imprimirCorte()))
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
          <select style={{ ...sel, width: '100%', marginTop: 6 }} value={scope} onChange={(e) => setScope(e.target.value as 'dia' | 'mia')}>
            <option value="dia">Caja del día · todos ({fmtDate(today)})</option>
            {user?.name && <option value="mia">Mi caja del día · {user.name}</option>}
          </select>

          <div className="tket-total" style={{ marginTop: 16 }}>
            <span>Efectivo por arquear {leyendo ? '' : '(servidor)'}</span>
            <b className="mono">{leyendo ? 'Calculando…' : money(esperado)}</b>
          </div>

          {tramo && (
            <div className="sysnote" style={{ marginTop: 12 }}>
              <span style={{ flex: 1, fontSize: 12.5 }}>
                {tramo.primer_corte
                  ? <>Primer corte de este alcance: cuenta el efectivo desde el <b>inicio del día</b> ({hora(tramo.desde)}) hasta ahora.</>
                  : tramo.reabre_anulado
                    ? <>El corte anterior fue <b>anulado</b>: este arqueo vuelve a cubrir su tramo, desde <b>{hora(tramo.desde)}</b>.</>
                    : <>Cuenta <b>solo</b> el efectivo posterior al último corte ({hora(tramo.desde)} → ahora). Lo ya arqueado no se vuelve a contar.</>}
                {previos.length > 0 && <> Cortes previos de este alcance: {previos.length} · {money(yaArqueado)} ya arqueados.</>}
              </span>
            </div>
          )}

          <label style={lbl}>Fondo inicial (efectivo de cambio)</label>
          <input type="number" min={0} style={fld} value={fondo} onChange={(e) => setFondo(e.target.value)} placeholder="0" />

          <div className="tket-total" style={{ marginTop: 14, fontWeight: 700 }}>
            <span>Esperado en el cajón</span><b className="mono">{money(esperadoEnCajon)}</b>
          </div>

          <label style={lbl}>Efectivo contado</label>
          <input type="number" min={0} style={fld} value={contado} onChange={(e) => setContado(e.target.value)} placeholder="0" />

          {contado !== '' && (
            <div className="sysnote" style={{ marginTop: 14, ...(cuadra
              ? { background: 'var(--ok-bg)', borderColor: '#C9E4CF', color: 'var(--green-deep)' }
              : { background: 'var(--danger-bg)', borderColor: '#ECCAC6', color: 'var(--danger)' }) }}>
              {cuadra ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
              <span>{cuadra ? 'Cuadra.' : `${diferencia > 0 ? 'Sobrante' : 'Faltante'} de ${money(Math.abs(diferencia))}.`}</span>
            </div>
          )}

          {needsMotivo && (
            <>
              <label style={lbl}>Motivo de la diferencia</label>
              <input style={fld} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="p. ej. cambio mal dado, propina, error de captura" />
            </>
          )}

          <button className="btn" type="button" style={{ width: '100%', marginTop: 18, opacity: valid && !busy ? 1 : 0.5, cursor: valid && !busy ? 'pointer' : 'not-allowed' }} disabled={!valid || busy} onClick={cerrar}>
            {busy ? 'Registrando…' : 'Registrar cierre'}
          </button>
          {err && <div className="sysnote" style={{ marginTop: 12, background: 'var(--danger-bg)', borderColor: '#ECCAC6', color: 'var(--danger)' }}><span>{err}</span></div>}
          {done && <div className="sysnote" style={{ marginTop: 12, background: 'var(--ok-bg)', borderColor: '#C9E4CF', color: 'var(--green-deep)' }}><span>Cierre registrado.</span></div>}
        </div>

        {/* Historial */}
        <div className="card" style={{ padding: 0 }}>
          <div style={{ padding: '18px 18px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="eyebrow" style={{ margin: 0 }}>Cierres recientes</div>
            <ExportButton name="cierres-de-caja" rows={cierres} style={{ marginLeft: 'auto' }} columns={[
              { key: 'fecha', label: 'Fecha', format: (v) => fmtDate(v as string) },
              { key: 'alcance', label: 'Alcance' },
              { key: 'esperado', label: 'Ventas efectivo', format: (v) => money(v as number) },
              { key: 'fondo', label: 'Fondo', format: (v) => money(v as number) },
              { key: 'contado', label: 'Contado', format: (v) => money(v as number) },
              { key: 'diferencia', label: 'Diferencia', format: (v) => money(v as number) },
              { key: 'motivo', label: 'Motivo' },
              { key: 'usuario', label: 'Usuario' },
            ]} />
          </div>
          <div style={{ padding: '0 14px 8px' }}>
            <table className="tbl-cards">
              <thead><tr><th>Fecha</th><th>Alcance</th><th>Esperado</th><th>Contado</th><th>Diferencia</th><th></th></tr></thead>
              <tbody>
                {cierres.map((c) => {
                  const muerto = sinEfecto.has(c.id)
                  const esAnulacion = !!c.voids_closing_id
                  return (
                  <tr key={c.id} style={muerto ? { opacity: 0.55 } : undefined}>
                    <td data-label="Fecha" style={{ whiteSpace: 'nowrap' }}>{fmtDate(c.fecha)}</td>
                    <td data-label="Alcance">
                      {c.alcance === 'cajero' ? 'Por cajero' : c.alcance === 'dia' ? 'Caja del día' : c.alcance}
                      {esAnulacion && <span className="pill p-neu" style={{ marginLeft: 6, fontSize: 10 }}>anulación</span>}
                      {muerto && !esAnulacion && <span className="pill p-dang" style={{ marginLeft: 6, fontSize: 10 }}>anulado</span>}
                      {(c.void_reason || c.motivo) && <div style={{ fontSize: 11, color: 'var(--ink-3)' }}>{c.void_reason ?? c.motivo}</div>}
                      {c.corte_desde && <div style={{ fontSize: 10.5, color: 'var(--ink-3)' }}>{hora(c.corte_desde)} → {hora(c.corte_hasta)}</div>}
                    </td>
                    <td data-label="Esperado" className="mono">{money(c.esperado)}</td>
                    <td data-label="Contado" className="mono">{money(c.contado)}</td>
                    <td data-label="Diferencia"><span className={'pill ' + (c.diferencia === 0 ? 'p-ok' : 'p-dang')}>{c.diferencia === 0 ? 'Cuadra' : (c.diferencia > 0 ? '+' : '') + money(c.diferencia)}</span></td>
                    <td data-label="" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button className="btn ghost sm" type="button" title="Imprimir ticket" onClick={() => printCierre(c)}><Printer size={14} /></button>
                      {!muerto && !esAnulacion && esUltimo(c) && (
                        <button className="btn ghost sm" type="button" title="Anular este corte (es el más reciente de su alcance)" style={{ color: 'var(--danger)' }}
                          onClick={() => void anular(c)}><Trash2 size={14} /></button>
                      )}
                    </td>
                  </tr>
                )})}
                {cierres.length === 0 && <tr><td colSpan={6} style={{ color: 'var(--ink-3)' }}>Aún no hay cierres.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {ticket && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <div className="eyebrow" style={{ margin: 0 }}>Ticket del corte</div>
            <button className="btn sm" type="button" style={{ marginLeft: 'auto' }} onClick={imprimirCorte}><Printer size={14} /> Imprimir</button>
          </div>
          <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 6, background: 'var(--hueso)' }}>
            <CorteTicketView c={ticket} />
          </div>
        </div>
      )}
      {ticket && <CorteTicketPrint c={ticket} />}
    </div>
  )
}
