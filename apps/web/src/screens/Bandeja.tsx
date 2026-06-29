// CENTRO DE TAREAS — "Mi bandeja". Pendientes priorizados del rol actual,
// agregados de los MISMOS stores que el resto del sistema (no inventa nada). Cada
// tarjeta enruta al módulo donde se resuelve (apoya la Regla 2: el sistema indica
// el siguiente pendiente). Es la funcionalidad "Muy Alta" pedida por todos.
import React, { useMemo } from 'react'
import { Icon, type IconName } from '../app/icons'
import { useRole } from '../auth/RoleContext'
import { getRole, type RoleKey } from '../app/roles'
import { useAllOrders, type OrderWithItems } from '../data/hooks/useOrders'
import { useShipments } from '../data/hooks/useShipments'
import { useLots } from '../data/hooks/useLots'
import { useDoctors } from '../data/hooks/useDoctors'
import { useProspects } from '../data/hooks/useProspects'
import { isSurtible, diagnoseShipment } from '../data/ops/seguimiento'
import { daysUntil, severity } from './warehouse/expiry'

type Tone = 'warn' | 'dang' | 'neu'
interface Task { id: string; icon: IconName; title: string; detail: string; count: number; tone: Tone; screen: string }

const isEmitida = (o: OrderWithItems) =>
  ((o.invoice_meta as Record<string, unknown> | null)?.status as string) === 'emitida'
const notCancelled = (o: OrderWithItems) => o.status !== 'cancelled'

export function Bandeja() {
  const { role, setScreen } = useRole()
  const { data: orders } = useAllOrders()
  const { data: shipments } = useShipments()
  const { data: lots } = useLots()
  const { data: doctors } = useDoctors()
  const { data: prospects } = useProspects()

  const tasks = useMemo<Task[]>(() => {
    const t: Task[] = []
    const lotesCriticos = lots.filter((l) => l.quantity > 0 && ['expired', 'critical'].includes(severity(daysUntil(l.expiry_date))))
    const porSurtir = orders.filter(isSurtible)
    const porEmpacar = orders.filter((o) => o.status === 'packed')

    if (role === 'warehouse') {
      if (porSurtir.length) t.push({ id: 'surtir', icon: 'layers', title: 'Pedidos por surtir', detail: 'Asigna lotes por FEFO y descuenta inventario.', count: porSurtir.length, tone: 'warn', screen: 'surtido' })
      if (porEmpacar.length) t.push({ id: 'empacar', icon: 'pkg', title: 'Pedidos por empacar', detail: 'Asigna envío (paquetería o chofer).', count: porEmpacar.length, tone: 'warn', screen: 'cola' })
      if (lotesCriticos.length) t.push({ id: 'caduc', icon: 'clock', title: 'Lotes por caducar', detail: 'Caducados o ≤ 60 días: prioriza su salida.', count: lotesCriticos.length, tone: 'dang', screen: 'caduc' })
    }

    if (role === 'admin') {
      const docsPend = doctors.filter((d) => !d.verified)
      const prospNuevos = prospects.filter((p) => (p.status ?? 'nuevo') === 'nuevo')
      const atorados = orders.filter((o) => ['packed', 'shipped'].includes(o.status ?? '') && diagnoseShipment(o, shipments.find((s) => s.order_id === o.id)).stuck)
      const porEmitir = orders.filter((o) => notCancelled(o) && o.invoice_requested && !isEmitida(o))
      const porCobrar = orders.filter((o) => notCancelled(o) && o.payment_status !== 'paid')

      if (docsPend.length) t.push({ id: 'verificar', icon: 'usercheck', title: 'Doctores por verificar', detail: 'Habilita su canal en el Portal.', count: docsPend.length, tone: 'warn', screen: 'av_doc' })
      if (prospNuevos.length) t.push({ id: 'prosp', icon: 'grid', title: 'Prospectos nuevos', detail: 'Contáctalos y muévelos por el pipeline.', count: prospNuevos.length, tone: 'warn', screen: 'av_prosp' })
      if (atorados.length) t.push({ id: 'atorados', icon: 'truck', title: 'Envíos atorados', detail: 'Requieren atención en seguimiento.', count: atorados.length, tone: 'dang', screen: 'seguimiento' })
      if (porEmitir.length) t.push({ id: 'cfdi', icon: 'receipt', title: 'CFDI por emitir', detail: 'Pedidos con factura solicitada.', count: porEmitir.length, tone: 'warn', screen: 'av_fin' })
      if (porCobrar.length) t.push({ id: 'cobrar', icon: 'receipt', title: 'Por cobrar', detail: 'Cuentas por cobrar (contra pedido / pendiente).', count: porCobrar.length, tone: 'neu', screen: 'av_fin' })
      if (lotesCriticos.length) t.push({ id: 'caduc', icon: 'clock', title: 'Lotes por caducar', detail: 'Revisa el detalle en el Tablero.', count: lotesCriticos.length, tone: 'warn', screen: 'tablero' })
    }

    return t
  }, [role, orders, shipments, lots, doctors, prospects])

  const total = tasks.reduce((s, x) => s + x.count, 0)

  return (
    <div className="grid" style={{ gap: 16 }}>
      <div className="eyebrow">{getRole(role as RoleKey).label} · Mi bandeja</div>

      {tasks.length === 0 ? (
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
    </div>
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
