// PAY-EXP-01A-3 · DIRECCIÓN/FACTURACIÓN · "Revisión económica": los pedidos cuyo dinero requiere una decisión
// (lectura canónica revision_economica, PAY-EXP-01A-2). UNA tarjeta por pedido con todas sus incidencias; montos y
// estado del caso tal cual los entrega el servidor (sin recalcular). Las acciones son las CANÓNICAS existentes:
// verificar/rechazar la declaración (revisar_pago) y, para reembolsos, el detalle del pedido en Ventas. No hay
// reparaciones, reembolsos automáticos ni mutaciones directas. La autorización la decide el servidor.
import React, { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronUp, Scale, Check, X, ExternalLink } from 'lucide-react'
import { money, fmtDate } from '../../lib/format'
import { useRole } from '../../auth/RoleContext'
import { useRevisionEconomica } from '../../data/hooks/useRevisionEconomica'
import { ETIQUETA_INCIDENCIA, ORIENTACION_INCIDENCIA, type CasoRevision, type ClienteRevisionEconomica } from '../../data/ops/revisionEconomica'
import { revisarDeclaracion as revisarPorDefecto } from '../../data/store/ordersStore'
import { pedirAbrirPedido } from '../../data/store/ventasIntentStore'

type Revisar = typeof revisarPorDefecto
const ESTADO_PEDIDO: Record<string, string> = { cancelled: 'Cancelado', pending_payment: 'Pendiente de pago', paid: 'Pagado', picking: 'En surtido', packed: 'Empacado', shipped: 'Enviado', delivered: 'Entregado', fulfilled: 'Completado', draft: 'Borrador' }

export function RevisionEconomica({ cliente, revisar = revisarPorDefecto }: { cliente?: ClienteRevisionEconomica; revisar?: Revisar }) {
  const { role, setScreen } = useRole()
  const autorizado = role === 'admin'   // Dirección y Facturación (billing → admin en la app); el servidor vuelve a validar
  const rev = useRevisionEconomica(autorizado, cliente)

  if (!autorizado) return <Aviso testid="revision-no-autorizado">Solo Dirección y Facturación pueden consultar la revisión económica.</Aviso>
  return (
    <div className="grid" style={{ gap: 16 }} data-testid="revision-economica">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <Scale size={18} />
        <div className="eyebrow" style={{ margin: 0 }}>Finanzas · Revisión económica</div>
        {rev.estado === 'listo' && <span className={'pill ' + (rev.data.resumen.abiertos ? 'p-warn' : 'p-ok')} style={{ marginLeft: 'auto' }} data-testid="revision-contador">{rev.data.resumen.abiertos} caso(s) abierto(s)</span>}
      </div>
      <div className="sysnote">
        <AlertTriangle size={16} />
        <span>Pedidos cuyo <b>dinero</b> requiere una decisión: declaraciones en pedidos cancelados, dinero recibido sin reembolso autorizado y reembolsos por pagar. Cada pedido es <b>un</b> caso. Aquí no se mueve dinero automáticamente: cada acción usa el flujo autorizado.</span>
      </div>

      {rev.estado === 'cargando' || rev.estado === 'inactivo' ? <Aviso testid="revision-cargando">Cargando revisión económica…</Aviso>
        : rev.estado === 'no_autorizado' ? <Aviso testid="revision-no-autorizado">{rev.mensaje}</Aviso>
        : rev.estado === 'error' ? (
          <div className="sysnote" style={{ background: 'var(--danger-bg)', borderColor: '#ECCAC6', color: 'var(--danger)' }} data-testid="revision-error">
            <span style={{ flex: 1 }}>{rev.mensaje}</span>
            <button type="button" className="btn ghost sm" onClick={() => void rev.recargar()}>Reintentar</button>
          </div>
        ) : rev.data.casos.length === 0 ? <Aviso testid="revision-vacia">Sin casos abiertos. No hay dinero ni declaraciones pendientes de decisión.</Aviso>
        : <>
            {rev.data.casos.map((c) => <Caso key={c.order_id} caso={c} revisar={revisar} recargar={rev.recargar} abrirEnVentas={() => { pedirAbrirPedido(c.order_id, c.folio); setScreen('av_ventas') }} />)}
            <div className="ms" style={{ color: 'var(--ink-3)' }} data-testid="revision-nota-stripe">Anomalías de pago en línea (Stripe): todavía no disponibles en esta vista.</div>
          </>}
    </div>
  )
}

function Aviso({ children, testid }: { children: React.ReactNode; testid: string }) {
  return <div className="card" style={{ textAlign: 'center', color: 'var(--ink-3)' }} data-testid={testid}>{children}</div>
}

function Caso({ caso: c, revisar, recargar, abrirEnVentas }: { caso: CasoRevision; revisar: Revisar; recargar: () => Promise<void>; abrirEnVentas: () => void }) {
  const [abierto, setAbierto] = useState(false)
  const [modo, setModo] = useState<null | 'verificar' | 'rechazar'>(null)
  const [motivo, setMotivo] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null)
  const declAbierta = c.declaraciones.find((d) => d.estado === 'reportado') ?? null
  const conDeclaracion = c.incidencias.includes('declaracion_abierta_en_cancelado') && declAbierta
  const conReembolso = c.incidencias.includes('dinero_sin_reembolso_autorizado') || c.incidencias.includes('reembolso_autorizado_pendiente')
  const cancelado = c.estado_pedido === 'cancelled'

  // La advertencia se basa en el estado ACTUAL: se relee la revisión antes de mostrar la confirmación.
  const prepararVerificacion = async () => { setMsg(null); await recargar(); setModo('verificar') }
  const ejecutar = async (accion: 'verificar' | 'rechazar') => {
    if (!declAbierta || busy) return
    if (accion === 'rechazar' && !motivo.trim()) { setMsg({ ok: false, texto: 'El rechazo necesita un motivo.' }); return }
    setBusy(true); setMsg(null)
    const r = await revisar(declAbierta.claim_id, accion, accion === 'rechazar' ? motivo.trim() : null)
    setBusy(false)
    if (!r.ok) { setMsg({ ok: false, texto: r.error ?? 'No se pudo completar.' }); return }
    setModo(null); setMotivo('')
    setMsg({ ok: true, texto: accion === 'verificar' ? 'Declaración verificada: el dinero quedó registrado.' : 'Declaración rechazada.' })
    await recargar()
  }

  return (
    <div className="card" data-testid="revision-caso" data-order={c.order_id}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <b className="mono">{c.folio ?? c.order_id.slice(0, 8)}</b>
            <span className={'pill ' + (cancelado ? 'p-dang' : 'p-neu')}>{ESTADO_PEDIDO[c.estado_pedido] ?? c.estado_pedido}</span>
            <span style={{ color: 'var(--ink-2)' }}>{c.cliente.nombre ?? 'Cliente sin nombre'}</span>
          </div>
          <div style={{ marginTop: 6, fontWeight: 600 }} data-testid="revision-principal">{ETIQUETA_INCIDENCIA[c.incidencia_principal]}</div>
          {c.incidencias.length > 1 && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }} data-testid="revision-incidencias">
              {c.incidencias.slice(1).map((i) => <span key={i} className="pill p-warn">{ETIQUETA_INCIDENCIA[i]}</span>)}
            </div>
          )}
          <div className="ms" style={{ color: 'var(--ink-3)', marginTop: 4 }}>{ORIENTACION_INCIDENCIA[c.incidencia_principal]}</div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 13 }} data-testid="revision-montos">
          <div>Cobrado neto <b className="mono">{money(c.montos.cobrado_neto)}</b></div>
          {c.montos.sin_reembolso_autorizado > 0 && <div style={{ color: 'var(--danger)' }}>Sin reembolso autorizado <b className="mono">{money(c.montos.sin_reembolso_autorizado)}</b></div>}
          {c.montos.reembolso_pendiente > 0 && <div style={{ color: 'var(--warn)' }}>Reembolso por pagar <b className="mono">{money(c.montos.reembolso_pendiente)}</b></div>}
          <div style={{ color: 'var(--ink-3)' }}>Total del pedido {money(c.montos.total)}</div>
          {c.fecha_relevante && <div style={{ color: 'var(--ink-3)' }}>Último movimiento {fmtDate(c.fecha_relevante)}</div>}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        {conDeclaracion && <>
          <button type="button" className="btn sm" disabled={busy} onClick={() => void prepararVerificacion()} data-testid="revision-verificar"><Check size={14} /> Verificar comprobante…</button>
          <button type="button" className="btn ghost sm" disabled={busy} onClick={() => { setMsg(null); setModo('rechazar') }} data-testid="revision-rechazar"><X size={14} /> Rechazar…</button>
        </>}
        {conReembolso && <button type="button" className="btn ghost sm" onClick={abrirEnVentas} data-testid="revision-ir-ventas"><ExternalLink size={14} /> Abrir pedido en Ventas</button>}
        <button type="button" className="btn ghost sm" style={{ marginLeft: 'auto' }} onClick={() => setAbierto((a) => !a)} aria-expanded={abierto} data-testid="revision-detalle-toggle">
          {abierto ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Evidencia
        </button>
      </div>

      {modo === 'verificar' && declAbierta && (
        <div className="sysnote" style={{ marginTop: 10, background: 'var(--warn-bg)', borderColor: 'var(--warn)', display: 'grid', gap: 8 }} role="alertdialog" aria-label="Confirmar verificación" data-testid="revision-advertencia">
          {cancelado
            ? <span><b>Este pedido está CANCELADO.</b> Verificar el comprobante de {money(declAbierta.monto_declarado)} <b>registrará dinero sobre un pedido cancelado</b>. El pedido seguirá cancelado y el caso quedará por <b>revisar y reembolsar</b> — no se reembolsa automáticamente. Verifica solo si el dinero realmente llegó a la cuenta.</span>
            : <span>Verificar registrará {money(declAbierta.monto_declarado)} en el libro de este pedido.</span>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn sm" disabled={busy} onClick={() => void ejecutar('verificar')} data-testid="revision-confirmar-verificar">{busy ? 'Registrando…' : 'Sí, el dinero llegó: verificar'}</button>
            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => setModo(null)}>Cancelar</button>
          </div>
        </div>
      )}
      {modo === 'rechazar' && declAbierta && (
        <div className="sysnote" style={{ marginTop: 10, display: 'grid', gap: 8 }} data-testid="revision-panel-rechazo">
          <label style={{ display: 'grid', gap: 4, fontSize: 13 }}>Motivo del rechazo (obligatorio)
            <input value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={400} style={{ padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontFamily: 'inherit' }} data-testid="revision-motivo" />
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn sm" disabled={busy} onClick={() => void ejecutar('rechazar')} data-testid="revision-confirmar-rechazo">Rechazar declaración</button>
            <button type="button" className="btn ghost sm" disabled={busy} onClick={() => { setModo(null); setMotivo('') }}>Cancelar</button>
          </div>
        </div>
      )}
      {msg && <div role={msg.ok ? 'status' : 'alert'} style={{ marginTop: 8, fontSize: 13, color: msg.ok ? 'var(--green-deep)' : 'var(--danger)' }} data-testid="revision-mensaje">{msg.texto}</div>}

      {abierto && (
        <div style={{ marginTop: 12, display: 'grid', gap: 10, fontSize: 13 }} data-testid="revision-evidencia">
          {c.cancelacion && <div><b>Cancelación</b> · {fmtDate(c.cancelacion.fecha)}{c.cancelacion.motivo ? ` · ${c.cancelacion.motivo}` : ''}{c.cancelacion.money_signal ? ` · señal: ${c.cancelacion.money_signal}` : ''}</div>}
          <Lista titulo="Declaraciones" vacio="Sin declaraciones." items={c.declaraciones.map((d) => `${fmtDate(d.declarada_at)} · ${d.metodo} · ${money(d.monto_declarado)} · ${d.estado}${d.referencia ? ` · ref. ${d.referencia}` : ''}${d.motivo_rechazo ? ` · rechazo: ${d.motivo_rechazo}` : ''}`)} />
          <Lista titulo="Asientos en el libro" vacio="Sin asientos." items={c.asientos.map((a) => `${a.fecha_valor} · ${a.direccion === 'in' ? 'entrada' : 'salida'} · ${a.metodo} · ${money(a.monto)}${a.reversal_of ? ' · reversa' : ''}`)} />
          <Lista titulo="Reembolsos" vacio="Sin reembolsos autorizados." items={c.reembolsos.map((r) => `${fmtDate(r.autorizado_at)} · ${r.tipo} · ${money(r.monto)} · ${r.pagado ? 'pagado' : 'por pagar'}`)} />
        </div>
      )}
    </div>
  )
}

function Lista({ titulo, items, vacio }: { titulo: string; items: string[]; vacio: string }) {
  return (
    <div>
      <b>{titulo}</b>
      {items.length ? <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{items.map((t, i) => <li key={i}>{t}</li>)}</ul> : <div style={{ color: 'var(--ink-3)' }}>{vacio}</div>}
    </div>
  )
}
