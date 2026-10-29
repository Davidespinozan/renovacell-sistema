// Tarjeta de pedido reutilizable (Mis pedidos e Historial).
import React from 'react'
import { useRastreo } from '../../data/hooks/useRastreo'
import { RastreoEnvio } from '../../app/RastreoEnvio'
import { Icon } from '../../app/icons'
import { money, fmtDate } from '../../lib/format'
import { statusView } from './orderStatus'
import { esRecoge } from '../../data/ops/seguimiento'
import { Trk } from './Trk'
import { isCancelable, type OrderWithItems } from '../../data/hooks/useOrders'
import { trackingUrl } from '../../data/shipping/provider'
import { creditoAbierto, creditoVencido, etiquetaLiberacion } from '../../data/ops/moneyView'
import type { OrderMoney } from '../../data/ops/money'
import type { ProductSafe } from '../../data/types'
import { promesaDe, type EntregaPedido } from '../../data/ops/entrega'

export function OrderCard({
  order,
  productsById,
  showTracking = true,
  onCancel,
  onPay,
  onReorder,
  dinero = null,
  pagoReportado = false,
}: {
  order: OrderWithItems
  productsById: Record<string, ProductSafe | undefined>
  showTracking?: boolean
  onCancel?: () => void
  onPay?: () => void
  onReorder?: () => void
  dinero?: OrderMoney | null
  pagoReportado?: boolean
}) {
  const sv = statusView(order.status, { recoge: esRecoge(order) })
  // Con libro de dinero, "por pagar" es tener SALDO: un pago parcial sigue pendiente.
  const saldo = dinero ? dinero.saldo : (order.payment_status === 'paid' ? 0 : (order.total ?? 0))
  const unpaid = saldo > 0.0001 && order.status !== 'cancelled'
  const pagado = dinero ? dinero.estado_pago === 'paid' : order.payment_status === 'paid'
  const credito = dinero && creditoAbierto(dinero) ? etiquetaLiberacion(dinero) : null

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span className="mono" style={{ fontSize: 14 }}>{order.external_ref}</span>
        <span className={'pill ' + sv.pill}><span className="d" /> {sv.label}</span>
        {pagado && <span className="pill p-ok">Pagado</span>}
        {!pagado && dinero && dinero.cobrado_neto > 0.0001 && <span className="pill p-warn">Pago parcial · falta {money(dinero.saldo)}</span>}
        {credito && <span className={'pill ' + (dinero && creditoVencido(dinero) ? 'p-dang' : 'p-warn')}>{credito.texto}{dinero?.due_date ? ` · vence ${fmtDate(dinero.due_date)}` : ''}</span>}
        {pagoReportado && !pagado && <span className="pill p-neu">Pago en revisión</span>}
        {order.invoice_requested && <span className="pill p-neu">CFDI</span>}
        <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--ink-3)' }}>{fmtDate(order.created_at)}</span>
      </div>

      <div style={{ marginBottom: 8 }}>
        {order.items.map((it) => {
          const p = productsById[it.product_id ?? '']
          return (
            <div key={it.id} className="coitem">
              <span>
                {p?.name ?? 'Producto'} <span style={{ color: 'var(--ink-3)' }}>×{it.qty}</span>
              </span>
              <span className="mono">{money((it.unit_price ?? 0) * it.qty)}</span>
            </div>
          )
        })}
      </div>

      {(() => {
        // ENT-0 · el flete va dentro del total; se desglosa para que el cliente vea productos + envío.
        const envio = Number((order as { shipping_cost?: number | null }).shipping_cost ?? 0)
        return envio > 0 ? (
          <div className="coitem" data-testid="pedido-envio"><span>Envío</span><span className="mono">{money(envio)}</span></div>
        ) : null
      })()}
      <div className="cototal">
        <span>Total</span>
        <b>{money(order.total)}</b>
      </div>

      {unpaid && onPay && (pagoReportado ? (
        // Ya informó su pago: no se le vuelve a ofrecer pagar (el servidor lo rechazaría) mientras Renovacell lo revisa.
        <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 12, background: 'var(--cp-surface-2, #f3f5f2)', border: '1px solid var(--line)', fontSize: 13 }} data-testid="pago-en-revision">
          Recibimos tu comprobante. Lo estamos revisando y te avisamos en cuanto se confirme.
        </div>
      ) : (
        <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 12, background: 'var(--warn-bg)', border: '1px solid #EEDDB6', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, color: 'var(--warn)', fontWeight: 600 }}>Este pedido está pendiente de pago.</span>
          <button className="btn sm" type="button" style={{ marginLeft: 'auto' }} onClick={onPay}>
            <Icon name="receipt" /> Pagar {money(saldo)}
          </button>
        </div>
      ))}

      {order.payment_status === 'paid' && order.payment_ref && (
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 10 }}>
          Pagado{order.payment_method ? ` · ${order.payment_method}` : ''} · ref. <span className="mono">{order.payment_ref}</span>
        </div>
      )}

      {showTracking && order.status !== 'cancelled' && <Trk step={sv.step} />}

      <EntregaLine meta={order.shipping_meta} />
      <ShippingLine meta={order.shipping_meta} />
      <RastreoCliente order={order} />

      {(() => {
        // El doctor solo auto-cancela pedidos NO pagados: un pedido ya pagado que se
        // cancela dejaría el dinero en el limbo (no hay reembolso en autoservicio). Los
        // pagados se cancelan con Dirección, que sí tiene el flujo de devolución.
        // W1 · frontera B: con transferencia reportada (pago en revisión) también decide Dirección.
        // W2 · tampoco se auto-cancela un pedido LIBERADO por crédito: Almacén ya lo puede
        // estar preparando y la decisión es de Dirección (el servidor reimpone esta regla).
        const transferReportada = pagoReportado
          || ((order.shipping_meta as { transfer?: { reported?: boolean } } | null)?.transfer?.reported) === true
        const liberado = dinero?.liberado ?? pagado
        const puedeCancelar = onCancel && isCancelable(order.status) && !liberado && !transferReportada
        const puedeReordenar = onReorder && order.items.length > 0
        if (!puedeCancelar && !puedeReordenar && !liberado) return null
        return (
          <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            {puedeReordenar && (
              <button className="btn ghost sm" type="button" onClick={onReorder}>
                <Icon name="cart" /> Volver a pedir
              </button>
            )}
            {puedeCancelar && (
              <button className="btn ghost sm" type="button" style={{ color: 'var(--danger)', marginLeft: 'auto' }} onClick={onCancel}>Cancelar pedido</button>
            )}
            {onCancel && isCancelable(order.status) && (liberado || transferReportada) && (
              <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--ink-3)' }}>Este pedido ya está en preparación o tiene un pago en revisión: para cancelarlo, contacta a Renovacell.</span>
            )}
          </div>
        )
      })()}
    </div>
  )
}

// PAQ-A · Rastreo de SU paquete para el cliente: estado actual e historial, tal como lo reporta la paquetería.
function RastreoCliente({ order }: { order: OrderWithItems }) {
  const m = (order.shipping_meta ?? {}) as { carrier?: string; tracking?: string; driver?: string }
  const activo = !!m.tracking && !m.driver && (order.status === 'shipped' || order.status === 'delivered')
  const { rastreo, cargando } = useRastreo(activo ? order.id : null, activo)
  if (!activo) return null
  return <RastreoEnvio rastreo={rastreo} cargando={cargando} vista="cliente" />
}

// ENT-0 · La promesa de entrega que se fijó al crear el pedido (tipo, paquetería y fechas): el cliente SIEMPRE la ve.
function EntregaLine({ meta }: { meta: OrderWithItems['shipping_meta'] }) {
  const m = meta && typeof meta === 'object' ? (meta as { entrega?: EntregaPedido | null; channel?: string }) : null
  const e = m?.entrega ?? null
  if (!e) return m?.channel === 'pos' ? <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 10 }} data-testid="pedido-entrega"><b style={{ color: 'var(--ink-2)' }}>Entrega en mostrador</b></div> : null
  return (
    <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 10 }} data-testid="pedido-entrega">
      <b style={{ color: 'var(--ink-2)' }}>{e.texto}</b> · {promesaDe(e)}
    </div>
  )
}

function ShippingLine({ meta }: { meta: OrderWithItems['shipping_meta'] }) {
  if (!meta || typeof meta !== 'object') return null
  const m = meta as { carrier?: string; tracking?: string; driver?: string; method?: string }
  if (m.method === 'recoge') return <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 10 }}>Listo para recoger en sucursal.</div>   // ENT-3
  if (m.driver) {
    // Va pegada a la línea de entrega (EntregaLine ya dice tipo y promesa): solo quién la lleva.
    // "Chofer propio" es jerga interna; el doctor solo necesita el nombre.
    return <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 4 }} data-testid="pedido-te-entrega">Te entrega: <b style={{ color: 'var(--ink-2)' }}>{m.driver}</b></div>
  }
  if (m.carrier) {
    const url = m.tracking ? trackingUrl(m.carrier, m.tracking) : null
    return (
      <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 10 }}>
        Paquetería: {m.carrier}
        {m.tracking && (url
          ? <> · guía <a href={url} target="_blank" rel="noreferrer" className="mono tap-link" style={{ color: 'var(--green-deep)', fontWeight: 600 }}>{m.tracking}</a></>
          : <> · guía {m.tracking}</>)}
      </div>
    )
  }
  return null
}
