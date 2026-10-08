// CENTRO DE TAREAS — "Mi bandeja". Pendientes priorizados del rol actual,
// agregados de los MISMOS stores que el resto del sistema (no inventa nada). Cada
// tarjeta enruta al módulo donde se resuelve (apoya la Regla 2: el sistema indica
// el siguiente pendiente). Es la funcionalidad "Muy Alta" pedida por todos.
// CHV2-B · El constructor de tareas (`useBandeja`) es ÚNICO: Mi bandeja muestra la cola completa e
// Inicio muestra su subconjunto superior con el MISMO resultado — no pueden contradecirse.
import React, { useCallback, useEffect, useMemo, useState } from 'react'
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
import { useSaludSistema } from '../data/hooks/useSaludSistema'
import { useAtencionComercial, fuenteComercial, type EstadoAtencionComercial } from '../data/store/atencionStore'   // CHV2-B
import { solicitudesVendedor, activasVendedor, intervencionDireccion, TEXTO_HORARIO_PENDIENTE } from '../data/ops/atencionComercial'
import { tieneCfdi } from '../data/ops/cfdi'
import { clasificarDeclaraciones } from '../data/ops/pagosPendientes'
import { useRevisionEconomica } from '../data/hooks/useRevisionEconomica'
import { hasSupabase, currentUserId } from '../lib/supabase'
import { isSurtible, diagnoseShipment } from '../data/ops/seguimiento'
import { daysUntil, severity } from './warehouse/expiry'
import { hoyNegocio } from '../data/periodo'

export type Tone = 'warn' | 'dang' | 'neu'
// `screen` ausente = aviso informativo sin destino (p. ej. salud del sistema: no hay nada que reparar aquí).
export interface Task { id: string; icon: IconName; title: string; detail: string; count: number; tone: Tone; screen?: string }

const isEmitida = (o: OrderWithItems) => tieneCfdi(o) // reconoce 'emitida' Y 'timbrada' (fuente única)
const notCancelled = (o: OrderWithItems) => o.status !== 'cancelled'
const PESO: Record<Tone, number> = { dang: 0, warn: 1, neu: 2 }
/** Orden de urgencia estable (Inicio): primero lo crítico, luego advertencias, luego informativo. */
export const porUrgencia = (a: Task, b: Task) => PESO[a.tone] - PESO[b.tone]

/** Tareas de los stores compartidos (pedidos, dinero, inventario…) para el rol actual. */
function useTareasBase(): Task[] {
  const { role, user } = useRole()
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
  return useMemo<Task[]>(() => {
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
      // PAY-EXP-01A-3 · MISMO universo que la lista de "Pagos por validar" (los de pedidos cancelados → Revisión económica).
      const transferPend = clasificarDeclaraciones(claims, orders).vigentes
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
}

// CHV2-B · Atención comercial desde el store compartido (la misma lectura que Inicio y la alerta).
// Vendedor: SUS solicitudes sin iniciar y sus asesorías con mensajes sin leer. Dirección: lo que
// requiere su intervención (sin vendedor, escaladas, cartera por reasignar, carritos sin rutear) y el
// horario sin configurar. Ya no es una lectura única al montar: se refresca con la señal en vivo.
export function tareasComerciales(est: EstadoAtencionComercial): Task[] {
  const t: Task[] = []
  if (est.fuente === 'vendedor') {
    const sol = solicitudesVendedor(est.cola)
    if (sol.length) {
      const urgentes = sol.some((c) => c.atencion?.estado === 'escalado' || c.atencion?.estado === 'aviso')
      t.push({ id: 'comercial', icon: 'chat', title: 'Clientes esperando asesor', detail: 'Te los asignaron y el asistente los atiende mientras tanto. Inicia la asesoría.', count: sol.length, tone: urgentes ? 'dang' : 'warn', screen: 'asesorias' })
    }
    const conMensajes = activasVendedor(est.cola).filter((c) => c.sin_leer > 0)
    if (conMensajes.length) t.push({ id: 'asesorias_activas', icon: 'chat', title: 'Asesorías con mensajes sin leer', detail: 'Tus clientes te escribieron en una asesoría en curso.', count: conMensajes.length, tone: 'warn', screen: 'asesorias' })
  }
  if (est.fuente === 'direccion' && est.pendientes) {
    const r = est.pendientes.resumen
    const interv = intervencionDireccion(est.pendientes.conversaciones)
    const escaladas = interv.filter((c) => c.atencion?.estado === 'escalado' && c.seller_id).length
    const n = r.handoffs_sin_asignar + escaladas + r.reasignacion + r.handoffs_pendientes
    const sinHorario = !r.horario.configurado
    if (n > 0 || sinHorario) {
      const partes = [
        r.handoffs_sin_asignar ? `${r.handoffs_sin_asignar} conversación(es) sin vendedor` : '',
        escaladas ? `${escaladas} solicitud(es) escalada(s) por espera` : '',
        r.reasignacion ? `${r.reasignacion} cliente(s) por reasignar` : '',
        r.handoffs_pendientes ? `${r.handoffs_pendientes} carrito(s) sin rutear` : '',
        sinHorario ? TEXTO_HORARIO_PENDIENTE.toLowerCase() : '',
      ].filter(Boolean)
      t.push({ id: 'comercial', icon: 'chat', title: 'Atención comercial pendiente', detail: partes.join(' · ') + '.', count: n || 1, tone: r.handoffs_pendientes || escaladas || r.handoffs_sin_asignar ? 'dang' : 'warn', screen: 'av_atencion' })
    }
  }
  return t
}

/**
 * EL constructor de la bandeja. Devuelve las tareas (en el orden canónico) y `fuentes`: componentes
 * invisibles de las colas que solo Dirección puede leer (fiscal, mensajes, salud). Quien use el hook
 * debe montar `fuentes`.
 */
export function useBandeja(): { tareas: Task[]; fuentes: React.ReactNode; comercialListo: boolean } {
  const { role, capabilities } = useRole()
  const base = useTareasBase()
  const est = useAtencionComercial(fuenteComercial(role as RoleKey, capabilities))
  const comerciales = useMemo(() => tareasComerciales(est), [est])
  const [extra, setExtra] = useState<Record<string, Task | null>>({})
  const reportar = useCallback((id: string, t: Task | null) => setExtra((m) => (m[id] === t || (m[id] && t && m[id]!.count === t.count && m[id]!.detail === t.detail) ? m : { ...m, [id]: t })), [])
  const tareas = useMemo(() => [...comerciales, ...base, ...(['mensajes', 'fiscal', 'salud', 'revision'] as const).map((k) => extra[k]).filter((x): x is Task => !!x)], [comerciales, base, extra])
  const fuentes = role === 'admin' ? <><FuenteMensajes onTarea={reportar} /><FuenteFiscal onTarea={reportar} /><FuenteSalud onTarea={reportar} /><FuenteRevision onTarea={reportar} /></> : null
  return { tareas, fuentes, comercialListo: !est.fuente || est.listo }
}

/** Lista de tareas. `limite` = vista resumida (Inicio): las más urgentes primero. */
export function ListaTareas({ tareas, limite, onGo }: { tareas: Task[]; limite?: number; onGo: (screen: string) => void }) {
  const vista = limite != null ? [...tareas].sort(porUrgencia).slice(0, limite) : tareas
  return <>{vista.map((task) => (task.screen ? <TaskRow key={task.id} task={task} onGo={() => onGo(task.screen!)} /> : <AvisoRow key={task.id} task={task} />))}</>
}

export function Bandeja() {
  const { role, setScreen } = useRole()
  const { tareas, fuentes } = useBandeja()
  const total = tareas.reduce((s, x) => s + x.count, 0)

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="eyebrow">{getRole(role as RoleKey).label} · Mi bandeja</div>
      {fuentes}
      {tareas.length === 0 ? (
        <div className="card" style={{ textAlign: 'center' }}>
          <div className="gi" style={{ width: 46, height: 46, borderRadius: 13, background: 'var(--grad-green)', color: '#fff', display: 'grid', placeItems: 'center', margin: '0 auto 12px' }}><Icon name="check" /></div>
          <div style={{ fontWeight: 600 }}>Todo al día</div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4 }}>No tienes pendientes en este momento.</div>
        </div>
      ) : (
        <>
          <div style={{ fontSize: 13, color: 'var(--ink-2)' }}><b>{total}</b> pendiente(s) · toca uno para resolverlo.</div>
          <ListaTareas tareas={tareas} onGo={setScreen} />
        </>
      )}
    </div>
  )
}

type Reportar = (id: string, t: Task | null) => void

// La cola fiscal vive en su propio componente porque su fuente (la hoja de trabajo
// fiscal) solo la puede leer Dirección: así no se consulta para los demás roles.
function FuenteFiscal({ onTarea }: { onTarea: Reportar }) {
  const { avance, loading } = useRevisionFiscal()
  const pendientes = loading ? 0 : Math.max(0, avance.total - avance.validados)
  useEffect(() => {
    onTarea('fiscal', pendientes > 0 ? { id: 'fiscal', icon: 'shield', title: 'Productos sin validar fiscalmente', detail: 'Un producto sin validar se puede vender, pero no facturar.', count: pendientes, tone: 'neu', screen: 'av_fiscal' } : null)
  }, [pendientes, onTarea])
  return null
}

// Mensajes al cliente que no salieron y esperan a una persona: rechazados, sin
// confirmar o sin correo. También se deriva del servidor (el buzón de salida).
function FuenteMensajes({ onTarea }: { onTarea: Reportar }) {
  const { cuentas, loading } = useComunicaciones()
  const n = loading ? 0 : cuentas.conProblema
  useEffect(() => {
    onTarea('mensajes', n > 0 ? { id: 'mensajes', icon: 'chat', title: 'Mensajes al cliente sin entregar', detail: 'No salieron, no se confirmaron o el cliente no tiene correo.', count: n, tone: 'warn', screen: 'av_mensajes' } : null)
  }, [n, onTarea])
  return null
}

// W6-A3.2 · Salud del sistema (procesos automáticos). Solo Dirección la consulta y solo
// aparece cuando el SERVIDOR ya clasificó un problema (FAILED / STALE) o cuando no se
// pudo consultar: un error de lectura no es "todo al día". Sin destino: no hay nada que
// reparar desde aquí; el mensaje viene redactado del servidor, sin detalles internos.
function FuenteSalud({ onTarea }: { onTarea: Reportar }) {
  const salud = useSaludSistema()
  const visible = salud.estado === 'unhealthy' || salud.estado === 'read_error'
  const problema = salud.estado === 'unhealthy'
  const tone: Tone = problema && salud.salud.estado === 'FAILED' ? 'dang' : 'warn'
  const detalle = problema ? salud.salud.mensaje ?? '' : salud.estado === 'read_error' ? salud.error : ''
  useEffect(() => {
    onTarea('salud', visible ? { id: 'salud', icon: 'clock', title: problema ? 'Alertas automáticas con problema' : 'Salud del sistema', detail: detalle, count: 1, tone } : null)
  }, [visible, problema, detalle, tone, onTarea])
  return null
}

// PAY-EXP-01A-3 · Revisión económica (solo Dirección/Facturación; el servidor autoriza). Casos abiertos → tarea;
// si no se pudo consultar, se avisa (un error de lectura NO es "sin casos").
function FuenteRevision({ onTarea }: { onTarea: Reportar }) {
  const rev = useRevisionEconomica(hasSupabase)
  const n = rev.estado === 'listo' ? rev.data.resumen.abiertos : 0
  const fallo = rev.estado === 'error'
  useEffect(() => {
    onTarea('revision', n > 0 ? { id: 'revision', icon: 'shield', title: 'Revisión económica', detail: 'Pedidos cuyo dinero requiere una decisión (cancelados con dinero o comprobante, reembolsos).', count: n, tone: 'dang', screen: 'av_revision' }
      : fallo ? { id: 'revision', icon: 'shield', title: 'Revisión económica', detail: 'No se pudo consultar; ábrela para reintentar.', count: 1, tone: 'warn', screen: 'av_revision' } : null)
  }, [n, fallo, onTarea])
  return null
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
        {task.detail && <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2 }}>{task.detail}</div>}
      </div>
      <span className={'pill ' + tonePill[task.tone]}>{task.count}</span>
      <span aria-hidden style={{ color: 'var(--ink-3)', fontSize: 20, lineHeight: 1, flex: 'none' }}>›</span>
    </button>
  )
}

function AvisoRow({ task }: { task: Task }) {
  return (
    <div className="card" role="status" style={{ display: 'flex', alignItems: 'center', gap: 14, border: '1px solid var(--line)' }}>
      <div style={{ width: 40, height: 40, borderRadius: 11, background: toneBg[task.tone], color: toneFg[task.tone], display: 'grid', placeItems: 'center', flex: 'none' }}>
        <Icon name={task.icon} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{task.title}</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 2, overflowWrap: 'anywhere' }}>{task.detail}</div>
      </div>
      <span className={'pill ' + tonePill[task.tone]}>{task.count}</span>
    </div>
  )
}
