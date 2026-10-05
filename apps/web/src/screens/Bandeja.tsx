// CENTRO DE TAREAS — "Mi bandeja". Pendientes priorizados del rol actual,
// agregados de los MISMOS stores que el resto del sistema (no inventa nada). Cada
// tarjeta enruta al módulo donde se resuelve (apoya la Regla 2: el sistema indica
// el siguiente pendiente). Es la funcionalidad "Muy Alta" pedida por todos.
import React, { useEffect, useMemo, useState } from 'react'
import { Icon, type IconName } from '../app/icons'
import { useRole } from '../auth/RoleContext'
import { getRole, type RoleKey } from '../app/roles'
import { useAllOrders, type OrderWithItems } from '../data/hooks/useOrders'
import { useOrderMoney, usePaymentClaims } from '../data/hooks/useMoney'
import { useShipments } from '../data/hooks/useShipments'
import { useLots } from '../data/hooks/useLots'
import { useDoctors } from '../data/hooks/useDoctors'
import { useProspects } from '../data/hooks/useProspects'
import { useStockReturns } from '../data/hooks/useStockReturns'
import { useCompras } from '../data/hooks/useCompras'
import { useCustodies } from '../data/hooks/useCustody'
import { useRevisionFiscal } from '../data/hooks/useRevisionFiscal'
import { useComunicaciones } from '../data/hooks/useComunicaciones'
import { tieneCfdi } from '../data/ops/cfdi'
import { hasSupabase, currentUserId } from '../lib/supabase'
import { isSurtible, diagnoseShipment } from '../data/ops/seguimiento'
import { daysUntil, severity } from './warehouse/expiry'
import { hoyNegocio } from '../data/periodo'

type Tone = 'warn' | 'dang' | 'neu'
interface Task { id: string; icon: IconName; title: string; detail: string; count: number; tone: Tone; screen: string }

const isEmitida = (o: OrderWithItems) => tieneCfdi(o) // reconoce 'emitida' Y 'timbrada' (fuente única)
const notCancelled = (o: OrderWithItems) => o.status !== 'cancelled'

export function Bandeja() {
  const { role, setScreen, user } = useRole()
  const { data: orders } = useAllOrders()
  const { byOrder } = useOrderMoney()
  const { data: claims } = usePaymentClaims()
  const { data: shipments } = useShipments()
  const { data: lots } = useLots()
  const { data: doctors } = useDoctors()
  const { data: prospects } = useProspects()
  const { data: devoluciones } = useStockReturns()
  const { data: compras } = useCompras()
  const { data: custodias } = useCustodies()

  // W4-03 · Toda cola de esta bandeja se DERIVA del estado del servidor. Ninguna
  // depende de un aviso ni de memoria del navegador: al recargar o abrir la app en
  // otro equipo, lo que requiere acción humana sigue ahí.
  const tasks = useMemo<Task[]>(() => {
    const t: Task[] = []
    const lotesCriticos = lots.filter((l) => l.quantity > 0 && ['expired', 'critical'].includes(severity(daysUntil(l.expiry_date))))
    const porSurtir = orders.filter((o) => isSurtible(o, byOrder[o.id]))
    const porEmpacar = orders.filter((o) => o.status === 'packed')

    if (role === 'warehouse') {
      if (porSurtir.length) t.push({ id: 'surtir', icon: 'layers', title: 'Pedidos por surtir', detail: 'Asigna lotes por FEFO y descuenta inventario.', count: porSurtir.length, tone: 'warn', screen: 'surtido' })
      if (porEmpacar.length) t.push({ id: 'empacar', icon: 'pkg', title: 'Pedidos por empacar', detail: 'Asigna envío (paquetería o chofer).', count: porEmpacar.length, tone: 'warn', screen: 'cola' })
      // Carga ya asignada a un chofer que sigue en el almacén.
      const porDespachar = shipments.filter((sh) => sh.status === 'por_despachar')
      if (porDespachar.length) t.push({ id: 'despachar', icon: 'truck', title: 'Carga por despachar', detail: 'Entrégala al chofer para que salga a ruta.', count: porDespachar.length, tone: 'warn', screen: 'despacho' })
      // Mercancía pedida que todavía no llega completa.
      const porRecibir = compras.filter((c) => c.status === 'pendiente' || c.status === 'parcial')
      if (porRecibir.length) t.push({ id: 'recibir', icon: 'download', title: 'Compras por recibir', detail: 'Registra la entrada cuando llegue la mercancía.', count: porRecibir.length, tone: 'neu', screen: 'compras' })
      // Devolución recibida a la que aún le falta la inspección física.
      const porInspeccionar = devoluciones.filter((d) => d.lines.some((l) => l.inspection == null))
      if (porInspeccionar.length) t.push({ id: 'inspeccionar', icon: 'shield', title: 'Devoluciones por inspeccionar', detail: 'Revisa el producto antes de que Dirección decida su destino.', count: porInspeccionar.length, tone: 'warn', screen: 'devoluciones' })
      if (lotesCriticos.length) t.push({ id: 'caduc', icon: 'clock', title: 'Lotes por caducar', detail: 'Caducados o ≤ 60 días: prioriza su salida.', count: lotesCriticos.length, tone: 'dang', screen: 'caduc' })
    }

    if (role === 'admin') {
      const docsPend = doctors.filter((d) => !d.verified)
      const prospNuevos = prospects.filter((p) => (p.status ?? 'nuevo') === 'nuevo')
      const atorados = orders.filter((o) => ['packed', 'shipped'].includes(o.status ?? '') && diagnoseShipment(o, shipments.find((s) => s.order_id === o.id)).stuck)
      const porEmitir = orders.filter((o) => notCancelled(o) && o.invoice_requested && !isEmitida(o))
      const porCobrar = orders.filter((o) => notCancelled(o) && (byOrder[o.id]?.saldo ?? (o.payment_status === 'paid' ? 0 : o.total ?? 0)) > 0.0001)

      if (docsPend.length) t.push({ id: 'verificar', icon: 'usercheck', title: 'Doctores por verificar', detail: 'Habilita su canal en el Portal.', count: docsPend.length, tone: 'warn', screen: 'av_verif' })
      if (prospNuevos.length) t.push({ id: 'prosp', icon: 'grid', title: 'Prospectos nuevos', detail: 'Contáctalos y muévelos por el pipeline.', count: prospNuevos.length, tone: 'warn', screen: 'av_prosp' })
      // Comprobantes DECLARADOS que esperan revisión: todavía no hay dinero registrado.
      const transferPend = claims.filter((c) => c.status === 'reportado')
      if (transferPend.length) t.push({ id: 'transfer', icon: 'receipt', title: 'Pagos por validar', detail: 'El cliente informó un pago; verifica que cayó y regístralo.', count: transferPend.length, tone: 'warn', screen: 'av_pagos' })
      if (atorados.length) t.push({ id: 'atorados', icon: 'truck', title: 'Envíos atorados', detail: 'Requieren atención en seguimiento.', count: atorados.length, tone: 'dang', screen: 'seguimiento' })
      if (porEmitir.length) t.push({ id: 'cfdi', icon: 'receipt', title: 'CFDI por emitir', detail: 'Pedidos con factura solicitada.', count: porEmitir.length, tone: 'warn', screen: 'av_fin' })
      if (porCobrar.length) t.push({ id: 'cobrar', icon: 'receipt', title: 'Por cobrar', detail: 'Cuentas por cobrar (contra pedido / pendiente).', count: porCobrar.length, tone: 'neu', screen: 'av_fin' })
      if (lotesCriticos.length) t.push({ id: 'caduc', icon: 'clock', title: 'Lotes por caducar', detail: 'Revisa el detalle en el Tablero.', count: lotesCriticos.length, tone: 'warn', screen: 'tablero' })

      // ── Dinero que espera una decisión (estado canónico de `v_order_money`) ──
      const dinero = Object.values(byOrder)
      const reembolsos = dinero.filter((m) => m.reembolso_pendiente > 0.0001)
      if (reembolsos.length) t.push({ id: 'reembolso', icon: 'receipt', title: 'Reembolsos por resolver', detail: 'Pedidos cancelados o devueltos con dinero por regresar al cliente.', count: reembolsos.length, tone: 'dang', screen: 'av_ventas' })
      const vencidos = dinero.filter((m) => m.vencido)
      if (vencidos.length) t.push({ id: 'vencido', icon: 'clock', title: 'Crédito vencido', detail: 'Pedidos a crédito cuya fecha de pago ya pasó.', count: vencidos.length, tone: 'dang', screen: 'av_fin' })
      const sobrepagos = dinero.filter((m) => m.sobrepago)
      if (sobrepagos.length) t.push({ id: 'sobrepago', icon: 'receipt', title: 'Pagos de más', detail: 'Se cobró más que el total del pedido: revisa y regresa la diferencia.', count: sobrepagos.length, tone: 'warn', screen: 'av_ventas' })

      // ── Inventario que espera una decisión de Dirección ──
      const porDisponer = devoluciones.filter((d) => d.lines.some((l) => l.inspection != null && l.disposition == null))
      if (porDisponer.length) t.push({ id: 'disponer', icon: 'shield', title: 'Devoluciones por resolver', detail: 'Ya inspeccionadas: decide si regresan a venta o se dan de baja.', count: porDisponer.length, tone: 'warn', screen: 'av_control_inv' })
      const porPagar = compras.filter((c) => c.kind === 'compra' && !c.paid)
      if (porPagar.length) t.push({ id: 'pagar', icon: 'receipt', title: 'Compras por pagar', detail: 'Pagos a proveedor pendientes de registrar.', count: porPagar.length, tone: 'neu', screen: 'av_finanzas' })
      // Custodia de un evento que ya pasó y nadie cerró: producto fuera del almacén sin liquidar.
      const hoy = hoyNegocio()
      const custodiasVencidas = custodias.filter((c) => c.status === 'abierta' && c.kind === 'evento' && !!c.event_date && c.event_date < hoy)
      if (custodiasVencidas.length) t.push({ id: 'custodia', icon: 'box', title: 'Custodias de evento por cerrar', detail: 'El evento ya pasó: liquida ventas, devoluciones y faltantes.', count: custodiasVencidas.length, tone: 'warn', screen: 'av_custodias' })
    }

    if (role === 'pos') {
      // `assigned_to` es UUID con backend (email en demo). Antes se comparaba SIEMPRE
      // contra el email → en producción nunca coincidía y el vendedor veía "todo al día".
      const mineId = hasSupabase ? currentUserId() : user?.email
      const prospNuevos = prospects.filter((p) => p.assigned_to === mineId && (p.status ?? 'nuevo') === 'nuevo')
      if (prospNuevos.length) t.push({ id: 'prosp', icon: 'grid', title: 'Prospectos nuevos', detail: 'Contáctalos.', count: prospNuevos.length, tone: 'warn', screen: 'av_prosp' })
    }

    return t
    // `byOrder` y `claims` FALTABAN aquí: si el dinero o los pagos declarados llegaban
    // después de los pedidos, la bandeja no se recalculaba y "Pagos por validar" o
    // "Por surtir" quedaban invisibles hasta que cambiara otra cosa.
  }, [role, user, orders, byOrder, claims, shipments, lots, doctors, prospects, devoluciones, compras, custodias])

  // Lo que la cola fiscal reporta hacia arriba, para que "Todo al día" no se muestre
  // junto a productos que siguen sin validar.
  const [fiscalPend, setFiscalPend] = useState(0)
  const [mensajesPend, setMensajesPend] = useState(0)
  const total = tasks.reduce((s, x) => s + x.count, 0) + fiscalPend + mensajesPend
  const vacio = tasks.length === 0 && fiscalPend === 0 && mensajesPend === 0

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="eyebrow">{getRole(role as RoleKey).label} · Mi bandeja</div>

      {vacio ? (
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="gi" style={{ width: 46, height: 46, borderRadius: 13, background: 'var(--grad-green)', color: '#fff', display: 'grid', placeItems: 'center', margin: '0 auto 12px' }}><Icon name="check" /></div>
          <div style={{ fontWeight: 600 }}>Todo al día</div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4 }}>No tienes pendientes en este momento.</div>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 13, color: 'var(--ink-2)' }}><b>{total}</b> pendiente(s) · toca uno para resolverlo.</div>
          {tasks.map((task) => <TaskRow key={task.id} task={task} onGo={() => setScreen(task.screen)} />)}
        </>
      )}
      {role === 'admin' && <ColaMensajes onGo={() => setScreen('av_mensajes')} onCount={setMensajesPend} />}
      {role === 'admin' && <ColaFiscal onGo={() => setScreen('av_fiscal')} onCount={setFiscalPend} />}
    </div>
  )
}

// La cola fiscal vive en su propio componente porque su fuente (la hoja de trabajo
// fiscal) solo la puede leer Dirección: así no se consulta para los demás roles.
function ColaFiscal({ onGo, onCount }: { onGo: () => void; onCount: (n: number) => void }) {
  const { avance, loading } = useRevisionFiscal()
  const pendientes = loading ? 0 : Math.max(0, avance.total - avance.validados)
  useEffect(() => { onCount(pendientes) }, [pendientes, onCount])
  if (pendientes <= 0) return null
  return (
    <TaskRow onGo={onGo} task={{
      id: 'fiscal', icon: 'shield', title: 'Productos sin validar fiscalmente',
      detail: 'Un producto sin validar se puede vender, pero no facturar.',
      count: pendientes, tone: 'neu', screen: 'av_fiscal',
    }} />
  )
}

// Mensajes al cliente que no salieron y esperan a una persona: rechazados, sin
// confirmar o sin correo. También se deriva del servidor (el buzón de salida).
function ColaMensajes({ onGo, onCount }: { onGo: () => void; onCount: (n: number) => void }) {
  const { cuentas, loading } = useComunicaciones()
  const n = loading ? 0 : cuentas.conProblema
  useEffect(() => { onCount(n) }, [n, onCount])
  if (n <= 0) return null
  return (
    <TaskRow onGo={onGo} task={{
      id: 'mensajes', icon: 'chat', title: 'Mensajes al cliente sin entregar',
      detail: 'No salieron, no se confirmaron o el cliente no tiene correo.',
      count: n, tone: 'warn', screen: 'av_mensajes',
    }} />
  )
}

const toneBg: Record<Tone, string> = { warn: 'var(--warn-bg)', dang: 'var(--danger-bg)', neu: 'var(--ok-bg)' }
const toneFg: Record<Tone, string> = { warn: 'var(--warn)', dang: 'var(--danger)', neu: 'var(--green-deep)' }
const tonePill: Record<Tone, string> = { warn: 'p-warn', dang: 'p-dang', neu: 'p-neu' }

function TaskRow({ task, onGo }: { task: Task; onGo: () => void }) {
  return (
    <button
      type="button"
      className="card clickrow"
      onClick={onGo}
      style={{ display: 'flex', alignItems: 'center', gap: 14, width: '100%', textAlign: 'left', fontFamily: 'inherit', cursor: 'pointer', border: '1px solid var(--line)' }}
    >
      <div style={{ width: 40, height: 40, borderRadius: 11, background: toneBg[task.tone], color: toneFg[task.tone], display: 'grid', placeItems: 'center', flex: 'none' }}>
        <Icon name={task.icon} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{task.title}</div>
      </div>
      <span className={'pill ' + tonePill[task.tone]}>{task.count}</span>
      <span aria-hidden style={{ color: 'var(--ink-3)', fontSize: 20, lineHeight: 1, flex: 'none' }}>›</span>
    </button>
  )
}
